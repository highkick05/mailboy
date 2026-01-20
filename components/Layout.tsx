import React, { forwardRef } from 'react';
import { EmailFolder } from '../types';

interface LayoutProps {
  children: React.ReactNode;
  currentFolder: EmailFolder;
  onFolderChange: (folder: EmailFolder) => void;
  onCompose: () => void;
  onOpenSettings: () => void;
  onSync: () => void;
  isConfigured: boolean;
  syncPercent?: number;
  darkMode: boolean;
  toggleTheme: () => void;
}

const folders: EmailFolder[] = ['Inbox', 'Sent', 'Drafts', 'Archive', 'Trash', 'Spam'];

const Layout = forwardRef<HTMLDivElement, LayoutProps>(({ children, currentFolder, onFolderChange, onCompose, onOpenSettings, onSync, isConfigured, syncPercent, darkMode, toggleTheme }, ref) => {
  return (
    <div className="flex flex-col h-screen bg-slate-50 dark:bg-slate-950 transition-colors duration-300 overflow-hidden">
      <header className="sticky top-0 z-50 w-full bg-white/90 dark:bg-slate-950/80 backdrop-blur-xl border-b border-slate-200 dark:border-slate-800 shadow-sm dark:shadow-none shrink-0">
        <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-8">
            <div className="flex items-center gap-2.5">
              {/* REBRANDED: 'm' logo */}
              <div className="w-9 h-9 bg-blue-600 rounded-xl flex items-center justify-center font-black text-white shadow-lg shadow-blue-600/30 pb-0.5">m</div>
              {/* REBRANDED: 'mailboy' text */}
              <span className="font-bold text-lg tracking-tight hidden sm:block text-slate-900 dark:text-slate-100">mail<span className="text-blue-600">boy</span></span>
            </div>

            <nav className="hidden md:flex items-center gap-1">
              {folders.map(folder => (
                <button
                  key={folder}
                  onClick={() => onFolderChange(folder)}
                  className={`px-4 py-2 rounded-xl text-sm font-semibold transition-all ${
                    currentFolder === folder 
                      ? 'bg-blue-600/10 text-blue-600 dark:bg-blue-900/20 dark:text-blue-400' 
                      : 'text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
                  }`}
                >
                  {folder}
                </button>
              ))}
            </nav>
          </div>

          <div className="flex items-center gap-3">
            <button 
              onClick={onSync} 
              disabled={!isConfigured}
              className={`p-2 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-900 transition-colors ${syncPercent !== undefined ? 'text-blue-600' : 'text-slate-400 dark:text-slate-600'}`}
              title="Protocol Sync"
            >
              <svg className={`w-5 h-5 ${syncPercent !== undefined ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
            </button>

            <button 
              onClick={toggleTheme} 
              className="p-2.5 rounded-xl bg-slate-100 dark:bg-slate-900 hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-400 transition-colors border border-slate-200 dark:border-slate-800"
              title="Toggle Theme"
            >
              {darkMode ? (
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" /></svg>
              ) : (
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" /></svg>
              )}
            </button>

            <div className="h-6 w-[1px] bg-slate-200 dark:bg-slate-800 mx-1 hidden sm:block"></div>

            <button 
              onClick={onCompose} 
              disabled={!isConfigured}
              className="bg-blue-600 hover:bg-blue-700 text-white px-5 py-2.5 rounded-xl text-sm font-bold shadow-lg shadow-blue-600/20 transition-all flex items-center gap-2 active:scale-95 disabled:opacity-50"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 4v16m8-8H4" /></svg>
              <span className="hidden sm:inline">Compose</span>
            </button>

            <button 
              onClick={onOpenSettings} 
              className="p-2 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-900 text-slate-500 dark:text-slate-400 transition-colors"
              title="Settings"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
            </button>
          </div>
        </div>
      </header>

      {/* Mobile Folder Navigation */}
      <nav className="md:hidden flex items-center gap-1 px-4 py-2 overflow-x-auto bg-white dark:bg-slate-950 border-b border-slate-200 dark:border-slate-800 scrollbar-hide shadow-sm dark:shadow-none shrink-0">
        {folders.map(folder => (
          <button
            key={folder}
            onClick={() => onFolderChange(folder)}
            className={`px-4 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap transition-all ${
              currentFolder === folder 
                ? 'bg-blue-600 text-white shadow-md shadow-blue-600/20' 
                : 'text-slate-500 bg-slate-100 dark:bg-slate-800 dark:text-slate-400'
            }`}
          >
            {folder}
          </button>
        ))}
      </nav>

      {/* Main Content Area */}
      <main ref={ref} className="flex-1 overflow-hidden relative flex flex-col h-full">
        {children}
      </main>
    </div>
  );
});

export default Layout;