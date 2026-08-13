
import { useState, useMemo, useCallback } from 'react';
import { Toast, LogEntry, TranslationTier } from '../types';
import { loadPersistedLogs, persistLogs, schedulePersistLogs, clearPersistedLogs } from '../utils/logStore';

const THEME_KEY = 'app_theme_preference';

export const useUIState = () => {
    const [isDarkMode, setIsDarkMode] = useState<boolean>(() => {
        if (typeof window === 'undefined') return false;
        let storedTheme = null;
        try { storedTheme = localStorage.getItem(THEME_KEY); } catch {}
        if (storedTheme) return storedTheme === 'dark';
        return window.matchMedia('(prefers-color-scheme: dark)').matches;
    });
    const [showSettings, setShowSettings] = useState<boolean>(false);
    const [showLogs, setShowLogs] = useState<boolean>(false);
    const [toasts, setToasts] = useState<Toast[]>([]);
    // Khôi phục log từ localStorage lúc khởi tạo — để lịch sử log (kể cả log dẫn tới 1 lần
    // crash/tải lại trang trước đó) không biến mất khỏi UI, người dùng vẫn xem/xuất lại được.
    const [systemLogs, setSystemLogs] = useState<LogEntry[]>(() => loadPersistedLogs());
    
    // Filter State
    const [activeTab, setActiveTab] = useState<'dashboard' | 'workspace' | 'knowledge' | 'titles' | 'creative' | 'hanviet'>('dashboard');
    const [showFilterPanel, setShowFilterPanel] = useState<boolean>(false);
    const [filterModels, setFilterModels] = useState<Set<string>>(new Set());
    const [filterStatuses, setFilterStatuses] = useState<Set<string>>(new Set());
    
    // Pagination / Selection State
    const [currentPage, setCurrentPage] = useState<number>(1);
    const [rangeStart, setRangeStart] = useState<string>('');
    const [rangeEnd, setRangeEnd] = useState<string>('');
    const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
    const [lastSelectedId, setLastSelectedId] = useState<string | null>(null);

    // Modal States
    const [editingFileId, setEditingFileId] = useState<string | null>(null);
    const [showFindReplace, setShowFindReplace] = useState<boolean>(false);
    const [showPasteModal, setShowPasteModal] = useState<boolean>(false);
    const [splitterModal, setSplitterModal] = useState<{ isOpen: boolean, content: string, name: string, isTranslatedImport?: boolean }>({ isOpen: false, content: '', name: '' });
    const [zipActionModal, setZipActionModal] = useState<boolean>(false);
    const [showGuide, setShowGuide] = useState<boolean>(false);
    const [showContextBuilder, setShowContextBuilder] = useState<boolean>(false);
    const [showSmartStartModal, setShowSmartStartModal] = useState<boolean>(false);
    const [smartStartStep, setSmartStartStep] = useState<'idle' | 'optimizing' | 'analyzing'>('idle');
    const [autoOptimizePrompt, setAutoOptimizePrompt] = useState<boolean>(true);
    const [showStartOptions, setShowStartOptions] = useState<boolean>(false);
    const [showNameAnalysisModal, setShowNameAnalysisModal] = useState<boolean>(false);
    const [isAnalyzingNames, setIsAnalyzingNames] = useState<boolean>(false);
    const [isRefiningContext, setIsRefiningContext] = useState<boolean>(false);
    const [showRetranslateModal, setShowRetranslateModal] = useState<boolean>(false);
    const [confirmModal, setConfirmModal] = useState<{ isOpen: boolean; title: string; message: string; onConfirm: () => void; isDanger: boolean; confirmText?: string }>({ isOpen: false, title: '', message: '', onConfirm: () => {}, isDanger: false });
    const [importModal, setImportModal] = useState<{ isOpen: boolean; pendingFiles: any[]; tempInfo?: any }>({ isOpen: false, pendingFiles: [] });
    const [showChangelog, setShowChangelog] = useState<boolean>(false);
    const [showPromptDesigner, setShowPromptDesigner] = useState<boolean>(false);
    const [showEpubModal, setShowEpubModal] = useState<boolean>(false);
    const [showAutomationModal, setShowAutomationModal] = useState<boolean>(false);
    const [showRawDownloadModal, setShowRawDownloadModal] = useState<boolean>(false);
    
    // New: Smart Automation Config State
    const [automationInitialConfig, setAutomationInitialConfig] = useState<{ steps: number[], rules: string, tier: TranslationTier }>({ steps: [0,1,2,3,4,5,6,7], rules: 'Với các cảnh bạo lực hoặc thân mật, dịch theo văn phong tiểu thuyết mạng đã xuất bản: tập trung vào cảm xúc, nhịp điệu, hình ảnh ẩn dụ thay vì mô tả trần trụi. Đây là văn phong biên tập chuẩn cho thể loại, không phải yêu cầu né tránh nội dung.', tier: 'pro' });

    // Loaders
    const [importProgress, setImportProgress] = useState<{ current: number; total: number; message: string } | null>(null);
    const [actionProgress, setActionProgress] = useState<{ current: number; total: number; message: string } | null>(null);
    const [nameAnalysisProgress, setNameAnalysisProgress] = useState<{ current: number; total: number; stage: string }>({ current: 0, total: 0, stage: '' });
    
    // Test Model State
    const [testingModelId, setTestingModelId] = useState<string | null>(null);

    // Other UI
    const [coverPreviewUrl, setCoverPreviewUrl] = useState<string | null>(null);
    const [viewOriginalPrompt, setViewOriginalPrompt] = useState<boolean>(false);
    const [dictTab, setDictTab] = useState<'custom' | 'default'>('custom');
    const [quickInput, setQuickInput] = useState('');
    const [isDragging, setIsDragging] = useState(false);
    const [isOptimizingPrompt, setIsOptimizingPrompt] = useState(false);
    const [isGeneratingCover, setIsGeneratingCover] = useState(false);
    const [autoAnalyzeStatus, setAutoAnalyzeStatus] = useState<string>('');

    // Theme Logic
    const toggleDarkMode = () => { const newMode = !isDarkMode; setIsDarkMode(newMode); try { localStorage.setItem(THEME_KEY, newMode ? 'dark' : 'light'); } catch {} };

    // Logging
    const addToast = useCallback((message: string, type: 'success' | 'error' | 'info' | 'warning' = 'info') => {
        const id = crypto.randomUUID();
        setToasts(prev => [...prev, { id, message, type }]);
        setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 5000);
        if (type === 'error' || type === 'success') {
            setSystemLogs(prev => {
                const next = [{ id, timestamp: new Date(), message, type }, ...prev].slice(0, 500);
                // Log lỗi ghi NGAY xuống localStorage (quan trọng nhất, không được mất dù app
                // crash ngay sau đó). Log success ít khẩn cấp hơn, dùng debounce như log thường.
                if (type === 'error') persistLogs(next); else schedulePersistLogs(next);
                return next;
            });
        }
    }, []);

    const addLog = useCallback((message: string, type: 'success' | 'error' | 'info' = 'info') => {
        const id = crypto.randomUUID();
        setSystemLogs(prev => {
            const next = [{ id, timestamp: new Date(), message, type }, ...prev].slice(0, 500);
            if (type === 'error') persistLogs(next); else schedulePersistLogs(next);
            return next;
        });
    }, []);

    const removeToast = useCallback((id: string) => setToasts(prev => prev.filter(t => t.id !== id)), []);
    const clearLogs = useCallback(() => { setSystemLogs([]); clearPersistedLogs(); }, []);

    const hasLogErrors = useMemo(() => systemLogs.some(l => l.type === 'error'), [systemLogs]);
    const isAutoAnalyzing = useMemo(() => !!autoAnalyzeStatus, [autoAnalyzeStatus]);

    return {
        activeTab, setActiveTab,
        isDarkMode, toggleDarkMode,
        showSettings, setShowSettings,
        showLogs, setShowLogs,
        toasts, addToast, removeToast,
        systemLogs, addLog, clearLogs, hasLogErrors,
        showFilterPanel, setShowFilterPanel,
        filterModels, setFilterModels,
        filterStatuses, setFilterStatuses,
        currentPage, setCurrentPage,
        rangeStart, setRangeStart,
        rangeEnd, setRangeEnd,
        selectedFiles, setSelectedFiles,
        lastSelectedId, setLastSelectedId,
        
        // Modals
        editingFileId, setEditingFileId,
        showFindReplace, setShowFindReplace,
        showPasteModal, setShowPasteModal,
        splitterModal, setSplitterModal,
        zipActionModal, setZipActionModal,
        showGuide, setShowGuide,
        showContextBuilder, setShowContextBuilder,
        showSmartStartModal, setShowSmartStartModal,
        smartStartStep, setSmartStartStep,
        autoOptimizePrompt, setAutoOptimizePrompt,
        showStartOptions, setShowStartOptions,
        showNameAnalysisModal, setShowNameAnalysisModal,
        isAnalyzingNames, setIsAnalyzingNames,
        isRefiningContext, setIsRefiningContext,
        showRetranslateModal, setShowRetranslateModal,
        confirmModal, setConfirmModal,
        importModal, setImportModal,
        showChangelog, setShowChangelog,
        showPromptDesigner, setShowPromptDesigner,
        showEpubModal, setShowEpubModal,
        showAutomationModal, setShowAutomationModal,
        showRawDownloadModal, setShowRawDownloadModal,
        
        automationInitialConfig, setAutomationInitialConfig,

        importProgress, setImportProgress,
        actionProgress, setActionProgress,
        nameAnalysisProgress, setNameAnalysisProgress,
        testingModelId, setTestingModelId, // Added

        coverPreviewUrl, setCoverPreviewUrl,
        viewOriginalPrompt, setViewOriginalPrompt,
        dictTab, setDictTab,
        quickInput, setQuickInput,
        isDragging, setIsDragging,
        isOptimizingPrompt, setIsOptimizingPrompt,
        isGeneratingCover, setIsGeneratingCover,
        autoAnalyzeStatus, setAutoAnalyzeStatus,
        isAutoAnalyzing
    };
};
