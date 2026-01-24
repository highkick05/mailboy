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
    
    // 4. INJECT SHADOW DOM STYLES (Full Width Centering)
    const themeStyles = `
      <style>
        :host { display: block; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color: ${isDark ? '#f1f5f9' : '#1e293b'}; line-height: 1.6; width: 100%; }
        
        /* LAYOUT RESET */
        body, .email-content { margin: 0; width: 100%; max-width: 100%; }
        
        /* TABLE CENTERING */
        table { margin-left: auto !important; margin-right: auto !important; max-width: 100% !important; }
        
        /* IMAGE FORCED CENTERING */
        img { 
          max-width: 100% !important; 
          height: auto !important; 
          border-radius: 8px; 
          display: block !important; 
          margin: 10px auto !important;
        }

        /* TEXT LINKS */
        a { color: #2563eb; text-decoration: none; font-weight: 500; }
        a:hover { text-decoration: underline; }
        
        /* ELEMENTS */
        blockquote { border-left: 4px solid #cbd5e1; padding-left: 16px; margin-left: 0; color: #64748b; }
        pre, code { background: ${isDark ? '#1e293b' : '#f1f5f9'}; padding: 4px 8px; border-radius: 6px; font-family: 'JetBrains Mono', monospace; font-size: 0.9em; }
      </style>
    `;

    return `
      ${themeStyles}
      <div class="email-content">
        ${isHtml ? clean : `<div style="white-space: pre-wrap; width: 100%; padding: 20px;">${clean}</div>`}
      </div>
    `;
  }, [email]);

  if (!email) return null;

  // Smart extraction (matches EmailList logic)
  const senderName = (email as any).senderName || formatSenderName(email.from);
  const senderAddr = (email as any).senderAddr || email.from;

  return (
    // 🛑 OUTER WRAPPER: Centers the content and handles the background gap
    <div className="w-full h-full flex flex-col items-center bg-slate-50 dark:bg-slate-950">
      
      {/* 🛑 CENTRAL COLUMN: Limited width (max-w-7xl) to match header bar */}
      <div className="w-full max-w-7xl h-full flex flex-col bg-white dark:bg-slate-900 shadow-xl border-x border-slate-200 dark:border-slate-800">
        
        {/* HEADER (Fixed Top) */}
        <div className="p-4 border-b border-slate-100 dark:border-slate-800 flex items-start gap-4 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md shrink-0 z-10">
          <button onClick={onClose} className="mt-1 p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full text-slate-500 transition-colors">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M10 19l-7-7m0 0l7-7m-7 7h18" /></svg>
          </button>
          
          <div className="flex-1 min-w-0">
             <div className="flex items-center justify-between mb-2">
                <h1 className="text-xl sm:text-2xl font-black text-slate-900 dark:text-slate-100 tracking-tight leading-tight truncate">
                  {email.subject}
                </h1>
                <span className={`hidden sm:inline-block px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest border ${email.hydrated ? 'bg-green-50 text-green-600 border-green-200' : 'bg-blue-50 text-blue-600 border-blue-200'}`}>
                  {email.hydrated ? 'Active' : 'Syncing'}
                </span>
             </div>

             <div className="flex items-center gap-3">
                <BrandAvatar emailAddr={senderAddr} displayName={senderName} />
                <div className="flex flex-col">
                   <div className="flex items-baseline gap-2">
                      <span className="text-sm font-bold text-slate-900 dark:text-slate-100">{senderName}</span>
                      <span className="text-xs text-slate-400 dark:text-slate-500 font-mono hidden sm:inline">&lt;{senderAddr}&gt;</span>
                   </div>
                   <span className="text-xs text-slate-400 dark:text-slate-500">
                      {new Date(email.timestamp).toLocaleString(undefined, { dateStyle: 'full', timeStyle: 'short' })}
                   </span>
                </div>
             </div>
          </div>
        </div>

        {/* CONTENT AREA (Scrollable) */}
        <div className="flex-1 overflow-y-auto bg-white dark:bg-slate-900 relative custom-scrollbar">
          <div className="p-6 sm:p-10 w-full">
            <ShadowView html={sanitizedContent} className="w-full min-h-[500px]" />
          </div>
        </div>

        {/* FOOTER (Fixed Bottom) */}
        <div className="p-4 bg-slate-50/80 dark:bg-slate-950/80 border-t border-slate-100 dark:border-slate-800 shrink-0 flex gap-3 justify-end backdrop-blur-sm">
          <button className="px-6 py-2 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-lg text-sm font-bold border border-slate-200 dark:border-slate-700 transition-all shadow-sm">
            Forward
          </button>
          <button className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-bold shadow-lg shadow-blue-600/20 transition-all">
            Reply
          </button>
        </div>

      </div>
    </div>
  );
};

export default EmailDetail;