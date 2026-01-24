import { ImapFlow } from 'imapflow';
import { Buffer } from 'buffer';
import { convert } from 'html-to-text';
import { redis, EmailModel, UserConfigModel } from './db';

const BG_WORKER_COUNT = 10;
const REDIS_TTL = 86400;

export const workerState = new Array(BG_WORKER_COUNT).fill(null).map((_, i) => ({
    id: i, status: 'IDLE', jobId: '', folder: '', duration: 0, lastActivity: Date.now()
}));
export const systemStats = { jobsCompleted: 0, jobsFailed: 0, jobsRetried: 0, startTime: Date.now() };
export const syncLocks = new Map<string, boolean>();
export const syncCooldowns = new Map<string, number>();
let connectionBackoffUntil = 0;

export const userWorkers = new Map<string, boolean>();
export const activeClients = new Map<string, ImapFlow>();

interface Job { id: string; priority: number; data: any; addedAt: number; attempts: number; }
class JobQueue {
    private jobs: Job[] = [];
    private processing = new Set<string>();
    add(job: Job) { 
        if (this.processing.has(job.id)) return;
        const existingIdx = this.jobs.findIndex(j => j.id === job.id);
        if (existingIdx !== -1) {
            if (job.priority < this.jobs[existingIdx].priority) { this.jobs[existingIdx] = job; this.sort(); }
            return;
        }
        if (!job.attempts) job.attempts = 0;
        this.jobs.push(job);
        this.sort();
    }
    pop(): Job | undefined { const job = this.jobs.shift(); if (job) this.processing.add(job.id); return job; }
    done(id: string) { this.processing.delete(id); }
    private sort() { this.jobs.sort((a, b) => (a.priority !== b.priority) ? a.priority - b.priority : a.addedAt - b.addedAt); }
    getStats() { return { pending: this.jobs.length, processing: this.processing.size, topJobs: this.jobs.slice(0, 5) }; }
}

const userQueues = new Map<string, JobQueue>();
export function getQueue(user: string) {
    if (!userQueues.has(user)) userQueues.set(user, new JobQueue());
    return userQueues.get(user)!;
}

function updateWorkerState(id: number, status: string, job?: Job) {
    workerState[id].status = status;
    workerState[id].lastActivity = Date.now();
    if (job) {
        workerState[id].jobId = job.id;
        workerState[id].folder = job.data.folder;
    } else if (status === 'IDLE') {
        workerState[id].jobId = '';
        workerState[id].folder = '';
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
      else if (name.match(/sent/i) && !map.Sent.includes('/')) map.Sent = name;
      else if (name.match(/draft/i) && !map.Drafts.includes('/')) map.Drafts = name;
      else if ((name.match(/trash/i) || name.match(/bin/i) || name.match(/deleted/i)) && !map.Trash.includes('/')) { map.Trash = name; }
    });
    await redis.setex(`folder_map:${user}`, 60, JSON.stringify(map));
    return map;
  } catch (e) { return map; }
}

export async function startWorkerSwarm(config: any) {
    if (userWorkers.has(config.user)) return; 
    userWorkers.set(config.user, true);
    console.log(`🚀 Spawning ${BG_WORKER_COUNT} Workers for ${config.user}`);
    for (let i = 0; i < BG_WORKER_COUNT; i++) {
        runWorker(i, config).catch(e => console.error(`Worker ${i} died:`, e));
        await new Promise(r => setTimeout(r, 500)); 
    }
}

async function runWorker(workerId: number, config: any) {
    const queue = getQueue(config.user);
    let client: ImapFlow | null = null;
    let currentFolder = '';
    let lastActionTime = Date.now();

    const connect = async () => {
        if (!userWorkers.has(config.user)) return false; 
        if (Date.now() < connectionBackoffUntil) { updateWorkerState(workerId, 'COOLDOWN'); return false; }
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
            if (e.responseText && e.responseText.includes('Too many simultaneous')) {
                console.warn(`🛑 GMAIL OVERLOAD: Pausing workers.`);
                connectionBackoffUntil = Date.now() + 30000;
            }
            return false;
        }
    };

    await connect();

    while (true) {
        if (!userWorkers.has(config.user)) { 
            if (client) try { client.close(); } catch(e) {}
            updateWorkerState(workerId, 'TERMINATED');
            break; 
        }
        if (Date.now() < connectionBackoffUntil) { await new Promise(r => setTimeout(r, 1000)); continue; }
        if (Date.now() - lastActionTime > 25000 && client?.usable) { try { await client.noop(); lastActionTime = Date.now(); } catch(e) {} }

        const job = queue.pop();
        if (!job) {
            updateWorkerState(workerId, 'IDLE');
            await new Promise(r => setTimeout(r, 500));
            continue;
        }

        updateWorkerState(workerId, 'WORKING', job);
        if (!client || !client.usable) await connect();
        if (!userWorkers.has(config.user)) { queue.add(job); break; }
        if (!client) { queue.add(job); await new Promise(r => setTimeout(r, 2000)); continue; }

        try {
            if (currentFolder !== job.data.folder) {
                if (client.mailbox) await client.mailboxClose();
                const map = await getFolderMap(client, config.user);
                const realPath = map[job.data.folder];
                if (realPath) { await client.getMailboxLock(realPath); currentFolder = job.data.folder; } 
                else { queue.done(job.id); continue; }
            }

            const exists = await EmailModel.findOne({ id: job.id }, { isFullBody: 1 });
            if (exists && exists.isFullBody) { queue.done(job.id); continue; }

            // 🛑 CHANGED: Added `peek: true` to prevent marking as read when fetching body
            const msg = await client.fetchOne(job.data.uid.toString(), { bodyStructure: true }, { uid: true });
            if (!msg) throw new Error("Msg not found");

            const partId = findBestPart(msg.bodyStructure);
            // 🛑 CHANGED: Download with `peek: true` implies we don't change flags
            const downloadResult = await client.download(job.data.uid.toString(), partId, { uid: true, peek: true });
            if (!downloadResult || !downloadResult.content) throw new Error("Empty content");

            let body = await streamToString(downloadResult.content);
            body = body.replace(/src=["'](https?:\/\/[^"']+)["']/gi, (match, url) => `src="/api/v1/proxy/image?url=${encodeURIComponent(url)}"`);
            const preview = generateSmartSnippet(body);

            const updated = await EmailModel.findOneAndUpdate(
                { id: job.id, user: config.user },
                { body, preview, isFullBody: true },
                { new: true, upsert: true }
            );

            if (updated) {
                await redis.setex(`mail_obj:${job.id}:${config.user}`, REDIS_TTL, JSON.stringify(updated));
                await redis.expire(`sync_active:${config.user}`, 10);
            }
            lastActionTime = Date.now();
            systemStats.jobsCompleted++;
            queue.done(job.id);
        } catch (e: any) {
            systemStats.jobsFailed++;
            queue.done(job.id); 
            if (job.attempts < 3) { job.attempts++; systemStats.jobsRetried++; setTimeout(() => { queue.add(job); }, 2000); }
            if (e.code === 'ETIMEOUT' || (e.message && (e.message.includes('closed') || e.message.includes('Socket')))) await connect();
        }
    }
}

function safeTimestamp(date: any): number {
    if (!date) return Date.now();
    const ts = new Date(date).getTime();
    return isNaN(ts) ? Date.now() : ts;
}

export async function saveBatch(messages: any[], folder: string, user: string, queue: JobQueue) {
    const ops = messages.map(msg => {
        const f = msg.envelope.from?.[0] || {};
        const cleanName = f.name || f.address || 'Unknown';
        const cleanAddr = f.address || 'unknown';
        // 🛑 NEW: Capture Read Status correctly from flags
        const isRead = msg.flags.has('\\Seen');

        return {
            updateOne: {
                filter: { id: `uid-${msg.uid}-${folder}`, user },
                update: {
                    // 🛑 NEW: Update 'read' status on every sync
                    $set: { 
                        timestamp: safeTimestamp(msg.envelope.date), 
                        read: isRead, 
                        folder: folder 
                    },
                    $setOnInsert: { 
                        uid: msg.uid, 
                        from: cleanAddr, 
                        senderName: cleanName, 
                        senderAddr: cleanAddr,
                        to: msg.envelope.to?.[0]?.address || user, 
                        subject: msg.envelope.subject || '(No Subject)', 
                        body: "", preview: "", isFullBody: false 
                    }
                },
                upsert: true
            }
        };
    });
    await EmailModel.bulkWrite(ops);
    await redis.del(`mail:${user}:list:${folder}`);
    const ids = messages.map(m => `uid-${m.uid}-${folder}`);
    const needsWork = await EmailModel.find({ id: { $in: ids }, isFullBody: false }, { id: 1, uid: 1 }).lean();
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
            // 🛑 OPTIMIZATION: Check for flag updates on recent messages
            const range = `${Math.max(1, client.mailbox.exists - 50)}:${client.mailbox.exists}`;
            await syncRangeAtomic(client, range, 'Inbox', user, queue, 10);
        } finally { lock.release(); }
    } catch (e) { console.error("Quick Sync Failed:", e); }
    finally {
        await redis.setex(`sync_progress:${user}`, 60, JSON.stringify({ status: 'IDLE', percent: 100 }));
    }
}

export async function runFullSync(client: ImapFlow, user: string) {
  const map = await getFolderMap(client, user);
  const foldersToSync = ['Inbox', 'Trash', 'Sent', 'Drafts', 'Spam'];
  const queue = getQueue(user);
  
  await redis.setex(`sync_progress:${user}`, 300, JSON.stringify({ status: 'HYDRATING', percent: 1 }));

  for (const standardName of foldersToSync) {
    const realPath = map[standardName];
    if (!realPath) continue;
    try {
      console.log(`📂 MOUNTING: ${standardName} (Path: ${realPath})`);
      if (client.mailbox) await client.mailboxClose();
      let lock;
      try { lock = await client.getMailboxLock(realPath); } catch (e) { continue; }
      try {
        const mailbox = client.mailbox;
        if (mailbox.exists === 0) continue;
        await redis.del(`mail:${user}:list:${standardName}`);
        const totalToSync = 400;
        const batchSize = (standardName === 'Sent') ? 25 : 50; 
        const top = mailbox.exists;
        const bottom = Math.max(1, top - totalToSync);
        if (mailbox.exists < 100) {
             await syncRangeAtomic(client, `1:${mailbox.exists}`, standardName, user, queue, 10);
        } else {
            for (let i = top; i > bottom; i -= batchSize) {
                const from = Math.max(bottom, i - batchSize + 1);
                const to = i;
                const range = `${from}:${to}`;
                try {
                    const saveSize = (i === top) ? 5 : 10;
                    await syncRangeAtomic(client, range, standardName, user, queue, saveSize);
                } catch (e) {
                   for (let j = to; j >= from; j -= 10) {
                       const subFrom = Math.max(from, j - 9);
                       const subRange = `${subFrom}:${j}`;
                       try { await syncRangeAtomic(client, subRange, standardName, user, queue, 1); } catch (err2) {}
                   }
                }
            }
        }
      } finally { lock.release(); }
    } catch (e) { console.error(`Failed to sync folder ${standardName}:`, e); }
  }
  
  await UserConfigModel.findOneAndUpdate({ user }, { setupComplete: true, lastSync: Date.now() });
  await redis.setex(`sync_progress:${user}`, 60, JSON.stringify({ status: 'IDLE', percent: 100 }));
  console.log(`🎉 FIRST SYNC COMPLETE for ${user}. Background sync enabled.`);
}

function findBestPart(node: any): string | null {
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

function streamToString(stream: any): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: any[] = [];
    stream.on("data", (chunk: any) => chunks.push(chunk));
    stream.on("end", () => resolve(Buffer.concat(chunks).toString('utf-8')));
    stream.on("error", reject);
  });
}

function generateSmartSnippet(text: string): string {
    if (!text) return "";
    let clean = text.replace(/<style([\s\S]*?)<\/style>/gi, "").replace(/<script([\s\S]*?)<\/script>/gi, "");
    clean = convert(clean, { wordwrap: false, limits: { maxInputLength: 5000000 }, selectors: [ { selector: 'a', options: { ignoreHref: true } }, { selector: 'img', format: 'skip' } ] });
    return clean.replace(/\s+/g, " ").trim().substring(0, 160);
}

export function preWarmCache(emails: any[], user: string) {
  if (!emails || emails.length === 0) return;
  const queue = getQueue(user);
  emails.forEach(email => { if (!email.isFullBody) queue.add({ id: email.id, priority: 2, addedAt: Date.now(), data: { uid: email.uid, folder: email.folder, user }, attempts: 0 }); });
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
    } catch (e) {
        console.error(`Failed to spawn background client for ${cfg.user}:`, e);
    }
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