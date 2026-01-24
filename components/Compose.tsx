import React, { useState, useRef, useEffect } from 'react';

// 🛑 UPDATE: Add optional initial values
interface ComposeProps {
  onClose: () => void;
  onSend: (data: { to: string; subject: string; body: string }) => Promise<void>;
  userEmail: string;
  initialData?: { to: string; subject: string; body: string }; // <--- NEW
}

export default function Compose({ onClose, onSend, userEmail, initialData }: ComposeProps) {
  // 🛑 UPDATE: Initialize state with props if they exist
  const [to, setTo] = useState(initialData?.to || '');
  const [subject, setSubject] = useState(initialData?.subject || '');
  const [body, setBody] = useState(initialData?.body || '');
  
  const [isSending, setIsSending] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  const toInputRef = useRef<HTMLInputElement>(null);

  // Focus logic: If "To" is filled (like in a Reply), focus the body instead
  useEffect(() => {
    if (initialData?.to && bodyRef.current) {
        bodyRef.current.focus();
        // Move cursor to top (basic hack)
        const range = document.createRange();
        const sel = window.getSelection();
        range.selectNodeContents(bodyRef.current);
        range.collapse(true); // true = start, false = end
        sel?.removeAllRanges();
        sel?.addRange(range);
    } else if (toInputRef.current) {
        toInputRef.current.focus();
    }
  }, [initialData]);

  const handleSendClick = async () => {
    if (!to || !subject) return;
    
    setIsSending(true);
    try {
      const htmlContent = bodyRef.current?.innerHTML || body;
      await onSend({ to, subject, body: htmlContent });
      onClose();
    } catch (e) {
      alert("Failed to send email. Check your SMTP settings.");
      setIsSending(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4 sm:p-6">
      <div className="w-full max-w-2xl bg-white dark:bg-slate-900 rounded-2xl shadow-2xl flex flex-col max-h-[90vh] animate-in slide-in-from-bottom-10 zoom-in-95 duration-200 border border-slate-200 dark:border-slate-800">
        
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 dark:border-slate-800">
          <h2 className="text-lg font-bold text-slate-800 dark:text-white">New Message</h2>
          <button onClick={onClose} className="p-2 -mr-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>

        {/* Form Fields */}
        <div className="flex flex-col flex-1 overflow-y-auto">
          <div className="px-6 py-2 border-b border-slate-100 dark:border-slate-800 flex items-center gap-4">
            <label className="text-sm font-semibold text-slate-500 w-12">To:</label>
            <input 
              ref={toInputRef}
              type="email" 
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="flex-1 bg-transparent py-2 outline-none text-slate-800 dark:text-slate-100 placeholder-slate-400"
              placeholder="recipient@example.com"
            />
          </div>

          <div className="px-6 py-2 border-b border-slate-100 dark:border-slate-800 flex items-center gap-4">
            <label className="text-sm font-semibold text-slate-500 w-12">From:</label>
            <span className="flex-1 py-2 text-slate-600 dark:text-slate-400 text-sm font-mono">
              {userEmail}
            </span>
          </div>

          <div className="px-6 py-2 border-b border-slate-100 dark:border-slate-800 flex items-center gap-4">
            <label className="text-sm font-semibold text-slate-500 w-12">Subject:</label>
            <input 
              type="text" 
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              className="flex-1 bg-transparent py-2 outline-none text-slate-800 dark:text-slate-100 font-medium placeholder-slate-400"
              placeholder="What's this about?"
            />
          </div>

          {/* Editor Body */}
          <div className="flex-1 p-6 min-h-[300px]">
            <div
              ref={bodyRef}
              contentEditable
              className="w-full h-full outline-none text-slate-800 dark:text-slate-200 text-lg leading-relaxed empty:before:content-[attr(data-placeholder)] empty:before:text-slate-400 cursor-text"
              data-placeholder="Write your masterpiece..."
              onInput={(e) => setBody(e.currentTarget.innerHTML)}
            />
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 bg-slate-50 dark:bg-slate-800/50 rounded-b-2xl flex justify-between items-center border-t border-slate-100 dark:border-slate-800">
           <div className="flex gap-2"></div>
           <div className="flex items-center gap-4">
             <button onClick={onClose} className="text-sm font-semibold text-slate-500 hover:text-slate-700 dark:hover:text-slate-300">
               Discard
             </button>
             <button 
               onClick={handleSendClick}
               disabled={!to || !subject || isSending}
               className={`flex items-center gap-2 px-6 py-2.5 rounded-xl font-bold text-white shadow-lg shadow-blue-500/30 transition-all ${(!to || !subject || isSending) ? 'bg-slate-400 cursor-not-allowed opacity-70' : 'bg-blue-600 hover:bg-blue-700 hover:scale-105 active:scale-95'}`}
             >
               {isSending ? (
                 <><span>Sending...</span></>
               ) : (
                 <><span>Send Message</span><svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" /></svg></>
               )}
             </button>
           </div>
        </div>
      </div>
    </div>
  );
}