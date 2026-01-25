import React, { useState, useRef, useEffect } from 'react';
import { Email } from '../types';
import { formatSenderName, formatRelativeTime, getDomain } from './EmailList';
import { mailService } from '../services/mailService';

// 1. Shadow DOM Component (Kept same)
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

// 2. Mini Avatar (Kept same)
const ToolbarAvatar = ({ emailAddr, displayName }: { emailAddr: string, displayName: string }) => {
  const [hasError, setHasError] = useState(false);
  const domain = getDomain(emailAddr);
  const initials = (displayName || '?').charAt(0).toUpperCase();
  const containerClasses = "shrink-0 w-10 h-10 rounded-lg"; 

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
  // Props for Reply All and Forward
  onReplyAll: (email: Email) => void;
  onForward: (email: Email) => void;
}

export default function EmailDetail({ email, onClose, onReply, onReplyAll, onForward }: EmailDetailProps) {
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

  const handleMarkAsSpam = async () => {
      if (confirm('Mark this sender as Spam?')) {
          setIsProcessing(true);
          const success = await mailService.moveEmail(email.id, 'Spam');
          if (success) {
              onClose();
          } else {
              alert("Failed to mark as spam");
              setIsProcessing(false);
          }
      }
  };

  const senderName = (email as any).senderName || formatSenderName(email.from);

  return (
    <div className="flex flex-col h-full bg-white dark:bg-slate-900 rounded-2xl shadow-xl border border-slate-200 dark:border-slate-800 animate-in slide-in-from-right-4 duration-300 overflow-hidden">
      
      {/* Unified Top App Bar */}
      <div className="shrink-0 flex items-center justify-between gap-4 px-4 py-3 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 z-20 shadow-sm">
        
        {/* LEFT GROUP: Back + Sender Info */}
        <div className="flex items-center gap-3 min-w-0 max-w-[35%]">
            <button 
                onClick={onClose}
                className="shrink-0 p-2 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 19l-7-7m0 0l7-7m-7 7h18" /></svg>
            </button>

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
        </div>

        {/* RIGHT GROUP: Actions */}
        <div className="flex items-center gap-1 sm:gap-2 shrink-0 max-w-[35%] justify-end">
            
            {/* Reply (Single Arrow) */}
            <button 
                onClick={() => onReply(email)}
                className="p-2 text-slate-500 hover:text-blue-600 dark:text-slate-400 dark:hover:text-blue-400 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
                title="Reply"
            >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" /></svg>
            </button>

            {/* Reply All (Double Arrow) */}
            <button 
                onClick={() => onReplyAll(email)}
                className="p-2 text-slate-500 hover:text-blue-600 dark:text-slate-400 dark:hover:text-blue-400 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
                title="Reply All"
            >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6m6 6l6-6" /></svg>
            </button>

            {/* Forward (Right Arrow) */}
            <button 
                onClick={() => onForward(email)}
                className="p-2 text-slate-500 hover:text-blue-600 dark:text-slate-400 dark:hover:text-blue-400 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
                title="Forward"
            >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M14 5l7 7m0 0l-7 7m7-7H3" /></svg>
            </button>

            <div className="w-px h-5 bg-slate-200 dark:bg-slate-700 mx-1"></div>

            {/* Spam */}
            <button 
                onClick={handleMarkAsSpam}
                disabled={isProcessing}
                className="p-2 text-slate-500 hover:text-amber-600 dark:text-slate-400 dark:hover:text-amber-500 rounded-lg hover:bg-amber-50 dark:hover:bg-amber-900/20 transition-colors"
                title="Mark as Spam"
            >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
            </button>

            {/* Trash */}
            <button 
                onClick={() => handleMove('Trash')}
                disabled={isProcessing}
                className="p-2 text-slate-500 hover:text-red-600 dark:text-slate-400 dark:hover:text-red-400 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
                title="Delete"
            >
                 <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
            </button>
        </div>

      </div>

      {/* BODY CONTENT */}
      <div className="flex-1 overflow-y-auto px-4 sm:px-8 py-6 custom-scrollbar bg-slate-50/50 dark:bg-slate-900/50">
        
        {/* Render Labels */}
        {(email.labels && email.labels.length > 0) && (
            <div className="flex flex-wrap gap-2 mb-4 justify-center opacity-70 hover:opacity-100 transition-opacity">
                {email.labels.map(label => (
                    <span key={label} className="px-2 py-0.5 rounded text-[10px] font-bold bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300 uppercase tracking-wide border border-blue-200 dark:border-blue-800">
                        {label}
                    </span>
                ))}
            </div>
        )}

        {/* 🛑 NEW: Render Attachments */}
        {/* We cast to 'any' here just in case Email type definition isn't fully updated yet */}
        {((email as any).attachments && (email as any).attachments.length > 0) && (
            <div className="mb-4 flex flex-wrap gap-3">
                {(email as any).attachments.map((att: any, i: number) => (
                    <a 
                        key={i} 
                        href={`${mailService.API_BASE}/attachments/${att.path}`} 
                        target="_blank" 
                        rel="noreferrer"
                        className="flex items-center gap-3 p-3 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 hover:border-blue-300 hover:shadow-md transition-all group"
                        title="Download Attachment"
                    >
                        <div className="w-10 h-10 bg-slate-100 dark:bg-slate-700 rounded-lg flex items-center justify-center text-slate-500 dark:text-slate-400 font-bold text-xs uppercase border border-slate-200 dark:border-slate-600">
                            {att.filename.split('.').pop()?.substring(0,3) || 'FILE'}
                        </div>
                        <div className="flex flex-col">
                            <span className="text-sm font-bold text-slate-700 dark:text-slate-200 group-hover:text-blue-600 truncate max-w-[150px]">
                                {att.filename}
                            </span>
                            <span className="text-[10px] text-slate-400 font-mono">
                                {Math.round(att.size / 1024)} KB
                            </span>
                        </div>
                        {/* Download Icon */}
                        <div className="ml-2 text-slate-300 group-hover:text-blue-500">
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                        </div>
                    </a>
                ))}
            </div>
        )}

        <div className="email-body-wrapper bg-white dark:bg-transparent rounded-lg p-1 sm:p-0">
           <SafeEmailBody content={email.body} />
        </div>
      </div>
    </div>
  );
}