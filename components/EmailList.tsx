import React, { useState } from 'react';
import { Email } from '../types';
import { mailService } from '../services/mailService';

interface EmailListProps {
  emails: Email[];
  onSelect: (id: string) => void;
  isLoading: boolean;
}

export const formatSenderName = (from: string) => {
  if (!from) return 'Unknown';
  let displayName = '';
  let emailAddr = from;
  if (from.includes('<')) {
    displayName = from.split('<')[0].trim();
    emailAddr = from.split('<')[1].replace('>', '').trim();
  }
  const [local, domain] = emailAddr.split('@');
  const brandName = domain ? domain.split('.')[0] : '';
  const noReplyRegex = /no[-._]?reply|donotreply|do[-._]?not[-._]?reply/i;
  const genericLocalRegex = /^(community|listings|hello|hi|info|support|news|newsletter|notifications|alerts|marketing|team|mail|email|member|members|noreply|donotreply|contact|sales|service)$/i;
  let finalName = displayName;
  if (!finalName || finalName.toLowerCase() === emailAddr.toLowerCase() || genericLocalRegex.test(local) || noReplyRegex.test(local)) {
    if (brandName) {
      finalName = brandName.toUpperCase();
    } else {
      finalName = local;
    }
  }
  return finalName.replace(/[._-]/g, ' ').split(' ').filter(word => word.length > 0).map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()).join(' ');
};

const getDomain = (from: string) => {
  const emailMatch = from.match(/<(.+)>|(\S+@\S+\.\S+)/);
  const email = emailMatch ? (emailMatch[1] || emailMatch[2]) : from;
  if (email && email.includes('@')) return email.split('@')[1];
  return null;
};

export const BrandAvatar = ({ from, displayName, size = 'md' }: { from: string, displayName: string, size?: 'md' | 'lg' }) => {
  const [hasError, setHasError] = useState(false);
  const domain = getDomain(from);
  const initials = displayName.charAt(0).toUpperCase();
  const containerClasses = size === 'md' ? "shrink-0 w-12 h-12 sm:w-16 sm:h-16 rounded-3xl" : "shrink-0 w-16 h-16 sm:w-20 sm:h-20 rounded-[2rem]";

  if (domain && !hasError) {
    const logoUrl = `${mailService.API_BASE}/proxy/logo?domain=${domain}`;
    return (
      <div className={`${containerClasses} flex items-center justify-center bg-white dark:bg-slate-800 shadow-lg overflow-hidden border border-slate-100 dark:border-slate-700/50`}>
        <img src={logoUrl} alt={displayName} className="w-full h-full object-cover p-2" onError={() => setHasError(true)} />
      </div>
    );
  }
  return (
    <div className={`${containerClasses} flex items-center justify-center text-xl sm:text-2xl font-black text-white shadow-lg bg-gradient-to-br from-blue-500 to-blue-700`}>
      {initials}
    </div>
  );
};

const EmailList: React.FC<EmailListProps> = ({ emails, onSelect, isLoading }) => {
  // 1. Full Height Scroll Container for Empty/Loading States
  if (isLoading && emails.length === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-center">
        <div className="w-12 h-12 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mb-6"></div>
        <p className="text-sm font-bold text-slate-400 dark:text-slate-600 font-mono tracking-widest uppercase">Initializing Protocol...</p>
      </div>
    );
  }

  if (emails.length === 0 && !isLoading) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-center">
        <div className="w-20 h-20 bg-white dark:bg-slate-900 rounded-[2rem] flex items-center justify-center mb-6 border border-slate-200 dark:border-slate-800 shadow-sm">
           <svg className="w-10 h-10 text-slate-200 dark:text-slate-700" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" /></svg>
        </div>
        <p className="text-lg font-semibold text-slate-400 dark:text-slate-600">Your mailbox is empty.</p>
      </div>
    );
  }

  const getSnippet = (email: Email) => {
    if (!email.body) return "";
    return email.body
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '') 
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '') 
      .replace(/<\/?[^>]+(>|$)/g, " ") 
      .replace(/\s+/g, ' ') 
      .trim()
      .substring(0, 180);
  };

  // 🚀 FIXED: Wrapped in a dedicated scroll container (h-full overflow-y-auto).
  // This ensures the list has its OWN scrollbar that persists when hidden.
  return (
    <div className="h-full overflow-y-auto px-4 py-6 sm:px-6 custom-scrollbar">
      <div className="max-w-7xl mx-auto flex flex-col gap-5 w-full pb-20">
        <div className="flex items-center justify-between px-2">
          <h2 className="text-xs font-black text-slate-400 dark:text-slate-600 uppercase tracking-[0.4em]">LOCAL_STORE_SYNC</h2>
          <span className="text-[10px] font-black uppercase tracking-[0.1em] text-slate-400 dark:text-slate-700 font-mono">
            V12.2_CACHE: {emails.length} OBJECTS
          </span>
        </div>

        <div className="grid gap-4">
          {emails.map((email) => {
            const displayName = formatSenderName(email.from);
            return (
              <div
                key={email.id}
                onClick={() => onSelect(email.id)}
                className={`email-card group cursor-pointer p-6 sm:p-8 rounded-[2.5rem] border transition-all relative overflow-hidden shadow-sm hover:shadow-2xl hover:shadow-blue-500/10 ${email.read 
                  ? 'bg-white dark:bg-slate-900 border-slate-100 dark:border-slate-800/50' 
                  : 'bg-white dark:bg-slate-900 border-blue-100 dark:border-blue-900/50 border-l-8 border-l-blue-600'}`}
              >
                <div className="flex gap-4 sm:gap-6 items-start">
                  <BrandAvatar from={email.from} displayName={displayName} />
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap justify-between items-start gap-2 mb-1.5">
                      <div className="flex items-center gap-2">
                        <span className={`font-bold truncate text-sm sm:text-base ${email.read ? 'text-slate-500 dark:text-slate-400' : 'text-slate-900 dark:text-slate-100'}`}>
                          {displayName}
                        </span>
                      </div>
                      <span className="text-[10px] font-bold text-slate-400 dark:text-slate-600 font-mono">
                        {new Date(email.timestamp).toLocaleDateString()}
                      </span>
                    </div>
                    <h3 className={`text-sm sm:text-base mb-1.5 truncate leading-tight ${!email.read ? 'font-black text-slate-900 dark:text-slate-100' : 'font-semibold text-slate-700 dark:text-slate-400'}`}>
                      {email.subject}
                    </h3>
                    <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-500 line-clamp-2 opacity-80 group-hover:opacity-100 transition-opacity">
                      {getSnippet(email)}
                    </p>
                  </div>
                </div>
                {!email.read && <div className="absolute top-8 right-8 w-3 h-3 rounded-full bg-blue-600 shadow-[0_0_15px_rgba(37,99,235,0.8)]"></div>}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default EmailList;