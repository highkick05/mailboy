/**
 * NOVAMAIL 2026 HYBRID ENGINE - V12.4 [IMAGE_CACHE_OPTIMIZATION]
 * Features: Full-Duplex Sync + Immediate Redis Population + Background L1 Warming + Aggressive Image Caching
 */

import express from 'express';
import { ImapFlow } from 'imapflow';
import Redis from 'ioredis';
import mongoose from 'mongoose';
import cors from 'cors';
import { Buffer } from 'buffer';
import fetch from 'node-fetch';
import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';

const app = express();
const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');
const CACHE_DIR = path.join(process.cwd(), 'img_cache');
const LOGO_CACHE_DIR = path.join(CACHE_DIR, 'logos');

const REDIS_TTL = 86400; 
const TRANSPARENT_PIXEL = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');

(async () => {
  try {
    await fs.mkdir(CACHE_DIR, { recursive: true });
    await fs.mkdir(LOGO_CACHE_DIR, { recursive: true });
    console.log(`📂 Cache architecture initialized: ${CACHE_DIR}`);
  } catch (e) {
    console.error('Failed to create cache directory', e);
  }
})();

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/novamail_2026';
mongoose.connect(MONGODB_URI)
  .then(() => console.log('🍃 MongoDB Persistent Layer Online'))
  .catch(err => console.error('MongoDB Connection Error:', err));

const EmailSchema = new mongoose.Schema({
  id: { type: String, unique: true, index: true },
  user: { type: String, index: true },
  uid: Number,
  from: String,
  to: String,
  subject: String,
  body: { type: String, default: "" },
  timestamp: { type: Number, index: true },
  read: Boolean,
  folder: { type: String, index: true }
});

const EmailModel = mongoose.model('Email', EmailSchema);

app.use(cors() as any);
app.use(express.json() as any);

const activeClients = new Map<string, ImapFlow>();

const getClient = async (config: any) => {
  if (activeClients.has(config.user)) {
    const existing = activeClients.get(config.user)!;
    if (existing.usable) return existing;
  }
  const client = new ImapFlow({
    host: config.imapHost,
    port: config.imapPort,
    secure: config.useTLS || config.imapPort === 993,
    auth: { user: config.user, pass: config.pass },
    logger: false
  });
  await client.connect();
  activeClients.set(config.user, client);
  return client;
};

async function streamToString(stream: any): Promise<string> {
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf-8');
}

function getDomainCandidates(domain: string): string[] {
  const parts = domain.toLowerCase().split('.');
  if (parts.length <= 2) return [domain];
  const candidates = [domain];
  const commonTldParts = ['com', 'org', 'net', 'gov', 'edu', 'co', 'asn', 'id', 'info', 'biz'];
  const isThreePartSuffix = parts.length >= 3 && commonTldParts.includes(parts[parts.length - 2]);
  if (isThreePartSuffix) {
    if (parts.length > 3) candidates.push(parts.slice(-3).join('.'));
  } else {
    if (parts.length > 2) candidates.push(parts.slice(-2).join('.'));
  }
  return Array.from(new Set(candidates));
}

async function resolveBrandLogo(domain: string): Promise<{ data: Buffer, contentType: string }> {
  const cacheKey = `logo_meta:${domain}`;
  const filePath = path.join(LOGO_CACHE_DIR, `${domain}.png`);
  const cachedMeta = await redis.get(cacheKey);
  if (cachedMeta) {
    try {
      const { contentType } = JSON.parse(cachedMeta);
      const data = await fs.readFile(filePath);
      return { data, contentType };
    } catch (e) { }
  }
  const logoToken = process.env.LOGO_DEV_KEY;
  const candidates = getDomainCandidates(domain);
  for (const candidate of candidates) {
    const strategies = [
      ...(logoToken ? [`https://img.logo.dev/${candidate}?token=${logoToken}&size=128`] : []),
      `https://icons.duckduckgo.com/ip3/${candidate}.ico`,
      `https://www.google.com/s2/favicons?domain=${candidate}&sz=128`
    ];
    for (const url of strategies) {
      try {
        const response = await fetch(url, { signal: AbortSignal.timeout(4000) });
        if (response.ok) {
          const buffer = await response.buffer();
          const contentType = response.headers.get('content-type') || 'image/png';
          if (buffer.length > 500 || url.includes('google.com') || url.includes('duckduckgo')) {
            await fs.writeFile(filePath, buffer);
            await redis.setex(cacheKey, REDIS_TTL * 30, JSON.stringify({ contentType }));
            return { data: buffer, contentType };
          }
        }
      } catch (e) { }
    }
  }
  
  const fallbackSvg = `
    <svg width="128" height="128" viewBox="0 0 128 128" xmlns="http://www.w3.org/2000/svg">
      <rect width="128" height="128" rx="30" fill="#e2e8f0"/>
      <text x="50%" y="50%" dy=".35em" fill="#94a3b8" font-family="sans-serif" font-size="64" text-anchor="middle" font-weight="bold">
        ${domain.charAt(0).toUpperCase()}
      </text>
    </svg>
  `;
  return { data: Buffer.from(fallbackSvg), contentType: 'image/svg+xml' };
}

app.get('/api/v1/health', (req, res) => {
  res.json({ status: 'UP', timestamp: Date.now() });
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
    const result = await resolveBrandLogo('unknown'); 
    res.setHeader('Content-Type', result.contentType);
    res.send(result.data);
  }
});

// 🚀 UPDATED: Added Cache-Control headers for Optimistic UI
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
      // 🔥 FORCE BROWSER CACHE (1 Year)
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      return res.send(data);
    } catch (e) { }
  }
  try {
    const response = await fetch(targetUrl, { signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error(`Status ${response.status}`);
    const buffer = await response.buffer();
    const contentType = response.headers.get('content-type') || 'image/jpeg';
    await fs.writeFile(filePath, buffer);
    await redis.setex(cacheKey, REDIS_TTL * 7, JSON.stringify({ contentType }));
    
    res.setHeader('Content-Type', contentType);
    // 🔥 FORCE BROWSER CACHE (1 Year)
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.send(buffer);
  } catch (e) {
    res.setHeader('Content-Type', 'image/gif');
    res.send(TRANSPARENT_PIXEL);
  }
});

app.delete('/api/v1/debug/reset', async (req, res) => {
  try {
    await redis.flushall();
    await EmailModel.deleteMany({});
    const dirs = [CACHE_DIR, LOGO_CACHE_DIR];
    for(const dir of dirs) {
      try {
        const files = await fs.readdir(dir);
        for (const file of files) {
          const p = path.join(dir, file);
          const stat = await fs.lstat(p);
          if (stat.isFile()) await fs.unlink(p);
        }
      } catch (e) {}
    }
    activeClients.forEach(c => c.logout());
    activeClients.clear();
    res.json({ status: 'SYSTEM_WIPED' });
  } catch (e) { res.status(500).json({ error: 'WIPE_FAILED' }); }
});

app.post('/api/v1/config/save', async (req, res) => {
  await redis.setex(`config:${req.body.user}`, REDIS_TTL, JSON.stringify(req.body));
  res.json({ status: 'PERSISTED' });
});

app.get('/api/v1/sync/status', async (req, res) => {
  const prog = await redis.get(`sync_progress:${req.query.user}`);
  res.json(prog ? JSON.parse(prog) : { percent: 0, status: 'IDLE' });
});

// 🚀 CACHE WARMER FUNCTION
async function preWarmCache(emails: any[], user: string) {
  if (!emails || emails.length === 0) return;
  
  process.nextTick(async () => {
    const keys = emails.map(e => `mail_obj:${e.id}:${user}`);
    const exists = await redis.mget(keys);
    
    const missingIds: string[] = [];
    exists.forEach((val, idx) => {
      if (!val) missingIds.push(emails[idx].id);
    });

    if (missingIds.length === 0) return;

    const docs = await EmailModel.find({ 
      id: { $in: missingIds }, 
      user 
    }).lean();

    if (docs.length > 0) {
      const pipeline = redis.pipeline();
      docs.forEach(doc => {
        pipeline.setex(`mail_obj:${doc.id}:${user}`, REDIS_TTL, JSON.stringify(doc));
      });
      await pipeline.exec();
      console.log(`🔥 Auto-Warmed ${docs.length} emails into Redis for ${user}`);
    }
  });
}

// 🚀 UNIFIED FULL SYNC
app.post('/api/v1/mail/sync', async (req, res) => {
  const { user } = req.body;
  (async () => {
    try {
      await redis.setex(`sync_progress:${user}`, 300, JSON.stringify({ percent: 0, status: 'BURST' }));
      const client = await getClient(req.body);
      const lock = await client.getMailboxLock('INBOX');
      try {
        await runFullSync(client, user);
      } finally { lock.release(); }
    } catch (e) { 
      console.error("Sync pipeline error:", e);
      await redis.setex(`sync_progress:${user}`, 300, JSON.stringify({ percent: 0, status: 'ERROR' }));
    }
  })();
  res.json({ status: 'SYNC_PIPELINE_INITIATED' });
});

app.get('/api/v1/mail/list', async (req, res) => {
  const { user, folder } = req.query;
  const listKey = `mail:${user}:list:${folder || 'Inbox'}`;
  
  let listData = null;

  const cached = await redis.get(listKey);
  if (cached) {
    listData = JSON.parse(cached);
  } else {
    listData = await EmailModel.find({ user, folder: folder || 'Inbox' })
      .sort({ timestamp: -1 })
      .limit(100)
      .lean();
      
    if (listData.length > 0) {
      await redis.setex(listKey, REDIS_TTL, JSON.stringify(listData));
    }
  }

  // Trigger background warming
  if (listData && listData.length > 0) {
    preWarmCache(listData, user as string);
  }

  res.json(listData);
});

app.get('/api/v1/mail/:id', async (req, res) => {
  const { id } = req.params;
  const { user } = req.query;
  const cacheKey = `mail_obj:${id}:${user}`;
  
  const l1 = await redis.get(cacheKey);
  if (l1) return res.json({ email: JSON.parse(l1), source: 'Redis' });
  
  const l2 = await EmailModel.findOne({ id, user });
  if (l2) {
    await redis.setex(cacheKey, REDIS_TTL, JSON.stringify(l2));
    return res.json({ email: l2, source: 'MongoDB' });
  }
  
  const configStr = await redis.get(`config:${user}`);
  if (!configStr) return res.status(401).json({ error: 'AUTH_REQUIRED' });
  
  try {
    const client = await getClient(JSON.parse(configStr));
    const uid = id.replace('uid-', '');
    const msg = await client.fetchOne(uid, { bodyStructure: true, envelope: true }, { uid: true });
    if (!msg) return res.status(404).json({ error: 'MESSAGE_NOT_FOUND' });
    const partId = findBestPart(msg.bodyStructure);
    const { content } = await client.download(uid, partId, { uid: true });
    let body = await streamToString(content);
    body = body.replace(/src=["'](https?:\/\/[^"']+)["']/gi, (match, url) => `src="/api/v1/proxy/image?url=${encodeURIComponent(url)}"`);
    
    const email = await EmailModel.findOneAndUpdate(
      { id, user }, 
      { body }, 
      { new: true, upsert: true }
    );
    
    await redis.del(`mail:${user}:list:${email.folder || 'Inbox'}`);
    await redis.setex(cacheKey, REDIS_TTL, JSON.stringify(email));
    
    return res.json({ email, source: 'IMAP' });
  } catch (e) { res.status(500).json({ error: 'REMOTE_FETCH_FAILED' }); }
});

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

async function runFullSync(client: ImapFlow, user: string) {
  const mailbox = client.mailbox;
  if (!mailbox) return;
  
  const range = `${Math.max(1, mailbox.exists - 50)}:${mailbox.exists}`;
  
  const uids: number[] = [];
  for await (let msg of client.fetch(range, { uid: true })) {
    uids.push(msg.uid);
  }
  uids.reverse(); 

  const BATCH_SIZE = 5;
  let processedCount = 0;

  for (let i = 0; i < uids.length; i += BATCH_SIZE) {
    const batchUids = uids.slice(i, i + BATCH_SIZE);
    
    await Promise.allSettled(batchUids.map(async (uid) => {
      try {
        const id = `uid-${uid}`;
        
        const exists = await EmailModel.exists({ id, user, body: { $ne: "" } });
        if (exists) return;

        const msg = await client.fetchOne(uid.toString(), { envelope: true, bodyStructure: true, flags: true }, { uid: true });
        if (!msg) return;

        const partId = findBestPart(msg.bodyStructure);
        const { content } = await client.download(uid.toString(), partId, { uid: true });
        let body = await streamToString(content);
        
        body = body.replace(/src=["'](https?:\/\/[^"']+)["']/gi, (match, url) => `src="/api/v1/proxy/image?url=${encodeURIComponent(url)}"`);

        const savedDoc = await EmailModel.findOneAndUpdate(
          { id, user },
          {
            uid,
            from: msg.envelope.from?.[0]?.address || 'unknown',
            to: msg.envelope.to?.[0]?.address || user,
            subject: msg.envelope.subject || '(No Subject)',
            timestamp: new Date(msg.envelope.date || Date.now()).getTime(),
            read: msg.flags.has('\\Seen'),
            folder: 'Inbox',
            body: body 
          },
          { upsert: true, new: true }
        );

        if (savedDoc) {
          await redis.setex(`mail_obj:${id}:${user}`, REDIS_TTL, JSON.stringify(savedDoc));
        }

      } catch (e) {
        console.error(`Sync error on UID ${uid}:`, e);
      }
    }));

    processedCount += batchUids.length;
    
    await redis.del(`mail:${user}:list:Inbox`);
    
    await redis.setex(`sync_progress:${user}`, 300, JSON.stringify({ 
      percent: Math.round((processedCount / uids.length) * 100), 
      status: 'HYDRATING' 
    }));
  }

  const final_list = await EmailModel.find({ user, folder: 'Inbox' }).sort({ timestamp: -1 }).limit(100);
  await redis.setex(`mail:${user}:list:Inbox`, REDIS_TTL, JSON.stringify(final_list));
  await redis.setex(`sync_progress:${user}`, 300, JSON.stringify({ percent: 100, status: 'STABLE' }));
}

const PORT = 3001;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 NOVAMAIL V12.4 ONLINE - FULL DUPLEX SYNC + L1 PRE-WARM + IMG CACHE`);
});