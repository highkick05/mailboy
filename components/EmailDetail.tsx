import React, { useMemo } from 'react';
import { Email } from '../types';
import { mailService } from '../services/mailService';
import DOMPurify from 'isomorphic-dompurify';
import { formatSenderName, BrandAvatar } from './EmailList';
import { ShadowView } from './ShadowView';

interface EmailDetailProps {
  email: Email | null;
  onClose: () => void;
}

const EmailDetail: React.FC<EmailDetailProps> = ({ email, onClose }) => {
  const sanitizedContent = useMemo(() => {
    if (!email) return '';
    
    // 1. PATH CORRECTION
    const absoluteBody = email.body.replace(
      /src="\/api\/v1/g, 
      `src="${mailService.API_BASE}`
    );

    // 2. NUCLEAR SANITIZATION
    let preClean = absoluteBody
      .replace(/<script\b[^>]*>([\s\S]*?)<\/script>/gim, "")
      .replace(/<iframe\b[^>]*>([\s\S]*?)<\/iframe>/gim, "")
      .replace(/javascript:/gim, "")
      .replace(/\bon\w+="[^"]*"/gim, "");

    // 3. DOM PURIFY
    const clean = DOMPurify.sanitize(preClean, {
      USE_PROFILES: { html: true },
      ADD_TAGS: ['style', 'base', 'center', 'svg', 'path', 'g', 'defs', 'linearGradient', 'stop', 'circle', 'rect'],
      ADD_ATTR: ['target', 'style', 'class', 'id', 'bgcolor', 'width', 'height', 'cellspacing', 'cellpadding', 'border', 'align', 'valign', 'viewBox', 'd', 'fill', 'stroke', 'stroke-width', 'gradientUnits', 'x1', 'y1', 'x2', 'y2', 'offset', 'stop-color']
    });

    const isHtml = clean.includes('<div') || clean.includes('<table') || clean.includes('<p');
    const isDark = document.documentElement.classList.contains('dark');
    
    // 4. INJECT SHADOW DOM STYLES (NUCLEAR CENTERING UPDATE)
    const themeStyles = `
      <style>
        :host { display: block; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color: ${isDark ? '#f1f5f9' : '#1e293b'}; line-height: 1.6; width: 100%; }
        
        /* LAYOUT RESET */
        body, .email-content { margin: 0 auto !important; width: 100%; max-width: 100%; display: flex; flex-direction: column; align-items: center; }
        
        /* TABLE CENTERING */
        table { margin-left: auto !important; margin-right: auto !important; max-width: 100% !important; }
        
        /* IMAGE FORCED CENTERING */
        img { 
          max-width: 100% !important; 
          height: auto !important; 
          border-radius: 12px; 
          display: block !important; 
          margin-left: auto !important; 
          margin-right: auto !important; 
          float: none !important; /* Overrides align="left" */
        }

        /* TEXT LINKS */
        a { color: #2563eb; text-decoration: none; font-weight: 500; }
        a:hover { text-decoration: underline; }
        
        /* ELEMENTS */
        blockquote { border-left: 4px solid #cbd5e1; padding-left: 16px; margin-left: 0; color: #64748b; }
        pre, code { background: ${isDark ? '#1e293b' : '#f1f5f9'}; padding: 4px 8px; border-radius: 6px; font-family: 'JetBrains Mono', monospace; font-size: 0.9em; }
        div { max-width: 100%; box-sizing: border-box; }
      </style>
    `;

    return `
      ${themeStyles}
      <div class="email-content">
        ${isHtml ? clean : `<div style="white-space: pre-wrap; width: 100%;">${clean}</div>`}
      </div>
    `;
  }, [email]);

  if (!email) return null;
  const displayName = formatSenderName(email.from);

  return (
    <div className="w-full">
      <div className="max-w-5xl mx-auto flex flex-col bg-white dark:bg-slate-900 rounded-[2rem] sm:rounded-[3rem] border border-slate-200 dark:border-slate-800 shadow-2xl">
        {/* Header */}
        <div className="p-6 sm:px-10 sm:py-8 border-b border-slate-100 dark:border-slate-800 flex flex-col sm:flex-row justify-between items-start gap-6 bg-slate-50/50 dark:bg-slate-950/40 shrink-0 rounded-t-[2rem] sm:rounded-t-[3rem]">
          <div className="flex gap-4 sm:gap-6 items-center w-full min-w-0">
            <button onClick={onClose} className="p-3 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 rounded-2xl text-slate-500 transition-all border border-slate-200 dark:border-slate-700 active:scale-90 shadow-sm">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M10 19l-7-7m0 0l7-7m-7 7h18" /></svg>
            </button>
            <div className="flex items-center gap-4 min-w-0 flex-1">
               <BrandAvatar from={email.from} displayName={displayName} size="md" />
               <div className="min-w-0 flex-1">
                  <h2 className="text-xl sm:text-2xl font-black text-slate-900 dark:text-slate-100 tracking-tight leading-tight mb-1 truncate pr-4">{email.subject}</h2>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold text-slate-600 dark:text-slate-400 truncate">{displayName}</span>
                    <span className="text-slate-300 dark:text-slate-600">•</span>
                    <span className="text-[10px] font-mono text-slate-400">{new Date(email.timestamp).toLocaleString()}</span>
                  </div>
               </div>
            </div>
          </div>
          <span className={`px-4 py-2 rounded-full text-[9px] font-black uppercase tracking-widest border shrink-0 ${email.hydrated ? 'bg-green-50 text-green-600 border-green-200 dark:bg-green-900/20 dark:text-green-400' : 'bg-blue-50 text-blue-600 border-blue-200 animate-pulse'}`}>
            {email.hydrated ? 'L1 Memory Active' : 'Relay Syncing'}
          </span>
        </div>

        {/* Content Area */}
        <div className="bg-white dark:bg-slate-950 p-6 sm:p-12 min-h-[400px]">
          <ShadowView html={sanitizedContent} className="w-full" />
        </div>

        {/* Footer */}
        <div className="p-6 bg-slate-50/50 dark:bg-slate-950/40 flex justify-center gap-4 shrink-0 border-t border-slate-100 dark:border-slate-800 rounded-b-[2rem] sm:rounded-b-[3rem]">
          <button className="flex-1 py-4 bg-blue-600 hover:bg-blue-700 text-white rounded-2xl font-black text-xs uppercase tracking-widest active:scale-95 transition-all shadow-xl shadow-blue-600/20">Reply</button>
          <button className="flex-1 py-4 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 rounded-2xl font-black text-xs uppercase tracking-widest active:scale-95 transition-all border border-slate-200 dark:border-slate-700 shadow-sm">Forward</button>
        </div>
      </div>
    </div>
  );
};

export default EmailDetail;