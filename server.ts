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

// Imports
import { redis, connectDB, EmailModel } from './db';
import { resolveBrandLogo, resolveBrandName, TRANSPARENT_PIXEL } from './logo-engine';
import { startWorkerSwarm, runFullSync, runQuickSync, getQueue, activeClients, syncLocks, syncCooldowns, userWorkers, workerState, systemStats, getFolderMap, preWarmCache } from './workers';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const CACHE_DIR = path.join(process.cwd(), 'img_cache');
const REDIS_TTL = 86400; 

// Init
connectDB();
(async () => { try { await fs.mkdir(CACHE_DIR, { recursive: true }); } catch (e) {} })();

app.use(cors() as any);
app.use(express.json() as any);

// =========================================================
// API ROUTES
// =========================================================

app.get('/api/v1/health', (req, res) => { res.json({ status: 'UP', timestamp: Date.now() }); });

// 🛑 RESTORED: Config Persistence Endpoint
app.post('/api/v1/config/save', async (req, res) => {
  await redis.setex(`config:${req.body.user}`, REDIS_TTL, JSON.stringify(req.body));
  res.json({ status: 'PERSISTED' });
});

// 🛑 RESTORED: Sync Status Endpoint
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
  const { user, folder } = req.query;
  const targetFolder = (folder as string) || 'Inbox';
  const listKey = `mail:${user}:list:${targetFolder}`;
  const isLiveMode = await redis.get(`sync_active:${user}`);
  let listData = null;
  if (!isLiveMode) {
      const cached = await redis.get(listKey);
      if (cached) listData = JSON.parse(cached);
  }
  if (!listData) {
    listData = await EmailModel.find({ user, folder: targetFolder }).sort({ timestamp: -1 }).limit(100).lean();
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

app.delete('/api/v1/debug/reset', async (req, res) => {
  try {
    userWorkers.clear(); 
    activeClients.forEach(c => { try { c.logout(); } catch(e){} });
    activeClients.clear();
    await redis.flushall();
    await EmailModel.deleteMany({});
    syncLocks.clear();
    syncCooldowns.clear();
    res.json({ status: 'SYSTEM_WIPED' });
  } catch (e) { res.status(500).json({ error: 'WIPE_FAILED' }); }
});

app.get('/api/v1/debug/workers', (req, res) => {
    res.json({
        workers: workerState.map(w => ({ ...w, ageMs: w.status === 'WORKING' ? Date.now() - w.lastActivity : 0 })),
        system: systemStats,
        locks: Array.from(syncLocks.keys()),
        timestamp: Date.now()
    });
});

// 🛑 RESTORED: Monitor UI
app.get('/monitor', (req, res) => {
    res.send(`<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Mailboy Console</title><style>body{background:#0f172a;color:#e2e8f0;font-family:'Courier New',monospace;padding:20px}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:15px;margin-bottom:20px}.card{background:#1e293b;padding:15px;border-radius:8px;border:1px solid #334155}.card.working{border-color:#22c55e;box-shadow:0 0 10px rgba(34,197,94,0.2)}.card.error{border-color:#ef4444}h1{font-size:1.5rem;margin-bottom:10px;color:#38bdf8}.stat-val{font-size:1.5rem;font-weight:bold}.stat-label{color:#94a3b8;font-size:0.8rem}</style></head><body><div style="display:flex;justify-content:space-between;align-items:center;"><h1>⚡ Mailboy Swarm</h1><div id="clock">--:--:--</div></div><div class="grid"><div class="card"><div class="stat-val" id="jobsCompleted">0</div><div class="stat-label">Jobs Done</div></div><div class="card"><div class="stat-val" id="queueSize">0</div><div class="stat-label">Queue</div></div><div class="card"><div class="stat-val" id="activeLocks">0</div><div class="stat-label">Active Syncs</div></div></div><h3>Workers</h3><div class="grid" id="workerGrid"></div><script>function update(){fetch('/api/v1/debug/workers').then(r=>r.json()).then(data=>{document.getElementById('jobsCompleted').innerText=data.system.jobsCompleted;document.getElementById('queueSize').innerText=data.queue?.pending||0;document.getElementById('activeLocks').innerText=data.locks.length;const grid=document.getElementById('workerGrid');grid.innerHTML=data.workers.map(w=>{const statusClass=w.status==='WORKING'?'working':(w.status==='ERROR'?'error':'');return \`<div class="card \${statusClass}"><div><strong>Worker \${w.id}</strong></div><div style="color:\${w.status==='WORKING'?'#4ade80':'#64748b'}">\${w.status}</div>\${w.status==='WORKING'?\`<div style="font-size:0.75rem;margin-top:5px;word-break:break-all;">\${w.jobId}</div><div style="font-size:0.75rem;color:#facc15;">\${(w.ageMs/1000).toFixed(1)}s</div><div style="font-size:0.75rem;color:#94a3b8;">📂 \${w.folder}</div>\`:''}</div>\`}).join('');document.getElementById('clock').innerText=new Date().toLocaleTimeString()})}setInterval(update,1000);update();</script></body></html>`);
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