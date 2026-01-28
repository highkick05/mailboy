import React, { useState, useEffect, useCallback, useRef } from 'react';
import { mailService } from './services/mailService';
import { Email, EmailFolder, CacheStats, MailConfig } from './types';
import Layout from './components/Layout';
import EmailList from './components/EmailList';
import EmailDetail from './components/EmailDetail';
import Compose from './components/Compose';
import ArchitectureStatus from './components/ArchitectureStatus';
import Settings from './components/Settings';
import { ComposeFAB } from './components/ComposeFAB';

const App: React.FC = () => {
  const [darkMode, setDarkMode] = useState(() => {
    const saved = localStorage.getItem('mailboy_theme');
    return saved === 'dark';
  });

  const [mailConfig, setMailConfig] = useState<MailConfig | null>(() => {
    const saved = localStorage.getItem('nova_mail_config');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        mailService.setConfig(parsed);
        return parsed;
      } catch { return null; }
    }
    return null;
  });

  const [emails, setEmails] = useState<Email[]>([]);
  const [currentFolder, setCurrentFolder] = useState<EmailFolder>('Inbox');
  // Smart Tab State
  const [activeCategory, setActiveCategory] = useState<string>('primary');
  
  const [selectedEmail, setSelectedEmail] = useState<Email | null>(null);
  const [lastStats, setLastStats] = useState<CacheStats | null>(null);
  const [isComposeOpen, setIsComposeOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(() => !localStorage.getItem('nova_mail_config'));
  const [isLoading, setIsLoading] = useState(false);
  const [bridgeOnline, setBridgeOnline] = useState<boolean | null>(null);
  const [syncProgress, setSyncProgress] = useState<{ percent: number, status: string } | null>(null);
  
  const [syncError, setSyncError] = useState<boolean>(false);

  // Added attachments support to replyData state
  const [replyData, setReplyData] = useState<{ 
      to: string; 
      cc?: string; 
      subject: string; 
      body: string; 
      id?: string;
      attachments?: any[]; 
  } | null>(null);
  
  const updateTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  
  // 🛑 OPTIMISTIC CACHE SYSTEM
  // 1. optimisticDrafts: Remembers drafts (with attachments) even after you close the window.
  const optimisticDraftsRef = useRef<Map<string, Email>>(new Map());
  // 2. suppressedIds: Remembers IDs we just deleted/sent so they don't zombie-walk back in.
  const suppressedIdsRef = useRef<Set<string>>(new Set());
  // 3. Active Draft Ref
  const currentDraftRef = useRef<Email | null>(null);

  // Refresh List Logic
  const refreshList = useCallback(async () => {
    if (!mailService.isConfigured() || syncError) return;
    try {
      // Only filter by category if we are in the Inbox
      const categoryParam = currentFolder === 'Inbox' ? activeCategory : undefined;
      const newData = await mailService.getAllEmails(currentFolder, categoryParam);
      
      setEmails(prevEmails => {
        let mergedData = [...newData];

        // 🛑 1. Filter out Zombies (items we know we deleted/sent)
        if (suppressedIdsRef.current.size > 0) {
            mergedData = mergedData.filter(e => !suppressedIdsRef.current.has(e.id));
        }

        // 🛑 2. Apply Optimistic Drafts
        if (currentFolder.toLowerCase().includes('draft')) {
             
             // A. Inject Active Draft & Remove Duplicates
             if (currentDraftRef.current) {
                 // Aggressively remove ANY item that looks like our active draft (Same Subject + To)
                 // This handles the "Server ID" vs "Local ID" mismatch causing duplicates
                 mergedData = mergedData.filter(e => {
                     const isSameId = e.id === currentDraftRef.current!.id;
                     // Weak check: If subject and recipient match, assume it's the server copy of this draft
                     const isDuplicate = e.subject === currentDraftRef.current!.subject && e.to === currentDraftRef.current!.to;
                     return !isSameId && !isDuplicate;
                 });
                 // Inject our fresh local version at the top
                 mergedData.unshift(currentDraftRef.current);
             }

             // B. Inject Cached Drafts (closed windows)
             optimisticDraftsRef.current.forEach((draft) => {
                 // Only inject if it's not the one we just handled above
                 if (currentDraftRef.current && currentDraftRef.current.id === draft.id) return;
                 
                 const index = mergedData.findIndex(e => e.id === draft.id);
                 if (index !== -1) {
                     mergedData[index] = { ...mergedData[index], ...draft };
                 } else {
                     // Check for content duplication here too
                     const isDuplicate = mergedData.some(e => e.subject === draft.subject && e.to === draft.to);
                     if (!isDuplicate) mergedData.unshift(draft);
                 }
             });
        }

        if (mergedData.length === 0) return prevEmails.length > 0 && isLoading ? prevEmails : mergedData;
        
        return mergedData.map(incoming => {
          const existing = prevEmails.find(e => e.id === incoming.id);
          if (existing && existing.body && (!incoming.body || incoming.body === "")) {
            return { ...incoming, body: existing.body, hydrated: true };
          }
          return incoming;
        });
      });
    } catch (e) {
      console.error("Refresh list failed", e);
    }
  }, [currentFolder, activeCategory, syncError, isLoading]);

  const checkHealth = useCallback(async () => {
    const isUp = await mailService.checkBridgeHealth();
    setBridgeOnline(isUp);
    return isUp;
  }, []);

  useEffect(() => {
    const root = window.document.documentElement;
    if (darkMode) {
      root.classList.add('dark');
      localStorage.setItem('mailboy_theme', 'dark');
    } else {
      root.classList.remove('dark');
      localStorage.setItem('mailboy_theme', 'light');
    }
  }, [darkMode]);

  useEffect(() => { checkHealth(); }, [checkHealth]);
  
  useEffect(() => { 
    if (mailConfig && !syncError) {
      refreshList(); 
    }
  }, [mailConfig, refreshList, syncError]);

  useEffect(() => {
    if (!mailConfig || !bridgeOnline) return;
    const hasEmptyEmails = emails.some(e => !e.body || e.body === "");
    const isServerIdle = syncProgress?.status === 'IDLE' || !syncProgress;

    if (hasEmptyEmails && isServerIdle && !syncError) {
      mailService.triggerHydration();
    }
  }, [emails, syncProgress, bridgeOnline, mailConfig, syncError]);

  useEffect(() => {
    if (!mailConfig || bridgeOnline !== true) return;
    const interval = setInterval(async () => {
      const status = await mailService.getSyncStatus();
      setSyncProgress(status);
      
      if (status.status === 'ERROR') {
        setSyncError(true);
        setEmails([]); 
      } else {
        setSyncError(false);
        if (status.status !== 'IDLE') {
          refreshList();
        }
      }
    }, 2000); 
    return () => clearInterval(interval);
  }, [mailConfig, bridgeOnline, refreshList]);

  // 🛑 NEW: Handle Delete with Optimistic UI & Batch Processing
  const handleDelete = async (ids: string[]) => {
      // 1. Optimistic Update
      setEmails(prev => prev.filter(e => !ids.includes(e.id)));
      if (selectedEmail && ids.includes(selectedEmail.id)) setSelectedEmail(null);
      
      // 2. Add to Suppression List (Prevent Zombies)
      ids.forEach(id => suppressedIdsRef.current.add(id));

      try {
          // 🛑 UPDATED: 'Drafts' now also uses Permanent Batch Delete ("Discard")
          if (currentFolder === 'Trash' || currentFolder === 'Spam' || currentFolder === 'Drafts') {
              // Permanent Delete (Batch)
              await fetch('/api/v1/mail/batch-delete', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ ids, user: mailConfig?.user })
              });
          } else {
              // Move to Trash (Soft Delete)
              for (const id of ids) {
                  await fetch('/api/v1/mail/move', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ emailId: id, targetFolder: 'Trash', user: mailConfig?.user })
                  });
              }
          }
      } catch (e) {
          console.error("Delete failed", e);
          refreshList(); // Revert on failure
      }
  };

  const handleSelectEmail = async (id: string) => {
    // Intercept Drafts - Open in Compose
    if (currentFolder.toLowerCase().includes('draft')) {
        // 🛑 Try to find in our optimistic cache FIRST
        const cachedDraft = optimisticDraftsRef.current.get(id);
        const activeDraft = currentDraftRef.current?.id === id ? currentDraftRef.current : null;
        
        const draft = activeDraft || cachedDraft || emails.find(e => e.id === id);

        if (draft) {
            setReplyData({
                to: (draft as any).to || "", 
                subject: draft.subject,
                body: draft.body || "",
                id: draft.id,
                attachments: (draft as any).attachments || [] 
            });
            setIsComposeOpen(true);
            return;
        }
    }

    try {
      const { data, stats } = await mailService.getEmailById(id);
      setLastStats(stats);
      if (data) {
        setSelectedEmail(data);
        if (!data.read && mailConfig) {
             setEmails(prev => prev.map(e => e.id === id ? { ...e, read: true } : e));
             mailService.markAsRead(id, true);
        } else {
             setEmails(prev => prev.map(e => e.id === data.id ? data : e));
        }
      } else {
          alert("This email is still syncing its full content. Please wait a moment and try again.");
      }
    } catch (e: any) {
      if (e.message === 'AUTH_REQUIRED') {
          setIsSettingsOpen(true);
      } else {
          alert("Could not load email. Please check backend console.");
      }
    }
  };

  const handleCloseEmail = () => {
    setSelectedEmail(null);
  };

  const handleSaveConfig = async (config: MailConfig) => {
    try {
      const response = await fetch(`/api/v1/config/save`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config)
      });
      if (!response.ok) throw new Error("BRIDGE_OFFLINE");
      
      localStorage.setItem('nova_mail_config', JSON.stringify(config));
      mailService.setConfig(config);
      setMailConfig(config);
      setIsSettingsOpen(false);
      
      setSyncError(false); 
      
      setTimeout(() => {
        checkHealth().then(online => {
          if (online) {
            mailService.fetchRemoteMail();
            setTimeout(() => refreshList(), 1000);
          }
        });
      }, 500);
    } catch (e) { 
      alert(`Bridge Connection Failed: Please verify the server is active.`); 
      throw e; 
    }
  };

  const handleResetSystem = async () => {
    try {
      const resp = await fetch(`/api/v1/debug/reset`, { method: 'DELETE' });
      if (!resp.ok) throw new Error("Wipe failed");
      
      localStorage.removeItem('nova_mail_config');
      setMailConfig(null);
      setEmails([]);
      setSelectedEmail(null);
      setLastStats(null);
      setIsSettingsOpen(true);
      return Promise.resolve();
    } catch (e) {
      return Promise.reject(e);
    }
  };

  const handleSync = async () => {
    if (!mailConfig) {
      setIsSettingsOpen(true);
      return;
    }
    setSyncProgress({ status: 'SYNCING', percent: 0 });
    try {
      await mailService.fetchRemoteMail();
    } catch (e: any) {
      if (e.message === 'AUTH_REQUIRED') setIsSettingsOpen(true);
    }
  };

  const handleSendEmail = async (data: { to: string; cc?: string; bcc?: string; subject: string; body: string; files?: File[]; draftId?: string }) => {
    try {
        const formData = new FormData();
        
        const authPayload = {
            user: mailConfig?.user,
            pass: mailConfig?.pass,
            smtpHost: mailConfig?.smtpHost,
            smtpPort: mailConfig?.smtpPort
        };
        formData.append('auth', JSON.stringify(authPayload));
        
        const emailPayload = {
            to: data.to,
            cc: data.cc,
            bcc: data.bcc,
            subject: data.subject,
            body: data.body,
            draftId: data.draftId 
        };
        formData.append('payload', JSON.stringify(emailPayload));

        if (data.files && data.files.length > 0) {
            data.files.forEach(file => {
                formData.append('files', file);
            });
        }

        const response = await fetch('/api/v1/mail/send', {
            method: 'POST',
            body: formData 
        });
        
        if (!response.ok) {
            const err = await response.json();
            throw new Error(err.error || "Send failed");
        }
        
        // 🛑 SUCCESS: Suppress this draft ID immediately so it doesn't zombie back
        if (data.draftId) {
            suppressedIdsRef.current.add(data.draftId);
            optimisticDraftsRef.current.delete(data.draftId);
            currentDraftRef.current = null;
        }

        if (currentFolder === 'Sent') {
            setTimeout(() => refreshList(), 1000);
        }
        
        // Instant update to remove from UI
        refreshList();

    } catch (e) {
        console.error("Failed to send", e);
        throw e;
    }
  };

  const handleBatchRead = async (ids: string[], read: boolean) => {
    setEmails(prev => prev.map(email => 
        ids.includes(email.id) ? { ...email, read } : email
    ));

    if (updateTimeoutRef.current) {
        clearTimeout(updateTimeoutRef.current);
    }

    updateTimeoutRef.current = setTimeout(async () => {
        try {
            await mailService.batchMarkRead(ids, read);
        } catch (e) {
            console.error("Batch update failed", e);
            refreshList(); 
        }
    }, 500);
  };

  // 🛑 UPDATED: Handle Files in Draft Save & RETURN ID
  const handleSaveDraft = useCallback(async (to: string, subject: string, body: string, existingId?: string, saveToServer: boolean = false, files: File[] = [], existingAttachments: any[] = []) => {
      // 1. OPTIMISTIC UPDATE: Update UI immediately
      if (mailConfig) {
          const now = Date.now();
          const hasFiles = files.length > 0 || existingAttachments.length > 0;

          const tempDraft: Email = {
              id: existingId || `temp-draft-${now}`, 
              uid: 0, 
              from: mailConfig.user,
              senderAddr: mailConfig.user,
              senderName: 'Me',
              to: to, 
              subject: subject || '(No Subject)',
              body: body,
              preview: body.replace(/<[^>]*>?/gm, '').substring(0, 100) || 'Draft...',
              timestamp: now,
              read: true,
              folder: 'Drafts',
              labels: [],
              isFullBody: true,
              // 🛑 Populate attachments for UI
              hasAttachments: hasFiles,
              attachments: [...existingAttachments, ...files.map(f => ({ filename: f.name }))] as any
          };

          // 🛑 UPDATE PERSISTENT CACHE
          currentDraftRef.current = tempDraft;
          optimisticDraftsRef.current.set(tempDraft.id, tempDraft);

          // Update State Immediately (Refresh list triggers the smart merge)
          if (currentFolder === 'Drafts') refreshList();
      }

      // 2. SERVER SAVE (With Attachments via FormData)
      if (saveToServer) {
          try {
              console.log("🚀 Saving draft to server (Final)...");
              
              const formData = new FormData();
              formData.append('user', mailConfig?.user || '');
              formData.append('to', to);
              formData.append('subject', subject);
              formData.append('body', body);
              if (existingId) formData.append('id', existingId);
              
              files.forEach(f => formData.append('files', f));

              // 🛑 KEEPALIVE & RETURN ID
              const response = await fetch('/api/v1/mail/draft', {
                  method: 'POST',
                  body: formData,
                  keepalive: true
              });
              
              if (response.ok) {
                  const data = await response.json();
                  if (currentFolder.toLowerCase().includes('draft')) {
                      setTimeout(() => refreshList(), 1500); 
                  }
                  // 🛑 THIS CLOSES THE LOOP WITH COMPOSE.TSX
                  return data.id; 
              }
          } catch (e) {
              console.error("Failed to save draft to server", e);
          }
      }
      return undefined;
  }, [mailConfig, currentFolder, refreshList]);

  const handleReply = (email: Email) => {
      const originalDate = new Date(email.timestamp).toLocaleString();
      const quoteHeader = `<br><br><br>On ${originalDate}, ${email.senderName || email.from} wrote:<br><blockquote style="border-left: 2px solid #ccc; padding-left: 10px; color: #555;">${email.body}</blockquote>`;
      setReplyData({ to: email.from, subject: email.subject.toLowerCase().startsWith('re:') ? email.subject : `Re: ${email.subject}`, body: quoteHeader });
      setIsComposeOpen(true);
  };

  const handleReplyAll = (email: Email) => {
      const originalDate = new Date(email.timestamp).toLocaleString();
      const quoteHeader = `<br><br><br>On ${originalDate}, ${email.senderName || email.from} wrote:<br><blockquote style="border-left: 2px solid #ccc; padding-left: 10px; color: #555;">${email.body}</blockquote>`;
      const to = email.from;
      const cc = (email as any).to || ""; 
      setReplyData({ to: to, cc: cc !== mailConfig?.user ? cc : undefined, subject: email.subject.toLowerCase().startsWith('re:') ? email.subject : `Re: ${email.subject}`, body: quoteHeader });
      setIsComposeOpen(true);
  };

  const handleForward = (email: Email) => {
      const originalDate = new Date(email.timestamp).toLocaleString();
      const header = `
        <br><br>
        ---------- Forwarded message ---------<br>
        From: <strong>${email.senderName || email.from}</strong> <${email.from}><br>
        Date: ${originalDate}<br>
        Subject: ${email.subject}<br>
        To: ${(email as any).to || "Unknown"}<br>
        <br>
      `;
      const quoteBody = `${header}<blockquote style="border-left: 2px solid #ccc; padding-left: 10px; color: #555;">${email.body}</blockquote>`;
      setReplyData({ to: "", subject: email.subject.toLowerCase().startsWith('fwd:') ? email.subject : `Fwd: ${email.subject}`, body: quoteBody });
      setIsComposeOpen(true);
  };

  const closeCompose = () => {
      setIsComposeOpen(false);
      setReplyData(null);
  };

  return (
    <div className="min-h-screen w-full bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 transition-colors duration-300">
      
      {syncError && (
        <div className="bg-red-600 text-white text-center py-2 px-4 font-bold text-sm sticky top-0 z-[100] flex justify-between items-center animate-in slide-in-from-top duration-300">
          <div className="flex items-center gap-2 mx-auto">
             <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
             <span>Connection Failed: Invalid Credentials. Inbox hidden to prevent stale data.</span>
          </div>
          <button onClick={() => setIsSettingsOpen(true)} className="bg-white/20 hover:bg-white/30 text-white px-3 py-1 rounded-lg text-xs uppercase tracking-wider font-black transition-colors">
            Fix Now
          </button>
        </div>
      )}

      <Layout 
        currentFolder={currentFolder} 
        onFolderChange={(f) => { 
          setCurrentFolder(f); 
          setSelectedEmail(null); 
          currentDraftRef.current = null; 
        }}
        onOpenSettings={() => setIsSettingsOpen(true)}
        onSync={handleSync}
        isConfigured={!!mailConfig && bridgeOnline === true}
        syncPercent={
            syncProgress?.status === 'HYDRATING' ? syncProgress.percent : 
            (syncProgress?.status === 'BURST' || syncProgress?.status === 'SYNCING' ? 100 : undefined)
        }
        darkMode={darkMode}
        toggleTheme={() => setDarkMode(prev => !prev)}
      >
        <div className="h-full w-full relative">
          
          <div 
            className="h-full w-full absolute inset-0"
            style={{ 
              visibility: selectedEmail ? 'hidden' : 'visible',
              zIndex: selectedEmail ? 0 : 10
            }}
          >
            <div className="w-full h-full px-4 sm:px-6 lg:px-8">
              <div className="max-w-7xl mx-auto flex flex-col gap-0 h-full">
                
                {syncError ? (
                  <div className="flex flex-col items-center justify-center h-full text-center text-slate-400">
                    <div className="bg-red-50 dark:bg-red-900/20 p-6 rounded-full mb-4">
                      <svg className="w-12 h-12 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 15v2m0-6V7m0-3.5A2.5 2.5 0 109.5 6m5 0a2.5 2.5 0 11-5 0" /></svg>
                    </div>
                    <h3 className="text-xl font-bold text-slate-700 dark:text-slate-300">Sync Paused</h3>
                    <p className="max-w-md mt-2">Authentication failed. We have hidden your cached emails to ensure you don't act on outdated information.</p>
                  </div>
                ) : (
                  <>
                    <EmailList 
                        emails={emails} 
                        onSelect={handleSelectEmail} 
                        isLoading={isLoading} 
                        onRefresh={refreshList} 
                        onBatchRead={handleBatchRead}
                        // 🛑 Pass the new DELETE handler
                        onDelete={handleDelete}
                        onCategoryChange={(cat) => setActiveCategory(cat)}
                        currentFolder={currentFolder} 
                        banner={!mailConfig ? (
                            <div className="w-full bg-white dark:bg-slate-900 border-2 border-dashed border-slate-200 dark:border-slate-800 rounded-3xl p-12 text-center animate-in fade-in zoom-in-95 duration-500 shadow-sm">
                                <div className="w-24 h-24 bg-blue-100 dark:bg-blue-900/30 rounded-full flex items-center justify-center mx-auto mb-8">
                                <svg className="w-12 h-12 text-blue-600 dark:text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" /></svg>
                                </div>
                                <h2 className="text-3xl font-black mb-4">Initialize mailboy</h2>
                                <p className="text-slate-500 dark:text-slate-400 mb-10 max-w-sm mx-auto font-medium">Configure your L3 Ingress/Egress nodes to start the secure real-time protocol handshake.</p>
                                <button 
                                onClick={() => setIsSettingsOpen(true)}
                                className="bg-blue-600 hover:bg-blue-700 text-white font-black py-4 px-12 rounded-2xl shadow-2xl shadow-blue-600/30 transition-all active:scale-95 uppercase text-xs tracking-[0.2em]"
                                >
                                Setup IMAP Bridge
                                </button>
                            </div>
                        ) : undefined}
                    />
                  </>
                )}

              </div>
            </div>
          </div>

          {selectedEmail && (
            <div className="h-full w-full absolute inset-0 z-20 bg-slate-50 dark:bg-slate-950">
               <div className="h-full w-full flex flex-col px-4 py-4 sm:px-6 overflow-hidden">
                 <div className="max-w-7xl w-full mx-auto flex-1 min-h-0 flex flex-col">
                    <EmailDetail 
                        email={selectedEmail} 
                        onClose={handleCloseEmail} 
                        onReply={handleReply}
                        onReplyAll={handleReplyAll}
                        onForward={handleForward}
                        // 🛑 Pass DELETE Handler to Detail View too
                        onDelete={() => handleDelete([selectedEmail.id])}
                    />
                 </div>
               </div>
            </div>
          )}

        </div>
        <ArchitectureStatus stats={lastStats} />
      </Layout>
      
      <ComposeFAB onClick={() => setIsComposeOpen(true)} />

      {isComposeOpen && (
        <Compose 
          onClose={closeCompose} 
          onSend={handleSendEmail} 
          onSaveDraft={handleSaveDraft}
          userEmail={mailConfig?.user || ''} 
          initialData={replyData || undefined}
        />
      )}
      
      {isSettingsOpen && <Settings onClose={() => setIsSettingsOpen(false)} onSave={handleSaveConfig} onReset={handleResetSystem} currentConfig={mailConfig} />}
    </div>
  );
};

export default App;