import React, { useState, useEffect } from 'react';
import { Email } from '../types';
import { mailService } from '../services/mailService';

interface EmailListProps {
  emails: Email[];
  onSelect: (id: string) => void;
  isLoading: boolean;
  onRefresh?: () => void;
}

// ==========================================
// 🕒 HELPER: RELATIVE TIME FORMATTER
// ==========================================
export const formatRelativeTime = (timestamp: number) => {
  const date = new Date(timestamp);
  const now = new Date();
  const diffInSeconds = Math.floor((now.getTime() - date.getTime()) / 1000);
  
  if (diffInSeconds < 60) return 'Just now';
  
  const diffInMinutes = Math.floor(diffInSeconds / 60);
  if (diffInMinutes < 60) return `${diffInMinutes}m ago`;
  
  const diffInHours = Math.floor(diffInMinutes / 60);
  if (diffInHours < 24) return `${diffInHours}h ago`;
  
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ', ' + 
         date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
};

// ==========================================
// 🛠️ SHARED HELPERS
// ==========================================
export const formatSenderName = (from: string): string => {
    if (!from) return 'Unknown';
    return from.split('<')[0].replace(/"/g, '').trim() || from;
};

export const getDomain = (emailAddr: string) => {
  if (!emailAddr || !emailAddr.includes('@')) return null;
  return emailAddr.split('@')[1];
};

// ==========================================
// 🖼️ AVATAR COMPONENT (Borderless)
// ==========================================
export const BrandAvatar = ({ emailAddr, displayName }: { emailAddr: string, displayName: string }) => {
  const [hasError, setHasError] = useState(false);
  const domain = getDomain(emailAddr);
  const initials = (displayName || '?').charAt(0).toUpperCase();
  
  const containerClasses = "shrink-0 w-16 h-16 rounded-xl"; 

  if (domain && !hasError) {
    const logoUrl = `${mailService.API_BASE}/proxy/logo?domain=${domain}`;
    return (
      // 🛑 CHANGED: Removed 'shadow-sm' to remove the light border effect
      <div className={`${containerClasses} flex items-center justify-center bg-white dark:bg-slate-800 overflow-hidden`}>
        <img 
          src={logoUrl} 
          alt={displayName} 
          className="w-full h-full object-contain p-2" 
          onError={() => setHasError(true)} 
        />
      </div>
    );
  }
  
  return (
    // 🛑 CHANGED: Removed 'shadow-sm'
    <div className={`${containerClasses} flex items-center justify-center text-2xl font-bold text-white bg-gradient-to-br from-blue-500 to-indigo-600`}>
      {initials}
    </div>
  );
};

// ==========================================
// 📜 EMAIL LIST COMPONENT (Table Layout)
// ==========================================
const EmailList: React.FC<EmailListProps> = ({ emails, onSelect, isLoading, onRefresh }) => {
  
  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (emails.length === 0 && !isLoading && onRefresh) {
        interval = setInterval(() => { onRefresh(); }, 2000); 
    }
    return () => { if (interval) clearInterval(interval); };
  }, [emails.length, isLoading, onRefresh]);

  // Loading State
  if (isLoading && emails.length === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-center">
        <div className="w-10 h-10 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mb-4"></div>
        <p className="text-xs font-bold text-slate-400 dark:text-slate-600 font-mono tracking-widest uppercase">Syncing...</p>
      </div>
    );
  }

  // Empty State
  if (emails.length === 0 && !isLoading) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-center">
        <div className="w-16 h-16 bg-slate-50 dark:bg-slate-800/50 rounded-2xl flex items-center justify-center mb-4 border border-dashed border-slate-300 dark:border-slate-700">
           <svg className="w-8 h-8 text-slate-300 dark:text-slate-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" /></svg>
        </div>
        <p className="text-sm font-medium text-slate-500 dark:text-slate-400">Mailbox empty</p>
      </div>
    );
  }

  // 🔎 SNIPPET PARSER
  const getSnippet = (email: Email) => {
    if (email.preview && email.preview.length > 5) return email.preview;
    if (!email.body) return "";
    try {
        let rawHtml = email.body
            .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
            .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
            .replace(/<iframe[^>]*>[\s\S]*?<\/iframe>/gi, '');
        const doc = new DOMParser().parseFromString(rawHtml, 'text/html');
        let text = doc.body.textContent || "";
        text = text.replace(/\s+/g, ' ').trim();
        if (text.length > 180) return text.substring(0, 180) + "..."; 
        return text;
    } catch (e) { return "Preview unavailable"; }
  };

  return (
    <div className="h-full overflow-y-auto px-2 py-2 sm:px-4 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:'none'] [scrollbar-width:'none']">
      <div className="w-full mx-auto flex flex-col gap-2 pb-20">
        
        {/* Header / Stats */}
        <div className="flex items-center justify-between px-4 mb-1">
          <h2 className="text-[10px] font-black text-slate-400 dark:text-slate-600 uppercase tracking-widest">INBOX</h2>
          <span className="text-[10px] font-bold text-slate-400 dark:text-slate-600 font-mono">
            {emails.length} MESSAGES
          </span>
        </div>

        {/* List */}
        <div className="flex flex-col gap-2">
          {emails.map((email) => {
            const senderName = (email as any).senderName || formatSenderName(email.from);
            const senderAddr = (email as any).senderAddr || email.from;
            const snippet = getSnippet(email);
            
            return (
              <div
                key={email.id}
                onClick={() => onSelect(email.id)}
                className={`
                  group cursor-pointer p-2 rounded-xl border transition-all relative overflow-hidden flex items-center gap-4
                  hover:shadow-md hover:border-blue-300 dark:hover:border-blue-700
                  ${email.read 
                    ? 'bg-white dark:bg-slate-900 border-slate-100 dark:border-slate-800/60' 
                    : 'bg-white dark:bg-slate-900 border-blue-200 dark:border-blue-900 shadow-sm border-l-4 border-l-blue-500'
                  }
                `}
              >
                
                {/* COL 1: AVATAR */}
                <BrandAvatar emailAddr={senderAddr} displayName={senderName} />

                {/* COL 2: SENDER INFO */}
                <div className="w-48 sm:w-56 shrink-0 flex flex-col justify-center gap-0.5">
                    <span className={`text-sm truncate ${!email.read ? 'font-bold text-slate-900 dark:text-white' : 'font-medium text-slate-700 dark:text-slate-300'}`}>
                        {senderName}
                    </span>
                    <span className="text-[11px] text-slate-400 dark:text-slate-500 truncate font-mono">
                        {senderAddr}
                    </span>
                </div>

                {/* COL 3: SUBJECT & SNIPPET */}
                <div className="flex-1 min-w-0 flex flex-col justify-center gap-0.5">
                    <span className={`text-sm truncate ${!email.read ? 'font-bold text-slate-800 dark:text-slate-100' : 'font-medium text-slate-600 dark:text-slate-400'}`}>
                        {email.subject}
                    </span>
                    <span className="text-xs text-slate-400 dark:text-slate-500 truncate font-normal">
                        {snippet}
                    </span>
                </div>

                {/* COL 4: TIME */}
                <div className="shrink-0 text-right pl-2">
                    <span className={`text-[11px] font-medium whitespace-nowrap ${!email.read ? 'text-blue-600 dark:text-blue-400' : 'text-slate-400 dark:text-slate-600'}`}>
                        {formatRelativeTime(email.timestamp)}
                    </span>
                </div>

              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default EmailList;