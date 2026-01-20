import React, { useState } from 'react';
import { MailConfig } from '../types';
import { mailService } from '../services/mailService';

interface SettingsProps {
  onClose: () => void;
  onSave: (config: MailConfig) => Promise<void>;
  onReset: () => Promise<void>;
  currentConfig: MailConfig | null;
}

type SettingsTab = 'PROTOCOL' | 'MAINTENANCE';

const Settings: React.FC<SettingsProps> = ({ onClose, onSave, onReset, currentConfig }) => {
  const [activeTab, setActiveTab] = useState<SettingsTab>('PROTOCOL');
  const [isSaving, setIsSaving] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const [config, setConfig] = useState<MailConfig>(currentConfig || {
    imapHost: 'imap.gmail.com',
    imapPort: 993,
    smtpHost: 'smtp.gmail.com',
    smtpPort: 587,
    user: '',
    pass: '',
    useTLS: true
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!config.user || !config.pass) {
      alert("Credentials required for real IMAP sync.");
      return;
    }
    
    setIsSaving(true);
    try {
      await onSave(config);
    } catch (err) {
      console.error("Save error:", err);
      setIsSaving(false);
    }
  };

  const handleWipe = async () => {
    if (!confirm("CRITICAL ACTION: This will wipe all emails, images, and configuration from Redis, MongoDB, and local caches. Continue?")) return;
    setIsResetting(true);
    try {
      await onReset();
      onClose();
    } catch (e) {
      alert("System wipe failed. Ensure bridge is online.");
    } finally {
      setIsResetting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-900/60 dark:bg-black/80 backdrop-blur-xl animate-in fade-in duration-500">
      <div className="w-full max-w-2xl bg-white dark:bg-slate-900 rounded-[3rem] shadow-2xl border border-slate-200 dark:border-white/5 overflow-hidden animate-in zoom-in-95 duration-500">
        <div className="p-8 border-b border-slate-100 dark:border-white/5 flex justify-between items-center bg-slate-50 dark:bg-slate-950/40">
          <div>
            <h3 className="text-2xl font-black text-slate-900 dark:text-slate-100 tracking-tight uppercase">System Parameters</h3>
            <p className="text-[10px] text-slate-400 dark:text-slate-500 font-mono mt-1 tracking-widest">NOVA_V11.1_ADMIN_GATEWAY</p>
          </div>
          <button 
            onClick={onClose} 
            className="p-3 hover:bg-slate-100 dark:hover:bg-slate-800/50 rounded-2xl text-slate-400 dark:text-slate-500 transition-all active:scale-90"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="flex px-8 border-b border-slate-100 dark:border-slate-800">
          <button 
            onClick={() => setActiveTab('PROTOCOL')}
            className={`px-6 py-4 text-xs font-black tracking-widest border-b-2 transition-all ${activeTab === 'PROTOCOL' ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-400 hover:text-slate-600'}`}
          >PROTOCOL_CONFIG</button>
          <button 
            onClick={() => setActiveTab('MAINTENANCE')}
            className={`px-6 py-4 text-xs font-black tracking-widest border-b-2 transition-all ${activeTab === 'MAINTENANCE' ? 'border-red-600 text-red-600' : 'border-transparent text-slate-400 hover:text-slate-600'}`}
          >SYSTEM_MAINTENANCE</button>
        </div>

        <div className="p-8 overflow-y-auto max-h-[70vh]">
          {activeTab === 'PROTOCOL' ? (
            <form onSubmit={handleSubmit} className="grid grid-cols-2 gap-6">
              <div className="col-span-2 bg-blue-50 dark:bg-blue-500/10 border border-blue-100 dark:border-blue-500/20 p-6 rounded-3xl">
                <p className="text-[11px] text-blue-700 dark:text-blue-300 leading-relaxed font-mono">
                  <span className="font-bold text-blue-600 dark:text-blue-400 mr-2 underline italic">NOTICE:</span> 
                  Bridge handshake requires a running Node instance. Gmail users must use <strong>App Passwords</strong>.
                </p>
              </div>

              <div className="col-span-2 space-y-4">
                <div className="flex flex-col gap-2">
                  <label className="text-[10px] text-slate-500 uppercase tracking-[0.2em] font-black">Identity</label>
                  <input 
                    required
                    disabled={isSaving}
                    autoComplete="email"
                    value={config.user}
                    onChange={e => setConfig({...config, user: e.target.value})}
                    className="bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-white/5 rounded-2xl px-5 py-4 text-sm focus:ring-4 focus:ring-blue-600/10 outline-none transition-all dark:text-white"
                    placeholder="email@gmail.com"
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <label className="text-[10px] text-slate-500 uppercase tracking-[0.2em] font-black">Encrypted Token (Password)</label>
                  <input 
                    required
                    disabled={isSaving}
                    type="password"
                    autoComplete="current-password"
                    value={config.pass}
                    onChange={e => setConfig({...config, pass: e.target.value})}
                    className="bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-white/5 rounded-2xl px-5 py-4 text-sm focus:ring-4 focus:ring-blue-600/10 outline-none transition-all dark:text-white"
                    placeholder="•••• •••• •••• ••••"
                  />
                </div>
              </div>

              <div className="space-y-3">
                <h4 className="text-[10px] font-black text-blue-600 uppercase tracking-widest">IMAP_INGRESS</h4>
                <div className="flex flex-col gap-2">
                  <input 
                    disabled={isSaving}
                    value={config.imapHost}
                    onChange={e => setConfig({...config, imapHost: e.target.value})}
                    className="bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-white/5 rounded-2xl px-4 py-3 text-xs dark:text-white"
                  />
                  <input 
                    disabled={isSaving}
                    type="number"
                    value={config.imapPort}
                    onChange={e => setConfig({...config, imapPort: parseInt(e.target.value)})}
                    className="bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-white/5 rounded-2xl px-4 py-3 text-xs w-24 dark:text-white"
                  />
                </div>
              </div>

              <div className="space-y-3">
                <h4 className="text-[10px] font-black text-indigo-600 dark:text-purple-500 uppercase tracking-widest">SMTP_EGRESS</h4>
                <div className="flex flex-col gap-2">
                  <input 
                    disabled={isSaving}
                    value={config.smtpHost}
                    onChange={e => setConfig({...config, smtpHost: e.target.value})}
                    className="bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-white/5 rounded-2xl px-4 py-3 text-xs dark:text-white"
                  />
                  <input 
                    disabled={isSaving}
                    type="number"
                    value={config.smtpPort}
                    onChange={e => setConfig({...config, smtpPort: parseInt(e.target.value)})}
                    className="bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-white/5 rounded-2xl px-4 py-3 text-xs w-24 dark:text-white"
                  />
                </div>
              </div>

              <div className="col-span-2 pt-6 flex justify-end gap-4">
                <button 
                  type="submit"
                  disabled={isSaving}
                  className="px-12 py-4 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-200 dark:disabled:bg-slate-800 rounded-2xl text-xs font-black text-white shadow-2xl shadow-blue-600/20 transition-all active:scale-95"
                >
                  {isSaving ? 'PERSISTING...' : 'COMMIT CHANGES'}
                </button>
              </div>
            </form>
          ) : (
            <div className="space-y-8 py-4">
              <div className="bg-red-50 dark:bg-red-500/10 border border-red-100 dark:border-red-500/20 p-8 rounded-3xl text-center">
                <div className="w-16 h-16 bg-red-100 dark:bg-red-900/40 rounded-full flex items-center justify-center mx-auto mb-6">
                  <svg className="w-8 h-8 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                </div>
                <h4 className="text-xl font-black text-slate-900 dark:text-slate-100 mb-2">Nuclear Reset</h4>
                <p className="text-sm text-slate-500 dark:text-slate-400 mb-8 max-w-sm mx-auto">This action permanently deletes all cached metadata, email bodies, and proxied image assets from Redis and MongoDB.</p>
                
                <button 
                  onClick={handleWipe}
                  disabled={isResetting}
                  className="w-full py-5 bg-red-600 hover:bg-red-700 text-white rounded-2xl font-black text-xs uppercase tracking-[0.3em] shadow-2xl shadow-red-600/30 transition-all active:scale-95 disabled:opacity-50"
                >
                  {isResetting ? 'EXECUTING_WIPE...' : 'INITIALIZE_TOTAL_WIPE'}
                </button>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="p-5 rounded-2xl bg-slate-50 dark:bg-slate-950 border border-slate-100 dark:border-slate-800">
                  <div className="text-[9px] font-black text-slate-400 uppercase mb-1">CACHE_VERSION</div>
                  <div className="text-sm font-mono font-bold text-slate-900 dark:text-slate-100 uppercase">V11.1_STABLE</div>
                </div>
                <div className="p-5 rounded-2xl bg-slate-50 dark:bg-slate-950 border border-slate-100 dark:border-slate-800">
                  <div className="text-[9px] font-black text-slate-400 uppercase mb-1">BRIDGE_LOG</div>
                  <div className="text-sm font-mono font-bold text-green-600 uppercase">OK_STATUS</div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default Settings;