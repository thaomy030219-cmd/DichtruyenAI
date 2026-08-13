import { useState, useRef, useEffect } from 'react';
import { FileItem, TranslationTier } from '../types';
import { DEFAULT_DICTIONARY } from '../constants';
import { useTranslator } from './useTranslator';
import { useSmartFix } from './useSmartFix';
import { useTitleNormalizer } from './useTitleNormalizer';

export const useTranslationEngine = (core: any, ui: any) => {
    const [isProcessing, setIsProcessing] = useState<boolean>(false);
    const [activeBatches, setActiveBatches] = useState<number>(0);
    const [processingQueue, setProcessingQueue] = useState<string[]>([]);
    const [translationTier, setTranslationTier] = useState<TranslationTier>('normal');
    const [isSmartAutoMode, setIsSmartAutoMode] = useState<boolean>(false);
    const [autoFixEnabled, setAutoFixEnabled] = useState<boolean>(false);
    const [retryTrigger, setRetryTrigger] = useState<number>(0);
    
    const [startTime, setStartTime] = useState<number | null>(null);
    const [endTime, setEndTime] = useState<number | null>(null);
    
    // Refs
    const isFixPhaseRef = useRef<boolean>(false);
    const isProcessingRef = useRef<boolean>(false);
    const runIdRef = useRef<number>(0);
    const filesRef = useRef<FileItem[]>(core.files);
    const scheduledBatchesRef = useRef<Set<string>>(new Set());
    // BUGFIX (bước C): cờ tường minh báo "đang có 1 phiên Sửa Lỗi (Repair) thực sự chạy dưới nền".
    // Khác với state isProcessing (có thể bị các effect khác vô tình set sai/sớm), ref này CHỈ do
    // chính handleFixRemainingRaw bật/tắt, nên executeProcessing() và handleSmartFix() có thể dựa
    // vào đây để biết chắc có nên khởi động phiên mới (và tăng runIdRef) hay không.
    const isRepairRunningRef = useRef<boolean>(false);

    useEffect(() => {
        filesRef.current = core.files;
    }, [core.files]);

    useEffect(() => {
        isProcessingRef.current = isProcessing;
    }, [isProcessing]);

    const effectiveDictionary = core.additionalDictionary ? DEFAULT_DICTIONARY + '\n' + core.additionalDictionary : DEFAULT_DICTIONARY;

    const sharedState = {
        isProcessing, setIsProcessing,
        activeBatches, setActiveBatches,
        processingQueue, setProcessingQueue,
        translationTier, setTranslationTier,
        isSmartAutoMode, setIsSmartAutoMode,
        autoFixEnabled, setAutoFixEnabled,
        retryTrigger, setRetryTrigger,
        startTime, setStartTime,
        endTime, setEndTime,
        isFixPhaseRef, isProcessingRef, runIdRef, filesRef, scheduledBatchesRef,
        isRepairRunningRef,
        effectiveDictionary
    };

    const smartFixFns = useSmartFix(core, ui, sharedState);
    const translatorFns = useTranslator(core, ui, sharedState, smartFixFns);
    const titleNormalizerFns = useTitleNormalizer(core, ui);

    return {
        isProcessing,
        isCustomFixing: smartFixFns.isCustomFixing,
        customFixProgress: smartFixFns.customFixProgress,
        activeBatches,
        processingQueue,
        translationTier,
        setTranslationTier,
        startTime,
        setStartTime,
        endTime,
        setEndTime,
        isSmartAutoMode,
        autoFixEnabled,
        isNormalizingTitles: titleNormalizerFns.isNormalizingTitles,
        
        executeProcessing: translatorFns.executeProcessing,
        stopProcessing: translatorFns.stopProcessing,
        handleRetranslateConfirm: translatorFns.handleRetranslateConfirm,
        
        handleCustomErrorCorrection: smartFixFns.handleCustomErrorCorrection,
        handleAnalyzeCustomError: smartFixFns.handleAnalyzeCustomError,
        stopCustomFixing: smartFixFns.stopCustomFixing,
        handleFixRemainingRaw: smartFixFns.handleFixRemainingRaw,
        handleSmartFix: smartFixFns.handleSmartFix,
        handleManualFixSingle: smartFixFns.handleManualFixSingle,
        
        handleTitleNormalization: async (scope: 'all' | 'selected' = 'all') => {
            setStartTime(Date.now());
            setEndTime(null);
            const res = await titleNormalizerFns.handleTitleNormalization(scope);
            setEndTime(Date.now());
            return res;
        },
        stopTitleNormalization: titleNormalizerFns.stopTitleNormalization
    };
};
