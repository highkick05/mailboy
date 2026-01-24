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

// Imports
// 🛑 UPDATED: Added SmartRuleModel
import { redis, connectDB, EmailModel, UserConfigModel, LabelModel, SmartRuleModel } from './db';
import { resolveBrandLogo, resolveBrandName, TRANSPARENT_PIXEL } from './logo-engine';
import { startWorkerSwarm, runFullSync, runQuickSync, getQueue, activeClients, syncLocks, syncCooldowns, userWorkers, workerState, systemStats, getFolderMap, preWarmCache, spawnBackgroundClient, killSwarm } from './workers';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const CACHE_DIR = path.join(process.cwd(), 'img_cache');
const REDIS_TTL = 86400; 

// Init
connectDB().then(async () => {
    // 🔍 Boot Loader - Restore sessions for users with setupComplete: true
    console.log("🔍 Scanning for Active Users...");
    const activeUsers = await UserConfigModel.find({ setupComplete: true });
    activeUsers.forEach(cfg => {
        spawnBackgroundClient(cfg);
    });
});

(async () => { try { await fs.mkdir(CACHE_DIR, { recursive: true }); } catch (e) {} })();

app.use(cors() as any);
app.use(express.json() as any);

// =========================================================
// API ROUTES
// =========================================================

app.get('/api/v1/health', (req, res) => { res.json({ status: 'UP', timestamp: Date.now() }); });

// Save Config to MongoDB (Persistent)
app.post('/api/v1/config/save', async (req, res) => {
  try {
      // 1. Save to Redis (Fast access)
      await redis.setex(`config:${req.body.user}`, REDIS_TTL, JSON.stringify(req.body));
      
      // 2. Save to MongoDB (Persistence) - Upsert
      await UserConfigModel.findOneAndUpdate(
          { user: req.body.user },
          { ...req.body, setupComplete: false }, // Reset setup flag on new config
          { upsert: true, new: true }
      );
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
  
  startWorkerSwarm(req.body);
  
  (async () => {
    try {
        const getClient = async (cfg: any) => {
            if (activeClients.has(cfg.user)) return activeClients.get(cfg.user)!;
            const client = new ImapFlow({
                host: cfg.imapHost, port: cfg.imapPort, secure: cfg.useTLS || cfg.imapPort === 993,
                auth: { user: cfg.user, pass: cfg.pass }, logger: false, clientTimeout: 60000, 
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
  const { user, folder, category } = req.query; // 🛑 Added category
  const target = (folder as string) || 'Inbox';
  
  // Distinguish between System Folders and Custom Labels
  const SYSTEM_FOLDERS = ['Inbox', 'Sent', 'Drafts', 'Trash', 'Spam', 'Archive'];
  
  // Build the query dynamically
  const query: any = { user };
  
  if (SYSTEM_FOLDERS.includes(target)) {
      query.folder = target;
      
      // 🛑 SMART TABS: Only filter by category if we are in Inbox and category is set
      if (target === 'Inbox' && category && category !== 'all') {
          query.category = category;
      }
  } else {
      query.labels = target; 
  }

  const listKey = `mail:${user}:list:${target}:${category || 'all'}`; // Updated cache key
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

app.get('/api/v1/mail/:id', async (req, res) => {
  const { id } = req.params;
  const { user } = req.query;
  const cacheKey = `mail_obj:${id}:${user}`;
  const l1 = await redis.get(cacheKey);
  if (l1) { const data = JSON.parse(l1); if (data.isFullBody) return res.json({ email: data, source: 'Redis' }); }
  const l2 = await EmailModel.findOne({ id, user });
  if (l2 && l2.isFullBody) { await redis.setex(cacheKey, REDIS_TTL, JSON.stringify(l2)); return res.json({ email: l2, source: 'MongoDB' }); }
  const queue = getQueue(user as string);
  if (l2) queue.add({ id: l2.id, priority: 1, addedAt: 0, data: { uid: l2.uid!, folder: l2.folder || 'Inbox', user: user as string }, attempts: 0 });
  res.status(408).json({ error: 'Fetch timed out - Worker busy' });
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

// Reset now kills the swarm first
app.delete('/api/v1/debug/reset', async (req, res) => {
  try {
    await killSwarm();
    await redis.flushall();
    await EmailModel.deleteMany({});
    await UserConfigModel.deleteMany({});
    await LabelModel.deleteMany({});
    await SmartRuleModel.deleteMany({}); // 🛑 Clear Smart Rules too

    console.log("✨ System Reset Cleanly");
    res.json({ status: 'SYSTEM_WIPED' });
  } catch (e) { 
    console.error(e);
    res.status(500).json({ error: 'WIPE_FAILED' }); 
  }
});

app.get('/api/v1/debug/workers', (req, res) => {
    res.json({
        workers: workerState.map(w => ({ ...w, ageMs: w.status === 'WORKING' ? Date.now() - w.lastActivity : 0 })),
        system: systemStats,
        locks: Array.from(syncLocks.keys()),
        timestamp: Date.now()
    });
});

app.get('/monitor', (req, res) => {
    res.send(`<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Mailboy Console</title><style>body{background:#0f172a;color:#e2e8f0;font-family:'Courier New',monospace;padding:20px}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:15px;margin-bottom:20px}.card{background:#1e293b;padding:15px;border-radius:8px;border:1px solid #334155}.card.working{border-color:#22c55e;box-shadow:0 0 10px rgba(34,197,94,0.2)}.card.error{border-color:#ef4444}h1{font-size:1.5rem;margin-bottom:10px;color:#38bdf8}.stat-val{font-size:1.5rem;font-weight:bold}.stat-label{color:#94a3b8;font-size:0.8rem}</style></head><body><div style="display:flex;justify-content:space-between;align-items:center;"><h1>⚡ Mailboy Swarm</h1><div id="clock">--:--:--</div></div><div class="grid"><div class="card"><div class="stat-val" id="jobsCompleted">0</div><div class="stat-label">Jobs Done</div></div><div class="card"><div class="stat-val" id="queueSize">0</div><div class="stat-label">Queue</div></div><div class="card"><div class="stat-val" id="activeLocks">0</div><div class="stat-label">Active Syncs</div></div></div><h3>Workers</h3><div class="grid" id="workerGrid"></div><script>function update(){fetch('/api/v1/debug/workers').then(r=>r.json()).then(data=>{document.getElementById('jobsCompleted').innerText=data.system.jobsCompleted;document.getElementById('queueSize').innerText=data.queue?.pending||0;document.getElementById('activeLocks').innerText=data.locks.length;const grid=document.getElementById('workerGrid');grid.innerHTML=data.workers.map(w=>{const statusClass=w.status==='WORKING'?'working':(w.status==='ERROR'?'error':'');return \`<div class="card \${statusClass}"><div><strong>Worker \${w.id}</strong></div><div style="color:\${w.status==='WORKING'?'#4ade80':'#64748b'}">\${w.status}</div>\${w.status==='WORKING'?\`<div style="font-size:0.75rem;margin-top:5px;word-break:break-all;">\${w.jobId}</div><div style="font-size:0.75rem;color:#facc15;">\${(w.ageMs/1000).toFixed(1)}s</div><div style="font-size:0.75rem;color:#94a3b8;">📂 \${w.folder}</div>\`:''}</div>\`}).join('');document.getElementById('clock').innerText=new Date().toLocaleTimeString()})}setInterval(update,1000);update();</script></body></html>`);
});

// SMTP Relay Endpoint
app.post('/api/v1/mail/send', async (req, res) => {
  const { auth, payload } = req.body;
  if (!auth || !payload) return res.status(400).json({ error: "MISSING_DATA" });
  try {
      const isImplicitSSL = auth.smtpPort === 465;
      const transporter = nodemailer.createTransport({
          host: auth.smtpHost, port: auth.smtpPort, secure: isImplicitSSL, 
          auth: { user: auth.user, pass: auth.pass },
          tls: { rejectUnauthorized: false, ciphers: 'SSLv3' }
      });
      const info = await transporter.sendMail({
          from: `"${auth.user}" <${auth.user}>`, 
          to: payload.to, subject: payload.subject,
          text: payload.body.replace(/<[^>]*>?/gm, ''), html: payload.body
      });
      console.log(`📤 Email sent: ${info.messageId}`);
      res.json({ status: 'SENT', messageId: info.messageId });
  } catch (error: any) {
      console.error("SMTP Relay Error:", error);
      res.status(500).json({ error: "SMTP_FAILED", details: error.message });
  }
});

// Mark Email as Read/Unread
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
                } catch(e) { console.error("IMAP Flag Update Failed", e); } 
                finally { lock.release(); }
            })();
        }
    } catch (e) {}
  }
  res.json({ status: 'UPDATED' });
});

// 🛑 UPDATED: Move Email + Smart Learning + BULK UPDATE
app.post('/api/v1/mail/move', async (req, res) => {
  const { emailId, targetFolder, user } = req.body;
  
  // 1. Check if this is a Smart Category Move
  const SMART_TABS = ['primary', 'social', 'updates', 'promotions'];
  const isCategoryMove = SMART_TABS.includes(targetFolder.toLowerCase());

  try {
    const email = await EmailModel.findOne({ id: emailId, user });
    if (!email) return res.status(404).json({ error: "Email not found" });

    // A: HANDLE SMART TAB MOVE (Learn + Classify + Bulk Update)
    if (isCategoryMove) {
        const newCategory = targetFolder.toLowerCase();

        // 1. Determine the Sender Rule
        let valueToLearn = null;
        if (email.senderAddr && email.senderAddr.includes('@')) {
            const domain = email.senderAddr.split('@')[1].toLowerCase();
            const genericProviders = ['gmail.com', 'outlook.com', 'yahoo.com', 'icloud.com', 'hotmail.com'];
            
            // If generic, learn full address. If business, learn domain.
            valueToLearn = genericProviders.includes(domain) 
                ? email.senderAddr.toLowerCase() 
                : domain;
        }

        // 2. BULK UPDATE: Move ALL existing emails from this sender to the new tab
        //    (If we identified a rule, use that. Otherwise just use the specific email's sender address)
        const senderQuery = valueToLearn 
            ? { $or: [ { senderAddr: { $regex: valueToLearn, $options: 'i' } }, { from: { $regex: valueToLearn, $options: 'i' } } ] }
            : { senderAddr: email.senderAddr }; // Fallback

        await EmailModel.updateMany(
            { user, ...senderQuery }, 
            { category: newCategory }
        );
        
        // 3. Save the Rule for FUTURE emails
        if (valueToLearn) {
            await SmartRuleModel.findOneAndUpdate(
                { user, category: newCategory, value: valueToLearn },
                { user, category: newCategory, type: 'from', value: valueToLearn },
                { upsert: true }
            );
            await redis.del(`smart_rules:${user}`); 
            console.log(`🧠 SMART LEARN & BULK MOVE: ${valueToLearn} -> ${targetFolder}`);
        }
        
        // 4. Clear Cache so the user sees the changes on refresh
        await redis.del(`mail:${user}:list:Inbox:all`);
        await redis.del(`mail:${user}:list:Inbox:primary`);
        await redis.del(`mail:${user}:list:Inbox:social`);
        await redis.del(`mail:${user}:list:Inbox:updates`);
        await redis.del(`mail:${user}:list:Inbox:promotions`);
        
        res.json({ status: 'CATEGORIZED_BULK' });
        return; 
    }

    // B: HANDLE FOLDER MOVE (Archive/Trash/Inbox)
    const sourceFolder = email.folder || 'Inbox';
    await EmailModel.findOneAndUpdate({ id: emailId, user }, { folder: targetFolder });
    
    // Clear Caches
    await redis.del(`mail_obj:${emailId}:${user}`);
    await redis.del(`mail:${user}:list:${sourceFolder}:all`); 
    await redis.del(`mail:${user}:list:${targetFolder}:all`);

    // IMAP Move
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

// 🛑 NEW: Smart Rules API
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

// Label Management
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