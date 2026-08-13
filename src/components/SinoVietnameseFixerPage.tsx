import React from 'react';
import { Search, Loader2, FileText, CheckCircle, PenTool, Upload, RefreshCw, Copy, Download, Image as ImageIcon, X, Sparkles } from 'lucide-react';
import { useSinoVietnameseFixerPage, UseSinoVietnameseFixerPageProps } from '../hooks/pages/useSinoVietnameseFixerPage';
import { downloadTextFile } from '../utils/fileHelpers';

type SinoVietnameseFixerPageProps = UseSinoVietnameseFixerPageProps

export const SinoVietnameseFixerPage: React.FC<SinoVietnameseFixerPageProps> = (props) => {
    const {
        isAnalyzingRules, isScanning, isFixing, scanProgress,
        imageInputRef,
        setUnfixedList, setFixedList, setCustomRules,
        unfixedList, fixedList, customRules, ruleImages,
        handleImageUpload, removeImage,
        handleAnalyzeRules, handleScan, handleFix, applyFixesToFiles,
        handleSaveToDictionary, handleCopy, handleUploadTxt,
    } = useSinoVietnameseFixerPage(props);
    const { handleTranslatedFileUpload, setAdditionalDictionary } = props;

    return (
        <div className="flex flex-col flex-1 min-h-0 w-full bg-slate-50 dark:bg-slate-950 overflow-y-auto">
            <div className="max-w-5xl mx-auto w-full p-6 space-y-5">
                {/* Header */}
                <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 bg-white dark:bg-slate-900 p-5 rounded-2xl shadow-elevation-1 border border-slate-200 dark:border-slate-800">
                    <div className="flex items-center gap-4">
                        <div className="p-3 bg-teal-50 dark:bg-teal-900/30 rounded-xl text-teal-600 dark:text-teal-400">
                            <Search className="w-7 h-7" />
                        </div>
                        <div>
                            <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100">Tối Ưu Hán Việt & Tiếng Anh</h1>
                            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                                AI quét cụm Hán Việt khó hiểu, đảo ngược và tiếng Anh lộn xộn — tự động theo batch song song.
                            </p>
                        </div>
                    </div>
                    <label className="shrink-0 px-5 py-2.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-xl font-bold cursor-pointer transition-colors duration-200 ease-smooth flex items-center gap-2 text-sm focus-within:ring-2 focus-within:ring-primary-400 focus-within:ring-offset-1">
                        <Upload className="w-4 h-4" /> Import Bản Dịch (EPUB)
                        <input type="file" accept=".epub,.zip,.txt" className="hidden" onChange={handleTranslatedFileUpload} />
                    </label>
                </div>

                {/* Section 1: Scan */}
                <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-elevation-1 border border-slate-200 dark:border-slate-800 overflow-hidden">
                    <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-800 flex flex-col md:flex-row md:items-center justify-between gap-3">
                        <div>
                            <h2 className="text-base font-bold text-slate-800 dark:text-slate-100">1. Quét và tìm kiếm lỗi</h2>
                            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Phân tích quy tắc → quét 3.5 Flash → lấy lỗi thô</p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                            <button
                                onClick={handleScan}
                                disabled={isScanning || isFixing || isAnalyzingRules}
                                className="px-5 py-2.5 bg-teal-600 hover:bg-teal-700 disabled:opacity-50 text-white rounded-xl font-bold text-sm flex items-center gap-2 transition-all duration-200 ease-smooth shadow-elevation-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 focus-visible:ring-offset-1"
                            >
                                {isScanning ? <><Loader2 className="w-4 h-4 animate-spin" /> Đang quét ({scanProgress.current}/{scanProgress.total})</> : <><Search className="w-4 h-4" /> Bắt đầu quét</>}
                            </button>
                            <button
                                onClick={handleFix}
                                disabled={isFixing || isScanning || !unfixedList}
                                className="px-5 py-2.5 bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white rounded-xl font-bold text-sm flex items-center gap-2 transition-all duration-200 ease-smooth shadow-glow-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 focus-visible:ring-offset-1"
                            >
                                {isFixing ? <><Loader2 className="w-4 h-4 animate-spin" /> Đang xử lý...</> : <><PenTool className="w-4 h-4" /> Đề xuất (Pro)</>}
                            </button>
                        </div>
                    </div>

                    {/* Rules Input */}
                    <div className="p-5 space-y-3">
                        <div className="flex items-center justify-between">
                            <label className="text-sm font-semibold text-slate-700 dark:text-slate-300">Quy tắc bổ sung (Tùy chọn)</label>
                            <div className="flex items-center gap-2">
                                <input type="file" multiple accept="image/*" className="hidden" ref={imageInputRef} onChange={handleImageUpload} />
                                <button
                                    onClick={() => imageInputRef.current?.click()}
                                    className="px-3 py-1.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-colors duration-200 ease-smooth focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400"
                                >
                                    <ImageIcon className="w-3.5 h-3.5" /> Thêm ảnh lỗi
                                </button>
                                <button
                                    onClick={handleAnalyzeRules}
                                    disabled={isAnalyzingRules || isScanning}
                                    className="px-3 py-1.5 bg-amber-100 dark:bg-amber-900/30 hover:bg-amber-200 dark:hover:bg-amber-900/50 disabled:opacity-50 text-amber-700 dark:text-amber-400 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-colors duration-200 ease-smooth focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400"
                                >
                                    {isAnalyzingRules ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Đang phân tích...</> : <><Sparkles className="w-3.5 h-3.5" /> Phân tích quy tắc (Flash)</>}
                                </button>
                            </div>
                        </div>

                        {ruleImages.length > 0 && (
                            <div className="flex gap-2 overflow-x-auto py-1">
                                {ruleImages.map((img, i) => (
                                    <div key={i} className="relative shrink-0">
                                        <img src={img} className="h-14 w-14 object-cover rounded-lg border border-slate-300 dark:border-slate-600" alt="" />
                                        <button onClick={() => removeImage(i)} className="absolute -top-1.5 -right-1.5 bg-danger-500 hover:bg-danger-600 text-white rounded-full p-0.5 shadow-elevation-1 transition-colors duration-200 ease-smooth focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400"><X className="w-3 h-3" /></button>
                                    </div>
                                ))}
                            </div>
                        )}

                        <textarea
                            value={customRules || ''}
                            onChange={e => setCustomRules(e.target.value)}
                            placeholder="Ví dụ: Ưu tiên sửa lỗi xưng hô, tìm từ Hán Việt đảo ngược...&#10;Hoặc nhấn 'Phân tích quy tắc' để AI tự đề xuất từ ảnh/mô tả."
                            className="w-full bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-xl p-3 text-sm shadow-elevation-1 focus:ring-2 focus:ring-teal-500 outline-none transition-all duration-200 ease-smooth resize-y min-h-[90px] custom-scrollbar scroll-smooth"
                        />
                        <p className="text-xs text-slate-400 dark:text-slate-500">💡 Bạn có thể chỉnh sửa quy tắc trên trước khi nhấn <strong>Bắt đầu quét</strong></p>
                    </div>
                </div>

                {/* Section 2: Results */}
                <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-elevation-1 border border-slate-200 dark:border-slate-800 overflow-hidden">
                    <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-800 flex flex-col md:flex-row md:items-center justify-between gap-3">
                        <div>
                            <h2 className="text-base font-bold text-slate-800 dark:text-slate-100">2. Kết quả & Áp dụng</h2>
                            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Kiểm tra và áp dụng vào bản dịch. Bạn có thể paste danh sách lỗi có sẵn.</p>
                        </div>
                        <div className="flex flex-wrap gap-2 shrink-0">
                            <button
                                onClick={handleSaveToDictionary}
                                disabled={!fixedList || !setAdditionalDictionary}
                                className="px-4 py-2 bg-primary-100 dark:bg-primary-900/40 text-primary-700 dark:text-primary-400 hover:bg-primary-200 dark:hover:bg-primary-900/60 disabled:opacity-50 rounded-lg font-bold text-sm flex items-center gap-2 transition-all duration-200 ease-smooth focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 focus-visible:ring-offset-1"
                            >
                                Lưu vào Từ Điển
                            </button>
                            <button
                                onClick={() => applyFixesToFiles(fixedList)}
                                disabled={!fixedList}
                                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded-lg font-bold text-sm flex items-center gap-2 transition-all duration-200 ease-smooth shadow-elevation-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 focus-visible:ring-offset-1"
                            >
                                <RefreshCw className="w-4 h-4" /> Sửa lỗi vào bản dịch
                            </button>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-0 divide-y lg:divide-y-0 lg:divide-x divide-slate-100 dark:divide-slate-800">
                        {/* Raw errors */}
                        <div className="p-5 space-y-2">
                            <div className="flex items-center justify-between">
                                <h3 className="font-bold text-slate-700 dark:text-slate-200 text-sm flex items-center gap-2">
                                    <FileText className="w-4 h-4 text-slate-400" /> Lỗi thô
                                </h3>
                                <div className="flex items-center gap-1">
                                    <label className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded cursor-pointer text-slate-500 transition-colors duration-200 ease-smooth focus-within:ring-2 focus-within:ring-primary-400" title="Upload .txt">
                                        <Upload className="w-3.5 h-3.5" />
                                        <input type="file" className="hidden" accept=".txt" onChange={e => handleUploadTxt(e, setUnfixedList)} />
                                    </label>
                                    <button onClick={() => downloadTextFile('Lỗi thô - Hán Việt.txt', unfixedList)} disabled={!unfixedList} className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded disabled:opacity-50 text-slate-500 transition-colors duration-200 ease-smooth focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400"><Download className="w-3.5 h-3.5" /></button>
                                    <button onClick={() => handleCopy(unfixedList)} disabled={!unfixedList} className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded disabled:opacity-50 text-slate-500 transition-colors duration-200 ease-smooth focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400"><Copy className="w-3.5 h-3.5" /></button>
                                </div>
                            </div>
                            <textarea
                                value={unfixedList || ''}
                                onChange={e => setUnfixedList(e.target.value)}
                                placeholder="Danh sách lỗi thô sẽ hiện ở đây sau khi quét..."
                                className="w-full h-72 lg:h-96 p-3 text-sm font-mono bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl transition-all duration-200 ease-smooth focus:outline-none focus:ring-2 focus:ring-teal-500 resize-none custom-scrollbar scroll-smooth"
                            />
                        </div>

                        {/* Fixed list */}
                        <div className="p-5 space-y-2">
                            <div className="flex items-center justify-between">
                                <h3 className="font-bold text-primary-700 dark:text-primary-400 text-sm flex items-center gap-2">
                                    <CheckCircle className="w-4 h-4" /> Đã xử lý (chờ áp dụng)
                                </h3>
                                <div className="flex items-center gap-1">
                                    <label className="p-1.5 hover:bg-primary-50 dark:hover:bg-primary-900/30 rounded cursor-pointer text-primary-500 transition-colors duration-200 ease-smooth focus-within:ring-2 focus-within:ring-primary-400">
                                        <Upload className="w-3.5 h-3.5" />
                                        <input type="file" className="hidden" accept=".txt" onChange={e => handleUploadTxt(e, setFixedList)} />
                                    </label>
                                    <button onClick={() => downloadTextFile('Đã xử lý - Hán Việt.txt', fixedList)} disabled={!fixedList} className="p-1.5 hover:bg-primary-50 dark:hover:bg-primary-900/30 rounded disabled:opacity-50 text-primary-500 transition-colors duration-200 ease-smooth focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400"><Download className="w-3.5 h-3.5" /></button>
                                    <button onClick={() => handleCopy(fixedList)} disabled={!fixedList} className="p-1.5 hover:bg-primary-50 dark:hover:bg-primary-900/30 rounded disabled:opacity-50 text-primary-500 transition-colors duration-200 ease-smooth focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400"><Copy className="w-3.5 h-3.5" /></button>
                                </div>
                            </div>
                            <textarea
                                value={fixedList || ''}
                                onChange={e => setFixedList(e.target.value)}
                                placeholder="Danh sách đã sửa sẽ hiện ở đây sau khi Đề xuất Pro..."
                                className="w-full h-72 lg:h-96 p-3 text-sm font-mono bg-primary-50/40 dark:bg-primary-950/20 border border-primary-100 dark:border-primary-900/50 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500 resize-none custom-scrollbar scroll-smooth"
                            />
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};
