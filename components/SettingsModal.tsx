import React from 'react';
import { AIConfig, AIProvider } from '../types';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  config: AIConfig;
  onConfigChange: (newConfig: AIConfig) => void;
}

const SettingsModal: React.FC<SettingsModalProps> = ({ isOpen, onClose, config, onConfigChange }) => {
  if (!isOpen) return null;

  const handleChange = (field: keyof AIConfig, value: string) => {
    onConfigChange({
      ...config,
      [field]: value,
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
      <div className="w-full max-w-2xl bg-slate-900 border border-cyan-500/30 rounded-lg shadow-2xl shadow-cyan-900/20 overflow-hidden flex flex-col max-h-[90vh]">
        
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-800 bg-slate-900/50 flex justify-between items-center">
          <h2 className="font-tech text-xl text-cyan-400 tracking-wider">SYSTEM CONFIGURATION</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white transition-colors">
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
          </button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto space-y-6 custom-scrollbar">
          
          {/* Model ID */}
          <div className="space-y-2">
            <label className="text-xs font-mono text-cyan-500 uppercase tracking-widest">Model Identifier</label>
            <input
              type="text"
              value={config.modelId}
              onChange={(e) => handleChange('modelId', e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded px-4 py-2 text-sm text-slate-300 focus:outline-none focus:border-cyan-500/50 font-mono"
            />
          </div>

          {/* System Instructions */}
          <div className="space-y-2">
            <label className="text-xs font-mono text-cyan-500 uppercase tracking-widest">Primary Directive (System Prompt)</label>
            <textarea
              value={config.systemInstruction}
              onChange={(e) => handleChange('systemInstruction', e.target.value)}
              rows={6}
              className="w-full bg-slate-950 border border-slate-800 rounded px-4 py-2 text-xs md:text-sm text-slate-300 focus:outline-none focus:border-cyan-500/50 font-mono leading-relaxed resize-none custom-scrollbar"
            />
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-slate-800 bg-slate-900/50 flex justify-end">
          <button 
            onClick={onClose}
            className="px-6 py-2 bg-cyan-600 hover:bg-cyan-500 text-white font-bold rounded text-sm transition-colors uppercase tracking-wider"
          >
            Apply Configuration
          </button>
        </div>
      </div>
    </div>
  );
};

export default SettingsModal;