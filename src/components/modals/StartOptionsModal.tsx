import React, { useState, useEffect } from 'react';
import { Play, Sparkles, Zap, Activity, Layers } from 'lucide-react';
import { TranslationTier } from '../../types';

export interface StartOptionsModalProps { isOpen: boolean; onClose: () => void; onConfirm: (tier: TranslationTier) => void; isSmartMode?: boolean; }
export const StartOptionsModal: React.FC<StartOptionsModalProps> = ({ isOpen, onClose, onConfirm, isSmartMode }) => {
    const [selectedTier, setSelectedTier] = useState<TranslationTier>('normal');

    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        if (isOpen) setSelectedTier(prev => prev !== 'normal' ? 'normal' : prev);
    }, [isOpen]);

    if (!isOpen) return null;
    return (
        <div className="fixed inset-0 z-[160] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
            <div className="bg-white rounded-3xl shadow-2xl w-full max-w-lg overflow-hidden animate-in zoom-in-95 duration-200 flex flex-col max-h-[90vh]">
                <div className="p-6 overflow-y-auto flex-1">
                    <h3 className="text-xl font-bold text-slate-800 mb-4 flex items-center gap-2 flex-shrink-0">
                        {isSmartMode ? <Sparkles className="w-6 h-6 text-primary-500" /> : <div className="text-primary-500"><Zap className="w-6 h-6" /></div>}
                        {isSmartMode ? "Smart AI Auto-Fix" : "Chọn Cấp Độ Dịch"}
                    </h3>
                    <div className="space-y-3">
                        <button onClick={() => setSelectedTier('lite')} className={`w-full p-4 rounded-2xl flex items-start gap-4 transition-all group text-left border ${selectedTier === 'lite' ? 'bg-yellow-50 border-yellow-300 ring-2 ring-yellow-200 shadow-md' : 'bg-white border-slate-200 hover:border-yellow-200'}`}>
                            <div className={`p-3 rounded-xl shadow-sm transition-colors ${selectedTier === 'lite' ? 'bg-yellow-500 text-white' : 'bg-yellow-50 text-yellow-600 group-hover:bg-yellow-100'}`}><Zap className="w-6 h-6" /></div>
                            <div><h4 className={`font-bold text-sm ${selectedTier === 'lite' ? 'text-yellow-800' : 'text-slate-700'}`}>Lite Mode</h4><p className="text-xs text-slate-500">Dùng Gemini 3 Flash cho dịch nhanh.</p></div>
                        </button>
                        <button onClick={() => setSelectedTier('flash')} className={`w-full p-4 rounded-2xl flex items-start gap-4 transition-all group text-left border ${selectedTier === 'flash' ? 'bg-primary-50 border-primary-300 ring-2 ring-primary-200 shadow-md' : 'bg-white border-slate-200 hover:border-primary-200'}`}>
                            <div className={`p-3 rounded-xl shadow-sm transition-colors ${selectedTier === 'flash' ? 'bg-primary-500 text-white' : 'bg-primary-50 text-primary-500 group-hover:bg-primary-100'}`}><Zap className="w-6 h-6" /></div>
                            <div><h4 className={`font-bold text-sm ${selectedTier === 'flash' ? 'text-primary-800' : 'text-slate-700'}`}>Flash Mode</h4><p className="text-xs text-slate-500">Ưu tiên Hydrogen và các model Flash.</p></div>
                        </button>
                        <button onClick={() => setSelectedTier('normal')} className={`w-full p-4 rounded-2xl flex items-start gap-4 transition-all group text-left border ${selectedTier === 'normal' ? 'bg-primary-50 border-primary-300 ring-2 ring-primary-200 shadow-md' : 'bg-white border-slate-200 hover:border-primary-200'}`}>
                            <div className={`p-3 rounded-xl shadow-sm transition-colors ${selectedTier === 'normal' ? 'bg-primary-500 text-white' : 'bg-primary-50 text-primary-500 group-hover:bg-primary-100'}`}><Activity className="w-6 h-6" /></div>
                            <div><h4 className={`font-bold text-sm ${selectedTier === 'normal' ? 'text-primary-800' : 'text-slate-700'}`}>Normal Mode (Khuyên dùng)</h4><p className="text-xs text-slate-500">Dịch với 2 luồng, ưu tiên Hydrogen.</p></div>
                        </button>
                        <button onClick={() => setSelectedTier('pro')} className={`w-full p-4 rounded-2xl flex items-start gap-4 transition-all group text-left border ${selectedTier === 'pro' ? 'bg-purple-50 border-purple-300 ring-2 ring-purple-200 shadow-md' : 'bg-white border-slate-200 hover:border-purple-200'}`}>
                            <div className={`p-3 rounded-xl shadow-sm transition-colors ${selectedTier === 'pro' ? 'bg-purple-500 text-white' : 'bg-purple-50 text-purple-500 group-hover:bg-purple-100'}`}><Sparkles className="w-6 h-6" /></div>
                            <div><h4 className={`font-bold text-sm ${selectedTier === 'pro' ? 'text-purple-800' : 'text-slate-700'}`}>Pro Mode</h4><p className="text-xs text-slate-500">Chất lượng cao nhất, tuân thủ nghiêm ngặt.</p></div>
                        </button>
                        <button onClick={() => setSelectedTier('full')} className={`w-full p-4 rounded-2xl flex items-start gap-4 transition-all group text-left border ${selectedTier === 'full' ? 'bg-emerald-50 border-emerald-300 ring-2 ring-emerald-200 shadow-md' : 'bg-white border-slate-200 hover:border-emerald-200'}`}>
                            <div className={`p-3 rounded-xl shadow-sm transition-colors ${selectedTier === 'full' ? 'bg-emerald-500 text-white' : 'bg-emerald-50 text-emerald-500 group-hover:bg-emerald-100'}`}><Layers className="w-6 h-6" /></div>
                            <div><h4 className={`font-bold text-sm ${selectedTier === 'full' ? 'text-emerald-800' : 'text-slate-700'}`}>Full Mode</h4><p className="text-xs text-slate-500">Dịch với 3 luồng, ưu tiên Hydrogen. Auto Fix dùng nhóm model hỗ trợ.</p></div>
                        </button>
                    </div>
                </div>
                <div className="p-4 bg-slate-50 border-t border-slate-200 flex justify-end gap-3 flex-shrink-0">
                    <button onClick={onClose} className="px-6 py-2 text-sm font-bold text-slate-500 hover:text-slate-700">Hủy</button>
                    <button onClick={() => onConfirm(selectedTier)} className="px-8 py-2 bg-gradient-to-r from-primary-500 to-primary-500 text-white rounded-xl font-bold text-sm shadow-lg shadow-primary-200/50 hover:shadow-primary-200/80 transition-all flex items-center gap-2">
                        <Play className="w-4 h-4 fill-current" /> Bắt Đầu
                    </button>
                </div>
            </div>
        </div>
    );
};
