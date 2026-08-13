import React from 'react';
import { Terminal, Trash2, X, Download } from 'lucide-react';
import { LogEntry } from '../../types';
import { exportSystemLogs } from '../../utils/logExport';

export interface LogModalProps { isOpen: boolean; onClose: () => void; logs: LogEntry[]; clearLogs: () => void; }
export const LogModal: React.FC<LogModalProps> = ({ isOpen, onClose, logs, clearLogs }) => {
    if (!isOpen) return null;
    return (
        <div className="fixed inset-0 z-[160] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
            <div className="bg-slate-900 rounded-3xl shadow-2xl w-full max-w-4xl h-[80vh] flex flex-col overflow-hidden animate-in zoom-in-95 duration-200 border border-slate-700 ring-1 ring-black/50">
                <div className="px-6 py-4 border-b border-slate-800 flex justify-between items-center bg-slate-950">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-slate-800 text-sky-400 rounded-xl"><Terminal className="w-5 h-5" /></div>
                        <div>
                            <h3 className="font-mono font-bold text-lg text-slate-200">System Deep Logs</h3>
                            <p className="text-xs text-slate-500 font-mono">Nhật ký chi tiết hệ thống (Mới nhất ở trên).</p>
                        </div>
                    </div>
                    <div className="flex gap-2">
                        <button
                            onClick={() => exportSystemLogs(logs)}
                            title="Xuất log ra file .txt để gửi cho dev kiểm tra"
                            className="p-2 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-sky-400 transition-colors"
                        >
                            <Download className="w-5 h-5" />
                        </button>
                        <button onClick={clearLogs} className="p-2 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-rose-500 transition-colors"><Trash2 className="w-5 h-5" /></button>
                        <button onClick={onClose} className="p-2 hover:bg-slate-800 rounded-full text-slate-400 hover:text-white transition-colors"><X className="w-5 h-5" /></button>
                    </div>
                </div>
                <div className="flex-1 overflow-y-auto p-6 bg-slate-900 custom-scrollbar font-mono text-xs leading-relaxed space-y-1">
                    {logs.length === 0 ? (
                        <div className="h-full flex items-center justify-center text-slate-700 italic">Trống...</div>
                    ) : (
                        logs.map(log => (
                            <div key={log.id} className="flex gap-3 hover:bg-slate-800/50 p-1 rounded transition-colors border-b border-slate-800/50 pb-1">
                                <span className="text-slate-500 shrink-0 select-none w-20">[{new Date(log.timestamp).toLocaleTimeString()}]</span>
                                <span className={`break-words flex-1 ${log.type === 'error' ? 'text-rose-400 font-bold' : log.type === 'success' ? 'text-emerald-400' : 'text-slate-300'}`}>
                                    {log.message}
                                </span>
                            </div>
                        ))
                    )}
                </div>
            </div>
        </div>
    );
};
