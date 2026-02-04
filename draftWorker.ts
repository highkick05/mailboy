import { ImapFlow } from 'imapflow';
import fs from 'fs/promises';
import path from 'path';
import { lookup, extension } from 'mime-types'; 
import MailComposer from 'nodemailer/lib/mail-composer'; 
import { redis, EmailModel } from './db';
import { 
    getQueue, 
    updateWorkerState, 
    getFolderMap, 
    saveBatch, 
    findBestPart, 
    streamToString, 
    generateSmartSnippet, 
    findAttachmentParts, 
    systemStats,
    userWorkers,
    ATTACHMENT_DIR 
} from './workers';

// 🛑 LOGGING BUFFER
export const uplinkLogs: { time: string, msg: string, type: 'info'|'success'|'warn'|'error' }[] = [];
function logUplink(msg: string, type: 'info'|'success'|'warn'|'error' = 'info') {
    const time = new Date().toLocaleTimeString();
    console.log(`[DraftUplink 📡] ${msg}`);
    uplinkLogs.unshift({ time, msg, type });
    if (uplinkLogs.length > 100) uplinkLogs.pop();
}

let isSystemRunning = true;

// 🛑 THE DRAFT UPLINK WORKER
export async function runDraftWorker(config: any) {
    const queue = getQueue(config.user);
    const workerId = 99;
    let client: ImapFlow | null = null;
    let lastHeartbeat = 0;

    const connect = async () => {
        if (!userWorkers.has(config.user)) return false;
        try {
            updateWorkerState(workerId, 'CONNECTING');
            if (client) try { client.close(); } catch(e) {}
            client = new ImapFlow({
                host: config.imapHost, port: config.imapPort, secure: config.useTLS || config.imapPort === 993,
                auth: { user: config.user, pass: config.pass }, logger: false, clientTimeout: 90000, 
            });
            await client.connect();
            return true;
        } catch (e) { 
            updateWorkerState(workerId, 'ERROR');
            logUplink("Connection Failed", 'error');
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

        if (!client || !client.usable) {
            await connect();
            await new Promise(r => setTimeout(r, 2000));
            continue;
        }

        try {
            const map = await getFolderMap(client, config.user);
            const draftsPath = map['Drafts'];
            
            if (!draftsPath) {
                logUplink("No Drafts folder found. Sleeping.", 'warn');
                await new Promise(r => setTimeout(r, 5000));
                continue;
            }

            const lock = await client.getMailboxLock(draftsPath);
            updateWorkerState(workerId, 'UPLINK_ESTABLISHED');
            
            if (Math.random() > 0.9) logUplink(`Locked onto ${draftsPath}. Active Pulse...`, 'success');

            try {
                while (isSystemRunning && client.usable) {
                    
                    // A. Check for Save Jobs
                    let job = queue.popDraft();
                    while (job && isSystemRunning) {
                        updateWorkerState(workerId, 'SAVING', job);
                        await handleDraftSyncLogic(job, client, config.user, draftsPath); 
                        systemStats.jobsCompleted++;
                        queue.done(job.id);
                        job = queue.popDraft(); 
                    }

                    // B. FORCE UPDATE (This makes Gmail report deletions)
                    await client.noop(); 

                    // C. Full Sync (Check deletions/additions)
                    await syncDraftsFolder(client, 'Drafts', config.user, queue);

                    // D. Heartbeat Log (Every 10s)
                    if (Date.now() - lastHeartbeat > 10000) {
                        logUplink("💓 Heartbeat: Checking for server changes...", 'info');
                        lastHeartbeat = Date.now();
                    }

                    // E. Pulse
                    updateWorkerState(workerId, 'IDLE_PULSE');
                    await new Promise(r => setTimeout(r, 2000)); 
                }
            } finally {
                lock.release();
            }

        } catch (e) {
            logUplink("Connection lost, reconnecting...", 'error');
            updateWorkerState(workerId, 'ERROR');
            await new Promise(r => setTimeout(r, 2000));
        }
    }
}

// 🛑 FULL SYNC LOGIC (Updated for Cache Correctness)
async function syncDraftsFolder(client: ImapFlow, folderName: string, user: string, queue: JobQueue) {
    const serverUids = new Set<number>();
    try {
        for await (const msg of client.fetch('1:*', { uid: true })) {
            serverUids.add(msg.uid);
        }
    } catch(e) { return; }

    // Fetch local state including IDs for correct cache clearing
    const localDocs = await EmailModel.find({ user, folder: folderName }, { uid: 1, id: 1 }).lean();
    const localUids = new Set(localDocs.map(d => d.uid));

    // 1. DETECT DELETIONS
    const toDeleteDocs = localDocs.filter(doc => doc.uid && !serverUids.has(doc.uid));

    if (toDeleteDocs.length > 0) {
        logUplink(`⚖️ Sync: Removing ${toDeleteDocs.length} deleted drafts (Server UID gone).`, 'warn');
        
        const idsToDelete = toDeleteDocs.map(d => d.id);
        const uidsToDelete = toDeleteDocs.map(d => d.uid);

        // A. Delete from DB
        await EmailModel.deleteMany({ user, uid: { $in: uidsToDelete }, folder: folderName });
        
        // B. Clear Specific Object Cache (🛑 FIXED: Uses correct ID from DB)
        for (const id of idsToDelete) {
            await redis.del(`mail_obj:${id}:${user}`);
        }

        // C. Clear List Cache (🛑 FIXED: Clears both variants)
        await redis.del(`mail:${user}:list:${folderName}`);
        await redis.del(`mail:${user}:list:${folderName}:all`);
    }

    // 2. DETECT NEW ITEMS
    const toDownload: number[] = [];
    for (const uid of serverUids) {
        if (!localUids.has(uid)) toDownload.push(uid);
    }

    if (toDownload.length > 0) {
        const sorted = toDownload.sort((a, b) => a - b);
        logUplink(`📥 Sync: Downloading ${sorted.length} new drafts...`, 'success');
        
        let savedCount = 0;
        
        for (const uid of sorted) {
            try {
                const msg = await client.fetchOne(uid.toString(), { envelope: true, flags: true, uid: true, internalDate: true, bodyStructure: true }, { uid: true });
                if (msg) {
                    await saveBatch([msg], folderName, user, queue);

                    const partId = findBestPart(msg.bodyStructure);
                    let body = "";
                    if (partId) {
                        const downloadResult = await client.download(uid.toString(), partId, { uid: true, peek: true });
                        if (downloadResult?.content) {
                            body = await streamToString(downloadResult.content);
                            body = body.replace(/src=["'](https?:\/\/[^"']+)["']/gi, (match, url) => `src="/api/v1/proxy/image?url=${encodeURIComponent(url)}"`);
                        }
                    }

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
                            
                            const attStream = await client.download(uid.toString(), part.part, { uid: true, peek: true });
                            if (attStream?.content) {
                                await fs.writeFile(filePath, attStream.content);
                                savedAttachments.push({ 
                                    filename: originalName, 
                                    path: uniqueFilename, 
                                    size: part.size, 
                                    mimeType, 
                                    cid: part.id 
                                });
                            }
                        } catch (err) { }
                    }

                    await EmailModel.findOneAndUpdate(
                        { uid, user, folder: folderName },
                        { 
                            body, 
                            preview: generateSmartSnippet(body), 
                            isFullBody: true, 
                            attachments: savedAttachments,
                            hasAttachments: savedAttachments.length > 0
                        }
                    );
                    savedCount++;
                }
            } catch (e: any) {
                logUplink(`❌ Hydration failed for UID ${uid}: ${e.message}`, 'error');
            }
        }

        if (savedCount > 0) {
            logUplink(`✅ Fully Synced ${savedCount} drafts.`);
            // Force cache clear on download too
            await redis.del(`mail:${user}:list:${folderName}`);
            await redis.del(`mail:${user}:list:${folderName}:all`);
        }
    }
}

// 🛑 SAVE LOGIC
async function handleDraftSyncLogic(job: any, client: ImapFlow, user: string, draftsPath: string) {
    const { clientId } = job.data;
    const cacheKey = `draft_stage:${user}:${clientId}`;
    const cached = await redis.get(cacheKey);
    if (!cached) return;
    const data = JSON.parse(cached);

    const existingDoc = await EmailModel.findOne({ 
        user, 
        $or: [ { clientDraftId: clientId }, { id: clientId } ] 
    });
    const previousUid = existingDoc?.uid;

    const attachmentList: any[] = [];
    try { await fs.mkdir(ATTACHMENT_DIR, { recursive: true }); } catch(e) {}

    if (data.files && Array.isArray(data.files)) {
        for (const f of data.files) {
            try {
                try { await fs.access(f.path); } catch { continue; }
                const safeName = f.originalname.replace(/[^a-z0-9.]/gi, '_');
                const permanentName = `${Date.now()}-${Math.round(Math.random()*1000)}-${safeName}`;
                const permanentPath = path.join(ATTACHMENT_DIR, permanentName);
                await fs.rename(f.path, permanentPath);
                logUplink(`📦 Saved New File: ${permanentPath}`);
                attachmentList.push({
                    filename: f.originalname,
                    path: permanentPath,
                    contentType: f.mimetype || lookup(f.originalname) || 'application/octet-stream' 
                });
            } catch (err: any) { logUplink(`❌ Failed to save new file: ${err.message}`, 'error'); }
        }
    }

    if (data.existingAttachments && Array.isArray(data.existingAttachments)) {
        for (const att of data.existingAttachments) {
            let resolvedPath = att.path;
            if (!resolvedPath && existingDoc && existingDoc.attachments) {
                const match = existingDoc.attachments.find((a: any) => a.filename === att.filename);
                if (match && match.path) resolvedPath = match.path;
            }
            if (resolvedPath) {
                const absolutePath = path.isAbsolute(resolvedPath) ? resolvedPath : path.join(ATTACHMENT_DIR, path.basename(resolvedPath));
                try {
                    await fs.access(absolutePath);
                    attachmentList.push({
                        filename: att.filename,
                        path: absolutePath,
                        contentType: att.mimeType || lookup(att.filename) || 'application/octet-stream'
                    });
                } catch (e) { logUplink(`⚠️ LOST File: ${absolutePath}`, 'warn'); }
            }
        }
    }

    if (previousUid) {
            logUplink(`🎯 Deleting previous UID: ${previousUid}`);
            try { await client.messageDelete(String(previousUid), { uid: true }); } catch (e) { }
    } else {
        const search = { header: { 'X-Mailboy-Draft-ID': clientId } };
        try {
            for await (const msg of client.fetch(search, { uid: true })) {
                await client.messageDelete(msg.uid.toString(), { uid: true });
            }
        } catch(e) {}
    }

    const mail = new MailComposer({
        from: user, to: data.to, subject: data.subject, html: data.body,
        headers: { 'X-Mailboy-Draft-ID': clientId },
        attachments: attachmentList 
    });
    const messageBuffer = await mail.compile().build();
    const result = await client.append(draftsPath, messageBuffer, ['\\Draft']);
    
    logUplink(`✅ Saved Draft. UID: ${result.uid} | Atts: ${attachmentList.length}`, 'success');

    const dbAttachments = attachmentList.map(a => ({
        filename: a.filename,
        path: path.basename(a.path), 
        mimeType: a.contentType
    }));

    if (previousUid) await EmailModel.deleteOne({ uid: previousUid, user });

    await EmailModel.findOneAndUpdate(
        { user, id: clientId }, 
        { 
            ...data, id: clientId, uid: result.uid, folder: 'Drafts', isFullBody: true,
            attachments: dbAttachments, hasAttachments: dbAttachments.length > 0,
            clientDraftId: clientId 
        },
        { upsert: true }
    );
    
    // 🛑 FORCE REFRESH FRONTEND LIST AFTER SAVE
    await redis.del(`mail:${user}:list:Drafts`);
    await redis.del(`mail:${user}:list:Drafts:all`);

    const latestInCache = await redis.get(cacheKey);
    if (latestInCache && JSON.parse(latestInCache).timestamp === data.timestamp) {
        await redis.del(cacheKey);
    }
}