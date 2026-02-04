import React, { useState, useEffect, useRef } from 'react';

interface ComposeProps {
  onClose: () => void;
  onSend: (payload: { to: string; cc?: string; bcc?: string; subject: string; body: string; files?: File[]; draftId?: string; existingAttachments?: any[] }) => Promise<void>;
  onSaveDraft?: (to: string, subject: string, body: string, id?: string, saveToServer?: boolean, files?: File[], existingAttachments?: any[]) => Promise<string | void>;
  userEmail: string;
  initialData?: {
    to: string;
    cc?: string;
    subject: string;
    body: string;
    id?: string;
    attachments?: any[]; 
  };
}

export default function Compose({ onClose, onSend, onSaveDraft, userEmail, initialData }: ComposeProps) {
  // --- STATE ---
  const [to, setTo] = useState(initialData?.to || '');
  const [cc, setCc] = useState(initialData?.cc || '');
  const [bcc, setBcc] = useState('');
  const [subject, setSubject] = useState(initialData?.subject || '');
  const [body, setBody] = useState(initialData?.body || ''); 
  
  const [isSending, setIsSending] = useState(false);
  const [showCcBcc, setShowCcBcc] = useState(false);
  
  // Save Status State
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  
  // File State
  const [files, setFiles] = useState<File[]>([]);
  const [existingAttachments, setExistingAttachments] = useState<any[]>(initialData?.attachments || []);

  // Refs
  const fileInputRef = useRef<HTMLInputElement>(null);
  const editorRef = useRef<HTMLDivElement>(null);
  const draftIdRef = useRef(initialData?.id || `draft-${Date.now()}`); // Stable ID
  const isSentRef = useRef(false); 
  
  // Timers
  const localSaveTimer = useRef<NodeJS.Timeout | null>(null);
  const serverSaveTimer = useRef<NodeJS.Timeout | null>(null);

  // --- 1. INITIALIZATION & RECOVERY ---
  useEffect(() => {
    if (initialData) {
      setTo(initialData.to || '');
      setCc(initialData.cc || '');
      setSubject(initialData.subject || '');
      setBody(initialData.body || '');
      setExistingAttachments(initialData.attachments || []);
      if (editorRef.current) editorRef.current.innerHTML = initialData.body ? initialData.body : '';
      if (initialData.cc) setShowCcBcc(true);
      // Don't override draftIdRef if it's already set (prevents race conditions)
      if (initialData.id) draftIdRef.current = initialData.id;
    } else {
      // Restore from Crash Cache
      const cached = localStorage.getItem('mailboy_draft_cache');
      if (cached) {
        try {
          const d = JSON.parse(cached);
          console.log(`[Frontend 🎨] ♻️ Restored draft from crash cache: ${d.id}`);
          setTo(d.to || '');
          setSubject(d.subject || '');
          setBody(d.body || '');
          if (editorRef.current) editorRef.current.innerHTML = d.body || '';
          draftIdRef.current = d.id;
        } catch (e) {}
      }
    }
  }, [initialData]);

  // --- 2. THE RE-ENGINEERED AUTOSAVE LOGIC ---
  useEffect(() => {
    if (!onSaveDraft || isSentRef.current) return;

    if (localSaveTimer.current) clearTimeout(localSaveTimer.current);
    if (serverSaveTimer.current) clearTimeout(serverSaveTimer.current);

    setSaveStatus('idle');

    // A. CACHE LAYER (1s) - LocalStorage Persistence
    localSaveTimer.current = setTimeout(() => {
        const content = editorRef.current?.innerHTML || '';
        const payload = { to, subject, body: content, id: draftIdRef.current };
        localStorage.setItem('mailboy_draft_cache', JSON.stringify(payload));
        
        // Optimistic UI Update (Passes files for local state consistency)
        onSaveDraft(to, subject, content, draftIdRef.current, false, files, existingAttachments);
    }, 1000);

    // B. BACKGROUND SYNC LAYER (2s) - Faster Autosave
    serverSaveTimer.current = setTimeout(async () => {
        const content = editorRef.current?.innerHTML || '';
        const hasAttachments = files.length > 0 || existingAttachments.length > 0;
        
        if (to || subject || (content && content !== '<br>') || hasAttachments) {
            console.log(`[Frontend 🎨] 💾 Autosave Timer Fired for ID: ${draftIdRef.current}`);
            setSaveStatus('saving');
            const startTime = Date.now();
            try {
                // 🛑 CRITICAL: Send files and existingAttachments
                await onSaveDraft(
                    to, 
                    subject, 
                    content, 
                    draftIdRef.current, 
                    true, 
                    files, 
                    existingAttachments
                );
                
                console.log(`[Frontend 🎨] 📡 Server Responded in ${Date.now() - startTime}ms`);
                
                // 🛑 CHANGE: We DO NOT update draftIdRef here. 
                // We keep using the Client ID (draft-123) for this session to prevent duplication.
                // The Worker handles mapping draft-123 to the correct IMAP UID.
                
                setSaveStatus('saved');
                setLastSaved(new Date());
            } catch (e) {
                console.error(`[Frontend 🎨] ❌ Save Failed`, e);
                setSaveStatus('error');
            }
        }
    }, 2000); // 🛑 CHANGED: Shortened to 2s

    return () => {
        if (localSaveTimer.current) clearTimeout(localSaveTimer.current);
        if (serverSaveTimer.current) clearTimeout(serverSaveTimer.current);
    };
  }, [to, subject, body, files, existingAttachments, onSaveDraft]);

  // Manual Save (Ctrl+S)
  useEffect(() => {
      const handleKeyDown = (e: KeyboardEvent) => {
          if ((e.ctrlKey || e.metaKey) && e.key === 's') {
              e.preventDefault();
              if (onSaveDraft && !isSentRef.current) {
                  console.log(`[Frontend 🎨] ⌨️ Manual Save Triggered (Ctrl+S)`);
                  if (serverSaveTimer.current) clearTimeout(serverSaveTimer.current);
                  setSaveStatus('saving');
                  const content = editorRef.current?.innerHTML || '';
                  
                  onSaveDraft(to, subject, content, draftIdRef.current, true, files, existingAttachments)
                      .then(() => {
                          setSaveStatus('saved');
                          setLastSaved(new Date());
                      });
              }
          }
      };
      window.addEventListener('keydown', handleKeyDown);
      return () => window.removeEventListener('keydown', handleKeyDown);
  }, [to, subject, body, files, existingAttachments, onSaveDraft]);

  const handleInput = (e: React.FormEvent<HTMLDivElement>) => setBody(e.currentTarget.innerHTML);
  
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files && e.target.files.length > 0) {
          setFiles(prev => [...prev, ...Array.from(e.target.files!)]);
      }
      if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const removeFile = (index: number) => setFiles(prev => prev.filter((_, i) => i !== index));
  const removeExistingAttachment = (index: number) => setExistingAttachments(prev => prev.filter((_, i) => i !== index));

  const handleSend = async () => {
    if (!to) return alert('Please add a recipient');
    setIsSending(true);
    isSentRef.current = true; 
    
    try {
      const content = editorRef.current?.innerHTML || '';
      console.log(`[Frontend 🎨] 🚀 Sending Message...`);
      await onSend({ 
          to, cc, bcc, subject, 
          body: content, 
          files, 
          existingAttachments, 
          draftId: draftIdRef.current 
      });
      console.log(`[Frontend 🎨] ✅ Message Sent. Cleaning up.`);
      localStorage.removeItem('mailboy_draft_cache'); 
      onClose();
    } catch (e) {
      console.error(`[Frontend 🎨] ❌ Send Failed`, e);
      alert('Failed to send');
      setIsSending(false);
      isSentRef.current = false;
    }
  };

  const handleClose = () => {
      localStorage.removeItem('mailboy_draft_cache');
      onClose();
  };

  const getTimeAgo = (date: Date) => {
      const seconds = Math.floor((new Date().getTime() - date.getTime()) / 1000);
      if (seconds < 5) return 'just now';
      if (seconds < 60) return `${seconds}s ago`;
      return `${Math.floor(seconds / 60)}m ago`;
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="bg-white dark:bg-slate-900 w-full max-w-5xl h-[85vh] rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 flex flex-col overflow-hidden ring-1 ring-white/10">
        
        {/* HEADER */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/50">
          <div className="flex items-center gap-3">
              <h2 className="text-lg font-bold text-slate-700 dark:text-slate-200">New Message</h2>
              <div className="flex items-center gap-2">
                  {saveStatus === 'saving' && (
                      <span className="text-[10px] uppercase font-bold tracking-wider text-blue-500 border border-blue-200 dark:border-blue-900 px-2 py-0.5 rounded animate-pulse">
                          Syncing...
                      </span>
                  )}
                  {saveStatus === 'saved' && lastSaved && (
                      <span className="text-[10px] uppercase font-bold tracking-wider text-green-600 dark:text-green-400 border border-green-200 dark:border-green-900 px-2 py-0.5 rounded">
                          Saved {getTimeAgo(lastSaved)}
                      </span>
                  )}
                  {saveStatus === 'error' && (
                      <span className="text-[10px] uppercase font-bold tracking-wider text-red-500 border border-red-200 px-2 py-0.5 rounded">
                          Offline
                      </span>
                  )}
              </div>
          </div>
          <button onClick={handleClose} className="p-2 -mr-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-full hover:bg-slate-200 dark:hover:bg-slate-800 transition-colors">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>

        {/* FIELDS */}
        <div className="px-6 py-4 space-y-4 shrink-0">
          <div className="relative group">
             <label className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-400 uppercase tracking-wider group-focus-within:text-blue-500 transition-colors">To</label>
             <input value={to} onChange={e => setTo(e.target.value)} className="w-full bg-slate-50 dark:bg-slate-950/50 border border-slate-200 dark:border-slate-800 rounded-xl py-3 pl-12 pr-20 text-slate-900 dark:text-white focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all outline-none" placeholder="recipient@example.com" autoFocus={!initialData} />
             <button onClick={() => setShowCcBcc(!showCcBcc)} className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors">CC/BCC</button>
          </div>

          {(showCcBcc || initialData?.cc) && (
            <div className="grid grid-cols-2 gap-4 animate-in slide-in-from-top-2 fade-in">
                <div className="relative group">
                    <label className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-400 uppercase tracking-wider group-focus-within:text-blue-500">Cc</label>
                    <input value={cc} onChange={e => setCc(e.target.value)} className="w-full bg-slate-50 dark:bg-slate-950/50 border border-slate-200 dark:border-slate-800 rounded-xl py-2 pl-12 text-slate-900 dark:text-white focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none" />
                </div>
                <div className="relative group">
                    <label className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-400 uppercase tracking-wider group-focus-within:text-blue-500">Bcc</label>
                    <input value={bcc} onChange={e => setBcc(e.target.value)} className="w-full bg-slate-50 dark:bg-slate-950/50 border border-slate-200 dark:border-slate-800 rounded-xl py-2 pl-12 text-slate-900 dark:text-white focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none" />
                </div>
            </div>
          )}

          <div className="relative group">
             <label className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-400 uppercase tracking-wider group-focus-within:text-blue-500 transition-colors">Sub</label>
             <input value={subject} onChange={e => setSubject(e.target.value)} className="w-full bg-slate-50 dark:bg-slate-950/50 border border-slate-200 dark:border-slate-800 rounded-xl py-3 pl-12 font-medium text-slate-900 dark:text-white focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all outline-none" placeholder="Subject line" />
          </div>
        </div>

        {/* ATTACHMENTS */}
        <div className="px-6 pb-2 flex flex-wrap gap-2 animate-in slide-in-from-top-1">
           {existingAttachments.map((att, i) => (
               <div key={`exist-${i}`} className="flex items-center gap-2 bg-blue-100 dark:bg-blue-900/30 px-3 py-1.5 rounded-lg text-xs font-bold text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800 shadow-sm">
                   <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" /></svg>
                   <span className="truncate max-w-[200px]">{att.filename || 'Attachment'}</span>
                   <button onClick={() => removeExistingAttachment(i)} className="ml-1 p-0.5 hover:bg-blue-200 dark:hover:bg-blue-800 rounded-full text-blue-500 transition-colors">
                     <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
                   </button>
               </div>
           ))}

           {files.map((f, i) => (
               <div key={`new-${i}`} className="flex items-center gap-2 bg-slate-100 dark:bg-slate-800 px-3 py-1.5 rounded-lg text-xs font-bold text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700 shadow-sm">
                   <svg className="w-3.5 h-3.5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                   <span className="truncate max-w-[200px]">{f.name}</span>
                   <button onClick={() => removeFile(i)} className="ml-1 p-0.5 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-full text-slate-400 hover:text-red-500 transition-colors">
                     <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
                   </button>
               </div>
           ))}
        </div>

        {/* EDITOR */}
        <div className="flex-1 p-6 overflow-hidden">
            <div ref={editorRef} contentEditable onInput={handleInput} className="w-full h-full resize-none outline-none text-lg text-slate-800 dark:text-slate-300 leading-relaxed overflow-y-auto custom-scrollbar empty:before:content-['Type_your_message...'] empty:before:text-slate-400" style={{ minHeight: '300px' }} />
        </div>

        {/* FOOTER */}
        <div className="shrink-0 p-4 border-t border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/50 flex justify-between items-center">
            <div className="flex items-center gap-4">
                <button onClick={() => fileInputRef.current?.click()} className="p-2 text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-full transition-all" title="Attach File">
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" /></svg>
                </button>
                <input type="file" multiple ref={fileInputRef} className="hidden" onChange={handleFileChange} />
                <div className="text-xs text-slate-400 font-medium px-2 border-l border-slate-200 dark:border-slate-700">From <span className="text-slate-600 dark:text-slate-300">{userEmail}</span></div>
            </div>

            <div className="flex items-center gap-3">
                <button onClick={handleClose} className="px-6 py-2.5 rounded-xl text-slate-500 font-bold hover:bg-slate-200 dark:hover:bg-slate-800 transition-colors">Discard</button>
                <button onClick={handleSend} disabled={isSending} className="flex items-center gap-2 px-8 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-xl font-bold shadow-lg shadow-blue-600/20 transition-all active:scale-95">
                    {isSending ? (
                        <>
                            <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                            Sending...
                        </>
                    ) : (
                        <>
                            Send Message
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" /></svg>
                        </>
                    )}
                </button>
            </div>
        </div>

      </div>
    </div>
  );
};