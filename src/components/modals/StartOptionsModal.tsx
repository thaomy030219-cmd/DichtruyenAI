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
                        {isSmartMode ? <Sparkles className="w-6 h-6 text-indigo-500" /> : <div className="text-sky-500"><Zap className="w-6 h-6" /></div>}
                        {isSmartMode ? "Smart AI Auto-Fix" : "Chọn Cấp Độ Dịch"}
                    </h3>
                    <div className="space-y-3">
                        <button onClick={() => setSelectedTier('openrouter')} className={`w-full p-4 rounded-2xl flex items-start gap-4 transition-all group text-left border ${selectedTier === 'openrouter' ? 'bg-orange-50 border-orange-300 ring-2 ring-orange-200 shadow-md' : 'bg-white border-slate-200 hover:border-orange-200'}`}>
                            <div className={`p-3 rounded-xl shadow-sm transition-colors ${selectedTier === 'openrouter' ? 'bg-orange-500 text-white' : 'bg-orange-50 text-orange-500 group-hover:bg-orange-100'}`}><Zap className="w-6 h-6" /></div>
                            <div><h4 className={`font-bold text-sm ${selectedTier === 'openrouter' ? 'text-orange-800' : 'text-slate-700'}`}>OR</h4><p className="text-xs text-slate-500">Dùng API OR. Chỉ khả dụng khi cấu hình API Key và chọn Model trong cài đặt OpenRouter.</p></div>
                        </button>
                        <button onClick={() => setSelectedTier('lite')} className={`w-full p-4 rounded-2xl flex items-start gap-4 transition-all group text-left border ${selectedTier === 'lite' ? 'bg-yellow-50 border-yellow-300 ring-2 ring-yellow-200 shadow-md' : 'bg-white border-slate-200 hover:border-yellow-200'}`}>
                            <div className={`p-3 rounded-xl shadow-sm transition-colors ${selectedTier === 'lite' ? 'bg-yellow-500 text-white' : 'bg-yellow-50 text-yellow-600 group-hover:bg-yellow-100'}`}><Zap className="w-6 h-6" /></div>
                            <div><h4 className={`font-bold text-sm ${selectedTier === 'lite' ? 'text-yellow-800' : 'text-slate-700'}`}>Lite Mode</h4><p className="text-xs text-slate-500">Chỉ dùng model 3.1 Flash Lite với tốc độ cao. Dừng tự động khi cạn Quota. Phù hợp cho dịch nội dung nhẹ.</p></div>
                        </button>
                        <button onClick={() => setSelectedTier('flash')} className={`w-full p-4 rounded-2xl flex items-start gap-4 transition-all group text-left border ${selectedTier === 'flash' ? 'bg-sky-50 border-sky-300 ring-2 ring-sky-200 shadow-md' : 'bg-white border-slate-200 hover:border-sky-200'}`}>
                            <div className={`p-3 rounded-xl shadow-sm transition-colors ${selectedTier === 'flash' ? 'bg-sky-500 text-white' : 'bg-sky-50 text-sky-500 group-hover:bg-sky-100'}`}><Zap className="w-6 h-6" /></div>
                            <div><h4 className={`font-bold text-sm ${selectedTier === 'flash' ? 'text-sky-800' : 'text-slate-700'}`}>Flash Mode</h4><p className="text-xs text-slate-500">Tốc độ tối đa, tiết kiệm Pro.</p></div>
                        </button>
                        <button onClick={() => setSelectedTier('normal')} className={`w-full p-4 rounded-2xl flex items-start gap-4 transition-all group text-left border ${selectedTier === 'normal' ? 'bg-indigo-50 border-indigo-300 ring-2 ring-indigo-200 shadow-md' : 'bg-white border-slate-200 hover:border-indigo-200'}`}>
                            <div className={`p-3 rounded-xl shadow-sm transition-colors ${selectedTier === 'normal' ? 'bg-indigo-500 text-white' : 'bg-indigo-50 text-indigo-500 group-hover:bg-indigo-100'}`}><Activity className="w-6 h-6" /></div>
                            <div><h4 className={`font-bold text-sm ${selectedTier === 'normal' ? 'text-indigo-800' : 'text-slate-700'}`}>Normal Mode (Khuyên dùng)</h4><p className="text-xs text-slate-500">Dịch bằng Pro Model (2 luồng, không dùng Flash), tối ưu quota.</p></div>
                        </button>
                        <button onClick={() => setSelectedTier('pro')} className={`w-full p-4 rounded-2xl flex items-start gap-4 transition-all group text-left border ${selectedTier === 'pro' ? 'bg-purple-50 border-purple-300 ring-2 ring-purple-200 shadow-md' : 'bg-white border-slate-200 hover:border-purple-200'}`}>
                            <div className={`p-3 rounded-xl shadow-sm transition-colors ${selectedTier === 'pro' ? 'bg-purple-500 text-white' : 'bg-purple-50 text-purple-500 group-hover:bg-purple-100'}`}><Sparkles className="w-6 h-6" /></div>
                            <div><h4 className={`font-bold text-sm ${selectedTier === 'pro' ? 'text-purple-800' : 'text-slate-700'}`}>Pro Mode</h4><p className="text-xs text-slate-500">Chất lượng cao nhất, tuân thủ nghiêm ngặt.</p></div>
                        </button>
                        <button onClick={() => setSelectedTier('full')} className={`w-full p-4 rounded-2xl flex items-start gap-4 transition-all group text-left border ${selectedTier === 'full' ? 'bg-emerald-50 border-emerald-300 ring-2 ring-emerald-200 shadow-md' : 'bg-white border-slate-200 hover:border-emerald-200'}`}>
                            <div className={`p-3 rounded-xl shadow-sm transition-colors ${selectedTier === 'full' ? 'bg-emerald-500 text-white' : 'bg-emerald-50 text-emerald-500 group-hover:bg-emerald-100'}`}><Layers className="w-6 h-6" /></div>
                            <div><h4 className={`font-bold text-sm ${selectedTier === 'full' ? 'text-emerald-800' : 'text-slate-700'}`}>Full Mode</h4><p className="text-xs text-slate-500">Dịch bằng Pro (3 luồng), dự phòng Flash. Auto Fix bằng Flash.</p></div>
                        </button>
                    </div>
                </div>
                <div className="p-4 bg-slate-50 border-t border-slate-200 flex justify-end gap-3 flex-shrink-0">
                    <button onClick={onClose} className="px-6 py-2 text-sm font-bold text-slate-500 hover:text-slate-700">Hủy</button>
                    <button onClick={() => onConfirm(selectedTier)} className="px-8 py-2 bg-gradient-to-r from-indigo-500 to-sky-500 text-white rounded-xl font-bold text-sm shadow-lg shadow-indigo-200/50 hover:shadow-indigo-200/80 transition-all flex items-center gap-2">
                        <Play className="w-4 h-4 fill-current" /> Bắt Đầu
                    </button>
                </div>
            </div>
        </div>
    );
};
