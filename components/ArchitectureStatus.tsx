import React, { useEffect, useState } from 'react';
import { CacheStats } from '../types';

interface ArchitectureStatusProps {
  stats: CacheStats | null;
}

const ArchitectureStatus: React.FC<ArchitectureStatusProps> = ({ stats }) => {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (stats) {
      setVisible(true);
      const timer = setTimeout(() => setVisible(false), 8000);
      return () => clearTimeout(timer);
    }
  }, [stats]);

  if (!stats && !visible) return null;

  const source = stats?.source || 'Bridge';
  const isL1 = source === 'Redis';
  const isL2 = source === 'MongoDB';
  const isL3 = source === 'IMAP';

  return (
    <div className={`fixed bottom-8 right-8 z-[100] transition-all duration-700 ease-[cubic-bezier(0.23,1,0.32,1)] transform ${visible ? 'translate-y-0 opacity-100 scale-100' : 'translate-y-20 opacity-0 scale-90'}`}>
      <div className="rounded-[2.5rem] p-8 w-[420px] shadow-2xl border border-slate-200 dark:border-white/5 bg-white dark:bg-slate-900/90 backdrop-blur-3xl">
        <div className={`absolute top-0 left-0 w-full h-2 rounded-t-[2.5rem] ${isL1 ? 'bg-green-500' : isL2 ? 'bg-amber-500' : 'bg-blue-600'}`}></div>
        
        <div className="flex justify-between items-center mb-6">
          <h4 className="text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-[0.4em]">Protocol Pipeline</h4>
          <div className="flex gap-1.5">
            <span className={`w-2 h-2 rounded-full ${isL1 ? 'bg-green-500' : 'bg-slate-100 dark:bg-slate-800'}`}></span>
            <span className={`w-2 h-2 rounded-full ${isL2 ? 'bg-amber-500' : 'bg-slate-100 dark:bg-slate-800'}`}></span>
            <span className={`w-2 h-2 rounded-full ${isL3 ? 'bg-blue-600' : 'bg-slate-100 dark:bg-slate-800'}`}></span>
          </div>
        </div>
        
        <div className="flex flex-col gap-6">
          <div className="grid grid-cols-3 gap-3">
            <div className={`bg-slate-50 dark:bg-slate-950/50 rounded-2xl p-4 border transition-colors ${isL1 ? 'border-green-500/20' : 'border-slate-100 dark:border-slate-800'}`}>
              <div className="text-[9px] text-slate-400 dark:text-slate-600 uppercase font-black tracking-wider mb-2">L1 Redis</div>
              <div className={`text-xs font-mono font-bold ${isL1 ? 'text-green-600 dark:text-green-400' : 'text-slate-300 dark:text-slate-800'}`}>{isL1 ? 'HIT' : 'MISS'}</div>
            </div>
            
            <div className={`bg-slate-50 dark:bg-slate-950/50 rounded-2xl p-4 border transition-colors ${isL2 ? 'border-amber-500/20' : 'border-slate-100 dark:border-slate-800'}`}>
              <div className="text-[9px] text-slate-400 dark:text-slate-600 uppercase font-black tracking-wider mb-2">L2 Mongo</div>
              <div className={`text-xs font-mono font-bold ${isL2 ? 'text-amber-600 dark:text-amber-400' : 'text-slate-300 dark:text-slate-800'}`}>{isL2 ? 'HIT' : 'MISS'}</div>
            </div>

            <div className="bg-slate-50 dark:bg-slate-950/50 rounded-2xl p-4 border border-slate-100 dark:border-slate-800">
              <div className="text-[9px] text-slate-400 dark:text-slate-600 uppercase font-black tracking-wider mb-2">LATENCY</div>
              <div className="text-xs font-mono font-bold text-slate-900 dark:text-slate-100">
                {stats?.latencyMs.toFixed(1)}<span className="text-[9px] font-normal text-slate-400 ml-0.5">ms</span>
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-3 border-t border-slate-100 dark:border-slate-800 pt-6">
             <div className="flex justify-between items-center text-[10px] font-mono font-bold">
              <div className="flex items-center gap-2 text-slate-600 dark:text-slate-500">
                <span className={`w-2 h-2 rounded-full ${isL1 ? 'bg-green-500' : 'bg-slate-200 dark:bg-slate-800'}`}></span>
                L1 (HOT): IN-MEMORY MIRROR
              </div>
              <div className="text-slate-300 dark:text-slate-800 tracking-tighter">{'<'}1ms</div>
            </div>
            <div className="flex justify-between items-center text-[10px] font-mono font-bold">
              <div className="flex items-center gap-2 text-slate-600 dark:text-slate-500">
                <span className={`w-2 h-2 rounded-full ${isL2 ? 'bg-amber-500' : 'bg-slate-200 dark:bg-slate-800'}`}></span>
                L2 (WARM): OBJECT STORE
              </div>
              <div className="text-slate-300 dark:text-slate-800 tracking-tighter">~25ms</div>
            </div>
            {isL3 && (
              <div className="flex justify-between items-center text-[10px] font-mono font-bold">
                <div className="flex items-center gap-2 text-blue-600 dark:text-blue-400">
                  <span className="w-2 h-2 rounded-full bg-blue-600 animate-pulse"></span>
                  L3 (COLD): REMOTE HANDSHAKE
                </div>
                <div className="text-blue-200 dark:text-blue-900 tracking-tighter">ASYNC_WAIT</div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default ArchitectureStatus;