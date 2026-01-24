import React, { forwardRef, useState, useRef, useEffect } from 'react';
import { EmailFolder, Label } from '../types';
import { mailService } from '../services/mailService';
import { Logo } from './Logo';

interface LayoutProps {
  children: React.ReactNode;
  currentFolder: EmailFolder | string; // Allow string for custom labels
  onFolderChange: (folder: EmailFolder | string) => void;
  onOpenSettings: () => void;
  onSync: () => void;
  isConfigured: boolean;
  syncPercent?: number;
  darkMode: boolean;
  toggleTheme: () => void;
}

const systemFolders: string[] = ['Inbox', 'Sent', 'Drafts', 'Trash', 'Spam'];
const tailwindColors = ['bg-red-500', 'bg-orange-500', 'bg-amber-500', 'bg-green-500', 'bg-emerald-500', 'bg-teal-500', 'bg-cyan-500', 'bg-blue-500', 'bg-indigo-500', 'bg-violet-500', 'bg-purple-500', 'bg-fuchsia-500', 'bg-pink-500', 'bg-rose-500'];

const Layout = forwardRef<HTMLDivElement, LayoutProps>(({ children, currentFolder, onFolderChange, onOpenSettings, onSync, isConfigured, syncPercent, darkMode, toggleTheme }, ref) => {
  const [isLabelMenuOpen, setIsLabelMenuOpen] = useState(false);
  const [labels, setLabels] = useState<Label[]>([]);
  const menuRef = useRef<HTMLDivElement>(null);

  // 1. Fetch Labels on Mount & When Configured
  useEffect(() => {
    if (isConfigured) {
        mailService.getLabels().then(setLabels);
    }
  }, [isConfigured]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsLabelMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // 2. Handle Creation
  const handleCreateLabel = async () => {
      const name = prompt("Enter label name (e.g., 'Work', 'Travel'):");
      if (!name) return;
      const randomColor = tailwindColors[Math.floor(Math.random() * tailwindColors.length)];
      
      const newLabel = await mailService.createLabel(name, randomColor);
      if (newLabel) {
          setLabels(prev => [...prev, newLabel]);
      }
  };

  // 3. Handle Deletion
  const handleDeleteLabel = async (id: string, name: string) => {
      if (confirm(`Permanently delete label "${name}"?`)) {
          const success = await mailService.deleteLabel(id);
          if (success) {
              setLabels(prev => prev.filter(l => l.id !== id));
              if (currentFolder === name) onFolderChange('Inbox');
          }
      }
  };

  const isCustomActive = !systemFolders.includes(currentFolder as string);

  return (
    <div className="flex flex-col h-screen bg-slate-50 dark:bg-slate-950 transition-colors duration-300 overflow-hidden">
      <header className="sticky top-0 z-50 w-full bg-white/90 dark:bg-slate-950/80 backdrop-blur-xl border-b border-slate-200 dark:border-slate-800 shadow-sm dark:shadow-none shrink-0">
        <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-6">
            
            {/* 🛑 LOGO UPDATED: Added -mt-1 to text to lift it up */}
            <div className="flex items-center gap-1">
              <Logo className="w-9 h-9 shadow-sm rounded-xl" />
              <span className="font-bold text-xl tracking-tight hidden sm:block text-slate-900 dark:text-slate-100 font-sans -mt-1">
                mail<span className="text-blue-600">boy</span>
              </span>
            </div>

            {/* FOLDER NAV */}
            <nav className="hidden md:flex items-center gap-1">
              {systemFolders.map(folder => (
                <button
                  key={folder}
                  onClick={() => onFolderChange(folder as EmailFolder)}
                  className={`px-3 py-2 rounded-xl text-sm font-semibold transition-all ${
                    currentFolder === folder 
                      ? 'bg-blue-600/10 text-blue-600 dark:bg-blue-900/20 dark:text-blue-400' 
                      : 'text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
                  }`}
                >
                  {folder}
                </button>
              ))}

              {/* LABELS DROPDOWN */}
              <div className="relative ml-2" ref={menuRef}>
                <button
                  onClick={() => setIsLabelMenuOpen(!isLabelMenuOpen)}
                  className={`px-3 py-2 rounded-xl text-sm font-semibold transition-all flex items-center gap-2 ${
                    isCustomActive || isLabelMenuOpen
                      ? 'bg-purple-600/10 text-purple-600 dark:bg-purple-900/20 dark:text-purple-400' 
                      : 'text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
                  }`}
                >
                  <span>Labels</span>
                  <svg className={`w-4 h-4 transition-transform ${isLabelMenuOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" /></svg>
                </button>

                {/* Dropdown Menu */}
                {isLabelMenuOpen && (
                  <div className="absolute top-full right-0 mt-2 w-56 bg-white dark:bg-slate-900 rounded-xl shadow-xl border border-slate-100 dark:border-slate-800 p-2 animate-in fade-in slide-in-from-top-2 duration-200">
                    <div className="text-xs font-bold text-slate-400 px-3 py-2 uppercase tracking-wider">My Labels</div>
                    
                    {labels.length === 0 && (
                        <div className="px-3 py-2 text-sm text-slate-400 italic">No labels yet</div>
                    )}

                    {labels.map(label => (
                      <div 
                        key={label.id}
                        className="group flex items-center justify-between w-full px-3 py-2 rounded-lg text-sm font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                      >
                        <button
                          onClick={() => {
                              // Filter by this label
                              onFolderChange(label.id); // Using ID helps backend filtering
                              setIsLabelMenuOpen(false);
                          }}
                          className="flex-1 flex items-center gap-3 text-left"
                        >
                          <span className={`w-2.5 h-2.5 rounded-full ${label.color}`}></span>
                          {label.name}
                        </button>

                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteLabel(label.id, label.name);
                          }}
                          className="opacity-0 group-hover:opacity-100 p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded transition-all"
                          title="Delete Label"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                        </button>
                      </div>
                    ))}

                    <div className="h-px bg-slate-100 dark:bg-slate-800 my-1"></div>
                    
                    <button 
                      onClick={handleCreateLabel}
                      className="w-full text-left px-3 py-2 rounded-lg text-sm font-medium text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 flex items-center gap-2 transition-colors"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4" /></svg>
                      Create New Label
                    </button>
                  </div>
                )}
              </div>
            </nav>
          </div>

          <div className="flex items-center gap-3">
             <button onClick={onSync} disabled={!isConfigured} className={`p-2 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-900 transition-colors ${syncPercent !== undefined ? 'text-blue-600' : 'text-slate-400 dark:text-slate-600'}`}>
              <svg className={`w-5 h-5 ${syncPercent !== undefined ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
            </button>
            <button onClick={toggleTheme} className="p-2.5 rounded-xl bg-slate-100 dark:bg-slate-900 hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-400 transition-colors border border-slate-200 dark:border-slate-800">
              {darkMode ? (<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" /></svg>) : (<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" /></svg>)}
            </button>
            <div className="h-6 w-[1px] bg-slate-200 dark:bg-slate-800 mx-1 hidden sm:block"></div>
            <button onClick={onOpenSettings} className="p-2 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-900 text-slate-500 dark:text-slate-400 transition-colors">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
            </button>
          </div>
        </div>
      </header>

      <main ref={ref} className="flex-1 overflow-hidden relative flex flex-col h-full">
        {children}
      </main>
    </div>
  );
});

export default Layout;