import React, { useState } from 'react';

interface ComposeProps {
  onClose: () => void;
  onSend: (to: string, subject: string, body: string) => void;
  userEmail: string;
}

const Compose: React.FC<ComposeProps> = ({ onClose, onSend, userEmail }) => {
  const [to, setTo] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSend(to, subject, body);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center p-4 bg-slate-900/40 dark:bg-black/70 backdrop-blur-sm animate-in fade-in duration-300">
      <div className="w-full max-w-2xl bg-white dark:bg-slate-900 rounded-[2rem] shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden animate-in slide-in-from-bottom-10 duration-500">
        <div className="flex items-center justify-between p-6 border-b border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/50">
          <div>
            <h3 className="font-bold text-slate-900 dark:text-slate-200">Secure SMTP Relay</h3>
            <p className="text-[10px] text-slate-500 font-mono tracking-wider">GATEWAY_ID: {userEmail}</p>
          </div>
          <button onClick={onClose} className="p-2.5 hover:bg-slate-200 dark:hover:bg-slate-800 rounded-2xl text-slate-400 transition-colors">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-8 flex flex-col gap-6">
          <div className="flex flex-col gap-1.5">
            <label className="text-[10px] text-slate-400 dark:text-slate-500 uppercase tracking-widest font-black">Recipient</label>
            <input 
              required
              value={to}
              onChange={e => setTo(e.target.value)}
              placeholder="recipient@domain.com"
              className="bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-2xl px-5 py-4 text-sm focus:outline-none focus:ring-4 focus:ring-blue-600/10 dark:text-white dark:placeholder:text-slate-700"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-[10px] text-slate-400 dark:text-slate-500 uppercase tracking-widest font-black">Subject Header</label>
            <input 
              required
              value={subject}
              onChange={e => setSubject(e.target.value)}
              placeholder="Enter subject line"
              className="bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-2xl px-5 py-4 text-sm focus:outline-none focus:ring-4 focus:ring-blue-600/10 dark:text-white dark:placeholder:text-slate-700"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-[10px] text-slate-400 dark:text-slate-500 uppercase tracking-widest font-black">Encrypted Payload</label>
            <textarea 
              required
              value={body}
              onChange={e => setBody(e.target.value)}
              placeholder="Compose your message..."
              rows={8}
              className="bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-2xl px-5 py-5 text-sm focus:outline-none focus:ring-4 focus:ring-blue-600/10 placeholder:text-slate-300 dark:placeholder:text-slate-800 resize-none font-sans dark:text-white"
            />
          </div>

          <div className="flex items-center justify-between mt-4">
            <div className="text-[9px] text-slate-400 dark:text-slate-600 uppercase font-mono tracking-tighter">
              L1 Cache Bypass &rarr; Direct Relay Push
            </div>
            <button 
              type="submit"
              className="px-12 py-4 bg-blue-600 hover:bg-blue-700 text-white rounded-2xl font-bold shadow-xl shadow-blue-600/20 flex items-center gap-2 transition-all active:scale-95"
            >
              Broadcast
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M14 5l7 7m0 0l-7 7m7-7H3" /></svg>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default Compose;