import express from 'express';
import cors from 'cors';
import { Buffer } from 'buffer';
import fs from 'fs/promises';
import fsSync from 'fs'; 
import https from 'https'; 
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { ImapFlow } from 'imapflow';
import nodemailer from 'nodemailer';
import multer from 'multer';
import MailComposer from 'nodemailer/lib/mail-composer/index.js';
import { simpleParser } from 'mailparser'; 

import { redis, connectDB, EmailModel, UserConfigModel, LabelModel, SmartRuleModel } from './db';
import { resolveBrandLogo, resolveBrandName, TRANSPARENT_PIXEL } from './logo-engine';

// 🛑 1. IMPORT STANDARD WORKERS
import { startWorkerSwarm, runFullSync, runQuickSync, getQueue, activeClients, syncLocks, syncCooldowns, userWorkers, workerState, systemStats, getFolderMap, preWarmCache, spawnBackgroundClient, killSwarm, syncRangeAtomic } from './workers';

// 🛑 2. IMPORT DRAFT WORKER SEPARATELY
import { runDraftWorker, uplinkLogs } from './draftWorker';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const CACHE_DIR = path.join(process.cwd(), 'img_cache');
const ATTACHMENT_DIR = path.join(process.cwd(), 'attachments');
const REDIS_TTL = 86400; 

// Global Error Handler
process.on('uncaughtException', (err: any) => {
    if (err.code === 'ETIMEOUT' || err.message?.includes('Socket timeout')) {
        console.warn('⚠️ Caught socket timeout (prevented crash)');
    } else {
        console.error('🚨 Uncaught Exception:', err);
    }
});

// Configure Multer for Disk Storage
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, ATTACHMENT_DIR);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const safeName = file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_');
    cb(null, uniqueSuffix + '-' + safeName);
  }
});
const upload = multer({ storage: storage });

// Default Keywords Logic
const DEFAULT_PROMO_KEYWORDS = ['unsubscribe', 'opt-out', 'view in browser', 'preferences', 'terms and conditions', '% off', 'sale', 'discount', 'clearance', 'promo code', 'coupon', 'free shipping', 'price drop', 'shop now', 'limited time', 'last chance', "don't miss out", 'ending soon', 'exclusive offer', 'newsletter', 'marketing', 'no-reply', 'info@', 'hello@'];

async function seedDefaultRules(user: string) {
    const count = await SmartRuleModel.countDocuments({ user, category: 'promotions' });
    if (count > 5) return; 
    const ops = DEFAULT_PROMO_KEYWORDS.map(kw => ({
        updateOne: {
            filter: { user, category: 'promotions', value: kw.toLowerCase() },
            update: { user, category: 'promotions', type: kw.includes('@') ? 'from' : 'content', value: kw.toLowerCase() },
            upsert: true
        }
    }));
    await SmartRuleModel.bulkWrite(ops);
    await redis.del(`smart_rules:${user}`);
}

// Init
connectDB().then(async () => {
    console.log("🔍 Scanning for Active Users...");
    const activeUsers = await UserConfigModel.find({ setupComplete: true });
    for (const cfg of activeUsers) {
        spawnBackgroundClient(cfg);
        await seedDefaultRules(cfg.user);
    }
});

(async () => { 
    try { await fs.mkdir(CACHE_DIR, { recursive: true }); } catch (e) {} 
    try { await fs.mkdir(ATTACHMENT_DIR, { recursive: true }); } catch (e) {} 
})();

app.use(cors() as any);
app.use(express.json() as any);

// =========================================================
// API ROUTES
// =========================================================

app.get('/api/v1/health', (req, res) => { res.json({ status: 'UP', timestamp: Date.now() }); });

app.get('/api/v1/attachments/:filename', (req, res) => {
    const filePath = path.join(ATTACHMENT_DIR, req.params.filename);
    if (!filePath.startsWith(ATTACHMENT_DIR)) return res.status(403).send('Access Denied');
    res.download(filePath, (err) => {
        if (err) res.status(404).send('File not found');
    });
});

app.post('/api/v1/config/save', async (req, res) => {
  try {
      await redis.setex(`config:${req.body.user}`, REDIS_TTL, JSON.stringify(req.body));
      await UserConfigModel.findOneAndUpdate(
          { user: req.body.user },
          { ...req.body, setupComplete: false }, 
          { upsert: true, new: true }
      );
      await seedDefaultRules(req.body.user);
      res.json({ status: 'PERSISTED_DB' });
  } catch (e) {
      console.error("Config Save Failed", e);
      res.status(500).json({ error: "DB_ERROR" });
  }
});

app.get('/api/v1/sync/status', async (req, res) => {
  const prog = await redis.get(`sync_progress:${req.query.user}`);
  const queue = getQueue(req.query.user as string);
  const stats = queue.getStats();
  const base = prog ? JSON.parse(prog) : { percent: 0, status: 'IDLE' };
  base.queue = stats;
  res.json(base);
});

app.get('/api/v1/proxy/logo', async (req, res) => {
  const domain = req.query.domain as string;
  if (!domain) return res.status(400).send('Domain missing');
  try {
    const result = await resolveBrandLogo(domain);
    res.setHeader('Content-Type', result.contentType);
    res.setHeader('Cache-Control', 'public, max-age=2592000, immutable');
    res.send(result.data);
  } catch (e) { 
    res.setHeader('Content-Type', 'image/gif');
    res.send(TRANSPARENT_PIXEL);
  }
});

app.get('/api/v1/proxy/brand-name', async (req, res) => {
    const domain = req.query.domain as string;
    if (!domain) return res.status(400).json({ name: null });
    const name = await resolveBrandName(domain);
    res.json({ name });
});

app.post('/api/v1/mail/sync', async (req, res) => {
  const { user } = req.body;
  if (syncLocks.get(user)) return res.json({ status: 'SYNC_IN_PROGRESS' });
  syncLocks.set(user, true);
  await redis.setex(`sync_active:${user}`, 30, '1');
  
  // 🛑 3. START WORKERS SEPARATELY
  startWorkerSwarm(req.body);
  setTimeout(() => runDraftWorker(req.body), 1000); 

  (async () => {
    try {
        const getClient = async (cfg: any) => {
            if (activeClients.has(cfg.user)) return activeClients.get(cfg.user)!;
            
            const client = new ImapFlow({
                host: cfg.imapHost, 
                port: cfg.imapPort, 
                secure: cfg.useTLS || cfg.imapPort === 993,
                auth: { user: cfg.user, pass: cfg.pass }, 
                logger: false, 
                clientTimeout: 90000, 
            });

            client.on('error', (err) => {
                console.error(`❌ IMAP Client Error (${cfg.user}):`, err.message);
                if (activeClients.get(cfg.user) === client) activeClients.delete(cfg.user);
            });
            
            client.on('close', () => {
                if (activeClients.get(cfg.user) === client) activeClients.delete(cfg.user);
            });

            await client.connect();
            activeClients.set(cfg.user, client);
            return client;
        };
        const client = await getClient(req.body);
        const count = await EmailModel.countDocuments({ user });
        if (count < 200) await runFullSync(client, user); else await runQuickSync(client, user);
    } catch (e) { console.error("Sync Error", e); }
    finally { syncLocks.delete(user); syncCooldowns.set(user, Date.now()); }
  })();
  res.json({ status: 'SYNC_PIPELINE_INITIATED' });
});

app.get('/api/v1/mail/list', async (req, res) => {
  const { user, folder, category } = req.query; 
  const target = (folder as string) || 'Inbox';
  const SYSTEM_FOLDERS = ['Inbox', 'Sent', 'Drafts', 'Trash', 'Spam', 'Archive'];
  const query: any = { user };
  if (SYSTEM_FOLDERS.includes(target)) {
      query.folder = target;
      if (target === 'Inbox' && category && category !== 'all') {
          query.category = category;
      }
  } else {
      query.labels = target; 
  }
  const listKey = `mail:${user}:list:${target}:${category || 'all'}`; 
  const isLiveMode = await redis.get(`sync_active:${user}`);
  let listData = null;
  if (!isLiveMode) {
      const cached = await redis.get(listKey);
      if (cached) listData = JSON.parse(cached);
  }
  if (!listData) {
    listData = await EmailModel.find(query).sort({ timestamp: -1 }).limit(100).lean();
    if (listData.length > 0 && !isLiveMode) await redis.setex(listKey, REDIS_TTL, JSON.stringify(listData));
  }
  if (listData && listData.length > 0) preWarmCache(listData, user as string);
  res.json(listData);
});

// Email Detail Fetch with Polling Logic
app.get('/api/v1/mail/:id', async (req, res) => {
  const { id } = req.params;
  const { user } = req.query;
  const cacheKey = `mail_obj:${id}:${user}`;

  // 1. Try Redis
  const l1 = await redis.get(cacheKey);
  if (l1) { 
      const data = JSON.parse(l1); 
      if (data.isFullBody) return res.json({ email: data, source: 'Redis' }); 
  }

  // 2. Try DB
  const l2 = await EmailModel.findOne({ id, user });
  if (l2 && l2.isFullBody) { 
      await redis.setex(cacheKey, REDIS_TTL, JSON.stringify(l2)); 
      return res.json({ email: l2, source: 'MongoDB' }); 
  }

  // 3. Not found or partial body? Queue it and WAIT (Polling).
  if (l2) {
      const queue = getQueue(user as string);
      queue.add({ 
          id: l2.id, 
          priority: 1, 
          addedAt: Date.now(), 
          data: { uid: l2.uid!, folder: l2.folder || 'Inbox', user: user as string }, 
          attempts: 0 
      });

      const MAX_ATTEMPTS = 20; 
      const INTERVAL = 500; 

      for (let i = 0; i < MAX_ATTEMPTS; i++) {
          await new Promise(resolve => setTimeout(resolve, INTERVAL));
          const check = await redis.get(cacheKey);
          if (check) {
              const freshData = JSON.parse(check);
              if (freshData.isFullBody) {
                  return res.json({ email: freshData, source: 'Worker-Live' });
              }
          }
          if (i % 4 === 0) { 
             const dbCheck = await EmailModel.findOne({ id, user }, { isFullBody: 1 });
             if (dbCheck && dbCheck.isFullBody) {
                 const fullDoc = await EmailModel.findOne({ id, user });
                 await redis.setex(cacheKey, REDIS_TTL, JSON.stringify(fullDoc));
                 return res.json({ email: fullDoc, source: 'Worker-DB-Live' });
             }
          }
      }
  }
  res.status(408).json({ error: 'Fetch timed out - Worker busy' });
});

// server.ts - Updated Batch Delete
app.post('/api/v1/mail/batch-delete', async (req, res) => {
    const { ids, user } = req.body;
    if (!ids || !Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: 'No IDs provided' });

    try {
        const emailsToDelete = await EmailModel.find({ id: { $in: ids }, user }, { uid: 1, folder: 1 });
        await EmailModel.deleteMany({ id: { $in: ids }, user });
        
        for (const id of ids) await redis.del(`mail_obj:${id}:${user}`);
        const folders = ['Inbox', 'Trash', 'Spam', 'Drafts', 'Sent'];
        for (const f of folders) await redis.del(`mail:${user}:list:${f}:all`);

        res.json({ status: 'DELETED_OPTIMISTIC', count: ids.length });

        // PERFORM REAL IMAP DELETION
        const client = activeClients.get(user as string);
        if (client && client.usable && emailsToDelete.length > 0) {
            (async () => {
                try {
                    const map = await getFolderMap(client, user as string);
                    const deletesByFolder: Record<string, number[]> = {};
                    
                    for (const email of emailsToDelete) {
                        const folder = email.folder || 'Trash';
                        if (!deletesByFolder[folder]) deletesByFolder[folder] = [];
                        if (email.uid) deletesByFolder[folder].push(email.uid);
                    }

                    for (const [folderName, uids] of Object.entries(deletesByFolder)) {
                        const path = map[folderName];
                        if (path && uids.length > 0) {
                            // Use a Lock to ensure we have exclusive access to the folder
                            const lock = await client.getMailboxLock(path);
                            try {
                                // 🛑 FIX: Use a sequence set and a single delete command
                                // Gmail handles \Deleted + Expunge automatically with messageDelete
                                const uidRange = uids.sort((a,b) => a-b).join(',');
                                console.log(`🗑️ IMAP: Executing bulk delete in ${folderName} for UIDs: ${uidRange}`);
                                await client.messageDelete(uidRange, { uid: true });
                            } catch(e: any) {
                                console.error(`IMAP Delete Command Failed [${folderName}]: ${e.message}`);
                            } finally {
                                lock.release();
                            }
                        }
                    }
                } catch (err) { console.error("Background Batch Delete Error", err); }
            })();
        }
    } catch (e) {
        console.error("Batch Delete Error", e);
        res.status(500).json({ error: 'Batch delete failed' });
    }
});

app.delete('/api/v1/mail/:id', async (req, res) => {
    const { id } = req.params;
    const { user } = req.query;
    try {
        const email = await EmailModel.findOne({ id, user });
        if (!email) return res.status(404).json({ error: 'Email not found' });

        await EmailModel.deleteOne({ id, user });
        await redis.del(`mail_obj:${id}:${user}`);
        if (email.folder) await redis.del(`mail:${user}:list:${email.folder}:all`);

        const client = activeClients.get(user as string);
        if (client && client.usable) {
            const map = await getFolderMap(client, user as string);
            const folderPath = map[email.folder || 'Trash'];
            if (folderPath && email.uid) {
                (async () => {
                    const lock = await client.getMailboxLock(folderPath);
                    try {
                        await client.messageFlagsAdd(email.uid, ['\\Deleted'], { uid: true });
                        await client.messageDelete(email.uid, { uid: true });
                    } catch(e) {} finally { lock.release(); }
                })();
            }
        }
        res.json({ status: 'PERMANENTLY_DELETED' });
    } catch (e) {
        res.status(500).json({ error: 'Delete failed' });
    }
});

// mailboy/server.ts - 🛑 UPDATED DRAFT ENDPOINT
app.post('/api/v1/mail/draft', upload.array('files', 10), async (req, res) => {
    const { user, to, subject, body, id: clientId, existingAttachments: existingStr } = req.body;
    
    // Parse existing attachments metadata (sent as JSON string)
    let existingAttachments = [];
    try {
        if (existingStr) existingAttachments = JSON.parse(existingStr);
    } catch (e) {}

    // 1. STAGE IN REDIS (Immediate response)
    const draftKey = `draft_stage:${user}:${clientId}`;
    const payload = {
        to, subject, body, 
        timestamp: Date.now(),
        files: req.files, // New files (Multer metadata)
        existingAttachments   // Old files (Metadata from DB/State)
    };

    console.log(`[API 🌐] 📨 Received Draft Save. ID: ${clientId} | Size: ${body.length} chars | Attachments: ${existingAttachments.length} old, ${req.files?.length || 0} new`);
    await redis.setex(draftKey, 3600, JSON.stringify(payload));
    
    // 2. TRIGGER BACKGROUND SYNC
    const queue = getQueue(user);
    const jobId = `sync-draft-${clientId}-${Date.now()}`;
    queue.add({
        id: jobId,
        priority: 10, 
        addedAt: Date.now(),
        data: { type: 'DRAFT_SYNC', clientId, user },
        attempts: 0
    });

    res.json({ status: 'STAGED', id: clientId });
});

app.get('/api/v1/proxy/image', async (req, res) => {
  const targetUrl = req.query.url as string;
  if (!targetUrl) return res.status(400).send('URL missing');
  const urlHash = crypto.createHash('sha256').update(targetUrl).digest('hex');
  const cacheKey = `img_meta:${urlHash}`;
  const filePath = path.join(CACHE_DIR, urlHash);
  const cachedMeta = await redis.get(cacheKey);
  if (cachedMeta) {
    try {
      const { contentType } = JSON.parse(cachedMeta);
      const data = await fs.readFile(filePath);
      res.setHeader('Content-Type', contentType);
      return res.send(data);
    } catch (e) { }
  }
  try {
    const response = await fetch(targetUrl, { signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error(`Status ${response.status}`);
    const arrayBuf = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuf);
    const contentType = response.headers.get('content-type') || 'image/jpeg';
    await fs.writeFile(filePath, buffer);
    await redis.setex(cacheKey, REDIS_TTL * 7, JSON.stringify({ contentType }));
    res.setHeader('Content-Type', contentType);
    res.send(buffer);
  } catch (e) {
    res.setHeader('Content-Type', 'image/gif');
    res.send(TRANSPARENT_PIXEL);
  }
});

// Robust System Reset
app.delete('/api/v1/debug/reset', async (req, res) => {
  try {
    console.log("☢️ NUCLEAR RESET INITIATED");
    try {
        await Promise.race([
            killSwarm(),
            new Promise((_, reject) => setTimeout(() => reject(new Error('Swarm Kill Timeout')), 3000))
        ]);
    } catch (e) { }

    for (const [user, client] of activeClients.entries()) {
        try { client.close(); } catch (e) {}
        activeClients.delete(user);
    }

    await redis.flushall();
    await EmailModel.deleteMany({});
    await UserConfigModel.deleteMany({});
    await LabelModel.deleteMany({});
    await SmartRuleModel.deleteMany({}); 
    
    try {
        const files = await fs.readdir(ATTACHMENT_DIR);
        for (const file of files) {
            await fs.unlink(path.join(ATTACHMENT_DIR, file));
        }
        console.log(`🗑️ Deleted ${files.length} physical attachments.`);
    } catch(e) {
        console.warn("⚠️ Could not clear attachments folder", e);
    }

    console.log("✨ System Reset Cleanly");
    res.json({ status: 'SYSTEM_WIPED' });
  } catch (e) { 
    res.status(500).json({ error: 'WIPE_FAILED' }); 
  }
});

app.get('/api/v1/debug/workers', (req, res) => {
    res.json({
        workers: workerState.map(w => ({ ...w, ageMs: w.status === 'WORKING' ? Date.now() - w.lastActivity : 0 })),
        system: systemStats,
        locks: Array.from(syncLocks.keys()),
        uplinkLogs, // 🛑 EXPOSE UPLINK LOGS FROM NEW FILE
        timestamp: Date.now()
    });
});

app.get('/monitor', (req, res) => {
    // 🛑 UPDATED MONITOR: Workers on Top, Draft Feed on Bottom, Renamed Worker 99, Added Purple CSS
    res.send(`<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Mailboy Console</title><style>body{background:#0f172a;color:#e2e8f0;font-family:'Courier New',monospace;padding:20px}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:15px;margin-bottom:20px}.card{background:#1e293b;padding:15px;border-radius:8px;border:1px solid #334155}.card.working{border-color:#22c55e;box-shadow:0 0 10px rgba(34,197,94,0.2)}.card.error{border-color:#ef4444}.card.draft-uplink{border-color:#a855f7;box-shadow:0 0 10px rgba(168,85,247,0.2)}h1{font-size:1.5rem;margin-bottom:10px;color:#38bdf8}.stat-val{font-size:1.5rem;font-weight:bold}.stat-label{color:#94a3b8;font-size:0.8rem}.logs{background:#020617;padding:10px;border-radius:8px;height:400px;overflow-y:auto;font-size:0.85rem;border:1px solid #334155;}.log-item{margin-bottom:6px;border-bottom:1px solid #1e293b;padding-bottom:4px;display:flex;gap:10px;}.log-time{color:#64748b;min-width:80px;}.log-msg{flex:1;}.success{color:#4ade80}.error{color:#ef4444}.warn{color:#facc15}.info{color:#94a3b8}</style></head><body><div style="display:flex;justify-content:space-between;align-items:center;"><h1>⚡ Mailboy Swarm</h1><div id="clock">--:--:--</div></div><div class="grid"><div class="card"><div class="stat-val" id="jobsCompleted">0</div><div class="stat-label">Jobs Done</div></div><div class="card"><div class="stat-val" id="queueSize">0</div><div class="stat-label">Queue</div></div><div class="card"><div class="stat-val" id="activeLocks">0</div><div class="stat-label">Active Syncs</div></div></div><h3>Workers</h3><div class="grid" id="workerGrid"></div><h3>📡 Draft Uplink Feed</h3><div class="logs" id="uplinkLogs"></div><script>function update(){fetch('/api/v1/debug/workers').then(r=>r.json()).then(data=>{document.getElementById('jobsCompleted').innerText=data.system.jobsCompleted;document.getElementById('queueSize').innerText=data.queue?.pending||0;document.getElementById('activeLocks').innerText=data.locks.length;const logContainer=document.getElementById('uplinkLogs');if(data.uplinkLogs){logContainer.innerHTML=data.uplinkLogs.map(l=>\`<div class="log-item \${l.type}"><div class="log-time">\${l.time}</div><div class="log-msg">\${l.msg}</div></div>\`).join('');}const grid=document.getElementById('workerGrid');grid.innerHTML=data.workers.map(w=>{let statusClass='';if(w.status==='WORKING')statusClass='working';else if(w.status==='ERROR')statusClass='error';if(w.id===99)statusClass+=' draft-uplink';const workerName=w.id===99?'Draft Uplink':'Worker '+w.id;return \`<div class="card \${statusClass}"><div><strong>\${workerName}</strong></div><div style="color:\${w.status==='WORKING'?'#4ade80':'#64748b'}">\${w.status}</div>\${w.status==='WORKING'?\`<div style="font-size:0.75rem;margin-top:5px;word-break:break-all;">\${w.jobId}</div><div style="font-size:0.75rem;color:#facc15;">\${(w.ageMs/1000).toFixed(1)}s</div><div style="font-size:0.75rem;color:#94a3b8;">📂 \${w.folder}</div>\`:''}</div>\`}).join('');document.getElementById('clock').innerText=new Date().toLocaleTimeString()})}setInterval(update,1000);update();</script></body></html>`);
});

// ... rest of the file (send, mark, move, etc) matches previous version
// SMTP Relay
app.post('/api/v1/mail/send', upload.array('files', 10), async (req, res) => {
  const { auth: authStr, payload: payloadStr } = req.body;
  if (!authStr || !payloadStr) return res.status(400).json({ error: "MISSING_DATA" });
  
  try {
      const auth = JSON.parse(authStr);
      const payload = JSON.parse(payloadStr);
      const draftId = payload.draftId; 

      const attachments = (req.files as Express.Multer.File[] || []).map(file => ({
          filename: file.originalname,
          path: file.path
      }));

      const isImplicitSSL = auth.smtpPort === 465;
      const transporter = nodemailer.createTransport({
          host: auth.smtpHost, port: auth.smtpPort, secure: isImplicitSSL, 
          auth: { user: auth.user, pass: auth.pass },
          tls: { rejectUnauthorized: false, ciphers: 'SSLv3' }
      });
      
      const info = await transporter.sendMail({
          from: `"${auth.user}" <${auth.user}>`, 
          to: payload.to, 
          cc: payload.cc,
          bcc: payload.bcc,
          subject: payload.subject,
          text: payload.body.replace(/<[^>]*>?/gm, ''), 
          html: payload.body,
          attachments: attachments
      });
      
      console.log(`📤 Email sent: ${info.messageId}`);

      const client = activeClients.get(auth.user);
      if (client && client.usable) {
          const map = await getFolderMap(client, auth.user);
          const sentPath = map['Sent']; 
          
          if (sentPath) {
              const lock = await client.getMailboxLock(sentPath);
              try {
                  const mail = new MailComposer({
                      from: auth.user,
                      to: payload.to,
                      cc: payload.cc,
                      bcc: payload.bcc,
                      subject: payload.subject,
                      html: payload.body,
                      text: payload.body.replace(/<[^>]*>?/gm, ''),
                      attachments: attachments
                  });
                  const msgBuffer = await mail.compile().build();
                  await client.append(sentPath, msgBuffer, ['\\Seen']);
                  await redis.del(`mail:${auth.user}:list:Sent`);
              } catch(e) { } 
              finally { lock.release(); }
          }

          if (draftId) {
              const draftsPath = map['Drafts'];
              if (draftsPath) {
                  const draftLock = await client.getMailboxLock(draftsPath);
                  try {
                      const searchCriteria = { header: { 'X-Mailboy-Draft-ID': draftId } };
                      let uidsToDelete: string[] = [];
                      for await (const msg of client.fetch(searchCriteria, { uid: true })) {
                          uidsToDelete.push(msg.uid.toString());
                      }
                      if (uidsToDelete.length === 0) {
                          const uidMatch = draftId.match(/uid-(\d+)-/);
                          if (uidMatch) uidsToDelete.push(uidMatch[1]);
                      }

                      if (uidsToDelete.length > 0) {
                          await client.messageFlagsAdd(uidsToDelete.join(','), ['\\Deleted'], { uid: true });
                          await client.messageDelete(uidsToDelete.join(','), { uid: true });
                          await redis.del(`mail:${auth.user}:list:Drafts`);
                      }
                  } catch (e) { } 
                  finally { draftLock.release(); }
              }
          }
      }

      res.json({ status: 'SENT', messageId: info.messageId });
  } catch (error: any) {
      res.status(500).json({ error: "SMTP_FAILED", details: error.message });
  }
});

app.post('/api/v1/mail/mark', async (req, res) => {
  const { id, read, user } = req.body;
  await EmailModel.findOneAndUpdate({ id, user }, { read });
  await redis.del(`mail_obj:${id}:${user}`); 
  const emailMeta = await EmailModel.findOne({ id, user }, { folder: 1 });
  if (emailMeta?.folder) await redis.del(`mail:${user}:list:${emailMeta.folder}:all`);

  const client = activeClients.get(user);
  if (client && client.usable && emailMeta) {
    try {
        const map = await getFolderMap(client, user);
        const realPath = map[emailMeta.folder || 'Inbox'];
        if (realPath) {
            (async () => {
                const lock = await client.getMailboxLock(realPath);
                try {
                   const uidMatch = id.match(/uid-(\d+)-/);
                   if (uidMatch) {
                       const uid = uidMatch[1];
                       if (read) await client.messageFlagsAdd(uid, ['\\Seen'], { uid: true });
                       else await client.messageFlagsRemove(uid, ['\\Seen'], { uid: true });
                   }
                } catch(e) { } 
                finally { lock.release(); }
            })();
        }
    } catch (e) {}
  }
  res.json({ status: 'UPDATED' });
});

app.post('/api/v1/mail/move', async (req, res) => {
  const { emailId, targetFolder, user } = req.body;
  const SMART_TABS = ['primary', 'social', 'updates', 'promotions'];
  const isCategoryMove = SMART_TABS.includes(targetFolder.toLowerCase());

  try {
    const email = await EmailModel.findOne({ id: emailId, user });
    if (!email) return res.status(404).json({ error: "Email not found" });

    if (isCategoryMove) {
        const newCategory = targetFolder.toLowerCase();
        let valueToLearn = null;
        if (email.senderAddr && email.senderAddr.includes('@')) {
            const domain = email.senderAddr.split('@')[1].toLowerCase();
            const genericProviders = ['gmail.com', 'outlook.com', 'yahoo.com', 'icloud.com', 'hotmail.com'];
            valueToLearn = genericProviders.includes(domain) ? email.senderAddr.toLowerCase() : domain;
        }
        const senderQuery = valueToLearn ? { $or: [ { senderAddr: { $regex: valueToLearn, $options: 'i' } }, { from: { $regex: valueToLearn, $options: 'i' } } ] } : { senderAddr: email.senderAddr }; 
        await EmailModel.updateMany({ user, ...senderQuery }, { category: newCategory });
        if (valueToLearn) {
            await SmartRuleModel.findOneAndUpdate(
                { user, category: newCategory, value: valueToLearn },
                { user, category: newCategory, type: 'from', value: valueToLearn },
                { upsert: true }
            );
            await redis.del(`smart_rules:${user}`); 
        }
        await redis.del(`mail:${user}:list:Inbox:all`);
        await redis.del(`mail:${user}:list:Inbox:primary`);
        await redis.del(`mail:${user}:list:Inbox:social`);
        await redis.del(`mail:${user}:list:Inbox:updates`);
        await redis.del(`mail:${user}:list:Inbox:promotions`);
        res.json({ status: 'CATEGORIZED_BULK' });
        return; 
    }

    const sourceFolder = email.folder || 'Inbox';
    await EmailModel.findOneAndUpdate({ id: emailId, user }, { folder: targetFolder });
    await redis.del(`mail_obj:${emailId}:${user}`);
    await redis.del(`mail:${user}:list:${sourceFolder}:all`); 
    await redis.del(`mail:${user}:list:${targetFolder}:all`);

    const client = activeClients.get(user);
    if (client && client.usable) {
        (async () => {
             try {
                const map = await getFolderMap(client, user);
                const sourcePath = map[sourceFolder];
                const targetPath = map[targetFolder];
                if (sourcePath && targetPath) {
                    const lock = await client.getMailboxLock(sourcePath);
                    try {
                        const uidMatch = emailId.match(/uid-(\d+)-/);
                        if (uidMatch) await client.messageMove(uidMatch[1], targetPath, { uid: true });
                    } finally { lock.release(); }
                }
             } catch (e) { console.error("IMAP Move Failed", e); }
        })();
    }
    res.json({ status: 'MOVED' });
  } catch (e) {
    res.status(500).json({ error: "MOVE_FAILED" });
  }
});

app.get('/api/v1/smart-rules', async (req, res) => {
    const { user } = req.query;
    const rules = await SmartRuleModel.find({ user }).sort({ category: 1 });
    res.json(rules);
});

app.post('/api/v1/smart-rules', async (req, res) => {
    const { user, category, type, value } = req.body;
    try {
        const newRule = await SmartRuleModel.findOneAndUpdate(
            { user, category, value: value.toLowerCase() },
            { user, category, type, value: value.toLowerCase() },
            { upsert: true, new: true }
        );
        await redis.del(`smart_rules:${user}`);
        res.json(newRule);
    } catch (e) { res.status(500).json({ error: "Failed to add rule" }); }
});

app.delete('/api/v1/smart-rules/:id', async (req, res) => {
    const { user } = req.query;
    await SmartRuleModel.findByIdAndDelete(req.params.id);
    await redis.del(`smart_rules:${user as string}`);
    res.json({ status: 'DELETED' });
});

app.get('/api/v1/labels', async (req, res) => {
    const { user } = req.query;
    if (!user) return res.json([]);
    const labels = await LabelModel.find({ user }).sort({ created: 1 });
    res.json(labels);
});

app.post('/api/v1/labels', async (req, res) => {
    const { user, name, color } = req.body;
    const id = name.toLowerCase().replace(/\s+/g, '-');
    try {
        const newLabel = await LabelModel.findOneAndUpdate(
            { user, id }, { user, id, name, color }, { upsert: true, new: true }
        );
        res.json(newLabel);
    } catch (e) { res.status(500).json({ error: "LABEL_CREATION_FAILED" }); }
});

app.delete('/api/v1/labels/:id', async (req, res) => {
    const { user } = req.query;
    await LabelModel.deleteOne({ id: req.params.id, user: user as string });
    res.json({ status: 'DELETED' });
});

app.post('/api/v1/mail/label', async (req, res) => {
    const { emailId, labelId, action, user } = req.body; 
    const update = action === 'add' ? { $addToSet: { labels: labelId } } : { $pull: { labels: labelId } };
    await EmailModel.findOneAndUpdate({ id: emailId, user }, update);
    await redis.del(`mail_obj:${emailId}:${user}`);
    res.json({ status: 'UPDATED' });
});

const distPath = path.join(__dirname, 'dist');
app.use(express.static(distPath));
app.get(/(.*)/, (req, res) => {
  if (req.path.startsWith('/api')) return res.status(404).json({ error: 'API route not found' });
  res.sendFile(path.join(distPath, 'index.html'));
});

const HTTP_PORT = 3001;
app.listen(HTTP_PORT, '0.0.0.0', () => { console.log(`🚀 MAILBOY HTTP ONLINE: http://localhost:${HTTP_PORT}`); });

try {
  const httpsOptions = {
    key: fsSync.readFileSync(path.join(__dirname, 'server.key')),
    cert: fsSync.readFileSync(path.join(__dirname, 'server.cert'))
  };
  const HTTPS_PORT = 3002;
  https.createServer(httpsOptions, app).listen(HTTPS_PORT, '0.0.0.0', () => { console.log(`🔒 MAILBOY HTTPS ONLINE: https://localhost:${HTTPS_PORT}`); });
} catch (e) { console.log("⚠️ HTTPS skipped: server.key or server.cert not found in /app"); }