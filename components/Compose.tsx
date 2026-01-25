import React, { useState, useEffect, useRef } from 'react';

interface ComposeProps {
  onClose: () => void;
  // onSend now accepts optional files array
  onSend: (payload: { to: string; cc?: string; bcc?: string; subject: string; body: string; files?: File[] }) => Promise<void>;
  userEmail: string;
  initialData?: {
    to: string;
    cc?: string;
    subject: string;
    body: string;
  };
}

export default function Compose({ onClose, onSend, userEmail, initialData }: ComposeProps) {
  const [to, setTo] = useState('');
  const [cc, setCc] = useState('');
  const [bcc, setBcc] = useState('');
  const [subject, setSubject] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [showCcBcc, setShowCcBcc] = useState(false);
  const [draftSaved, setDraftSaved] = useState(false);
  
  // File State
  const [files, setFiles] = useState<File[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  // We use a ref for the contentEditable div to handle HTML content (replies/forwards)
  const editorRef = useRef<HTMLDivElement>(null);

  // 1. Populate fields (Load Draft OR Reply Data)
  useEffect(() => {
    if (initialData) {
      // REPLY / FORWARD MODE
      setTo(initialData.to || '');
      setCc(initialData.cc || '');
      setSubject(initialData.subject || '');
      
      if (editorRef.current) {
        editorRef.current.innerHTML = initialData.body 
          ? `<br>${initialData.body}` 
          : '';
      }
      
      if (initialData.cc) setShowCcBcc(true);
    } else {
      // FRESH COMPOSE MODE - CHECK FOR SAVED DRAFT
      const saved = localStorage.getItem('mailboy_draft');
      if (saved) {
        try {
          const draft = JSON.parse(saved);
          setTo(draft.to || '');
          setSubject(draft.subject || '');
          // We can't easily restore files from localStorage, just text
          if (editorRef.current) editorRef.current.innerHTML = draft.body || '';
          setDraftSaved(true);
        } catch (e) { }
      }
    }
  }, [initialData]);

  // 2. Autosave Logic (Interval)
  useEffect(() => {
    // Only autosave for fresh emails, not replies (to avoid overwriting draft with reply data)
    if (initialData) return;

    const interval = setInterval(() => {
      const body = editorRef.current?.innerHTML || '';
      const hasContent = to || subject || (body && body !== '<br>');
      
      if (hasContent) {
        const draftData = { to, subject, body };
        // Check if different from saved to avoid unnecessary writes
        const currentSaved = localStorage.getItem('mailboy_draft');
        if (currentSaved !== JSON.stringify(draftData)) {
            localStorage.setItem('mailboy_draft', JSON.stringify(draftData));
            setDraftSaved(true);
        }
      }
    }, 2000); // Save every 2 seconds

    return () => clearInterval(interval);
  }, [to, subject, initialData]);

  // Handle File Selection
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files && e.target.files.length > 0) {
          setFiles(prev => [...prev, ...Array.from(e.target.files!)]);
      }
      if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const removeFile = (index: number) => {
      setFiles(prev => prev.filter((_, i) => i !== index));
  };

  const handleSend = async () => {
    if (!to) return alert('Please add a recipient');
    setIsSending(true);
    try {
      const bodyContent = editorRef.current?.innerHTML || '';
      
      await onSend({ 
        to, 
        cc, 
        bcc, 
        subject, 
        body: bodyContent,
        files // Pass files to parent
      });

      // Clear draft on successful send
      localStorage.removeItem('mailboy_draft');
      onClose();
    } catch (e) {
      alert('Failed to send');
      setIsSending(false);
    }
  };

  const handleClose = () => {
      // Just close, keeping the draft in localStorage so user can resume later
      onClose();
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      
      {/* Larger Window (max-w-5xl, h-[85vh]) */}
      <div className="bg-white dark:bg-slate-900 w-full max-w-5xl h-[85vh] rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 flex flex-col overflow-hidden ring-1 ring-white/10">
        
        {/* HEADER */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/50">
          <div className="flex items-center gap-3">
              <h2 className="text-lg font-bold text-slate-700 dark:text-slate-200">New Message</h2>
              {draftSaved && !initialData && (
                  <span className="text-[10px] uppercase font-bold tracking-wider text-slate-400 border border-slate-200 dark:border-slate-700 px-2 py-0.5 rounded animate-pulse">
                      Draft Saved
                  </span>
              )}
          </div>
          <button 
            onClick={handleClose}
            className="p-2 -mr-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-full hover:bg-slate-200 dark:hover:bg-slate-800 transition-colors"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>

        {/* FIELDS */}
        <div className="px-6 py-4 space-y-4 shrink-0">
          {/* TO Field */}
          <div className="relative group">
             <label className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-400 uppercase tracking-wider group-focus-within:text-blue-500 transition-colors">To</label>
             <input 
                value={to}
                onChange={e => setTo(e.target.value)}
                className="w-full bg-slate-50 dark:bg-slate-950/50 border border-slate-200 dark:border-slate-800 rounded-xl py-3 pl-12 pr-20 text-slate-900 dark:text-white focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all outline-none"
                placeholder="recipient@example.com"
                autoFocus={!initialData} 
             />
             <button 
               onClick={() => setShowCcBcc(!showCcBcc)}
               className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
             >
               CC/BCC
             </button>
          </div>

          {/* CC / BCC (Hidden by default) */}
          {showCcBcc && (
            <div className="grid grid-cols-2 gap-4 animate-in slide-in-from-top-2 fade-in">
                <div className="relative group">
                    <label className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-400 uppercase tracking-wider group-focus-within:text-blue-500">Cc</label>
                    <input 
                        value={cc}
                        onChange={e => setCc(e.target.value)}
                        className="w-full bg-slate-50 dark:bg-slate-950/50 border border-slate-200 dark:border-slate-800 rounded-xl py-2 pl-12 text-slate-900 dark:text-white focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none"
                    />
                </div>
                <div className="relative group">
                    <label className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-400 uppercase tracking-wider group-focus-within:text-blue-500">Bcc</label>
                    <input 
                        value={bcc}
                        onChange={e => setBcc(e.target.value)}
                        className="w-full bg-slate-50 dark:bg-slate-950/50 border border-slate-200 dark:border-slate-800 rounded-xl py-2 pl-12 text-slate-900 dark:text-white focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none"
                    />
                </div>
            </div>
          )}

          {/* SUBJECT Field */}
          <div className="relative group">
             <label className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-400 uppercase tracking-wider group-focus-within:text-blue-500 transition-colors">Sub</label>
             <input 
                value={subject}
                onChange={e => setSubject(e.target.value)}
                className="w-full bg-slate-50 dark:bg-slate-950/50 border border-slate-200 dark:border-slate-800 rounded-xl py-3 pl-12 font-medium text-slate-900 dark:text-white focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all outline-none"
                placeholder="Subject line"
             />
          </div>
        </div>

        {/* Attachment Chips Area */}
        {files.length > 0 && (
           <div className="px-6 pb-2 flex flex-wrap gap-2 animate-in slide-in-from-top-1">
               {files.map((f, i) => (
                   <div key={i} className="flex items-center gap-2 bg-slate-100 dark:bg-slate-800 px-3 py-1.5 rounded-lg text-xs font-bold text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700 shadow-sm">
                       {/* Generic File Icon */}
                       <svg className="w-3.5 h-3.5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                       <span className="truncate max-w-[200px]">{f.name}</span>
                       <button 
                         onClick={() => removeFile(i)} 
                         className="ml-1 p-0.5 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-full text-slate-400 hover:text-red-500 transition-colors"
                       >
                         <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
                       </button>
                   </div>
               ))}
           </div>
        )}

        {/* EDITOR: ContentEditable Div */}
        <div className="flex-1 p-6 overflow-hidden">
            <div 
                ref={editorRef}
                contentEditable
                className="w-full h-full resize-none outline-none text-lg text-slate-800 dark:text-slate-300 leading-relaxed overflow-y-auto custom-scrollbar empty:before:content-['Type_your_message...'] empty:before:text-slate-400"
                style={{ minHeight: '300px' }}
            />
        </div>

        {/* FOOTER */}
        <div className="shrink-0 p-4 border-t border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/50 flex justify-between items-center">
            <div className="flex items-center gap-4">
                {/* Attach Button (Paperclip) */}
                <button 
                    onClick={() => fileInputRef.current?.click()}
                    className="p-2 text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-full transition-all"
                    title="Attach File"
                >
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" /></svg>
                </button>
                <input 
                    type="file" 
                    multiple 
                    ref={fileInputRef} 
                    className="hidden" 
                    onChange={handleFileChange} 
                />

                <div className="text-xs text-slate-400 font-medium px-2 border-l border-slate-200 dark:border-slate-700">
                    Sending as <span className="text-slate-600 dark:text-slate-300">{userEmail}</span>
                </div>
            </div>

            <div className="flex items-center gap-3">
                <button 
                    onClick={handleClose}
                    className="px-6 py-2.5 rounded-xl text-slate-500 font-bold hover:bg-slate-200 dark:hover:bg-slate-800 transition-colors"
                >
                    Discard
                </button>
                <button 
                    onClick={handleSend}
                    disabled={isSending}
                    className="flex items-center gap-2 px-8 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-xl font-bold shadow-lg shadow-blue-600/30 transition-all active:scale-95"
                >
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
}