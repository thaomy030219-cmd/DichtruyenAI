/* eslint-disable react-hooks/set-state-in-effect */
import React, { useState, useEffect } from 'react';
import { Settings, X, ExternalLink, CheckCircle, AlertTriangle, Loader2, Save, Upload, Play, RefreshCw, Key, ShieldCheck, CheckSquare, Square } from 'lucide-react';
import { openRouterKeyManager, OpenRouterKeyStatus } from '../../services/api/openrouter';

interface ApiSettingsModalProps {
    isOpen: boolean;
    onClose: () => void;
    openRouterKey: string;
    setOpenRouterKey: (v: string) => void;
    openRouterModel: string;
    setOpenRouterModel: (v: string) => void;
}

// UPDATED v11.5.8: Trước chỉ có 1 model Gemma trong danh sách chọn thủ công, khiến người
// dùng tưởng OpenRouter chỉ có đúng 1 model free. Bổ sung thêm các model free đang hoạt
// động tốt trên OpenRouter (đã xác nhận còn miễn phí tính tới 8/2026), ưu tiên 2 model
// GPT-OSS của OpenAI (cùng dòng được dùng làm cứu hộ tự động ở streamTranslate.ts) lên đầu.
const FREE_MODELS = [
    { id: 'openai/gpt-oss-20b:free', name: 'OpenAI: GPT-OSS 20B (Free)' },
    { id: 'openai/gpt-oss-120b:free', name: 'OpenAI: GPT-OSS 120B (Free)' },
    { id: 'google/gemma-4-26b-a4b-it:free', name: 'Google: Gemma 4 26B (Free)' },
    { id: 'google/gemma-4-31b-it:free', name: 'Google: Gemma 4 31B (Free)' },
    { id: 'meta-llama/llama-3.3-70b-instruct:free', name: 'Meta: Llama 3.3 70B (Free)' },
    { id: 'nvidia/nemotron-3-nano-30b-a3b:free', name: 'NVIDIA: Nemotron 3 Nano 30B (Free)' },
];

export const ApiSettingsModal: React.FC<ApiSettingsModalProps> = ({ 
    isOpen, onClose, openRouterKey, setOpenRouterKey, openRouterModel, setOpenRouterModel
}) => {
    const [localKey, setLocalKey] = useState(openRouterKey);
    const [localModels, setLocalModels] = useState<string[]>([]);
    
    const [keyStatuses, setKeyStatuses] = useState<OpenRouterKeyStatus[]>([]);
    const [activeKeyInfo, setActiveKeyInfo] = useState<OpenRouterKeyStatus | null>(null);
    
    const [newKeyInput, setNewKeyInput] = useState("");
    const [testing, setTesting] = useState(false);
    const [testResult, setTestResult] = useState<{ status: 'success' | 'error' | null, message: string }>({ status: null, message: '' });
    const [testResults, setTestResults] = useState<{ modelId: string; modelName: string; status: 'success' | 'error' | 'testing'; message?: string }[]>([]);
    const abortControllerRef = React.useRef<AbortController | null>(null);

    const getModelName = (id: string) => {
        const found = FREE_MODELS.find(m => m.id === id);
        return found ? found.name : id;
    };

    const updateStatuses = React.useCallback(() => {
        setKeyStatuses(openRouterKeyManager.getKeyStatuses());
        setActiveKeyInfo(openRouterKeyManager.getCurrentKeyInfo());
    }, []);

    useEffect(() => {
        if (isOpen) {
            setLocalKey(openRouterKey);
            // Parse comma-separated models, if empty use the 2 default free ones
            const m = openRouterModel ? openRouterModel.split(',').map(s => s.trim()).filter(Boolean) : FREE_MODELS.filter(m => m.id !== 'openrouter/free').map(m => m.id);
            setLocalModels(m.length > 0 ? m : FREE_MODELS.filter(m => m.id !== 'openrouter/free').map(m => m.id));
            setTestResult({ status: null, message: '' });
            
            openRouterKeyManager.syncKeys(openRouterKey);
            updateStatuses();
            
            const unsubscribe = openRouterKeyManager.subscribe(() => {
                updateStatuses();
            });
            return () => unsubscribe();
        }
    }, [isOpen, openRouterKey, openRouterModel, updateStatuses]);

    const handleAddKey = () => {
        if (!newKeyInput.trim()) return;
        const keysToAdd = newKeyInput.split(/[,\n]/).map(k => k.trim()).filter(Boolean);
        if (keysToAdd.length > 0) {
            const currentKeys = localKey.split(/[,\n]/).map(k => k.trim()).filter(Boolean);
            const updatedKeys = [...currentKeys, ...keysToAdd];
            const newStr = updatedKeys.join('\n');
            setLocalKey(newStr);
            setNewKeyInput("");
            setTestResult({ status: 'success', message: `Đã thêm ${keysToAdd.length} key.` });
            openRouterKeyManager.syncKeys(newStr); // immediately sync to show in UI
        }
    };

    const handleRemoveKey = (index: number) => {
        const currentKeys = localKey.split(/[,\n]/).map(k => k.trim()).filter(Boolean);
        currentKeys.splice(index, 1);
        const newStr = currentKeys.join('\n');
        setLocalKey(newStr);
        openRouterKeyManager.syncKeys(newStr);
    };

    const handleClearAll = () => {
        setLocalKey('');
        setTestResult({ status: null, message: '' });
        openRouterKeyManager.syncKeys('');
    };

    const handleSave = () => {
        setOpenRouterKey(localKey);
        setOpenRouterModel(localModels.join(','));
        onClose();
    };

    const handleTest = async () => {
        if (!localKey) {
            setTestResult({ status: 'error', message: 'Vui lòng nhập API Key' });
            return;
        }

        const keys = localKey.split(/[,\n]/).map(k => k.trim()).filter(Boolean);
        if (keys.length === 0) {
             setTestResult({ status: 'error', message: 'Không tìm thấy API Key hợp lệ' });
             return;
        }

        if (localModels.length === 0) {
            setTestResult({ status: 'error', message: 'Vui lòng chọn ít nhất 1 model để test' });
            return;
        }

        setTesting(true);
        setTestResult({ status: null, message: '' });
        
        const initialResults = localModels.map(id => ({ modelId: id, modelName: getModelName(id), status: 'testing' as const }));
        setTestResults(initialResults);

        const controller = new AbortController();
        abortControllerRef.current = controller;
        const signal = controller.signal;

        let hasError = false;
        const currentKey = openRouterKeyManager.getCurrentKey() || keys[0];

        for (let i = 0; i < localModels.length; i++) {
            if (signal.aborted) break;

            const modelId = localModels[i];
            
            try {
                const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
                    method: "POST",
                    headers: {
                        "Authorization": `Bearer ${currentKey}`,
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify({
                        model: modelId,
                        messages: [{ role: "user", content: "Say 'OK'" }],
                        max_tokens: 5
                    }),
                    signal
                });

                if (res.ok) {
                    setTestResults(prev => prev.map((r, idx) => idx === i ? { ...r, status: 'success', message: 'Kết nối thành công' } : r));
                } else {
                    const err = await res.json();
                    setTestResults(prev => prev.map((r, idx) => idx === i ? { ...r, status: 'error', message: err.error?.message || `Thất bại (HTTP ${res.status})` } : r));
                    hasError = true;
                }
            } catch (e: any) {
                if (e.name === 'AbortError') {
                    break;
                }
                setTestResults(prev => prev.map((r, idx) => idx === i ? { ...r, status: 'error', message: 'Thất bại (Lỗi mạng/Timeout)' } : r));
                hasError = true;
            }
        }
        
        if (!signal.aborted) {
            setTesting(false);
            setTestResult({ status: hasError ? 'error' : 'success', message: hasError ? 'Có model kết nối thất bại' : 'Tất cả model kết nối thành công!' });
        }
    };

    const handleStopTest = () => {
        if (abortControllerRef.current) {
            abortControllerRef.current.abort();
            abortControllerRef.current = null;
        }
        setTesting(false);
        setTestResult({ status: 'error', message: 'Đã dừng test' });
        setTestResults(prev => prev.map(r => r.status === 'testing' ? { ...r, status: 'error', message: 'Đã dừng' } : r));
    };

    const handleResetQuota = () => {
        openRouterKeyManager.resetQuota();
        setTestResult({ status: 'success', message: 'Đã reset quota toàn bộ Key!' });
    };

    const toggleModel = (modelId: string) => {
        if (localModels.includes(modelId)) {
            setLocalModels(localModels.filter(m => m !== modelId));
        } else {
            setLocalModels([...localModels, modelId]);
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[150] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
            <div className="bg-white dark:bg-slate-900 rounded-3xl shadow-elevation-5 w-full max-w-4xl overflow-hidden animate-in zoom-in-95 duration-200 border border-slate-200 dark:border-slate-800 flex flex-col max-h-[90vh]">
                <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 dark:border-slate-800 flex-shrink-0">
                    <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
                        <Settings className="w-5 h-5 text-primary-500" />
                        Quản Lý API Key & Model
                    </h3>
                    <button aria-label="Đóng" onClick={onClose} className="p-2 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full transition-colors duration-200 ease-smooth focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 focus-visible:ring-offset-1">
                        <X className="w-5 h-5" />
                    </button>
                </div>

                <div className="p-6 overflow-y-auto no-scrollbar overscroll-contain flex-1 flex flex-col md:flex-row gap-6">
                    {/* LEFT COLUMN: KEY MANAGEMENT */}
                    <div className="flex-1 space-y-6">
                        {/* ACTIVE KEY PANEL */}
                        <div className="bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-100 dark:border-indigo-800/50 rounded-2xl p-4">
                            <h4 className="font-bold text-indigo-900 dark:text-indigo-300 text-sm mb-3 flex items-center gap-2">
                                <Key className="w-4 h-4" /> KEY ĐANG SỬ DỤNG
                            </h4>
                            {activeKeyInfo ? (
                                <div className="space-y-2">
                                    <div className="flex items-center justify-between bg-white dark:bg-slate-800 px-3 py-2 rounded-lg border border-indigo-100 dark:border-indigo-800">
                                        <div className="flex items-center gap-2">
                                            <span className="text-indigo-600 dark:text-indigo-400 font-mono text-xs border border-indigo-200 dark:border-indigo-700 bg-indigo-50 dark:bg-indigo-900/50 rounded px-1.5 py-0.5">#{activeKeyInfo.index + 1}</span>
                                            <span className="font-mono text-sm text-slate-700 dark:text-slate-300">{activeKeyInfo.maskedKey}</span>
                                        </div>
                                        <div className="flex items-center gap-2 text-xs font-medium">
                                            <span className="text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/30 px-2 py-0.5 rounded-full flex items-center gap-1">
                                                <CheckCircle className="w-3 h-3" /> {activeKeyInfo.status === 'Active' ? 'Active' : activeKeyInfo.status}
                                            </span>
                                        </div>
                                    </div>
                                    <div className="flex items-center justify-between text-xs text-slate-600 dark:text-slate-400 px-1">
                                        <span>Số request thành công: <strong>{activeKeyInfo.successCount}</strong></span>
                                        <button onClick={handleResetQuota} className="text-indigo-600 hover:text-indigo-700 dark:text-indigo-400 dark:hover:text-indigo-300 font-medium flex items-center gap-1">
                                            <RefreshCw className="w-3 h-3" /> Reset Quota toàn bộ
                                        </button>
                                    </div>
                                </div>
                            ) : (
                                <div className="text-sm text-slate-500 dark:text-slate-400 bg-white dark:bg-slate-800 px-3 py-2 rounded-lg border border-indigo-100 dark:border-indigo-800">
                                    Chưa có API Key nào được cấu hình
                                </div>
                            )}
                        </div>

                        {/* ADD & LIST KEYS */}
                        <div className="space-y-3">
                            <div className="flex items-center justify-between">
                                <h4 className="font-bold text-slate-800 dark:text-slate-200 text-sm">Danh sách API Key</h4>
                                <a href="https://openrouter.ai/keys" target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-xs font-medium text-primary-500 hover:text-primary-600 dark:hover:text-primary-400 transition-colors duration-200 ease-smooth rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400">
                                    Lấy API Key <ExternalLink className="w-3.5 h-3.5" />
                                </a>
                            </div>

                            <div className="flex items-start gap-2">
                                <textarea 
                                    value={newKeyInput}
                                    onChange={(e) => setNewKeyInput(e.target.value)}
                                    placeholder="Dán API Key (Hỗ trợ nhiều dòng)..."
                                    className="flex-1 px-3 py-2 min-h-[60px] bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-xl text-sm shadow-elevation-1 focus:ring-2 focus:ring-primary-400 outline-none text-slate-700 dark:text-slate-300 resize-y transition-all duration-200 ease-smooth"
                                    spellCheck="false"
                                />
                                <div className="flex flex-col gap-2">
                                    <button 
                                        onClick={handleAddKey} 
                                        disabled={!newKeyInput.trim()}
                                        className="px-4 py-2 bg-primary-50 dark:bg-primary-900/40 border border-primary-200 dark:border-primary-800 text-primary-700 dark:text-primary-400 rounded-xl text-sm font-medium hover:bg-primary-100 dark:hover:bg-primary-900 transition-colors duration-200 ease-smooth disabled:opacity-50 min-w-[80px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 focus-visible:ring-offset-1"
                                    >
                                        Thêm
                                    </button>
                                    <label className="px-4 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 rounded-xl text-sm font-medium hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors duration-200 ease-smooth cursor-pointer text-center flex items-center justify-center gap-1 focus-within:ring-2 focus-within:ring-primary-400 focus-within:ring-offset-1">
                                        <Upload className="w-3.5 h-3.5" /> File
                                        <input 
                                            type="file" 
                                            accept=".txt" 
                                            className="hidden" 
                                            onChange={(e) => {
                                                const file = e.target.files?.[0];
                                                if (!file) return;
                                                const reader = new FileReader();
                                                reader.onload = (event) => {
                                                    const text = event.target?.result as string;
                                                    if (text) {
                                                        const keysToAdd = text.split(/[,\n]/).map(k => k.trim()).filter(Boolean);
                                                        if (keysToAdd.length > 0) {
                                                            const currentKeys = localKey.split(/[,\n]/).map(k => k.trim()).filter(Boolean);
                                                            const updatedKeys = [...currentKeys, ...keysToAdd];
                                                            const newStr = updatedKeys.join('\n');
                                                            setLocalKey(newStr);
                                                            openRouterKeyManager.syncKeys(newStr);
                                                            setTestResult({ status: 'success', message: `Đã nạp file thành công.` });
                                                        }
                                                    }
                                                };
                                                reader.readAsText(file);
                                                e.target.value = '';
                                            }}
                                        />
                                    </label>
                                </div>
                            </div>

                            {keyStatuses.length > 0 && (
                                <div className="max-h-64 overflow-y-auto overscroll-contain w-full space-y-2 p-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl">
                                    {keyStatuses.map((ks, idx) => (
                                        <div key={idx} className={`flex items-center justify-between bg-white dark:bg-slate-950 px-3 py-2 rounded-lg border text-sm transition-all ${ks.status === 'Active' ? 'border-indigo-400 dark:border-indigo-600 shadow-sm' : 'border-slate-100 dark:border-slate-800'}`}>
                                            <div className="flex items-center gap-2">
                                                <span className="text-slate-400 font-mono text-xs border border-slate-200 dark:border-slate-700 rounded px-1.5 py-0.5">#{idx + 1}</span>
                                                <span className="font-mono text-slate-700 dark:text-slate-300">{ks.maskedKey}</span>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                {ks.status === 'Active' && <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/30 px-2 py-0.5 rounded-full">ACTIVE</span>}
                                                {ks.status === 'Exhausted' && <span className="text-[10px] font-bold text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/30 px-2 py-0.5 rounded-full">HẾT QUOTA</span>}
                                                {ks.status === 'Error' && <span className="text-[10px] font-bold text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-900/30 px-2 py-0.5 rounded-full">LỖI</span>}
                                                {ks.status === 'Pending' && <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded-full">CHỜ</span>}
                                                
                                                {ks.status !== 'Active' && (
                                                    <button onClick={() => openRouterKeyManager.switchToKey(idx)} className="p-1 text-primary-500 hover:text-primary-600 dark:hover:text-primary-400 transition-colors duration-200 ease-smooth rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400" title="Đổi sang key này">
                                                        <Play className="w-3.5 h-3.5" />
                                                    </button>
                                                )}
                                                <button onClick={() => handleRemoveKey(idx)} className="p-1 text-danger-400 hover:text-danger-600 dark:hover:text-danger-300 transition-colors duration-200 ease-smooth rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger-400" title="Xóa Key">
                                                    <X className="w-4 h-4" />
                                                </button>
                                            </div>
                                        </div>
                                    ))}
                                    <div className="flex justify-between items-center px-1 pt-2">
                                        <div className="text-xs text-slate-500">Tự động xoay vòng khi hết Quota</div>
                                        <button type="button" onClick={handleClearAll} className="text-xs text-danger-500 hover:text-danger-600 transition-colors duration-200 ease-smooth font-medium rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger-400">Bỏ tất cả</button>
                                    </div>
                                </div>
                            )}

                            {testResult.status && (
                                <div className={`mt-2 text-xs flex items-center gap-1.5 p-2 rounded-lg ${testResult.status === 'success' ? 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400 border border-emerald-100 dark:border-emerald-800/50' : 'bg-rose-50 dark:bg-rose-900/20 text-rose-600 dark:text-rose-400 border border-rose-100 dark:border-rose-800/50'}`}>
                                    {testResult.status === 'success' ? <CheckCircle className="w-4 h-4 flex-shrink-0" /> : <AlertTriangle className="w-4 h-4 flex-shrink-0" />}
                                    {testResult.message}
                                </div>
                            )}
                        </div>
                    </div>

                    {/* RIGHT COLUMN: MODELS */}
                    <div className="flex-1 space-y-4 flex flex-col md:h-full border-t md:border-t-0 md:border-l border-slate-100 dark:border-slate-800 md:pl-6 pt-4 md:pt-0">
                        <div className="flex items-center justify-between">
                            <h4 className="font-bold text-slate-800 dark:text-slate-200 text-sm">Danh sách Models</h4>
                            <div className="flex gap-2">
                                {testing && (
                                    <button 
                                        onClick={handleStopTest} 
                                        className="px-3 py-1.5 bg-danger-500 hover:bg-danger-600 text-white rounded-lg text-xs font-bold shadow-elevation-1 hover:shadow-elevation-2 transition-all duration-200 ease-smooth flex items-center gap-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger-400 focus-visible:ring-offset-1"
                                    >
                                        <Square className="w-3.5 h-3.5 fill-current" />
                                        Dừng Test
                                    </button>
                                )}
                                <button 
                                    onClick={handleTest} 
                                    disabled={testing || localModels.length === 0 || keyStatuses.length === 0}
                                    className="px-3 py-1.5 bg-primary-600 hover:bg-primary-700 text-white rounded-lg text-xs font-bold shadow-elevation-1 hover:shadow-elevation-2 transition-all duration-200 ease-smooth disabled:opacity-50 flex items-center gap-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 focus-visible:ring-offset-1"
                                >
                                    {testing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ShieldCheck className="w-3.5 h-3.5" />}
                                    Test API
                                </button>
                            </div>
                        </div>
                        <p className="text-xs text-slate-500 dark:text-slate-400">
                            Các model được tích chọn sẽ được xoay vòng ngẫu nhiên khi gọi API để tránh Rate Limit.
                        </p>

                        {testResults.length > 0 && (
                            <div className={`p-3 rounded-lg border text-sm ${testResult.status === 'success' ? 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800' : testResult.status === 'error' ? 'bg-rose-50 dark:bg-rose-900/20 border-rose-200 dark:border-rose-800' : 'bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700'}`}>
                                <div className="font-bold mb-2 flex items-center gap-2">
                                    {testResult.status === 'success' ? <CheckCircle className="w-4 h-4 text-emerald-500" /> : testResult.status === 'error' ? <AlertTriangle className="w-4 h-4 text-rose-500" /> : <Loader2 className="w-4 h-4 text-indigo-500 animate-spin" />}
                                    Kết quả Test API
                                </div>
                                <div className="space-y-1.5 max-h-40 overflow-y-auto no-scrollbar overscroll-contain">
                                    {testResults.map((r, idx) => (
                                        <div key={idx} className="flex items-start gap-2">
                                            {r.status === 'testing' ? (
                                                <Loader2 className="w-4 h-4 text-indigo-500 animate-spin mt-0.5 flex-shrink-0" />
                                            ) : r.status === 'success' ? (
                                                <span className="text-emerald-500 mt-0.5 flex-shrink-0">✅</span>
                                            ) : (
                                                <span className="text-rose-500 mt-0.5 flex-shrink-0">❌</span>
                                            )}
                                            <div className="flex-1 text-xs leading-relaxed">
                                                <span className="font-bold text-slate-700 dark:text-slate-200">[{r.modelName}]: </span>
                                                <span className={r.status === 'error' ? 'text-rose-600 dark:text-rose-400 font-medium' : r.status === 'success' ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-500'}>
                                                    {r.status === 'testing' ? 'Đang kiểm tra...' : r.message}
                                                </span>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        <div className="md:flex-1 no-scrollbar md:overflow-y-auto md:overscroll-contain space-y-4">
                            {/* Free Models */}
                            <div className="space-y-2">
                                <div className="flex items-center justify-between">
                                    <h5 className="text-xs font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-wider">Miễn Phí (Free)</h5>
                                    <div className="flex items-center gap-2">
                                        <button onClick={() => setLocalModels(Array.from(new Set([...localModels, ...FREE_MODELS.filter(m => m.id !== 'openrouter/free').map(m => m.id)])))} className="text-[10px] text-primary-500 font-medium hover:text-primary-600 transition-colors duration-200 ease-smooth rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400">Chọn tất cả</button>
                                        <button onClick={() => setLocalModels(localModels.filter(m => !FREE_MODELS.map(fm=>fm.id).includes(m)))} className="text-[10px] text-slate-400 font-medium hover:text-slate-600 dark:hover:text-slate-300 transition-colors duration-200 ease-smooth rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400">Bỏ chọn</button>
                                    </div>
                                </div>
                                <div className="space-y-1">
                                    {FREE_MODELS.map(m => (
                                        <div key={m.id} onClick={() => toggleModel(m.id)} className={`flex items-center gap-3 p-2.5 rounded-lg border cursor-pointer transition-colors duration-200 ease-smooth focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 ${localModels.includes(m.id) ? 'bg-primary-50 dark:bg-primary-900/20 border-primary-200 dark:border-primary-800' : 'bg-white dark:bg-slate-900 border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50'}`}>
                                            <div className="text-primary-500">
                                                {localModels.includes(m.id) ? <CheckSquare className="w-4 h-4" /> : <Square className="w-4 h-4 text-slate-300 dark:text-slate-600" />}
                                            </div>
                                            <div className="flex-1 text-sm font-medium text-slate-700 dark:text-slate-300">{m.name}</div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="px-6 py-4 border-t border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/50 flex justify-between flex-shrink-0">
                    <button onClick={onClose} className="px-6 py-2 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-800 rounded-xl text-sm font-medium transition-colors duration-200 ease-smooth focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 focus-visible:ring-offset-1">
                        Đóng
                    </button>
                    <button onClick={handleSave} className="px-6 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded-xl text-sm font-bold shadow-elevation-2 hover:shadow-elevation-3 transition-all duration-200 ease-smooth flex items-center gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 focus-visible:ring-offset-1">
                        <Save className="w-4 h-4" /> Lưu Cấu Hình
                    </button>
                </div>
            </div>
        </div>
    );
};
