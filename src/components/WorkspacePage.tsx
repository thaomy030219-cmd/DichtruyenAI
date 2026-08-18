
import React, { useMemo, useEffect, useRef, useState, useCallback } from 'react';
import { 
    FileArchive, FileUp, Copy, AlertTriangle, Layers
} from 'lucide-react';
import { FileItem, FileStatus, StoryInfo, RatioLimits } from '../types';
import { validateTranslationIntegrity, BATCH_MISSING_TAG_WARNING } from '../utils/text';
import FileCard from './FileCard';

interface WorkspacePageProps {
    files: FileItem[];
    visibleFiles: FileItem[];
    selectedFiles: Set<string>;
    setSelectedFiles: (ids: Set<string>) => void;
    currentPage: number;
    setCurrentPage: (v: number) => void;
    totalPages: number;
    handleSelectFile: (id: string, shiftKey: boolean) => void;
    handleManualFixSingle: (e: React.MouseEvent, id: string) => void;
    handleRescueCopy: (e: React.MouseEvent, file: FileItem) => void;
    requestRetranslateSingle: (e: React.MouseEvent, id: string) => void;
    handleAutoSplitChapters: (scope: 'all' | 'selected' | 'single', id?: string, threshold?: number, numParts?: number) => void;
    openEditor: (file: FileItem) => void;
    handleRemoveFile: (id: string) => void;
    handleFileUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
    
    // Bottom Bar Logic
    setShowPasteModal: (v: boolean) => void;
    selectAll: () => void;
    rangeStart: string;
    setRangeStart: (v: string) => void;
    rangeEnd: string;
    setRangeEnd: (v: string) => void;
    handleRangeSelect: () => void;
    setShowFindReplace: (v: boolean) => void;
    isProcessing: boolean;
    handleSmartFix: () => void;
    
    // Filter Logic
    showFilterPanel: boolean;
    setShowFilterPanel: (v: boolean) => void;
    filterModels: Set<string>;
    filterStatuses: Set<string>;
    toggleFilterModel: (key: string) => void;
    toggleFilterStatus: (key: string) => void;
    clearFilters: () => void;

    handleScanJunk: () => void;
    handleScanFuzzyDuplicates: () => void;
    handleFilterMismatchedRatio: () => void;
    handleManualCleanup: (scope: 'all' | 'selected') => void;
    handleTitleNormalization: (scope: 'all' | 'selected') => void; // NEW
    setShowRetranslateModal: (v: boolean) => void;
    handleSmartDelete: () => void;
    requestDeleteAll: () => void;
    handleDownloadRaw: () => void;
    handleDownloadTranslatedZip: () => void;
    handleDownloadMerged: () => void;
    handleExportDocx: () => void;
    handleDownloadSelected: () => void;
    handleDownloadEpub: () => void;
    stopProcessing: () => void;
    handleStartButton: () => void;
    
    // Story Info & Ratio Limits
    storyInfo: StoryInfo;
    ratioLimits: RatioLimits; // Injected
}

export const WorkspacePage: React.FC<WorkspacePageProps> = (props) => {
    const [displayLimit, setDisplayLimit] = useState(300);
    
    // --- REAL-TIME STATS CALCULATION (ENHANCED) ---
    const counts = useMemo(() => {
        return {
            selected: props.selectedFiles.size,
            pending: props.files.filter(f => f.status === FileStatus.IDLE).length,
            completed: props.files.filter(f => f.status === FileStatus.COMPLETED && f.remainingRawCharCount === 0).length,
            raw: props.files.filter(f => f.status === FileStatus.COMPLETED && f.remainingRawCharCount > 0).length,
            error: props.files.filter(f => f.status === FileStatus.ERROR && !f.errorMessage?.includes("English")).length,
            english: props.files.filter(f => f.status === FileStatus.ERROR && f.errorMessage?.includes("English")).length,
            short: props.files.filter(f => f.content.length < 1200).length,
            processing: props.files.filter(f => f.status === FileStatus.PROCESSING || f.status === FileStatus.REPAIRING).length,
            
            unchanged: props.files.filter(f => 
                f.status === FileStatus.COMPLETED && 
                f.translatedContent && 
                f.translatedContent.trim() === f.content.trim()
            ).length,
            
            // Files with "Missing Tag/Merge" warning or no line breaks
            merged: props.files.filter(f => 
                f.status === FileStatus.COMPLETED && f.translatedContent && (
                    f.translatedContent.includes(BATCH_MISSING_TAG_WARNING) ||
                    (f.content.split('\n').length > 5 && f.translatedContent.split('\n').length <= 2 && f.translatedContent.length > 300)
                )
            ).length,
            
            // Low Ratio (Using centralized logic)
            lowRatio: props.files.filter(f => {
                if (f.status === FileStatus.ERROR && (f.errorMessage?.toLowerCase().includes('tỷ lệ') || f.errorMessage?.toLowerCase().includes('ratio'))) return true;
                if (f.status !== FileStatus.COMPLETED || !f.translatedContent) return false;
                const integrity = validateTranslationIntegrity(f.content, f.translatedContent, props.ratioLimits, props.storyInfo.languages, f.usedModel);
                return !integrity.isValid && (integrity.reason?.toLowerCase().includes('tỷ lệ') || false);
            }).length,
            
            suspicious: props.files.filter(f => f.errorMessage && (f.errorMessage.includes('phân loại riêng') || f.errorMessage.toLowerCase().includes('an toàn') || f.errorMessage.includes('Nghi vấn lỗi nội dung') || f.errorMessage.includes('BLOCKLIST') || f.errorMessage.includes('PROHIBITED_CONTENT'))).length,
            
            m31pro: props.files.filter(f => f.usedModel?.includes('gemini-3.1-pro')).length,
            m37flash: props.files.filter(f => f.usedModel?.includes('gemini-3.7-flash')).length,
            m36flash: props.files.filter(f => f.usedModel?.includes('gemini-3.6-flash')).length,
            m35flash: props.files.filter(f => f.usedModel?.includes('gemini-3.5-flash') && !f.usedModel?.includes('lite')).length,
            m3flash: props.files.filter(f => f.usedModel?.includes('gemini-3-flash')).length,
            m35flashlite: props.files.filter(f => f.usedModel?.includes('gemini-3.5-flash-lite')).length,
            m31flashlite: props.files.filter(f => f.usedModel?.includes('gemini-3.1-flash-lite') || f.usedModel?.includes('gemini-3.1-flash')).length,
            mOpenRouter: props.files.filter(f => f.usedModel?.includes('openrouter:')).length,
            mManual: props.files.filter(f => f.usedModel?.includes('Thủ công')).length,
            mOther: props.files.filter(f => f.status === FileStatus.COMPLETED && (!f.usedModel || (!f.usedModel.includes('gemini-3.1-pro') && !f.usedModel.includes('gemini-3.7-flash') && !f.usedModel.includes('gemini-3.6-flash') && !f.usedModel.includes('gemini-3.5-flash') && !f.usedModel.includes('gemini-3.1-flash') && !f.usedModel.includes('gemini-3-flash') && !f.usedModel.includes('openrouter:') && !f.usedModel.includes('Thủ công')))).length,
        };
    }, [props.files, props.selectedFiles, props.ratioLimits, props.storyInfo.languages]);

    const renderFilterBadge = (label: string, count: number, active: boolean, onClick: () => void, colorClass: string, icon?: React.ReactNode) => (
        <button 
            onClick={onClick}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all duration-200 ease-smooth border flex items-center gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 focus-visible:ring-offset-1
            ${active ? colorClass : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 hover:border-slate-300'}`}
        >
            <div className="flex items-center gap-1.5">
                {icon}
                <span>{label}</span>
            </div>
            <span className={`px-1.5 py-0.5 rounded-md text-[10px] ${active ? 'bg-white/30' : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300'}`}>
                {count}
            </span>
        </button>
    );

    // Filter Logic inside WorkspacePage
    const filteredFiles = useMemo(() => {
        let filtered = props.files;
        if (props.filterStatuses.size > 0 || props.filterModels.size > 0) {
            filtered = props.files.filter(f => {
                let statusMatch = true;
                if (props.filterStatuses.size > 0) {
                    if (props.filterStatuses.has('selected')) { if (!props.selectedFiles.has(f.id)) return false; if (props.filterStatuses.size === 1) return true; }
                    
                    const isCompleted = f.status === FileStatus.COMPLETED;
                    const isError = f.status === FileStatus.ERROR;
                    const isEnglishError = isError && f.errorMessage?.includes("English");
                    const isRaw = isCompleted && f.remainingRawCharCount > 0;
                    const isClean = isCompleted && f.remainingRawCharCount === 0;
                    const isProcessing = f.status === FileStatus.PROCESSING || f.status === FileStatus.REPAIRING;
                    const isPending = f.status === FileStatus.IDLE;
                    const isShort = f.content.length < 1200;
                    const isUnchanged = isCompleted && f.translatedContent?.trim() === f.content.trim();
                    const isMergedWarning = isCompleted && f.translatedContent && (
                        f.translatedContent.includes(BATCH_MISSING_TAG_WARNING) ||
                        (f.content.split('\n').length > 5 && f.translatedContent.split('\n').length <= 2 && f.translatedContent.length > 300)
                    );

                    const isErrorFilterMatch = props.filterStatuses.has('error') && ((isError && !isEnglishError) || isProcessing);
                    
                    // SUSPICIOUS RATIO FILTER (Precise)
                    let isLowRatio = false;
                    if (props.filterStatuses.has('low_ratio')) {
                        if (isCompleted && f.translatedContent) {
                            const integrity = validateTranslationIntegrity(f.content, f.translatedContent, props.ratioLimits, props.storyInfo.languages, f.usedModel);
                            if (!integrity.isValid && integrity.reason?.toLowerCase().includes('tỷ lệ')) isLowRatio = true;
                        } else if (isError && (f.errorMessage?.toLowerCase().includes('tỷ lệ') || f.errorMessage?.toLowerCase().includes('ratio'))) {
                            isLowRatio = true;
                        }
                    }
                    
                    let isSuspicious = false;
                    if (props.filterStatuses.has('suspicious')) {
                        if (f.errorMessage && (f.errorMessage.includes('phân loại riêng') || f.errorMessage.toLowerCase().includes('an toàn') || f.errorMessage.includes('Nghi vấn lỗi nội dung') || f.errorMessage.includes('BLOCKLIST') || f.errorMessage.includes('PROHIBITED_CONTENT'))) {
                            isSuspicious = true;
                        }
                    }

                    const matchesStandardStatus = ( 
                        (props.filterStatuses.has('completed') && isClean) || 
                        (props.filterStatuses.has('raw') && isRaw) || 
                        isErrorFilterMatch || 
                        (props.filterStatuses.has('english') && isEnglishError) || 
                        (props.filterStatuses.has('processing') && isProcessing) || 
                        (props.filterStatuses.has('pending') && isPending) || 
                        (props.filterStatuses.has('short') && isShort) ||
                        (props.filterStatuses.has('unchanged') && isUnchanged) ||
                        (props.filterStatuses.has('merged') && isMergedWarning)
                    );
                    
                    if (props.filterStatuses.size > (props.filterStatuses.has('selected') ? 1 : 0)) { 
                        statusMatch = matchesStandardStatus || isLowRatio || isSuspicious; 
                    }
                }
                
                let modelMatch = true;
                if (props.filterModels.size > 0) { 
                    const m = f.usedModel || ""; 
                    modelMatch = ( 
                        (props.filterModels.has('31pro') && m.includes('gemini-3.1-pro')) || 
                        (props.filterModels.has('37flash') && m.includes('gemini-3.7-flash')) || 
                        (props.filterModels.has('36flash') && m.includes('gemini-3.6-flash')) || 
                        (props.filterModels.has('35flash') && m.includes('gemini-3.5-flash') && !m.includes('lite')) || 
                        (props.filterModels.has('3flash') && m.includes('gemini-3-flash')) || 
                        (props.filterModels.has('35flashlite') && m.includes('gemini-3.5-flash-lite')) || 
                        (props.filterModels.has('31flashlite') && (m.includes('gemini-3.1-flash-lite') || m.includes('gemini-3.1-flash'))) ||
                        (props.filterModels.has('openrouter') && m.includes('openrouter:')) ||
                        (props.filterModels.has('manual') && m.includes('Thủ công')) ||

                        (props.filterModels.has('other') && f.status === FileStatus.COMPLETED && (!m || (!m.includes('gemini-3.1-pro') && !m.includes('gemini-3.7-flash') && !m.includes('gemini-3.6-flash') && !m.includes('gemini-3.5-flash') && !m.includes('gemini-3.1-flash') && !m.includes('gemini-3-flash') && !m.includes('openrouter:') && !m.includes('Thủ công'))))
                    ); 
                }
                return statusMatch && modelMatch;
            });
        }
        return filtered;
    }, [props.files, props.filterStatuses, props.filterModels, props.selectedFiles, props.ratioLimits, props.storyInfo.languages]);

    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setDisplayLimit(300);
    }, [props.currentPage, props.filterStatuses, props.filterModels]);

    const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
        if (props.currentPage !== 0) return;
        const { scrollTop, scrollHeight, clientHeight } = e.currentTarget;
        if (scrollHeight - scrollTop <= clientHeight + 800) {
            setDisplayLimit(prev => Math.min(prev + 100, filteredFiles.length));
        }
    }, [props.currentPage, filteredFiles.length]);

    const localVisibleFiles = useMemo(() => {
        if (props.currentPage === 0) return filteredFiles.slice(0, displayLimit); 
        const startIndex = (props.currentPage - 1) * 100; // Change to 100
        const endIndex = startIndex + 100;
        return filteredFiles.slice(startIndex, endIndex);
    }, [filteredFiles, props.currentPage, displayLimit]);

    const { filterStatuses, filterModels, setSelectedFiles } = props;
    const prevFiltersRef = useRef({ statuses: filterStatuses, models: filterModels });

    useEffect(() => {
        const statusesChanged = filterStatuses !== prevFiltersRef.current.statuses;
        const modelsChanged = filterModels !== prevFiltersRef.current.models;

        if (statusesChanged || modelsChanged) {
            prevFiltersRef.current = { statuses: filterStatuses, models: filterModels };
            
            if (filterStatuses.size === 0 && filterModels.size === 0) {
                setSelectedFiles(new Set());
            } else {
                const newSelected = new Set(filteredFiles.map(f => f.id));
                setSelectedFiles(newSelected);
            }
        }
    }, [filterStatuses, filterModels, filteredFiles, setSelectedFiles]);

    return (
        <div className="flex flex-col h-full relative animate-in fade-in slide-in-from-bottom-4 duration-500 overflow-hidden">
            {/* 1. Toolbar & Pagination - Flex Item */}
            <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex justify-between items-center bg-white dark:bg-slate-900 shadow-elevation-1 flex-wrap gap-2 shrink-0 z-20">
                <div className="flex items-center gap-2 overflow-x-auto no-scrollbar max-w-full">
                     <button 
                        onClick={() => props.setCurrentPage(0)}
                        className={`px-4 py-2 rounded-xl text-xs font-bold transition-all duration-200 ease-smooth shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 focus-visible:ring-offset-1 ${props.currentPage === 0 || props.totalPages === 0 ? 'bg-primary-600 text-white shadow-elevation-2' : 'bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700'}`}
                    >
                        Tất cả ({props.files.length})
                    </button>
                    {Array.from({ length: props.totalPages }).map((_, idx) => (
                        <button 
                            key={idx} 
                            onClick={() => props.setCurrentPage(idx + 1)}
                            className={`px-4 py-2 rounded-xl text-xs font-bold transition-all duration-200 ease-smooth shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 focus-visible:ring-offset-1 ${props.currentPage === idx + 1 ? 'bg-primary-600 text-white shadow-elevation-2' : 'bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700'}`}
                        >
                            Trang {idx + 1}
                        </button>
                    ))}
                </div>
            </div>

            {/* 1.5 Filter Panel (Collapsible) - Flex Item */}
            {props.showFilterPanel && (
                <div className="bg-slate-50 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-700 p-4 animate-in slide-in-from-top-2 shrink-0 z-10">
                    <div className="max-w-7xl mx-auto flex flex-col gap-4">
                        <div className="flex items-start gap-4">
                            <div className="w-24 text-xs font-bold text-slate-400 uppercase mt-2">Trạng thái:</div>
                            <div className="flex flex-wrap gap-2 flex-1">
                                {renderFilterBadge("Đã chọn", counts.selected, props.filterStatuses.has('selected'), () => props.toggleFilterStatus('selected'), 'bg-primary-100 dark:bg-primary-900/50 text-primary-700 dark:text-primary-300 border-primary-200 dark:border-primary-800')}
                                {renderFilterBadge("Chưa dịch", counts.pending, props.filterStatuses.has('pending'), () => props.toggleFilterStatus('pending'), 'bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-300 dark:border-slate-600')}
                                {renderFilterBadge("Hoàn thành", counts.completed, props.filterStatuses.has('completed'), () => props.toggleFilterStatus('completed'), 'bg-emerald-100 dark:bg-emerald-900/50 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800')}
                                {renderFilterBadge("Còn Raw", counts.raw, props.filterStatuses.has('raw'), () => props.toggleFilterStatus('raw'), 'bg-orange-100 dark:bg-orange-900/50 text-orange-700 dark:text-orange-300 border-orange-200 dark:border-orange-800')}
                                {renderFilterBadge("Lỗi Gộp Chương", counts.merged, props.filterStatuses.has('merged'), () => props.toggleFilterStatus('merged'), 'bg-fuchsia-200 dark:bg-fuchsia-900 text-fuchsia-800 dark:text-fuchsia-200 border-fuchsia-300 dark:border-fuchsia-800', <Layers className="w-3.5 h-3.5" />)}
                                {renderFilterBadge("Tỉ lệ Ảo/Lệch", counts.lowRatio, props.filterStatuses.has('low_ratio'), () => {
                                    const isActive = props.filterStatuses.has('low_ratio');
                                    props.toggleFilterStatus('low_ratio');
                                    if (!isActive) {
                                        // Auto-select files with low ratio
                                        const lowRatioIds = new Set<string>();
                                        props.files.forEach(f => {
                                            if (f.status === FileStatus.COMPLETED && f.translatedContent) {
                                                const integrity = validateTranslationIntegrity(f.content, f.translatedContent, props.ratioLimits, props.storyInfo.languages, f.usedModel);
                                                if (!integrity.isValid && integrity.reason?.toLowerCase().includes('tỷ lệ')) {
                                                    lowRatioIds.add(f.id);
                                                }
                                            } else if (f.status === FileStatus.ERROR && (f.errorMessage?.toLowerCase().includes('tỷ lệ') || f.errorMessage?.toLowerCase().includes('ratio'))) {
                                                lowRatioIds.add(f.id);
                                            }
                                        });
                                        props.setSelectedFiles(lowRatioIds);
                                    }
                                }, 'bg-rose-100 dark:bg-rose-900/50 text-rose-700 dark:text-rose-300 border-rose-200 dark:border-rose-800', <AlertTriangle className="w-3.5 h-3.5" />)}
                                {renderFilterBadge("Nghi vấn (Lỗi/Nhầm)", counts.suspicious, props.filterStatuses.has('suspicious'), () => {
                                    const isActive = props.filterStatuses.has('suspicious');
                                    props.toggleFilterStatus('suspicious');
                                    if (!isActive) {
                                        const suspiciousIds = new Set<string>();
                                        props.files.forEach(f => {
                                            if (f.errorMessage && (f.errorMessage.includes('phân loại riêng') || f.errorMessage.toLowerCase().includes('an toàn') || f.errorMessage.includes('Nghi vấn lỗi nội dung') || f.errorMessage.includes('BLOCKLIST') || f.errorMessage.includes('PROHIBITED_CONTENT'))) {
                                                suspiciousIds.add(f.id);
                                            }
                                        });
                                        props.setSelectedFiles(suspiciousIds);
                                    }
                                }, 'bg-rose-100 dark:bg-rose-900/50 text-rose-700 dark:text-rose-300 border-rose-200 dark:border-rose-800', <AlertTriangle className="w-3.5 h-3.5" />)}
                                {renderFilterBadge("Không dịch (Lỗi)", counts.unchanged, props.filterStatuses.has('unchanged'), () => props.toggleFilterStatus('unchanged'), 'bg-red-100 dark:bg-red-900/50 text-red-700 dark:text-red-300 border-red-200 dark:border-red-800', <Copy className="w-3.5 h-3.5" />)}
                                {renderFilterBadge("Lỗi/Chờ", counts.error + counts.processing, props.filterStatuses.has('error'), () => props.toggleFilterStatus('error'), 'bg-rose-100 dark:bg-rose-900/50 text-rose-700 dark:text-rose-300 border-rose-200 dark:border-rose-800')}
                                {renderFilterBadge("Lỗi Tiếng Anh", counts.english, props.filterStatuses.has('english'), () => props.toggleFilterStatus('english'), 'bg-purple-100 dark:bg-purple-900/50 text-purple-700 dark:text-purple-300 border-purple-200 dark:border-purple-800')}
                                {renderFilterBadge("Quá ngắn (<1200)", counts.short, props.filterStatuses.has('short'), () => props.toggleFilterStatus('short'), 'bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300 border-slate-300 dark:border-slate-600')}
                            </div>
                        </div>
                        <div className="flex items-start gap-4 border-t border-slate-200 dark:border-slate-700 pt-3">
                            <div className="w-24 text-xs font-bold text-slate-400 uppercase mt-2">Model:</div>
                            <div className="flex flex-wrap gap-2 flex-1">
                                {renderFilterBadge("3.1 Pro", counts.m31pro, props.filterModels.has('31pro'), () => props.toggleFilterModel('31pro'), 'bg-primary-100 dark:bg-primary-900/50 text-primary-700 dark:text-primary-300 border-primary-200 dark:border-primary-800')}
                                {renderFilterBadge("3.7 Flash", counts.m37flash, props.filterModels.has('37flash'), () => props.toggleFilterModel('37flash'), 'bg-primary-100 dark:bg-primary-900/50 text-primary-700 dark:text-primary-300 border-primary-200 dark:border-primary-800')}
                                {renderFilterBadge("3.6 Flash", counts.m36flash, props.filterModels.has('36flash'), () => props.toggleFilterModel('36flash'), 'bg-primary-100 dark:bg-primary-900/50 text-primary-700 dark:text-primary-300 border-primary-200 dark:border-primary-800')}
                                {renderFilterBadge("3.5 Flash", counts.m35flash, props.filterModels.has('35flash'), () => props.toggleFilterModel('35flash'), 'bg-amber-100 dark:bg-amber-900/50 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800')}
                                {renderFilterBadge("3.0 Flash", counts.m3flash, props.filterModels.has('3flash'), () => props.toggleFilterModel('3flash'), 'bg-amber-100 dark:bg-amber-900/50 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800')}
                                {renderFilterBadge("3.5 Flash Lite", counts.m35flashlite, props.filterModels.has('35flashlite'), () => props.toggleFilterModel('35flashlite'), 'bg-amber-100 dark:bg-amber-900/50 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800')}
                                {renderFilterBadge("3.1 Flash Lite", counts.m31flashlite, props.filterModels.has('31flashlite'), () => props.toggleFilterModel('31flashlite'), 'bg-amber-100 dark:bg-amber-900/50 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800')}
                                {renderFilterBadge("OpenRouter", counts.mOpenRouter, props.filterModels.has('openrouter'), () => props.toggleFilterModel('openrouter'), 'bg-fuchsia-100 dark:bg-fuchsia-900/50 text-fuchsia-700 dark:text-fuchsia-300 border-fuchsia-200 dark:border-fuchsia-800')}
                                {renderFilterBadge("Thủ công", counts.mManual, props.filterModels.has('manual'), () => props.toggleFilterModel('manual'), 'bg-teal-100 dark:bg-teal-900/50 text-teal-700 dark:text-teal-300 border-teal-200 dark:border-teal-800')}
                                {renderFilterBadge("Khác", counts.mOther, props.filterModels.has('other'), () => props.toggleFilterModel('other'), 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700')}
                            </div>
                            <button onClick={props.clearFilters} className="px-3 py-1.5 text-xs font-bold text-danger-500 hover:bg-danger-50 dark:hover:bg-danger-900/20 rounded-lg transition-colors duration-200 ease-smooth ml-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 focus-visible:ring-offset-1">
                                Xóa bộ lọc
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* 2. File Grid - Main Scrollable Area (Flex-1) */}
            <div className="flex-1 overflow-y-auto custom-scrollbar p-6 bg-slate-50/50 dark:bg-slate-900/50" onScroll={handleScroll}>
                {props.files.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center text-slate-400 dark:text-slate-500 border-2 border-dashed border-slate-300/50 dark:border-slate-700/50 rounded-3xl bg-white/50 dark:bg-slate-900/50">
                        <div className="p-8 bg-white dark:bg-slate-800 rounded-full shadow-xl shadow-primary-100 dark:shadow-none mb-6 animate-bounce"><FileArchive className="w-16 h-16 text-primary-200 dark:text-primary-800" /></div>
                        <h3 className="text-xl font-display font-bold text-slate-600 dark:text-slate-300 mb-2">Chưa có file nào</h3>
                        <p className="text-sm text-slate-400 dark:text-slate-500 mb-8 max-w-xs text-center">Kéo thả file .txt, .zip, .epub, .pdf vào đây</p>
                        <label className="px-8 py-3 bg-primary-600 text-white rounded-xl font-bold shadow-elevation-3 hover:bg-primary-700 hover:shadow-elevation-4 cursor-pointer transition-all duration-200 ease-smooth flex items-center gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 focus-visible:ring-offset-1">
                            <FileUp className="w-4 h-4" /> Tải Truyện Lên
                            <input type="file" multiple accept=".txt,.zip,.epub,.docx,.doc,.pdf" className="hidden" onChange={props.handleFileUpload} />
                        </label>
                    </div>
                ) : localVisibleFiles.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center text-slate-400 dark:text-slate-500 border-2 border-dashed border-slate-300/50 dark:border-slate-700/50 rounded-3xl bg-white/50 dark:bg-slate-900/50">
                        <div className="p-8 bg-white dark:bg-slate-800 rounded-full shadow-xl shadow-primary-100 dark:shadow-none mb-6"><FileArchive className="w-16 h-16 text-slate-300 dark:text-slate-600" /></div>
                        <h3 className="text-xl font-display font-bold text-slate-600 dark:text-slate-300 mb-2">Không có file nào khớp với bộ lọc</h3>
                        <p className="text-sm text-slate-400 dark:text-slate-500 mb-8 max-w-xs text-center">Hãy thử thay đổi hoặc xóa bộ lọc để xem các file khác.</p>
                        <button onClick={props.clearFilters} className="px-8 py-3 bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 rounded-xl font-bold hover:bg-slate-300 dark:hover:bg-slate-700 transition-all duration-200 ease-smooth focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 focus-visible:ring-offset-1">
                            Xóa Bộ Lọc
                        </button>
                    </div>
                ) : (
                    <div className="grid gap-4 grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                        {localVisibleFiles.map(file => (
                            <FileCard 
                                key={file.id}
                                file={file}
                                isSelected={props.selectedFiles.has(file.id)}
                                storyInfo={props.storyInfo}
                                ratioLimits={props.ratioLimits}
                                handleSelectFile={props.handleSelectFile}
                                handleManualFixSingle={props.handleManualFixSingle}
                                requestRetranslateSingle={props.requestRetranslateSingle}
                                handleAutoSplitChapters={props.handleAutoSplitChapters}
                                handleRescueCopy={props.handleRescueCopy}
                                openEditor={props.openEditor}
                                handleRemoveFile={props.handleRemoveFile}
                            />
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
};
