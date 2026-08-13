import React from 'react';
import { Search, Loader2, FileText, CheckCircle, Upload, RefreshCw, Download, Image as ImageIcon, X, Sparkles } from 'lucide-react';
import { InlineEnglishFixPanel } from './InlineEnglishFixPanel';
import { usePromptFixPage, UsePromptFixPageProps } from '../hooks/pages/usePromptFixPage';
import { downloadTextFile } from '../utils/fileHelpers';

type PromptFixPageProps = UsePromptFixPageProps

export const PromptFixPage: React.FC<PromptFixPageProps> = (props) => {
    const {
        isAnalyzingReq, isScanning, isProposing, isFixing, scanProgress,
        imageInputRef, fileInputRef,
        setRawErrors, setProcessedFixes, setPrompt,
        rawErrors, processedFixes, fixPrompt, fixImages,
        handleImageUpload, handleUploadTxt, removeImage,
        handleAnalyzeRequirements, handleScan, handlePropose, applyFixesToTranslation,
        isWorking,
    } = usePromptFixPage(props);
    const { handleTranslatedFileUpload, promptTemplate, dictionary, files, setFilesSafe, addToast, addLog, storyInfo } = props;

    return (
        <div className="flex flex-col flex-1 min-h-0 w-full bg-slate-50 dark:bg-slate-900 rounded-2xl overflow-hidden shadow-elevation-1 border border-slate-200 dark:border-slate-800">
            {/* Header */}
            <div className="bg-white dark:bg-slate-900 px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between shrink-0">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-orange-100 dark:bg-orange-900/30 flex items-center justify-center text-orange-600 dark:text-orange-400">
                        <Search className="w-5 h-5" />
                    </div>
                    <div>
                        <h2 className="font-bold text-base text-slate-800 dark:text-slate-100">AI Quét & Sửa Lỗi Hàng Loạt</h2>
                        <p className="text-xs text-slate-500 dark:text-slate-400">3.5 Flash quét lỗi thô → 3.1 Pro đề xuất quy tắc → Áp dụng tự động</p>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <input type="file" multiple accept="image/*" className="hidden" ref={imageInputRef} onChange={handleImageUpload} />
                    <input type="file" accept=".epub,.zip,.txt" className="hidden" ref={fileInputRef} onChange={handleTranslatedFileUpload} />
                    <button
                        onClick={() => fileInputRef.current?.click()}
                        className="px-3 py-2 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 rounded-xl text-xs font-medium flex items-center gap-1.5 transition-colors duration-200 ease-smooth focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400"
                    >
                        <Upload className="w-3.5 h-3.5" /> Tải File Dịch
                    </button>
                </div>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto custom-scrollbar scroll-smooth p-4 md:p-6 lg:p-8 space-y-6 lg:space-y-8 relative">
                {/* Requirements input */}
                <div className="p-4 border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/50 rounded-2xl shrink-0 space-y-3 shadow-elevation-1">
                    <div className="flex items-center justify-between">
                        <label className="text-sm font-bold text-slate-700 dark:text-slate-300">Yêu Cầu Sửa Lỗi:</label>
                        <div className="flex items-center gap-2">
                            <button
                                onClick={() => imageInputRef.current?.click()}
                                className="px-2.5 py-1.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-colors duration-200 ease-smooth focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400"
                            >
                                <ImageIcon className="w-3.5 h-3.5" /> Ảnh lỗi
                            </button>
                            <button
                                onClick={handleAnalyzeRequirements}
                                disabled={isWorking}
                                className="px-2.5 py-1.5 bg-amber-100 dark:bg-amber-900/30 hover:bg-amber-200 dark:hover:bg-amber-900/50 disabled:opacity-50 text-amber-700 dark:text-amber-400 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-colors duration-200 ease-smooth focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400"
                            >
                                {isAnalyzingReq ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                                Phân tích (Flash)
                            </button>
                            <button
                                onClick={handleScan}
                                disabled={isWorking}
                                className="px-4 py-2 bg-orange-600 hover:bg-orange-700 disabled:opacity-50 text-white rounded-lg text-xs font-bold flex items-center gap-1.5 shadow-elevation-2 shadow-orange-500/20 transition-all duration-200 ease-smooth focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 focus-visible:ring-offset-1"
                            >
                                {isScanning ? <><Loader2 className="w-3.5 h-3.5 animate-spin" />{scanProgress.total > 0 ? ` ${scanProgress.current}/${scanProgress.total}` : ''}</> : <><Search className="w-3.5 h-3.5" /> Quét</>}
                            </button>
                        </div>
                    </div>

                    {fixImages.length > 0 && (
                        <div className="flex gap-2 overflow-x-auto py-1 custom-scrollbar">
                            {fixImages.map((img, i) => (
                                <div key={i} className="relative shrink-0">
                                    <img src={img} className="h-12 w-12 object-cover rounded-lg border border-slate-300 dark:border-slate-600" alt="" />
                                    <button onClick={() => removeImage(i)} className="absolute -top-1.5 -right-1.5 bg-danger-500 hover:bg-danger-600 text-white rounded-full p-0.5 shadow-elevation-1 transition-colors duration-200 ease-smooth focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400"><X className="w-3 h-3" /></button>
                                </div>
                            ))}
                        </div>
                    )}

                    <textarea
                        value={fixPrompt || ''}
                        onChange={e => setPrompt(e.target.value)}
                        placeholder="Ví dụ: Tìm các đoạn bị lỗi xưng hô từ Ta thành Ngươi, hoặc tên nhân vật bị sai...&#10;Nhấn 'Phân tích' để AI đề xuất quy tắc từ mô tả/ảnh. Chỉnh sửa xong rồi nhấn 'Quét'."
                        className="w-full bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-xl p-3 text-sm shadow-elevation-1 focus:ring-2 focus:ring-orange-500 outline-none transition-all duration-200 ease-smooth resize-y min-h-[90px] custom-scrollbar scroll-smooth"
                    />
                    <p className="text-xs text-slate-400 dark:text-slate-500">💡 Sau khi AI phân tích, bạn có thể chỉnh sửa quy tắc trước khi nhấn <strong>Quét</strong></p>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 lg:gap-6 w-full min-h-0">
                    {/* LEFT: Raw errors pane */}
                    <div className="flex flex-col bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden shadow-elevation-1">
                        <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-800 flex justify-between items-center bg-slate-50 dark:bg-slate-950 shrink-0">
                            <div className="font-semibold text-slate-700 dark:text-slate-200 text-sm flex items-center gap-2">
                                <FileText className="w-4 h-4 text-rose-500" />
                                Lỗi thô (AI tìm thấy)
                            </div>
                            <div className="flex items-center gap-1">
                                <label className="p-1.5 hover:bg-slate-200 dark:hover:bg-slate-800 rounded-lg text-slate-500 cursor-pointer transition-colors duration-200 ease-smooth focus-within:ring-2 focus-within:ring-primary-400" title="Tải lên danh sách lỗi thô (.txt)">
                                    <Upload className="w-3.5 h-3.5" />
                                    <input type="file" className="hidden" accept=".txt" onChange={e => handleUploadTxt(e, setRawErrors)} />
                                </label>
                                <button onClick={() => downloadTextFile('Lỗi thô - Sửa lỗi.txt', rawErrors)} disabled={!rawErrors} className="p-1.5 hover:bg-slate-200 dark:hover:bg-slate-800 rounded-lg text-slate-500 disabled:opacity-50 transition-colors duration-200 ease-smooth focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400"><Download className="w-3.5 h-3.5" /></button>
                            </div>
                        </div>
                        <textarea
                            value={rawErrors || ''}
                            onChange={e => setRawErrors(e.target.value)}
                            className="w-full h-72 lg:h-96 p-4 text-sm font-mono bg-transparent border-none focus:ring-0 outline-none resize-none leading-relaxed custom-scrollbar scroll-smooth text-slate-700 dark:text-slate-300"
                            placeholder="Lỗi thô xuất hiện sau khi quét..."
                            spellCheck={false}
                        />
                    </div>

                    {/* RIGHT: Processed fixes */}
                    <div className="flex flex-col bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden shadow-elevation-1">
                        <div className="px-4 py-3 border-b border-primary-100 dark:border-primary-900/30 flex justify-between items-center bg-primary-50/50 dark:bg-primary-950 shrink-0">
                            <div className="font-semibold gap-2 items-center flex text-primary-700 dark:text-primary-400 text-sm">
                                <CheckCircle className="w-4 h-4" />
                                Quy tắc ĐÃ XỬ LÝ
                            </div>
                            <div className="flex items-center gap-2">
                                <button
                                    onClick={handlePropose}
                                    disabled={isWorking || !rawErrors.trim()}
                                    className="px-3 py-1.5 bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all duration-200 ease-smooth shadow-glow-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 focus-visible:ring-offset-1"
                                >
                                    {isProposing ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Đề xuất...</> : <><Sparkles className="w-3.5 h-3.5" /> Đề xuất Pro</>}
                                </button>
                                <label className="p-1.5 hover:bg-primary-100 dark:hover:bg-primary-900/50 rounded-lg text-primary-500 cursor-pointer transition-colors duration-200 ease-smooth focus-within:ring-2 focus-within:ring-primary-400" title="Tải lên quy tắc đã xử lý (.txt)">
                                    <Upload className="w-3.5 h-3.5" />
                                    <input type="file" className="hidden" accept=".txt" onChange={e => handleUploadTxt(e, setProcessedFixes)} />
                                </label>
                                <button onClick={() => downloadTextFile('Quy tắc đã xử lý.txt', processedFixes)} disabled={!processedFixes} className="p-1.5 hover:bg-primary-100 dark:hover:bg-primary-900/50 rounded-lg text-primary-500 disabled:opacity-50 transition-colors duration-200 ease-smooth focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400"><Download className="w-3.5 h-3.5" /></button>
                            </div>
                        </div>
                        <div className="flex-1 flex flex-col relative w-full h-72 lg:h-96">
                            <textarea
                                value={processedFixes || ''}
                                onChange={e => setProcessedFixes(e.target.value)}
                                className="absolute inset-0 w-full h-full p-4 text-sm font-mono bg-primary-50/20 dark:bg-primary-950/20 border-none focus:ring-0 outline-none resize-none leading-relaxed custom-scrollbar scroll-smooth text-slate-700 dark:text-slate-300"
                                placeholder="Định dạng: Lỗi cũ = Đoạn mới sửa&#10;(Nhấn 'Đề xuất Pro' sau khi có lỗi thô)"
                                spellCheck={false}
                            />
                        </div>
                        <div className="p-4 border-t border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 shrink-0 flex justify-center">
                            <button
                                onClick={applyFixesToTranslation}
                                disabled={isFixing || !processedFixes.trim()}
                                className="w-full md:w-auto px-8 py-3 bg-primary-600 hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-xl font-bold text-sm shadow-glow-primary transition-all duration-200 ease-smooth active:scale-95 flex items-center justify-center gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 focus-visible:ring-offset-1"
                            >
                                {isFixing ? <Loader2 className="w-5 h-5 animate-spin" /> : <RefreshCw className="w-5 h-5" />}
                                Sửa lỗi vào bản dịch ({files.length} chap)
                            </button>
                        </div>
                    </div>
                </div>

                <InlineEnglishFixPanel 
                    files={files} 
                    setFilesSafe={setFilesSafe} 
                    addToast={addToast} 
                    addLog={addLog} 
                    storyInfo={storyInfo} 
                    promptTemplate={promptTemplate}
                    dictionary={dictionary}
                />
            </div>
        </div>
    );
};
