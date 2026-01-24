import React, { useState, useEffect } from 'react';
import { Email, Label } from '../types';
import { mailService } from '../services/mailService';

interface EmailListProps {
  emails: Email[];
  onSelect: (id: string) => void;
  isLoading: boolean;
  onRefresh?: () => void;
  // 🛑 NEW: Prop for handling instant/debounced reads
  onBatchRead?: (ids: string[], read: boolean) => void;
  // 🛑 NEW: Prop to notify parent about category change (Smart Tabs)
  onCategoryChange?: (category: string) => void;
  // 🛑 NEW: Current folder to determine if tabs should show
  currentFolder?: string;
}

// ... (Keep formatRelativeTime, formatSenderName, getDomain, BrandAvatar helpers exactly as they are) ...
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

export const formatSenderName = (from: string): string => {
    if (!from) return 'Unknown';
    return from.split('<')[0].replace(/"/g, '').trim() || from;
};

export const getDomain = (emailAddr: string) => {
  if (!emailAddr || !emailAddr.includes('@')) return null;
  return emailAddr.split('@')[1];
};

export const BrandAvatar = ({ emailAddr, displayName }: { emailAddr: string, displayName: string }) => {
  const [hasError, setHasError] = useState(false);
  const domain = getDomain(emailAddr);
  const initials = (displayName || '?').charAt(0).toUpperCase();
  const containerClasses = "shrink-0 w-16 h-16 rounded-xl"; 

  if (domain && !hasError) {
    const logoUrl = `${mailService.API_BASE}/proxy/logo?domain=${domain}`;
    return (
      <div className={`${containerClasses} flex items-center justify-center bg-white dark:bg-slate-800 overflow-hidden`}>
        <img src={logoUrl} alt={displayName} className="w-full h-full object-contain p-2" onError={() => setHasError(true)} />
      </div>
    );
  }
  return (
    <div className={`${containerClasses} flex items-center justify-center text-2xl font-bold text-white bg-gradient-to-br from-blue-500 to-indigo-600`}>
      {initials}
    </div>
  );
};

const EmailList: React.FC<EmailListProps> = ({ emails, onSelect, isLoading, onRefresh, onBatchRead, onCategoryChange, currentFolder }) => {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [labels, setLabels] = useState<Label[]>([]);
  const [isLabelMenuOpen, setIsLabelMenuOpen] = useState(false);
  
  // 🛑 NEW: Active Tab & Drag State
  const [activeTab, setActiveTab] = useState('primary');
  const [dragTargetTab, setDragTargetTab] = useState<string | null>(null);
  
  // 🛑 NEW: Optimistic UI state to hide sorted emails instantly
  const [optimisticallyHidden, setOptimisticallyHidden] = useState<Set<string>>(new Set());

  useEffect(() => {
    mailService.getLabels().then(setLabels);
  }, []);

  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (emails.length === 0 && !isLoading && onRefresh) {
        interval = setInterval(() => { onRefresh(); }, 2000); 
    }
    return () => { if (interval) clearInterval(interval); };
  }, [emails.length, isLoading, onRefresh]);

  // 🛑 NEW: Handle Tab Switching
  const handleTabSwitch = (tab: string) => {
      setActiveTab(tab);
      setOptimisticallyHidden(new Set()); // Reset hidden items when switching tabs
      if (onCategoryChange) onCategoryChange(tab);
  };

  // 🛑 NEW: Drag and Drop Handlers
  const handleDragStart = (e: React.DragEvent, id: string) => {
      e.dataTransfer.setData("text/plain", id);
      e.dataTransfer.effectAllowed = "move";
  };

  const handleTabDragOver = (e: React.DragEvent, tab: string) => {
      e.preventDefault(); // Allow dropping
      if (tab !== activeTab) {
          setDragTargetTab(tab);
      }
  };

  const handleTabDragLeave = (e: React.DragEvent) => {
      setDragTargetTab(null);
  };

  const handleTabDrop = async (e: React.DragEvent, tab: string) => {
      e.preventDefault();
      setDragTargetTab(null);
      const emailId = e.dataTransfer.getData("text/plain");
      
      if (emailId && tab !== activeTab) {
          // 🛑 OPTIMISTIC LOGIC: Hide ALL emails from this sender instantly
          const draggedEmail = emails.find(e => e.id === emailId);
          if (draggedEmail) {
              const sender = draggedEmail.senderAddr;
              // Find all siblings in current list
              const relatedIds = emails
                  .filter(e => e.senderAddr === sender || e.id === emailId)
                  .map(e => e.id);
              
              // Update hidden set
              const newHidden = new Set(optimisticallyHidden);
              relatedIds.forEach(id => newHidden.add(id));
              setOptimisticallyHidden(newHidden);
          }

          // 1. Move & Learn logic (Backend handles bulk update)
          await mailService.moveEmail(emailId, tab);
          
          // 2. Refresh list to confirm move
          if (onRefresh) onRefresh();
      }
  };

  const toggleSelection = (e: React.MouseEvent, id: string) => {
      e.stopPropagation();
      const newSet = new Set(selectedIds);
      if (newSet.has(id)) newSet.delete(id);
      else newSet.add(id);
      setSelectedIds(newSet);
  };

  const handleSelectAll = () => {
    if (selectedIds.size === emails.length && emails.length > 0) {
        setSelectedIds(new Set()); 
    } else {
        setSelectedIds(new Set(emails.map(e => e.id))); 
    }
  };

  const handleApplyLabel = async (labelId: string) => {
      const promises = Array.from(selectedIds).map(emailId => 
          mailService.toggleLabel(emailId, labelId, 'add')
      );
      await Promise.all(promises);
      setSelectedIds(new Set());
      setIsLabelMenuOpen(false);
      if (onRefresh) onRefresh();
  };

  const handleDeleteSelected = async () => {
      const count = selectedIds.size;
      if (count === 0) return;
      if (!confirm(`Are you sure you want to delete ${count} emails?`)) return;
      
      const idsToDelete = Array.from(selectedIds);
      await mailService.deleteEmails(idsToDelete);
      
      setSelectedIds(new Set());
      setIsLabelMenuOpen(false);
      if (onRefresh) onRefresh();
  };

  // 🛑 UPDATED: Batch Read/Unread Handler using prop
  const handleBatchReadStatus = (read: boolean) => {
      const ids = Array.from(selectedIds);
      if (ids.length === 0) return;

      if (onBatchRead) {
          onBatchRead(ids, read);
      } else {
          // Fallback
          mailService.batchMarkRead(ids, read).then(() => onRefresh && onRefresh());
      }
      
      setSelectedIds(new Set());
  };

  const getSnippet = (email: Email) => {
    if (email.preview && email.preview.length > 5) return email.preview;
    if (!email.body) return "";
    try {
        let rawHtml = email.body.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '').replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<iframe[^>]*>[\s\S]*?<\/iframe>/gi, '');
        const doc = new DOMParser().parseFromString(rawHtml, 'text/html');
        let text = doc.body.textContent || "";
        text = text.replace(/\s+/g, ' ').trim();
        if (text.length > 180) return text.substring(0, 180) + "..."; 
        return text;
    } catch (e) { return "Preview unavailable"; }
  };

  // 🛑 Filter out hidden emails (Optimistic UI)
  const visibleEmails = emails.filter(e => !optimisticallyHidden.has(e.id));

  const allSelected = visibleEmails.length > 0 && selectedIds.size === visibleEmails.length;
  const anySelected = selectedIds.size > 0;

  // 🛑 UPDATED: Only show tabs if onCategoryChange is present AND we are in Inbox
  const showTabs = !!onCategoryChange && currentFolder === 'Inbox';

  return (
    // 🛑 ROOT: Fixed Flex Column Layout (Fixes Scrolling Issue)
    <div className="flex flex-col h-full w-full overflow-hidden bg-slate-50 dark:bg-slate-950">
      
      {/* 🛑 HEADER: Fixed Height, Solid Background, High Z-Index */}
      <div className="shrink-0 z-30 bg-slate-50/95 dark:bg-slate-950/95 backdrop-blur-md px-2 sm:px-4 pt-1 border-b border-slate-200/50 dark:border-slate-800/50 transition-colors duration-300">
        
        {/* 🛑 NEW: Smart Tabs Bar (Droppable) - Only visible in Inbox */}
        {showTabs && (
            <div className="flex items-center gap-2 mb-2 overflow-x-auto pb-1 no-scrollbar pt-1">
                {['primary', 'social', 'updates', 'promotions'].map(tab => {
                    const isActive = activeTab === tab;
                    const isTarget = dragTargetTab === tab;

                    // Colors per tab type
                    let activeColor = 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300';
                    if (tab === 'social') activeColor = 'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300';
                    if (tab === 'updates') activeColor = 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300';
                    if (tab === 'promotions') activeColor = 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300';

                    // Drag visual feedback
                    const dragStyle = isTarget ? 'scale-110 ring-2 ring-offset-2 ring-blue-500 z-10' : '';

                    return (
                        <button 
                            key={tab}
                            onClick={() => handleTabSwitch(tab)}
                            // 🛑 Drop Handlers
                            onDragOver={(e) => handleTabDragOver(e, tab)}
                            onDragLeave={handleTabDragLeave}
                            onDrop={(e) => handleTabDrop(e, tab)}
                            className={`px-4 py-1.5 rounded-full text-xs font-bold capitalize transition-all whitespace-nowrap border ${dragStyle} ${
                                isActive 
                                ? `${activeColor} border-transparent shadow-sm`
                                : 'bg-white dark:bg-slate-900 text-slate-500 border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700'
                            }`}
                        >
                            {tab}
                        </button>
                    );
                })}
            </div>
        )}

        {/* PERMANENT TOOLBAR */}
        <div className="flex items-center gap-4 py-1.5">
             
             {/* MASTER CHECKBOX */}
             <div 
                onClick={handleSelectAll}
                className={`cursor-pointer shrink-0 w-5 h-5 rounded border flex items-center justify-center transition-all ${
                    allSelected 
                    ? 'bg-blue-600 border-blue-600 text-white' 
                    : 'border-slate-300 dark:border-slate-600 hover:border-blue-400 bg-white dark:bg-slate-900'
                }`}
            >
                {allSelected && <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7" /></svg>}
            </div>

            {/* BATCH ACTIONS */}
            <div className={`flex items-center gap-2 transition-opacity duration-200 ${anySelected ? 'opacity-100 pointer-events-auto' : 'opacity-30 pointer-events-none'}`}>
                
                {/* Trash */}
                <button 
                    onClick={handleDeleteSelected}
                    className="p-1.5 rounded-lg text-slate-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                    title="Delete Selected"
                >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                </button>

                {/* Mark as Read */}
                <button 
                    onClick={() => handleBatchReadStatus(true)}
                    className="p-1.5 rounded-lg text-slate-500 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors"
                    title="Mark as Read"
                >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 19v-8.93a2 2 0 01.89-1.664l7-4.666a2 2 0 012.22 0l7 4.666A2 2 0 0121 10.07V19M3 19a2 2 0 002 2h14a2 2 0 002-2M3 19l6.75-4.5M21 19l-6.75-4.5M3 10l6.75 4.5M21 10l-6.75 4.5m0 0l-1.14.76a2 2 0 01-2.22 0l-1.14-.76" /></svg>
                </button>

                {/* Mark as Unread */}
                <button 
                    onClick={() => handleBatchReadStatus(false)}
                    className="p-1.5 rounded-lg text-slate-500 hover:text-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                    title="Mark as Unread"
                >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>
                </button>

                {/* Label Dropdown */}
                <div className="relative">
                    <button 
                        onClick={(e) => { e.stopPropagation(); setIsLabelMenuOpen(!isLabelMenuOpen); }}
                        className="p-1.5 rounded-lg text-slate-500 hover:text-purple-600 hover:bg-purple-50 dark:hover:bg-purple-900/20 transition-colors flex items-center gap-1"
                        title="Label Selected"
                    >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" /></svg>
                    </button>
                    
                    {isLabelMenuOpen && (
                        <div className="absolute left-0 top-full mt-1 w-48 bg-white dark:bg-slate-800 rounded-lg shadow-xl border border-slate-200 dark:border-slate-700 z-50 py-1">
                            {labels.length === 0 ? (
                                <div className="px-4 py-2 text-xs text-slate-400">No labels found</div>
                            ) : (
                                labels.map(l => (
                                    <button 
                                        key={l.id}
                                        onClick={() => handleApplyLabel(l.id)}
                                        className="w-full text-left px-4 py-2 text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 flex items-center gap-2"
                                    >
                                        <span className={`w-2 h-2 rounded-full ${l.color}`}></span>
                                        {l.name}
                                    </button>
                                ))
                            )}
                        </div>
                    )}
                </div>
            </div>

            {/* Spacer */}
            <div className="flex-1"></div>

            {/* Right Side Stats */}
            <span className="text-[10px] font-bold text-slate-400 dark:text-slate-600 font-mono tracking-widest uppercase">
                {anySelected ? `${selectedIds.size} SELECTED` : `${visibleEmails.length} MESSAGES`}
            </span>
        </div>
      </div>

      {/* 🛑 LIST AREA: Flex-1 to fill space, Overflow-Y to scroll ONLY this part */}
      <div className="flex-1 overflow-y-auto px-2 sm:px-4 py-2 custom-scrollbar">
        <div className="flex flex-col gap-2 pb-20">
          
          {isLoading && visibleEmails.length === 0 && (
             <div className="h-40 flex flex-col items-center justify-center text-center">
                <div className="w-10 h-10 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mb-4"></div>
                <p className="text-xs font-bold text-slate-400 dark:text-slate-600 font-mono tracking-widest uppercase">Syncing...</p>
             </div>
          )}
          
          {!isLoading && visibleEmails.length === 0 && (
             <div className="h-40 flex flex-col items-center justify-center text-center">
                <p className="text-sm font-medium text-slate-500 dark:text-slate-400">
                    {showTabs ? `No ${activeTab} emails` : 'Mailbox empty'}
                </p>
             </div>
          )}
          
          {visibleEmails.map((email) => {
            const senderName = (email as any).senderName || formatSenderName(email.from);
            const senderAddr = (email as any).senderAddr || email.from;
            const snippet = getSnippet(email);
            const isSelected = selectedIds.has(email.id);
            
            return (
              <div
                key={email.id}
                onClick={() => onSelect(email.id)}
                // 🛑 NEW: Draggable Attribute for Learning
                draggable="true"
                onDragStart={(e) => handleDragStart(e, email.id)}
                
                className={`
                  group cursor-pointer p-2 rounded-xl border transition-all relative overflow-hidden flex items-center gap-4
                  hover:shadow-md hover:border-blue-300 dark:hover:border-blue-700
                  active:cursor-grabbing
                  ${isSelected ? 'bg-blue-50 dark:bg-blue-900/20 border-blue-300 dark:border-blue-700' : ''}
                  ${!isSelected && email.read ? 'bg-white dark:bg-slate-900 border-slate-100 dark:border-slate-800/60' : ''}
                  ${!isSelected && !email.read ? 'bg-white dark:bg-slate-900 border-blue-200 dark:border-blue-900 shadow-sm border-l-4 border-l-blue-500' : ''}
                `}
              >
                {/* CHECKBOX */}
                <div 
                    onClick={(e) => toggleSelection(e, email.id)}
                    className={`shrink-0 w-5 h-5 rounded border flex items-center justify-center transition-all ${
                        isSelected 
                        ? 'bg-blue-600 border-blue-600 text-white' 
                        : 'border-slate-300 dark:border-slate-600 hover:border-blue-400 opacity-30 group-hover:opacity-100' 
                    }`}
                >
                    {isSelected && <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7" /></svg>}
                </div>

                {/* COL 1: AVATAR */}
                <BrandAvatar emailAddr={senderAddr} displayName={senderName} />

                {/* COL 2: SENDER INFO */}
                <div className="w-48 sm:w-56 shrink-0 flex flex-col justify-center gap-0.5">
                    <span className={`text-sm truncate ${!email.read ? 'font-bold text-slate-900 dark:text-white' : 'font-medium text-slate-700 dark:text-slate-300'}`}>{senderName}</span>
                    <span className="text-[11px] text-slate-400 dark:text-slate-500 truncate font-mono">{senderAddr}</span>
                </div>

                {/* COL 3: SUBJECT & SNIPPET */}
                <div className="flex-1 min-w-0 flex flex-col justify-center gap-0.5">
                    <div className="flex items-center gap-2">
                        {email.labels && email.labels.length > 0 && email.labels.map(labelId => (
                            <span key={labelId} className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300 uppercase tracking-wider">{labelId}</span>
                        ))}
                        <span className={`text-sm truncate ${!email.read ? 'font-bold text-slate-800 dark:text-slate-100' : 'font-medium text-slate-600 dark:text-slate-400'}`}>{email.subject}</span>
                    </div>
                    <span className="text-xs text-slate-400 dark:text-slate-500 truncate font-normal">{snippet}</span>
                </div>

                {/* COL 4: TIME */}
                <div className="shrink-0 text-right pl-2">
                    <span className={`text-[11px] font-medium whitespace-nowrap ${!email.read ? 'text-blue-600 dark:text-blue-400' : 'text-slate-400 dark:text-slate-600'}`}>{formatRelativeTime(email.timestamp)}</span>
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