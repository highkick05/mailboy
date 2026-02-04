import { ImapFlow } from 'imapflow';
import { Buffer } from 'buffer';
import { convert } from 'html-to-text';
import fs from 'fs/promises';
import path from 'path';
import { lookup, extension } from 'mime-types'; 
import { redis, EmailModel, UserConfigModel, SmartRuleModel } from './db';

// 🛑 EXPORTED CONSTANTS
export const BG_WORKER_COUNT = 5; 
export const REDIS_TTL = 86400;
export const ATTACHMENT_DIR = path.resolve('/app/attachments');

let isSystemRunning = true;

// 🛑 Shared State
export const workerState = new Array(BG_WORKER_COUNT + 1).fill(null).map((_, i) => ({
    id: i === BG_WORKER_COUNT ? 99 : i,
    status: 'IDLE', jobId: '', folder: '', duration: 0, lastActivity: Date.now(), type: i === BG_WORKER_COUNT ? 'DRAFT' : 'STD'
}));

export const systemStats = { jobsCompleted: 0, jobsFailed: 0, jobsRetried: 0, startTime: Date.now() };
export const syncLocks = new Map<string, boolean>();
export const syncCooldowns = new Map<string, number>();
let connectionBackoffUntil = 0;

export const userWorkers = new Map<string, boolean>();
export const activeClients = new Map<string, ImapFlow>();

const DEFAULT_RULES = {
    promotions: ['unsubscribe', 'opt-out', 'sale', 'discount', 'newsletter', 'marketing'],
    social: ['facebook', 'twitter', 'linkedin', 'instagram', 'friend request'],
    updates: ['receipt', 'billing', 'invoice', 'order', 'tracking', 'security alert', 'password reset']
};

export const killSwarm = async () => {
    isSystemRunning = false;
    userWorkers.clear();
    for (const [user, client] of activeClients.entries()) {
        try { await client.logout(); } catch (e) { client.close(); }
    }
    activeClients.clear();
    syncLocks.clear();
    syncCooldowns.clear();
    setTimeout(() => { isSystemRunning = true; }, 1000);
};

interface Job { id: string; priority: number; data: any; addedAt: number; attempts: number; }

class JobQueue {
    private jobs: Job[] = [];
    private processing = new Set<string>();

    add(job: Job) { 
        if (this.processing.has(job.id)) return;
        if (job.data.type === 'DRAFT_SYNC') job.priority = 0;

        const existingIdx = this.jobs.findIndex(j => j.id === job.id);
        if (existingIdx !== -1) {
            if (job.priority < this.jobs[existingIdx].priority) { 
                this.jobs[existingIdx] = job; 
                this.sort(); 
            }
            return;
        }
        if (!job.attempts) job.attempts = 0;
        this.jobs.push(job);
        this.sort();
    }

    popDraft(): Job | undefined {
        const idx = this.jobs.findIndex(j => j.data.type === 'DRAFT_SYNC');
        if (idx !== -1) {
            const job = this.jobs[idx];
            this.jobs.splice(idx, 1);
            this.processing.add(job.id);
            return job;
        }
        return undefined;
    }

    popStandard(): Job | undefined {
        const idx = this.jobs.findIndex(j => j.data.type !== 'DRAFT_SYNC');
        if (idx !== -1) {
            const job = this.jobs[idx];
            this.jobs.splice(idx, 1);
            this.processing.add(job.id);
            return job;
        }
        return undefined;
    }

    done(id: string) { 
        this.processing.delete(id); 
    }

    getStats() {
        return {
            pending: this.jobs.length,
            processing: this.processing.size,
            topJobs: this.jobs.slice(0, 5).map(j => ({ id: j.id, type: j.data.type || 'HYDRATION' }))
        };
    }

    private sort() { 
        this.jobs.sort((a, b) => (a.priority !== b.priority) ? a.priority - b.priority : a.addedAt - b.addedAt); 
    }
}

const userQueues = new Map<string, JobQueue>();
export function getQueue(user: string) {
    if (!userQueues.has(user)) userQueues.set(user, new JobQueue());
    return userQueues.get(user)!;
}

// 🛑 EXPORTED HELPER
export function updateWorkerState(id: number, status: string, job?: Job) {
    const index = id === 99 ? BG_WORKER_COUNT : id;
    if (workerState[index]) {
        workerState[index].status = status;
        workerState[index].lastActivity = Date.now();
        if (job) {
            workerState[index].jobId = job.id;
            workerState[index].folder = job.data.folder || 'N/A';
        } else if (status === 'IDLE') {
            workerState[index].jobId = '';
            workerState[index].folder = '';
        }
    }
}

export async function getFolderMap(client: ImapFlow, user: string): Promise<Record<string, string>> {
  const map: Record<string, string> = { Inbox: 'INBOX', Sent: 'Sent', Drafts: 'Drafts', Trash: 'Trash', Spam: 'Spam' };
  try {
    const list = await client.list();
    list.forEach(folder => {
      const flags = folder.specialUse || [];
      const name = folder.path;
      if (flags.includes('\\Sent')) map.Sent = name;
      else if (flags.includes('\\Drafts')) map.Drafts = name;
      else if (flags.includes('\\Trash')) map.Trash = name;
      else if (flags.includes('\\Junk')) map.Spam = name;
    });
    return map;
  } catch (e) { return map; }
}

// 🛑 STANDARD WORKER LOGIC
async function runWorker(workerId: number, config: any) {
    const queue = getQueue(config.user);
    let client: ImapFlow | null = null;
    let currentFolder = '';
    let lastActionTime = Date.now();

    const connect = async () => {
        if (!isSystemRunning || !userWorkers.has(config.user)) return false;
        
        if (Date.now() < connectionBackoffUntil) { 
            updateWorkerState(workerId, 'COOLDOWN'); 
            return false; 
        }

        try {
            updateWorkerState(workerId, 'CONNECTING');
            if (client) try { client.close(); } catch(e) {}
            client = new ImapFlow({
                host: config.imapHost, port: config.imapPort, secure: config.useTLS || config.imapPort === 993,
                auth: { user: config.user, pass: config.pass }, logger: false, clientTimeout: 90000, 
            });
            await client.connect();
            updateWorkerState(workerId, 'IDLE');
            lastActionTime = Date.now();
            return true;
        } catch (e: any) {
            updateWorkerState(workerId, 'ERROR');
            if (e.responseText && (e.responseText.includes('Too many') || e.responseText.includes('THROTTLED'))) {
                connectionBackoffUntil = Date.now() + 120000; 
            }
            return false;
        }
    };

    await connect();

    while (isSystemRunning) {
        if (!userWorkers.has(config.user)) {
            if (client) try { client.close(); } catch(e) {}
            updateWorkerState(workerId, 'TERMINATED');
            break; 
        }

        if (Date.now() < connectionBackoffUntil) { await new Promise(r => setTimeout(r, 5000)); continue; }
        if (Date.now() - lastActionTime > 25000 && client?.usable) { try { await client.noop(); lastActionTime = Date.now(); } catch(e) {} }

        const job = queue.popStandard();
        if (!job) {
            updateWorkerState(workerId, 'IDLE');
            await new Promise(r => setTimeout(r, 1000));
            continue;
        }

        updateWorkerState(workerId, 'WORKING', job);
        if (!client || !client.usable) await connect();
        if (!client) { queue.add(job); continue; }

        try {
            if (currentFolder !== job.data.folder) {
                if (client.mailbox) await client.mailboxClose();
                const map = await getFolderMap(client, config.user);
                const realPath = map[job.data.folder];
                if (realPath) { await client.getMailboxLock(realPath); currentFolder = job.data.folder; } 
                else { queue.done(job.id); continue; }
            }

            const exists = await EmailModel.findOne({ id: job.id }, { isFullBody: 1 });
            if (exists?.isFullBody) { queue.done(job.id); continue; }

            const msg = await client.fetchOne(job.data.uid.toString(), { bodyStructure: true }, { uid: true });
            if (!msg) throw new Error("Msg not found");

            const partId = findBestPart(msg.bodyStructure);
            const downloadResult = await client.download(job.data.uid.toString(), partId, { uid: true, peek: true });
            if (!downloadResult?.content) throw new Error("Empty content");

            let body = await streamToString(downloadResult.content);
            body = body.replace(/src=["'](https?:\/\/[^"']+)["']/gi, (match, url) => `src="/api/v1/proxy/image?url=${encodeURIComponent(url)}"`);
            
            const attachmentParts = findAttachmentParts(msg.bodyStructure);
            const savedAttachments: any[] = [];
            for (const part of attachmentParts) {
                if (!part.part) continue;
                try {
                    const mimeType = part.type || 'application/octet-stream';
                    const ext = extension(mimeType);
                    let originalName = part.filename || `att-${Date.now()}.${ext || 'bin'}`;
                    const uniqueFilename = `${Date.now()}-${originalName.replace(/[^a-z0-9.-]/gi, '_')}`;
                    const filePath = path.join(ATTACHMENT_DIR, uniqueFilename);
                    const attStream = await client.download(job.data.uid.toString(), part.part, { uid: true, peek: true });
                    if (attStream?.content) {
                        await fs.writeFile(filePath, attStream.content);
                        savedAttachments.push({ filename: originalName, path: uniqueFilename, size: part.size, mimeType, cid: part.id });
                    }
                } catch (err) { console.error("Attachment err", err); }
            }

            const updated = await EmailModel.findOneAndUpdate(
                { id: job.id, user: config.user },
                { body, preview: generateSmartSnippet(body), isFullBody: true, attachments: savedAttachments },
                { new: true, upsert: true }
            );
            if (updated) await redis.setex(`mail_obj:${job.id}:${config.user}`, REDIS_TTL, JSON.stringify(updated));

            lastActionTime = Date.now();
            systemStats.jobsCompleted++;
            queue.done(job.id);
        } catch (e: any) {
            systemStats.jobsFailed++;
            queue.done(job.id);
            if (job.attempts < 3) { job.attempts++; queue.add(job); }
            if (e.message?.includes('closed')) await connect();
        }
    }
}

export async function startWorkerSwarm(config: any) {
    if (!isSystemRunning || userWorkers.has(config.user)) return; 
    userWorkers.set(config.user, true);
    for (let i = 0; i < BG_WORKER_COUNT; i++) {
        setTimeout(() => runWorker(i, config), i * 2000); 
    }
    // 🛑 Note: Draft Worker is now started by server.ts via draftWorker.ts
}

// 🛑 EXPORTED UTILS
export function findBestPart(node: any): string | null {
  const findHtml = (n: any): string | null => {
    if (n.type === 'text/html') return n.part;
    if (n.childNodes) for (const child of n.childNodes) { const res = findHtml(child); if (res) return res; }
    return null;
  };
  const findText = (n: any): string | null => {
    if (n.type === 'text/plain') return n.part;
    if (n.childNodes) for (const child of n.childNodes) { const res = findText(child); if (res) return res; }
    return null;
  };
  return findHtml(node) || findText(node) || '1';
}

export function streamToString(stream: any): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: any[] = [];
    stream.on("data", (chunk: any) => chunks.push(chunk));
    stream.on("end", () => resolve(Buffer.concat(chunks).toString('utf-8')));
    stream.on("error", reject);
  });
}

export function generateSmartSnippet(text: string): string {
    if (!text) return "";
    let clean = text.replace(/<style([\s\S]*?)<\/style>/gi, "").replace(/<script([\s\S]*?)<\/script>/gi, "");
    clean = convert(clean, { wordwrap: false, limits: { maxInputLength: 5000000 }, selectors: [ { selector: 'a', options: { ignoreHref: true } }, { selector: 'img', format: 'skip' } ] });
    return clean.replace(/\s+/g, " ").trim().substring(0, 160);
}

export function findAttachmentParts(node: any): any[] {
  let attachments: any[] = [];
  if (node.disposition === 'attachment' || (node.disposition === 'inline' && node.filename)) {
    attachments.push(node);
  }
  if (node.childNodes) {
    for (const child of node.childNodes) {
      attachments = attachments.concat(findAttachmentParts(child));
    }
  }
  return attachments;
}

export function preWarmCache(emails: any[], user: string) {
  if (!emails || emails.length === 0) return;
  const queue = getQueue(user);
  emails.forEach(email => { if (!email.isFullBody) queue.add({ id: email.id, priority: 2, addedAt: Date.now(), data: { uid: email.uid, folder: email.folder, user }, attempts: 0 }); });
}

function safeTimestamp(date: any): number {
  if (!date) return Date.now();
  const ts = new Date(date).getTime();
  return isNaN(ts) ? Date.now() : ts;
}

async function getUserRules(user: string) {
  const cacheKey = `smart_rules:${user}`;
  const cached = await redis.get(cacheKey);
  if (cached) return JSON.parse(cached);
  const rules = await SmartRuleModel.find({ user }).lean();
  await redis.setex(cacheKey, 3600, JSON.stringify(rules));
  return rules;
}

async function classifyEmail(msg: any, user: string): Promise<string> {
  const rules = await getUserRules(user);
  const from = (msg.envelope.from?.[0]?.address || "").toLowerCase();
  const subject = (msg.envelope.subject || "").toLowerCase();
  for (const rule of rules) {
    if (rule.type === 'from' && from.includes(rule.value.toLowerCase())) return rule.category;
    if (rule.type === 'subject' && subject.includes(rule.value.toLowerCase())) return rule.category;
  }
  if (DEFAULT_RULES.promotions.some(kw => from.includes(kw) || subject.includes(kw))) return 'promotions';
  if (DEFAULT_RULES.social.some(kw => from.includes(kw) || subject.includes(kw))) return 'social';
  if (DEFAULT_RULES.updates.some(kw => from.includes(kw) || subject.includes(kw))) return 'updates';
  return 'primary';
}

export async function saveBatch(messages: any[], folder: string, user: string, queue: JobQueue) {
  // Check if system running? Skipped for brevity, managed by caller
  const classifiedData = await Promise.all(messages.map(async (msg) => ({ msg, category: await classifyEmail(msg, user) })));
  const ops = classifiedData.map(({ msg, category }) => {
    const f = msg.envelope.from?.[0] || {};
    const cleanName = f.name || f.address || 'Unknown';
    const cleanAddr = f.address || 'unknown';
    return {
      updateOne: {
        filter: { id: `uid-${msg.uid}-${folder}`, user },
        update: {
          $set: { timestamp: safeTimestamp(msg.envelope.date), read: msg.flags.has('\\Seen'), folder: folder, category: category },
          $setOnInsert: { uid: msg.uid, from: cleanAddr, senderName: cleanName, senderAddr: cleanAddr, to: msg.envelope.to?.[0]?.address || user, subject: msg.envelope.subject || '(No Subject)', body: "", preview: "", isFullBody: false }
        },
        upsert: true
      }
    };
  });
  await EmailModel.bulkWrite(ops);
  
  await redis.del(`mail:${user}:list:${folder}`);
  await redis.del(`mail:${user}:list:${folder}:all`);

  const ids = messages.map(m => `uid-${m.uid}-${folder}`);
  const needsWork = await EmailModel.find({ id: { $in: ids }, isFullBody: false }, { id: 1, uid: 1 }).sort({timestamp: -1}).limit(20).lean();
  needsWork.forEach(doc => { queue.add({ id: doc.id, priority: 4, addedAt: Date.now(), data: { uid: doc.uid!, folder: folder, user }, attempts: 0 }); });
}

export async function syncRangeAtomic(client: ImapFlow, range: string, folder: string, user: string, queue: JobQueue, batchSize: number) {
  const fetchOptions = { envelope: true, flags: true, uid: true, internalDate: true };
  let batch: any[] = [];
  let count = 0;
  for await (let msg of client.fetch(range, fetchOptions)) {
    batch.push(msg);
    count++;
    if (batch.length >= (count === 1 ? 1 : batchSize)) { await saveBatch(batch, folder, user, queue); batch = []; }
  }
  if (batch.length > 0) await saveBatch(batch, folder, user, queue);
}

export async function runQuickSync(client: ImapFlow, user: string) {
  const map = await getFolderMap(client, user);
  const inboxPath = map['Inbox'];
  const queue = getQueue(user);
  if (!inboxPath) return;
  try {
    await redis.setex(`sync_progress:${user}`, 60, JSON.stringify({ status: 'SYNCING', percent: 0 }));
    if (client.mailbox) await client.mailboxClose();
    const lock = await client.getMailboxLock(inboxPath);
    try {
      if (client.mailbox.exists === 0) return;
      const range = `${Math.max(1, client.mailbox.exists - 50)}:${client.mailbox.exists}`;
      await syncRangeAtomic(client, range, 'Inbox', user, queue, 10);
    } finally { lock.release(); }
  } catch (e) { console.error("Quick Sync Failed:", e); }
  finally { await redis.setex(`sync_progress:${user}`, 60, JSON.stringify({ status: 'IDLE', percent: 100 })); }
}

export async function runFullSync(client: ImapFlow, user: string) {
  const map = await getFolderMap(client, user);
  const foldersToSync = ['Inbox', 'Trash', 'Sent', 'Spam']; 
  const queue = getQueue(user);
  await redis.setex(`sync_progress:${user}`, 300, JSON.stringify({ status: 'HYDRATING', percent: 1 }));
  
  // 🛑 DRAFTS removed from here (handled by DraftWorker)

  // 🛑 PERCENTAGE LOGGING
  let foldersProcessed = 0;
  for (const standardName of foldersToSync) {
    const realPath = map[standardName];
    if (!realPath) continue;
    try {
      console.log(`📂 Syncing ${standardName} (${foldersProcessed + 1}/${foldersToSync.length})...`);
      if (client.mailbox) await client.mailboxClose();
      await new Promise(r => setTimeout(r, 500));
      let lock;
      try { lock = await client.getMailboxLock(realPath); } catch (e) { continue; }
      try {
        if (client.mailbox.exists === 0) continue;
        await redis.del(`mail:${user}:list:${standardName}`);
        await redis.del(`mail:${user}:list:${standardName}:all`);
        const totalToSync = (standardName === 'Inbox') ? 200 : 50; 
        const top = client.mailbox.exists;
        const bottom = Math.max(1, top - totalToSync);
        if (client.mailbox.exists < 100) {
             await syncRangeAtomic(client, `1:${client.mailbox.exists}`, standardName, user, queue, 10);
        } else {
            for (let i = top; i > bottom; i -= 25) {
                const from = Math.max(bottom, i - 25 + 1);
                
                // Progress Log
                const processed = top - i;
                if (processed > 0 && processed % 50 === 0) {
                    const percent = Math.round((processed / totalToSync) * 100);
                    console.log(`[${standardName}] ⏳ Syncing: ${percent}% complete`);
                }

                await syncRangeAtomic(client, `${from}:${i}`, standardName, user, queue, 10);
            }
        }
      } finally { lock.release(); }
    } catch (e) { console.error(`Failed to sync folder ${standardName}:`, e); }
    foldersProcessed++;
  }
  
  await UserConfigModel.findOneAndUpdate({ user }, { setupComplete: true, lastSync: Date.now() });
  await redis.setex(`sync_progress:${user}`, 60, JSON.stringify({ status: 'IDLE', percent: 100 }));
  console.log(`🎉 FIRST SYNC COMPLETE for ${user}.`);
}

export async function spawnBackgroundClient(cfg: any) {
    if (activeClients.has(cfg.user)) return;
    try {
        const client = new ImapFlow({
            host: cfg.imapHost, port: cfg.imapPort, secure: cfg.useTLS || cfg.imapPort === 993,
            auth: { user: cfg.user, pass: cfg.pass }, logger: false, clientTimeout: 60000, 
        });
        await client.connect();
        activeClients.set(cfg.user, client);
        startWorkerSwarm(cfg); 
        console.log(`👻 Background Sync Session Restored: ${cfg.user}`);
    } catch (e) { console.error(`Failed to spawn background client:`, e); }
}

setInterval(() => {
    if (activeClients.size > 0) {
        activeClients.forEach((client, user) => {
            const lastRun = syncCooldowns.get(user) || 0;
            if (Date.now() - lastRun < 10000) return; 
            if (client.usable && !syncLocks.get(user)) {
                syncLocks.set(user, true);
                runQuickSync(client, user)
                    .finally(() => { syncLocks.delete(user); syncCooldowns.set(user, Date.now()); })
                    .catch(err => console.error(`Auto-Sync failed for ${user}`, err));
            }
        });
    }
}, 60000);