import React, { useState, useRef, useEffect } from 'react';
import { Email } from '../types';
import { formatSenderName, formatRelativeTime, getDomain } from './EmailList';
import { mailService } from '../services/mailService';

// 1. Shadow DOM Component (Kept from previous step)
const SafeEmailBody = ({ content }: { content: string }) => {
  const rootRef = useRef<HTMLDivElement>(null);
  const shadowRef = useRef<ShadowRoot | null>(null);

  useEffect(() => {
    if (rootRef.current && !shadowRef.current) {
      shadowRef.current = rootRef.current.attachShadow({ mode: 'open' });
    }
    if (shadowRef.current) {
      shadowRef.current.innerHTML = `
        <style>
          :host { display: block; font-family: sans-serif; color: #334155; }
          img { max-width: 100%; height: auto; }
          a { color: #2563eb; }
          body { margin: 0; padding: 0; background-color: transparent; }
          @media (prefers-color-scheme: dark) {
             :host { color: #cbd5e1; }
             a { color: #60a5fa; }
          }
        </style>
        ${content}
      `;
    }
  }, [content]);

  return <div ref={rootRef} className="w-full" />;
};

// 2. 🛑 NEW: Mini Avatar for Toolbar (Smaller size: w-10 h-10)
const ToolbarAvatar = ({ emailAddr, displayName }: { emailAddr: string, displayName: string }) => {
  const [hasError, setHasError] = useState(false);
  const domain = getDomain(emailAddr);
  const initials = (displayName || '?').charAt(0).toUpperCase();
  const containerClasses = "shrink-0 w-10 h-10 rounded-lg"; // Smaller size

  if (domain && !hasError) {
    const logoUrl = `${mailService.API_BASE}/proxy/logo?domain=${domain}`;
    return (
      <div className={`${containerClasses} flex items-center justify-center bg-white dark:bg-slate-800 overflow-hidden border border-slate-100 dark:border-slate-700`}>
        <img src={logoUrl} alt={displayName} className="w-full h-full object-contain p-1" onError={() => setHasError(true)} />
      </div>
    );
  }
  return (
    <div className={`${containerClasses} flex items-center justify-center text-sm font-bold text-white bg-gradient-to-br from-blue-500 to-indigo-600`}>
      {initials}
    </div>
  );
};

interface EmailDetailProps {
  email: Email;
  onClose: () => void;
  onReply: (email: Email) => void;
}

export default function EmailDetail({ email, onClose, onReply }: EmailDetailProps) {
  const [isProcessing, setIsProcessing] = useState(false);

  const handleMove = async (target: 'Archive' | 'Trash' | 'Inbox') => {
      setIsProcessing(true);
      const success = await mailService.moveEmail(email.id, target);
      if (success) {
          onClose(); 
      } else {
          alert("Failed to move email");
          setIsProcessing(false);
      }
  };

  const handleReplyClick = () => {
      onReply(email);
  };

  const senderName = (email as any).senderName || formatSenderName(email.from);

  return (
    <div className="flex flex-col h-full bg-white dark:bg-slate-900 rounded-2xl shadow-xl border border-slate-200 dark:border-slate-800 animate-in slide-in-from-right-4 duration-300 overflow-hidden">
      
      {/* 🛑 NEW: Unified Top App Bar */}
      <div className="shrink-0 flex items-center justify-between gap-4 px-4 py-3 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 z-20 shadow-sm">
        
        {/* LEFT GROUP: Back + Sender Info */}
        <div className="flex items-center gap-3 min-w-0 max-w-[35%]">
            <button 
                onClick={onClose}
                className="shrink-0 p-2 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 19l-7-7m0 0l7-7m-7 7h18" /></svg>
            </button>

            {/* Sender Avatar & Text */}
            <div className="flex items-center gap-3 min-w-0">
                <ToolbarAvatar emailAddr={email.from} displayName={senderName} />
                <div className="flex flex-col min-w-0">
                    <span className="text-sm font-bold text-slate-900 dark:text-slate-100 truncate leading-tight">
                        {senderName}
                    </span>
                    <span className="text-[11px] text-slate-500 dark:text-slate-400 truncate leading-tight">
                        {email.from}
                    </span>
                </div>
            </div>
        </div>

        {/* CENTER GROUP: Subject */}
        <div className="flex-1 text-center px-4 min-w-0">
            <h2 className="text-sm md:text-base font-bold text-slate-800 dark:text-slate-200 truncate">
                {email.subject}
            </h2>
             {/* Optional: Show labels tiny below subject? Or hide them for cleanness. Hiding for now based on 'save space' request. */}
        </div>

        {/* RIGHT GROUP: Actions + Date */}
        <div className="flex items-center gap-1 sm:gap-2 shrink-0 max-w-[35%] justify-end">
            
            {/* Reply Button */}
            <button 
                onClick={handleReplyClick}
                className="p-2 text-slate-500 hover:text-blue-600 dark:text-slate-400 dark:hover:text-blue-400 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
                title="Reply"
            >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" /></svg>
            </button>

            {/* Trash Button */}
            <button 
                onClick={() => handleMove('Trash')}
                disabled={isProcessing}
                className="p-2 text-slate-500 hover:text-red-600 dark:text-slate-400 dark:hover:text-red-400 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
                title="Delete"
            >
                 <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
            </button>
            
            {/* Divider */}
            <div className="w-px h-5 bg-slate-200 dark:bg-slate-700 mx-1 sm:mx-2"></div>

            {/* Date */}
            <span className="text-xs font-medium text-slate-400 dark:text-slate-500 whitespace-nowrap">
                {formatRelativeTime(email.timestamp)}
            </span>
        </div>

      </div>

      {/* BODY CONTENT */}
      <div className="flex-1 overflow-y-auto px-4 sm:px-8 py-6 custom-scrollbar bg-slate-50/50 dark:bg-slate-900/50">
        
        {/* Render Labels just inside the body if they exist, nice and subtle */}
        {email.labels && email.labels.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-4 justify-center opacity-70 hover:opacity-100 transition-opacity">
                {email.labels.map(label => (
                    <span key={label} className="px-2 py-0.5 rounded text-[10px] font-bold bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300 uppercase tracking-wide border border-blue-200 dark:border-blue-800">
                        {label}
                    </span>
                ))}
            </div>
        )}

        <div className="email-body-wrapper bg-white dark:bg-transparent rounded-lg p-1 sm:p-0">
           <SafeEmailBody content={email.body} />
        </div>
        
        {/* Mobile Reply Footer */}
        <div className="mt-12 pt-6 border-t border-slate-100 dark:border-slate-800 sm:hidden">
            <button 
             onClick={handleReplyClick}
             className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-blue-600 text-white rounded-xl font-bold shadow-lg shadow-blue-500/30"
           >
             <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" /></svg>
             Reply
           </button>
        </div>
      </div>
    </div>
  );
}