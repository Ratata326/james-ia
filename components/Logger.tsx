import React, { useEffect, useRef } from 'react';
import { LogEntry } from '../types';

interface LoggerProps {
  logs: LogEntry[];
}

const Logger: React.FC<LoggerProps> = ({ logs }) => {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [logs]);

  return (
    <div className="flex flex-col h-full bg-slate-900/50 border-t border-slate-800 backdrop-blur-sm">
      <div className="px-4 py-2 border-b border-slate-800 flex justify-between items-center">
        <h3 className="font-tech text-cyan-500 text-xs tracking-widest uppercase">System Logs</h3>
        <div className="flex gap-1">
            <div className="w-2 h-2 rounded-full bg-cyan-500 animate-pulse"></div>
            <div className="w-2 h-2 rounded-full bg-cyan-500 animate-pulse delay-75"></div>
            <div className="w-2 h-2 rounded-full bg-cyan-500 animate-pulse delay-150"></div>
        </div>
      </div>
      <div 
        ref={containerRef}
        className="flex-1 overflow-y-auto p-4 space-y-3 font-mono text-sm"
      >
        {logs.length === 0 && (
          <div className="text-slate-600 italic text-center mt-10">Awaiting initialization sequence...</div>
        )}
        {logs.map((log, index) => (
          <div key={index} className="flex gap-2 animate-fadeIn">
            <span className="text-slate-500 shrink-0 text-xs mt-1">
              [{log.timestamp.toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })}]
            </span>
            <div className="flex flex-col">
              <span className={`text-xs font-bold uppercase tracking-wider mb-0.5 ${
                log.sender === 'ai' ? 'text-cyan-400' : 
                log.sender === 'user' ? 'text-emerald-400' : 'text-slate-400'
              }`}>
                {log.sender === 'ai' ? 'JAMES' : log.sender === 'user' ? 'OPERATOR' : 'SYSTEM'}
              </span>
              <span className="text-slate-300 opacity-90">{log.message}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default Logger;