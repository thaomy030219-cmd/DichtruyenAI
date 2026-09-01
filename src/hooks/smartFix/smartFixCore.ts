// Nhóm hàm SMART FIX (Pro Mode): dò và tự sửa các dòng còn sót raw/tiếng Anh
// (handleFixRemainingRaw), và hàm điều phối tổng gom toàn bộ file lỗi/nghi vấn vào hàng đợi
// xử lý lại (handleSmartFix). handleSmartFix có gọi trực tiếp handleFixRemainingRaw ở 1
// nhánh (file lỗi raw nhẹ) nên 2 hàm này được giữ chung 1 file.
import { FileItem, FileStatus, GlobalRepairEntry } from '../../types';
import { performAggregatedRepair, getEffectiveModelsForTier } from '../../geminiService';
import { findLinesWithForeignChars, mergeFixedLines, formatBookStyle, countForeignChars, validateTranslationIntegrity, BATCH_MISSING_TAG_WARNING, attemptFormatMergedParagraphs, detectUnmappedInlineEnglish, applyInlineEnglishFix } from '../../utils/text';

export const useSmartFixCore = (core: any, ui: any, sharedState: any) => {
    const {
        setIsProcessing, setProcessingQueue, setStartTime, setEndTime,
        isFixPhaseRef, scheduledBatchesRef, runIdRef,
        setIsSmartAutoMode, setAutoFixEnabled,
        effectiveDictionary, filesRef, translationTier,
        isRepairRunningRef
    } = sharedState;

    const handleFixRemainingRaw = async (isSmartFixMode: boolean = false) => {
        const myRunId = runIdRef.current;
        let rawTargets = filesRef.current.filter((f: FileItem) => f.status === FileStatus.COMPLETED && f.remainingRawCharCount > 0);
        
        // Bỏ qua các file đã được người dùng tự cứu hộ thủ công
        rawTargets = rawTargets.filter((f: FileItem) => f.usedModel !== 'Thủ công');

        const targets = [...rawTargets];
        if (targets.length === 0) { ui.addToast("Không có file nào cần sửa", 'info'); return; }

        // BUGFIX (bước C): đánh dấu "đang có phiên repair chạy" NGAY khi chắc chắn sẽ chạy thật,
        // để executeProcessing()/handleSmartFix() có thể tự chặn nếu bị gọi chồng trong lúc này.
        isRepairRunningRef.current = true;
        
        setEndTime(null);
        setIsProcessing(true);
        setStartTime(Date.now());
        
        const allBadLines: GlobalRepairEntry[] = [];
        core.setFiles((prev: FileItem[]) => prev.map((f: FileItem) => targets.some(t => t.id === f.id) ? { ...f, status: FileStatus.REPAIRING } : f));
        
        targets.forEach(f => {
            if (f.translatedContent) {
                const rawLines = findLinesWithForeignChars(f.translatedContent);
                const enLines = detectUnmappedInlineEnglish(f.translatedContent, core.additionalDictionary, core.storyInfo?.contextNotes, core.promptTemplate, core.storyInfo?.genres || []);
                
                const addedIndexes = new Set<number>();
                
                rawLines.forEach(l => { 
                    allBadLines.push({ fileId: f.id, lineIndex: l.index, originalLine: l.originalLine }); 
                    addedIndexes.add(l.index);
                });
                
                enLines.forEach(l => {
                    if (!addedIndexes.has(l.lineIndex)) {
                        allBadLines.push({ fileId: f.id, lineIndex: l.lineIndex, originalLine: l.line });
                        addedIndexes.add(l.lineIndex);
                    }
                });
            }
        });

        const taskType = isSmartFixMode ? 'smart_fix' : 'auto_fix';
        const modelsUsed = getEffectiveModelsForTier(translationTier, taskType, core.enabledModels).join(', ');
        
        ui.addToast(`Bắt đầu dò và dịch lại ${allBadLines.length} dòng sót raw/tiếng Anh`, 'info');
        if (isSmartFixMode) {
            ui.addLog(`🔍 Tiến trình Smart Fix (Pro Mode): Tiến hành Autofix sót raw (Eng/CJK) ở ${targets.length} tệp. Tổng cộng ${allBadLines.length} dòng lỗi... (Sử dụng model: ${modelsUsed})`, "info");
        } else {
            ui.addLog(`⚡ Tiến trình Auto-Fix In-stream (Kèm Batch): Tiến hành Autofix sót raw (Eng/CJK) ở ${targets.length} tệp. Tổng cộng ${allBadLines.length} dòng lỗi... (Sử dụng model: ${modelsUsed})`, "info");
        }

        if (allBadLines.length === 0) {
            ui.addToast("Không tìm thấy dòng lỗi cụ thể (có thể do ký tự ẩn).", "warning");
            core.setFiles((prev: FileItem[]) => prev.map((f: FileItem) => f.status === FileStatus.REPAIRING ? { ...f, status: FileStatus.COMPLETED } : f));
            setIsProcessing(false);
            isFixPhaseRef.current = false;
            isRepairRunningRef.current = false;
            return;
        }

        try {
            const hasOpenRouterFile = allBadLines.some(bl => {
                const f = core.files.find((file: FileItem) => file.id === bl.fileId);
                return f?.usedModel?.startsWith('openrouter:');
            });
            let modelsForFix = core.enabledModels;
            if (hasOpenRouterFile && core.openRouterKey && core.openRouterModel) {
                const safetyFallbackSet = new Set<string>();
                safetyFallbackSet.add(`openrouter:${core.openRouterModel}`);
                safetyFallbackSet.add('openrouter:google/gemma-4-26b-a4b-it:free');
                modelsForFix = Array.from(safetyFallbackSet);
            }

            const fixesMap = await performAggregatedRepair(
                allBadLines, effectiveDictionary, translationTier, core.storyInfo.contextNotes, 
                core.storyInfo, core.promptTemplate, (msg) => ui.addLog(msg, 'info'), modelsForFix,
                undefined,
                () => myRunId !== runIdRef.current,
                taskType,
                core.openRouterKey
            );
            
            if (myRunId !== runIdRef.current) { isRepairRunningRef.current = false; return; }

            core.setFiles((prev: FileItem[]) => {
                const newFiles = [...prev];
                fixesMap.forEach((fileFixes, id) => {
                    const fIndex = newFiles.findIndex(f => f.id === id);
                    if (fIndex !== -1 && newFiles[fIndex].translatedContent) {
                        const f = newFiles[fIndex];
                        const fixArray = Array.from(fileFixes.entries()).map(([idx, txt]) => ({ index: idx, text: txt }));
                        const fixedContent = mergeFixedLines(f.translatedContent!, fixArray);
                        const cleanContent = formatBookStyle(fixedContent, f.content, core.storyInfo?.enableTitleFormatting !== false, core.storyInfo?.titleFormat, core.storyInfo?.enableAutoFormat !== false);
                        const cleanContentWithEnFix = applyInlineEnglishFix(cleanContent);
                        const remainingRaw = countForeignChars(cleanContentWithEnFix);
                        newFiles[fIndex] = { ...f, translatedContent: cleanContentWithEnFix, remainingRawCharCount: remainingRaw };
                    }
                });
                return newFiles;
            });
        } catch (e: any) {
            if (myRunId !== runIdRef.current) { isRepairRunningRef.current = false; return; }
            ui.addLog(`❌ Lỗi sửa hàng loạt: ${e.message}`, "error");
        }
        
        if (myRunId !== runIdRef.current) { isRepairRunningRef.current = false; return; }
        core.setFiles((prev: FileItem[]) => prev.map((f: FileItem) => {
            if (f.status === FileStatus.REPAIRING) return { ...f, status: FileStatus.COMPLETED };
            if (f.status === FileStatus.PROCESSING) return { ...f, status: FileStatus.IDLE, errorMessage: "Bị treo (Hệ thống tự động reset)" };
            return f;
        }));
        setIsProcessing(false);
        setIsSmartAutoMode(false);
        setAutoFixEnabled(false);
        setEndTime(Date.now());
        isFixPhaseRef.current = false;
        isRepairRunningRef.current = false;
        ui.addToast("Hoàn tất quy trình Auto-fix sót (Eng/CJK) & Định dạng lại!", 'success');
        
        core.saveSession(true);
    };

    const handleSmartFix = (): boolean => {
        // BUGFIX (bước C): nếu đang có 1 phiên repair thật sự chạy dưới nền, tuyệt đối không cho
        // khởi động phiên mới/tăng runId — chỉ báo cho biết và bỏ qua lần gọi này.
        if (isRepairRunningRef.current) {
            ui.addLog('⏳ Đang có phiên sửa lỗi chạy dở, bỏ qua yêu cầu Smart Fix trùng lặp.', 'info');
            return false;
        }
        // KHÔNG tăng runIdRef ngay ở đây nữa. Trước đây hàm này tăng runId ngay dòng đầu,
        // trước cả khi biết có file lỗi cần sửa hay không -> chỉ cần handleSmartFix() bị gọi lại lần
        // 2 (dù "rỗng", tự return false ngay sau) trong lúc 1 phiên Sửa Lỗi Pro khác đang chạy dở, nó
        // cũng đủ làm đổi runId -> phiên đang chạy tưởng "bị người dùng hủy" (xem repair.ts: so sánh
        // shouldAbort dựa trên runId). Giờ chỉ tăng runId ở đúng 2 nhánh THỰC SỰ khởi động việc mới,
        // phía cuối hàm.
        const hasSelection = ui.selectedFiles && ui.selectedFiles.size > 0;
        
        const targetFiles = core.files.filter((f: FileItem) => {
            if (hasSelection && !ui.selectedFiles.has(f.id)) return false;
            
            const isSuspiciousContentError = f.errorMessage && f.errorMessage.includes('Nghi vấn lỗi nội dung');
            const isSafetyError = f.errorMessage && (f.errorMessage.includes('phân loại riêng') || f.errorMessage.toLowerCase().includes('an toàn') || f.errorMessage.includes('BLOCKLIST') || f.errorMessage.includes('PROHIBITED_CONTENT'));

            if (!hasSelection && f.usedModel === 'Thủ công' && !isSuspiciousContentError && !isSafetyError) return false; // Không gom tệp cứu hộ thủ công
            
            return true;
        });

        const heavyRawFiles = targetFiles.filter((f: FileItem) => {
            if (f.status !== FileStatus.COMPLETED || !f.translatedContent) return false;
            const len = f.translatedContent.length;
            const ratio = len > 0 ? f.remainingRawCharCount / len : 0;
            // Coi là lỗi nặng nếu bị sót quá 100 ký tự CJK, HOẶC tỷ lệ sót > 15% (bắt được file rất ngắn bị sót)
            return f.remainingRawCharCount > 100 || ratio > 0.15;
        });
        
        const suspiciousFiles = targetFiles.filter((f: FileItem) => {
            if (f.status !== FileStatus.COMPLETED || !f.translatedContent) return false;
            if (f.translatedContent.trim() === f.content.trim()) return true;

            if (f.integrityOverrideAccepted) return false;

            const integrity = validateTranslationIntegrity(
                f.content,
                f.translatedContent,
                core.stateRef.current.ratioLimits,
                core.stateRef.current.storyInfo.languages
            );

            return !integrity.isValid;
        });

        const stuckFiles = targetFiles.filter((f: FileItem) => f.status === FileStatus.PROCESSING || f.status === FileStatus.REPAIRING);
        // DO NOT AUTOMATICALLY RE-QUEUE errorFiles infinitely. Only requeue if they haven't been heavily retried inside smart auto logic
        // Bắt buộc lấy file "Nghi vấn" dù đã thử quá giới hạn
        const errorFiles = targetFiles.filter((f: FileItem) => {
            const isSpecialError = f.errorMessage && (f.errorMessage.includes('Nghi vấn lỗi nội dung') || f.errorMessage.toLowerCase().includes('an toàn') || f.errorMessage.includes('BLOCKLIST') || f.errorMessage.includes('PROHIBITED_CONTENT') || f.errorMessage.toLowerCase().includes('safety'));
            if (f.status === FileStatus.ERROR && ((f.retryCount || 0) < 4 || isSpecialError)) return true;
            if (f.status === FileStatus.IDLE && isSpecialError) return true;
            return false;
        });
        const giveUpErrorFiles = targetFiles.filter((f: FileItem) => f.status === FileStatus.ERROR && (f.retryCount || 0) >= 4 && !(f.errorMessage && f.errorMessage.includes('Nghi vấn lỗi nội dung')) && !f.errorMessage?.includes("Nên dùng cứu hộ"));
        const lightRawFiles = targetFiles.filter((f: FileItem) => {
            if (f.status !== FileStatus.COMPLETED || !f.translatedContent) return false;
            const len = f.translatedContent.length;
            const ratio = len > 0 ? f.remainingRawCharCount / len : 0;
            return f.remainingRawCharCount > 0 && f.remainingRawCharCount <= 100 && ratio <= 0.15;
        });

        const mergedWarningFiles = targetFiles.filter((f: FileItem) => 
            f.status === FileStatus.COMPLETED && f.translatedContent && (
                f.translatedContent.includes(BATCH_MISSING_TAG_WARNING) ||
                (f.content.split('\n').length > 5 && f.translatedContent.split('\n').length <= 2 && f.translatedContent.length > 300)
            )
        );

        if (heavyRawFiles.length === 0 && suspiciousFiles.length === 0 && stuckFiles.length === 0 && errorFiles.length === 0 && lightRawFiles.length === 0 && mergedWarningFiles.length === 0) {
            ui.addToast("Không còn gì để hậu kiểm — bản dịch hiện không phát hiện lỗi cần xử lý.", "success");
            return false;
        }

        const queueIds: string[] = [];
        
        // Try to format merged files locally first
        const unformattableMergedFiles: FileItem[] = [];
        let formattedCount = 0;
        
        if (mergedWarningFiles.length > 0) {
            core.setFiles((prev: FileItem[]) => {
                const newFiles = [...prev];
                for (const f of mergedWarningFiles) {
                    const formatted = attemptFormatMergedParagraphs(f.content, f.translatedContent!);
                    if (formatted) {
                        const fIndex = newFiles.findIndex(nf => nf.id === f.id);
                        if (fIndex !== -1) {
                            newFiles[fIndex] = { ...newFiles[fIndex], translatedContent: formatted, status: FileStatus.COMPLETED };
                            formattedCount++;
                        }
                    } else {
                        unformattableMergedFiles.push(f);
                    }
                }
                return newFiles;
            });
        }
        
        if (formattedCount > 0) {
            ui.addToast(`Đã tự động định dạng lại ${formattedCount} file bị gộp chương.`, "success");
            ui.addLog(`✨ Smart Fix: Tự động tách đoạn thành công ${formattedCount} file bị gộp.`, "success");
        }

        // Only queue targets that haven't been retried infinitely in SmartFix loops
        const validRetranslateTargets = [...heavyRawFiles, ...suspiciousFiles, ...unformattableMergedFiles].filter(f => (f.retryCount || 0) < 4);
        const giveUpRetranslateTargets = [...heavyRawFiles, ...suspiciousFiles, ...unformattableMergedFiles].filter(f => (f.retryCount || 0) >= 4 && !f.errorMessage?.includes("Nên dùng cứu hộ"));

        const uniqueRetranslateIds = new Set(validRetranslateTargets.map(f => f.id));
        
        if (uniqueRetranslateIds.size > 0) {
            core.setFiles((prev: FileItem[]) => prev.map((f: FileItem) => uniqueRetranslateIds.has(f.id) ? { ...f, status: FileStatus.IDLE, translatedContent: null, hasStaleTranslation: false, remainingRawCharCount: 0, retryCount: (f.retryCount || 0) + 1, usedModel: undefined, errorMessage: "Smart Fix: Auto Re-queue (Raw/Ratio/Merged)" } : f));
            queueIds.push(...Array.from(uniqueRetranslateIds));
        }

        const resetTargets = [...stuckFiles, ...errorFiles];
        const uniqueResetIds = new Set(resetTargets.map(f => f.id));
        if (uniqueResetIds.size > 0) {
            core.setFiles((prev: FileItem[]) => prev.map((f: FileItem) => {
                if (uniqueResetIds.has(f.id)) {
                    const isSpecialError = f.errorMessage && (f.errorMessage.includes('Nghi vấn lỗi nội dung') || f.errorMessage.toLowerCase().includes('an toàn') || f.errorMessage.includes('BLOCKLIST') || f.errorMessage.includes('PROHIBITED_CONTENT') || f.errorMessage.toLowerCase().includes('safety'));
                    return { ...f, status: FileStatus.IDLE, usedModel: undefined, retryCount: isSpecialError ? 0 : (f.retryCount || 0) + 1, errorMessage: undefined, translatedContent: null, hasStaleTranslation: false, remainingRawCharCount: 0 };
                }
                return f;
            }));
            queueIds.push(...Array.from(uniqueResetIds));
        }

        const allGiveUpFiles = [...giveUpErrorFiles, ...giveUpRetranslateTargets];
        if (allGiveUpFiles.length > 0) {
            const giveUpIds = new Set(allGiveUpFiles.map(f => f.id));
            core.setFiles((prev: FileItem[]) => prev.map((f: FileItem) => giveUpIds.has(f.id) ? { ...f, status: FileStatus.ERROR, errorMessage: (f.errorMessage || 'Lỗi ratio/gộp đoạn') + " - Nên dùng cứu hộ hoặc dịch thủ công" } : f));
        }

        if (queueIds.length > 0) {
            runIdRef.current += 1; // Chỉ tăng khi thực sự bắt đầu 1 phiên sửa lỗi mới
            ui.addToast(`Tiến trình Smart Fix (Pro Mode): Bắt đầu xử lý ${queueIds.length} file lỗi/nghi vấn...`, 'warning');
            ui.addLog(`🔍 Tiến trình Smart Fix (Pro Mode): Đã gom và nối tiếp ${queueIds.length} file bị lỗi/nghi vấn vào hàng đợi.`, 'info');
            const uniqueQueue = Array.from(new Set(queueIds));
            scheduledBatchesRef.current.clear();
            setProcessingQueue(uniqueQueue);
            setStartTime(Date.now());
            setEndTime(null);
            setIsProcessing(true);
            setIsSmartAutoMode(true);
            setAutoFixEnabled(true);
            isFixPhaseRef.current = true;
            return true;
        } else if (lightRawFiles.length > 0) {
            runIdRef.current += 1; // Chỉ tăng khi thực sự bắt đầu 1 phiên sửa lỗi mới
            setIsSmartAutoMode(true);
            setAutoFixEnabled(true);
            isFixPhaseRef.current = true;
            handleFixRemainingRaw(true);
            return true;
        } else if (formattedCount > 0) {
            core.saveSession(true);
            return false;
        }
        return false;
    };

    return { handleFixRemainingRaw, handleSmartFix };
};
