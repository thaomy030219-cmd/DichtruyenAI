import { useEffect, useCallback } from 'react';
import { FileItem, FileStatus, TranslationTier } from '../types';
import { translateBatchStream, getEffectiveModelsForTier } from '../geminiService';
import { BATCH_MISSING_TAG_WARNING, countForeignChars, formatBookStyle, validateTranslationIntegrity, fixMergedTitle, applyInlineEnglishFix, proofreadVietnamese } from '../utils/text';
import { quotaManager } from '../utils/quotaManager';
import { getRescueTarget, getRescueBudget, getRescueLabel } from '../services/workflows/translate/rescueTarget';
import { stripTitleAnchor } from '../utils/fileHelpers';

// FIX (starvation hàng chờ): trước đây MỌI tệp lỗi (kể cả tệp vừa bị "cách ly để kiểm tra
// riêng" hoặc đã xác nhận cần "Bàn giao OpenRouter") đều bị xếp chung xuống TẬN CUỐI
// hàng chờ giống như các tệp lỗi thường/"vạ lây". Với hàng chờ dài (hàng trăm tệp), điều này
// khiến các tệp cần cứu hộ có thể không bao giờ được thử lại riêng lẻ (batch 1 tệp qua
// OpenRouter) trước khi hết Quota hoặc hết phiên làm việc - dù đã add đủ API Key.
// Hàm này đưa các tệp "ưu tiên" (priorityIds) lên ĐẦU hàng chờ, các tệp lỗi thường còn lại vẫn
// giữ nguyên hành vi cũ (xuống cuối), để chúng được xử lý ngay ở lượt gom batch kế tiếp.
const reorderQueueWithPriority = (prev: string[], retryingIds: string[], priorityIds: Set<string>): string[] => {
    if (retryingIds.length === 0) return prev;
    const priority = retryingIds.filter(id => priorityIds.has(id));
    const normal = retryingIds.filter(id => !priorityIds.has(id));
    if (priority.length === 0) {
        // Không có tệp ưu tiên nào - giữ nguyên hành vi cũ (toàn bộ xuống cuối)
        const otherIds = prev.filter(id => !retryingIds.includes(id));
        return [...otherIds, ...normal];
    }
    const otherIds = prev.filter(id => !retryingIds.includes(id));
    return [...priority, ...otherIds, ...normal];
};

export const useTranslator = (
    core: any,
    ui: any,
    sharedState: any,
    smartFixFns: any
) => {
    const {
        isProcessing, setIsProcessing,
        activeBatches, setActiveBatches,
        processingQueue, setProcessingQueue,
        translationTier, setTranslationTier,
        startTime, setStartTime,
        setEndTime,
        isSmartAutoMode, setIsSmartAutoMode,
        autoFixEnabled, setAutoFixEnabled,
        retryTrigger, setRetryTrigger,
        isFixPhaseRef, scheduledBatchesRef, runIdRef, isProcessingRef,
        effectiveDictionary, filesRef, isRepairRunningRef
    } = sharedState;

    const { handleSmartFix, handleFixRemainingRaw } = smartFixFns;

    const processBatch = useCallback(async (batchIds: string[], tier: TranslationTier, myRunId: number) => {
        if (!isProcessing || myRunId !== runIdRef?.current) return;
        
        const batchFiles = filesRef?.current.filter((f: FileItem) => batchIds.includes(f.id));
        if (batchFiles.length === 0) return;

        const firstFileName = batchFiles[0].name;
        const lastFileName = batchFiles[batchFiles.length - 1].name;
        const batchStartTime = Date.now();
        
        const isSafeRebatch = batchFiles.every(f => (f as any).isSafeRebatch);
        if (isSafeRebatch) {
             ui.addLog(`✅ Bắt đầu dịch lại gộp (Batch) ${batchFiles.length} tệp an toàn qua Gemini...`, 'success');
             // remove flag to not print this again if it fails for other reasons later
             core.setFiles((prev: FileItem[]) => prev.map((f: FileItem) => 
                batchIds.includes(f.id) ? { ...f, isSafeRebatch: false } as FileItem : f
             ));
        } else {
             ui.addLog(`🚀 Bắt đầu dịch Batch gồm ${batchFiles.length} tệp (từ ${firstFileName} đến ${lastFileName})`, 'info');
        }

        const inputs = batchFiles.map(f => ({ id: f.id, content: f.content, name: f.name, fileRetryCount: f.retryCount || 0, errorMessage: f.errorMessage }));
        
        core.setFiles((prev: FileItem[]) => prev.map((f: FileItem) => 
            batchIds.includes(f.id) ? { ...f, status: FileStatus.PROCESSING, usedModel: undefined } : f
        ));
        
        try {
            if (myRunId !== runIdRef?.current) return;

            // Throttled updater to prevent React crash from too many state updates during streaming
            const pendingUpdates = new Map<string, string>();
            let updateTimeout: any = null;
            const flushUpdates = () => {
                if (pendingUpdates.size > 0 && myRunId === runIdRef?.current) {
                    const updates = new Map(pendingUpdates);
                    pendingUpdates.clear();
                    core.setFiles((prev: FileItem[]) => prev.map((f: FileItem) => 
                        updates.has(f.id) ? { ...f, translatedContent: updates.get(f.id)! } : f
                    ));
                }
                updateTimeout = null;
            };

            const resultsMap = await translateBatchStream(
                inputs,
                core.promptTemplate,
                effectiveDictionary,
                core.storyInfo.contextNotes,
                core.enabledModels,
                "", // previousBatchContext
                (fileId, partialContent) => {
                    if (myRunId === runIdRef?.current) {
                        // Không để lộ marker nội bộ "__TITLE_ANCHOR__:" ra bản xem trước lúc đang
                        // dịch (streaming) - marker chỉ được formatBookStyle lọc bỏ khi batch dịch
                        // xong hẳn (dòng ~239), nên nếu không lọc ở đây, người dùng đang theo dõi
                        // trực tiếp có thể thoáng thấy dòng "__TITLE_ANCHOR__: ..." vài trăm ms
                        // trước khi batch hoàn tất.
                        pendingUpdates.set(fileId, stripTitleAnchor(partialContent));
                        if (!updateTimeout) {
                            updateTimeout = setTimeout(flushUpdates, 500); // 500ms throttle
                        }
                    }
                }, // onUpdate
                (msg) => { if (myRunId === runIdRef?.current) ui.addLog(msg, 'info'); },
                tier,
                core.enabledModels,
                core.stateRef.current.storyInfo,
                undefined, // preferredModelId
                () => myRunId !== runIdRef?.current, // shouldAbort
                core.stateRef.current.ratioLimits,
                core.openRouterKey,
                core.openRouterModel
            );
            
            // Flush any remaining updates
            if (updateTimeout) {
                clearTimeout(updateTimeout);
                flushUpdates();
            }
            
            if (myRunId !== runIdRef?.current) return;
            const batchEndTime = Date.now();
            const processingDuration = batchEndTime - batchStartTime;

            let successCount = 0;
            const ratioErrorFiles: string[] = [];
            const missingResultFiles: string[] = [];
            // Tệp cần được xử lý ƯU TIÊN ở lượt gom batch kế tiếp (xem reorderQueueWithPriority
            // ở đầu file) - gồm tệp vừa bị "cách ly để kiểm tra riêng" và tệp vừa được xác nhận
            // "Bàn giao OpenRouter", để chúng không bị chôn ở cuối hàng chờ dài.
            const priorityRetryIds = new Set<string>();

            // FIX (cách ly quá gắt khi cắt ngang giữa batch): trước đây nếu batch bị cắt ngang bởi
            // bộ lọc an toàn ở 1 tệp giữa chừng (ví dụ tệp 51/60), TOÀN BỘ các tệp phía sau (chưa
            // kịp dịch vì stream đã dừng) chỉ bị gắn nhãn chung "vạ lây" và đưa lại hàng chờ mà
            // không hề được kiểm tra riêng nội dung của chính chúng - khiến các tệp thực sự có vấn
            // đề (nếu có) không bao giờ kích hoạt được cơ chế cứu hộ (OpenRouter), cứ dịch
            // lại với Gemini vô thời hạn. Ở đây ta quét TRƯỚC (bằng testContentSafety, giống hệt cơ
            // chế đã có sẵn cho trường hợp cả batch rỗng hoàn toàn) cho từng tệp "vạ lây" này, để
            // phân biệt: tệp nào tự nó nghi vấn vi phạm -> bàn giao thẳng cho vệ tinh cứu hộ; tệp
            // nào an toàn -> giữ nguyên hành vi cũ (trả lại hàng chờ dịch bình thường, không tính
            // thêm retryCount).
            const tailSafetyScan = new Map<string, { isUnsafe: boolean; modelUsed: string }>();
            {
                const missingIdsInOrder = batchIds.filter(id => !resultsMap.results.has(id));
                if (missingIdsInOrder.length > 1 && myRunId === runIdRef?.current) {
                    const globalStreamErr = (resultsMap as any).streamError;
                    const firstMissingId = missingIdsInOrder[0];
                    const firstSpecificErr = ((resultsMap as any).errors?.get(firstMissingId) || '') as string;
                    const streamErrStr = (globalStreamErr?.message || firstSpecificErr).toLowerCase();
                    const isQuotaErrorMsg = streamErrStr.includes("429") || streamErrStr.includes("quota");
                    const isSafetyCutoff = !isQuotaErrorMsg && (streamErrStr.includes("bộ lọc an toàn") || streamErrStr.includes("safety") || streamErrStr.includes("blocklist") || streamErrStr.includes("prohibited_content"));

                    if (isSafetyCutoff) {
                        const tailIds = missingIdsInOrder.slice(1); // tệp đầu tiên đã có luồng cách ly-thử-lại-riêng của chính nó
                        if (tailIds.length > 0) {
                            ui.addLog(`🔍 Batch bị cắt ngang giữa chừng, nghi do bộ lọc an toàn. Đang quét trước nội dung ${tailIds.length} tệp "vạ lây" (chưa kịp dịch) trước khi đưa lại hàng chờ...`, 'info');
                            try {
                                const { testContentSafety } = await import('../services/workflows/translator');
                                for (const tailId of tailIds) {
                                    if (myRunId !== runIdRef?.current) break;
                                    const tf = batchFiles.find((x: FileItem) => x.id === tailId);
                                    if (!tf) continue;
                                    await new Promise(r => setTimeout(r, 1500)); // tránh dồn dập request quét, giống luồng quét cả-batch-rỗng
                                    const scan = await testContentSafety(tf.content, core.enabledModels);
                                    tailSafetyScan.set(tailId, { isUnsafe: !scan.isSafe, modelUsed: scan.modelUsed });
                                    if (!scan.isSafe) {
                                        ui.addLog(`🚨 Tệp ${tf.name} (vạ lây) thực chất TỰ nó nghi vấn vi phạm bộ lọc an toàn (Quét bởi ${scan.modelUsed})!`, 'warning');
                                    }
                                }
                                if (tailSafetyScan.size > 0) {
                                    const unsafeCount = Array.from(tailSafetyScan.values()).filter(v => v.isUnsafe).length;
                                    ui.addLog(`📊 Kết quả quét trước tệp vạ lây: ${unsafeCount} tệp nghi vấn, ${tailSafetyScan.size - unsafeCount} tệp an toàn.`, 'info');
                                }
                            } catch (scanErr: any) {
                                ui.addLog(`⚠️ Không quét trước được an toàn cho các tệp vạ lây (${scanErr?.message || 'lỗi không xác định'}) - giữ hành vi cũ (đưa lại hàng chờ dịch bình thường).`, 'warning');
                            }
                        }
                    }
                }
            }

            // Hậu kiểm chính tả chạy offline cho mọi model trước khi lưu kết quả.
            // Chỉ tải từ điển ở batch đầu tiên; trình duyệt sẽ cache cho các batch sau.
            const proofreadResults = new Map<string, Awaited<ReturnType<typeof proofreadVietnamese>>>();
            const protectedSources = [core.additionalDictionary || '', core.storyInfo?.contextNotes || ''];
            await Promise.all(Array.from(resultsMap.results.entries()).map(async ([id, content]) => {
                if (content) proofreadResults.set(id, await proofreadVietnamese(content, protectedSources));
            }));

            core.setFiles((prev: FileItem[]) => {
                const newFiles = [...prev];
                let hasChanges = false;
                
                const flaggedStaleIds: Set<string> = (resultsMap as any).flaggedStaleIds || new Set();

                batchIds.forEach(id => {
                    const fIndex = newFiles.findIndex(f => f.id === id);
                    if (fIndex !== -1) {
                        const f = newFiles[fIndex];

                        // Hậu kiểm (Tier 1/2 - validateBatch/validateBatchWithAI) đã nghi vấn bản dịch
                        // này, nhưng KHÔNG xoá nội dung dịch được nữa - giữ lại để xem xét, gắn cờ lỗi,
                        // và đẩy xuống cuối hàng chờ (qua ratioErrorFiles bên dưới). Bản dịch nghi vấn
                        // này sẽ tự động bị ghi đè khi lần dịch lại kế tiếp thành công.
                        if (flaggedStaleIds.has(id) && resultsMap.results.has(id)) {
                            const staleContent = resultsMap.results.get(id) || f.translatedContent;
                            const specificErr = (resultsMap as any).errors?.get(id) || "Nghi vấn lỗi nội dung (hậu kiểm)";
                            ratioErrorFiles.push(f.name);
                            const maxRetries = isFixPhaseRef?.current ? 1 : 2;
                            if ((f.retryCount || 0) < maxRetries) {
                                newFiles[fIndex] = {
                                    ...f,
                                    status: FileStatus.IDLE,
                                    translatedContent: staleContent,
                                    hasStaleTranslation: true,
                                    errorMessage: `${specificErr} - Đang thử lại (${(f.retryCount || 0) + 1}/${maxRetries})`,
                                    retryCount: (f.retryCount || 0) + 1,
                                    processingDuration
                                };
                            } else {
                                newFiles[fIndex] = {
                                    ...f,
                                    status: FileStatus.ERROR,
                                    translatedContent: staleContent,
                                    hasStaleTranslation: true,
                                    errorMessage: specificErr,
                                    processingDuration
                                };
                            }
                            hasChanges = true;
                            return;
                        }

                        if (resultsMap.results.has(id)) {
                            const resultText = resultsMap.results.get(id);
                            if (resultText) {
                                const proofread = proofreadResults.get(id);
                                const finalContent = proofread?.text || resultText;
                                const fixedContent = fixMergedTitle(finalContent);
                                const cleanContent = applyInlineEnglishFix(formatBookStyle(fixedContent, f.content, core.storyInfo?.enableTitleFormatting !== false, core.storyInfo?.titleFormat, core.storyInfo?.enableAutoFormat !== false));
                                const remainingRaw = countForeignChars(cleanContent);
                                
                                const integrity = validateTranslationIntegrity(f.content, cleanContent, core.stateRef.current.ratioLimits, core.stateRef.current.storyInfo?.languages, resultsMap.model || f.usedModel);
                                
                                let status = FileStatus.COMPLETED;
                                let errorMessage: string | undefined = undefined;
                                let ratioWarning: string | undefined = undefined;
                                
                                if (!integrity.isValid) {
                                    ratioErrorFiles.push(f.name);
                                    const maxRetries = isFixPhaseRef?.current ? 1 : 2;
                                    if ((f.retryCount || 0) < maxRetries) {
                                        status = FileStatus.IDLE;
                                        errorMessage = `${integrity.reason} - Đang thử lại (${(f.retryCount || 0) + 1}/${maxRetries})`;
                                    } else {
                                        status = FileStatus.ERROR;
                                        errorMessage = integrity.reason;
                                    }
                                } else if (cleanContent.includes(BATCH_MISSING_TAG_WARNING)) {
                                    errorMessage = "Cảnh báo: Thiếu thẻ kết thúc trong batch";
                                    successCount++;
                                } else {
                                    if (integrity.reason) {
                                        ratioWarning = integrity.reason;
                                    }
                                    successCount++;
                                }
                                
                                newFiles[fIndex] = { 
                                    ...f, 
                                    status: status, 
                                    translatedContent: cleanContent, 
                                    // File này vừa nhận được nội dung dịch mới (dù đạt hay chưa đạt ratio),
                                    // nên bản dịch nghi vấn cũ (nếu có) coi như đã bị thay thế - reset cờ.
                                    hasStaleTranslation: false,
                                    remainingRawCharCount: remainingRaw,
                                    spellingCorrectionCount: proofread?.correctedCount || 0,
                                    spellingSuspicionCount: proofread?.suspiciousCount || 0,
                                    usedModel: resultsMap.model,
                                    errorMessage: errorMessage,
                                    processingDuration: processingDuration,
                                    retryCount: status === FileStatus.IDLE ? (f.retryCount || 0) + 1 : f.retryCount,
                                    integrityRatio: integrity.ratio,
                                    isFragmentedSource: integrity.isFragmentedSource || f.isFragmentedSource,
                                    ratioWarning: ratioWarning || undefined
                                };
                                hasChanges = true;
                            } else {
                                missingResultFiles.push(f.name);
                                const maxRetries = isFixPhaseRef?.current ? 1 : 2;
                                const specificErr = (resultsMap as any).errors?.get(id) || "Lỗi không xác định từ API";
                                // Không nhận được nội dung gì cho lần thử này - giữ nguyên translatedContent
                                // cũ (có thể là bản dịch nghi vấn từ lần hậu kiểm trước) thay vì xoá trắng.
                                if ((f.retryCount || 0) < maxRetries) {
                                    newFiles[fIndex] = { ...f, status: FileStatus.IDLE, translatedContent: f.translatedContent, errorMessage: `${specificErr} - Đang thử lại (${(f.retryCount || 0) + 1}/${maxRetries})`, retryCount: (f.retryCount || 0) + 1 };
                                } else {
                                    newFiles[fIndex] = { ...f, status: FileStatus.ERROR, translatedContent: f.translatedContent, errorMessage: specificErr };
                                }
                                hasChanges = true;
                            }
                        } else {
                            missingResultFiles.push(f.name);
                            const maxRetries = isFixPhaseRef?.current ? 1 : 2;
                            
                            let specificErr = (resultsMap as any).errors?.get(id) || "Không nhận được kết quả cho file này";
                            let shouldIncrementRetry = true;

                            if ((resultsMap as any).streamError || specificErr.includes("Thiếu kết quả từ API") || specificErr.includes("Lỗi ngắt kết nối API")) {
                                const streamErrStr = ((resultsMap as any).streamError?.message || specificErr).toLowerCase();
                                const isQuotaErrorMsg = streamErrStr.includes("429") || streamErrStr.includes("quota");
                                const isSafetyError = !isQuotaErrorMsg && (streamErrStr.includes("bộ lọc an toàn") || streamErrStr.includes("safety") || streamErrStr.includes("blocklist") || streamErrStr.includes("prohibited_content"));
                                
                                if (missingResultFiles.length === 1) { // First file missing
                                    specificErr = isSafetyError ? "Nghi vấn lỗi nội dung nhạy cảm - Đang cách ly để kiểm tra riêng" : "Nghi vấn lỗi nội dung hoặc format - Đang cách ly để kiểm tra riêng";
                                    priorityRetryIds.add(id);
                                } else {
                                    // Đã quét trước (tailSafetyScan) cho tệp "ăn theo" này chưa, và nếu có,
                                    // chính nội dung của nó có thực sự nghi vấn hay không (xem khối quét
                                    // trước core.setFiles ở trên). Nếu nghi vấn thật -> xử lý y hệt 1 tệp
                                    // đã xác nhận unsafe: bàn giao thẳng cho vệ tinh cứu hộ thay vì tiếp
                                    // tục "vạ lây" chờ dịch lại với Gemini vô thời hạn.
                                    const tailScan = tailSafetyScan.get(id);
                                    if (tailScan?.isUnsafe) {
                                        const hasOR = !!(core.openRouterKey && core.openRouterKey.trim().length > 0);
                                        const target = getRescueTarget(f.retryCount || 0, hasOR, maxRetries);
                                        if (target) {
                                            const rescueBudget = getRescueBudget(hasOR, maxRetries);
                                            const errMsg = `Nghi vấn lỗi nội dung nhạy cảm (quét trước) - Bàn giao ${getRescueLabel(target)} (${(f.retryCount || 0) + 1}/${rescueBudget})`;
                                            newFiles[fIndex] = { ...f, status: FileStatus.IDLE, translatedContent: f.translatedContent, errorMessage: errMsg, retryCount: (f.retryCount || 0) + 1 } as any;
                                            priorityRetryIds.add(id);
                                        } else {
                                            const reason = hasOR ? "Đã hết lượt cứu hộ OpenRouter" : "Không có OpenRouter dự phòng";
                                            newFiles[fIndex] = { ...f, status: FileStatus.ERROR, translatedContent: f.translatedContent, errorMessage: `Bị chặn bởi Safety Filter (quét trước) (${reason})` };
                                        }
                                        hasChanges = true;
                                        return;
                                    }
                                    specificErr = "Chờ thử lại do vạ lây từ file lỗi trong batch";
                                    shouldIncrementRetry = false; 
                                }
                            }

                            // Không nhận được nội dung gì cho lần thử này - giữ nguyên translatedContent
                            // cũ (có thể là bản dịch nghi vấn từ lần hậu kiểm trước) thay vì xoá trắng.
                            if ((f.retryCount || 0) < maxRetries) {
                                const newRetryCount = shouldIncrementRetry ? (f.retryCount || 0) + 1 : (f.retryCount || 0);
                                newFiles[fIndex] = { ...f, status: FileStatus.IDLE, translatedContent: f.translatedContent, errorMessage: shouldIncrementRetry ? `${specificErr} - Đang thử lại (${newRetryCount}/${maxRetries})` : specificErr, retryCount: newRetryCount, isSafeRebatch: !shouldIncrementRetry } as any;
                            } else {
                                newFiles[fIndex] = { ...f, status: FileStatus.ERROR, translatedContent: f.translatedContent, errorMessage: specificErr };
                            }
                            hasChanges = true;
                        }
                    }
                });
                return hasChanges ? newFiles : prev;
            });

            if (myRunId === runIdRef?.current) {
                setProcessingQueue(prev => {
                    if (missingResultFiles.length > 0 || ratioErrorFiles.length > 0) {
                        const failedNames = [...missingResultFiles, ...ratioErrorFiles];
                        const retryingIds = batchIds.filter(id => {
                            const f = filesRef.current.find(x => x.id === id);
                            return f && failedNames.includes(f.name);
                        });
                        if (retryingIds.length > 0) {
                            return reorderQueueWithPriority(prev, retryingIds, priorityRetryIds);
                        }
                    }
                    return prev;
                });
                
                const durationStr = (processingDuration / 1000).toFixed(1);
                
                const finalErrorFiles = batchFiles.filter(f => {
                    const updated = filesRef?.current.find((x: FileItem) => x.id === f.id);
                    return updated && updated.status === FileStatus.ERROR;
                }).map(f => f.name);
                
                const retryingFiles = batchFiles.filter(f => {
                    const updated = filesRef?.current.find((x: FileItem) => x.id === f.id);
                    return updated && updated.status === FileStatus.IDLE;
                }).map(f => f.name);
                
                let icon = '✅';
                let logLevel: 'success'|'warning'|'error' = 'success';
                
                if (successCount === batchFiles.length) {
                    icon = '✅';
                    logLevel = 'success';
                } else if (successCount > 0) {
                    icon = '⚠️';
                    logLevel = 'warning';
                } else {
                    icon = '❌';
                    logLevel = 'error';
                }
                
                let logMsg = `${icon} Batch ${batchFiles.length} tệp (${firstFileName} → ${lastFileName}) | ${durationStr}s | `;
                logMsg += `✓${successCount} `;
                
                if (finalErrorFiles.length > 0) {
                    logMsg += `| ❌ Thất bại (${finalErrorFiles.length}): ${finalErrorFiles.join(', ')} `;
                }
                
                if (retryingFiles.length > 0) {
                    logMsg += `| 🔄 Đang thử lại (${retryingFiles.length}): ${retryingFiles.join(', ')}`;
                }
                
                ui.addLog(logMsg, logLevel);

                // FIX (giảm rủi ro "mất trắng dữ liệu"): trước đây chỉ lưu tự động mỗi 2 phút
                // (hẹn giờ) hoặc khi TOÀN BỘ hàng đợi dịch xong. Với các job dịch dài (hàng chục,
                // hàng trăm file), nếu app bị crash/đóng đột ngột giữa chừng, mọi tiến độ đã dịch
                // xong nhưng chưa tới mốc lưu định kỳ sẽ mất hết, khiến người dùng thấy "về như
                // mới". Gọi lưu (không ép buộc, không chặn UI) ngay sau MỖI batch nhỏ hoàn tất để
                // thu hẹp cửa sổ mất dữ liệu xuống chỉ còn ~1 batch nhỏ thay vì cả job.
                core.saveSession();
                
                if (retryingFiles.length > 0) {
                    retryingFiles.forEach(name => {
                        const f = filesRef?.current.find((x: FileItem) => x.name === name);
                        if (f && f.errorMessage) {
                            ui.addLog(`  🔄 [Thử lại] ${name}: ratio=${f.integrityRatio?.toFixed(2) ?? '?'} | ${f.errorMessage}`, 'warning');
                        }
                    });
                }
                
                if (finalErrorFiles.length > 0) {
                    finalErrorFiles.forEach(name => {
                        const f = filesRef?.current.find((x: FileItem) => x.name === name);
                        if (f && f.errorMessage) {
                            ui.addLog(`  ❌ [Lỗi] ${name}: ratio=${f.integrityRatio?.toFixed(2) ?? '?'} | ${f.errorMessage}`, 'error');
                        }
                    });
                }
            }

        } catch (error: any) {
            if (myRunId !== runIdRef?.current || error.message === 'ABORTED') return;
            const isAllQuotaExhausted = error.message.includes("Tất cả model khả dụng đã hết Quota hoặc bị tắt") || error.message.includes("Tất cả model đã thử đều gặp lỗi hoặc hết Quota");
            const isQuotaError = error.message.includes("429") || error.message.toLowerCase().includes("quota");
            const isSafetyError = !isAllQuotaExhausted && !isQuotaError && (error.message.includes("bộ lọc an toàn") || error.message.toLowerCase().includes("safety") || error.message.includes("BLOCKLIST") || error.message.includes("PROHIBITED_CONTENT"));
            
            const shouldScanAndIsolate = isSafetyError;
            
            if (shouldScanAndIsolate) {
                ui.addLog(`⚠️ Bị chặn bởi Safety Filter. Đang xác định các tệp vi phạm...`, "warning");
                
                const unsafeIds = new Set<string>();
                
                try {
                    const { testContentSafety } = await import('../services/workflows/translator');
                    
                    let needsIndividualScan = true;
                    if (batchFiles.length > 1) {
                        ui.addLog(`🔍 Đang quét sơ bộ bộ lọc an toàn cho toàn bộ Batch (${batchFiles.length} tệp)...`, 'info');
                        const fullBatchContent = batchFiles.map(f => f.content).join('\n\n');
                        const scanResult = await testContentSafety(fullBatchContent, core.enabledModels);
                        
                        if (scanResult.modelUsed && scanResult.modelUsed !== 'error' && !scanResult.modelUsed.includes('unknown')) {
                            // Usage is now recorded inside testContentSafety
                        }

                        const isBatchUnsafe = !scanResult.isSafe;
                        
                        if (!isBatchUnsafe) {
                            ui.addLog(`✅ Toàn batch an toàn (Quét bởi ${scanResult.modelUsed}). Lỗi có thể do ngắt kết nối (bảng thông tin, format).`, 'info');
                            needsIndividualScan = false;
                        } else {
                            ui.addLog(`⚠️ Phát hiện nội dung vi phạm trong Batch (Quét bởi ${scanResult.modelUsed}). Đang dò tìm tệp lỗi cụ thể...`, 'warning');
                        }
                    }

                    if (needsIndividualScan) {
                        for (const f of batchFiles) {
                            let isUnsafe = false;
                            
                            // Nếu batch chỉ có 1 file và bị lỗi safety từ API dịch, chắc chắn file này là nguyên nhân!
                            if (batchFiles.length === 1 && isSafetyError) {
                                isUnsafe = true;
                                ui.addLog(`🔍 Tệp ${f.name} là nguyên nhân gây lỗi Safety.`, 'info');
                            } else {
                                ui.addLog(`🔍 Kiểm tra an toàn tệp: ${f.name}...`, 'info');
                                // Add delay BEFORE individual scan to avoid overwhelming quota
                                await new Promise(r => setTimeout(r, 2000));
                                
                                const individualScan = await testContentSafety(f.content, core.enabledModels);
                                isUnsafe = !individualScan.isSafe;
                                
                                if (individualScan.modelUsed && individualScan.modelUsed !== 'error' && !individualScan.modelUsed.includes('unknown')) {
                                    // Usage is now recorded inside testContentSafety
                                }
                            }
                            
                            if (isUnsafe) {
                                unsafeIds.add(f.id);
                                const maxRetries = isFixPhaseRef?.current ? 1 : 2;
                                const hasOR = !!(core.openRouterKey && core.openRouterKey.trim().length > 0);
                                const target = getRescueTarget(f.retryCount || 0, hasOR, maxRetries);
                                if (target) {
                                    ui.addLog(`🚨 Tệp ${f.name} nghi vấn vi phạm/lỗi! Bàn giao cho vệ tinh ${getRescueLabel(target)}...`, "warning");
                                } else {
                                    ui.addLog(`🚨 Tệp ${f.name} bị Gemini chặn nội dung! Đánh dấu lỗi. (Mẹo: Thêm API Key OpenRouter trong Cài đặt để dự phòng cho các tệp lỗi)`, "error");
                                }
                            } else {
                                ui.addLog(`✅ Tệp ${f.name} an toàn.`, "success");
                            }
                        }
                        
                        ui.addLog(`📊 Kết quả quét: ${unsafeIds.size} tệp lỗi, ${batchFiles.length - unsafeIds.size} tệp an toàn.`, 'info');
                    }
                    
                    // Nếu lỗi gốc là Safety mà quét không ra file nào, BẮT BUỘC phải cách ly file đầu tiên để loại trừ dần
                    if (unsafeIds.size === 0 && isSafetyError && batchFiles.length > 0) {
                         ui.addLog(`⚠️ Không dò ra tệp vi phạm bằng công cụ quét, nhưng API dịch báo lỗi Safety. Tự động cách ly tệp đầu tiên (${batchFiles[0].name}) để loại trừ dần...`, "warning");
                         unsafeIds.add(batchFiles[0].id);
                    }
                    
                } catch (internalErr: any) {
                    ui.addLog(`❌ Lỗi khi quét bộ lọc: ${internalErr.message || 'Lỗi không xác định'}. Đang áp dụng cơ chế cách ly an toàn...`, "error");
                    core.setFiles((prev: FileItem[]) => prev.map((item: FileItem) => {
                        if (batchIds.includes(item.id)) {
                            const batchIndex = batchIds.indexOf(item.id);
                            if (batchIndex === 0) {
                                return { ...item, status: FileStatus.IDLE, retryCount: (item.retryCount || 0) + 1, errorMessage: "Nghi vấn lỗi nội dung hoặc format - Đang cách ly để kiểm tra riêng" };
                            } else {
                                return { ...item, status: FileStatus.IDLE, retryCount: (item.retryCount || 0), errorMessage: `Chờ thử lại do vạ lây từ batch có file safety`, isSafeRebatch: true } as any;
                            }
                        }
                        return item;
                    }));
                    if (myRunId === runIdRef?.current) {
                        // batchIndex 0 vừa được gắn "Đang cách ly để kiểm tra riêng" ở trên -> ưu tiên
                        // lên đầu hàng chờ thay vì chôn ở cuối cùng với các tệp "vạ lây" phía sau.
                        setProcessingQueue(prev => reorderQueueWithPriority(prev, batchIds, new Set(batchIds.length > 0 ? [batchIds[0]] : [])));
                        setRetryTrigger(prev => prev + 1);
                    }
                    return; // Thoát sớm sau khi đã cập nhật trạng thái của tệp
                }
                
                const rescueMaxRetries = isFixPhaseRef?.current ? 1 : 2;
                const rescueHasOR = !!(core.openRouterKey && core.openRouterKey.trim().length > 0);
                // Tệp nào trong unsafeIds thực sự có vệ tinh cứu hộ tiếp nhận (còn lượt) sẽ được ưu
                // tiên lên đầu hàng chờ (xem reorderQueueWithPriority) thay vì chờ tới lượt cuối cùng.
                const priorityIdsForRescue = new Set<string>();
                if (unsafeIds.size > 0) {
                    for (const uid of unsafeIds) {
                        const uf = batchFiles.find((x: FileItem) => x.id === uid);
                        const target = getRescueTarget(uf?.retryCount || 0, rescueHasOR, rescueMaxRetries);
                        if (target) priorityIdsForRescue.add(uid);
                    }
                }

                if (unsafeIds.size > 0) {
                    const maxRetries = rescueMaxRetries;
                    const hasOR = rescueHasOR;
                    core.setFiles((prev: FileItem[]) => prev.map((item: FileItem) => {
                        if (unsafeIds.has(item.id)) {
                            const target = getRescueTarget(item.retryCount || 0, hasOR, maxRetries);
                            if (target) {
                                const rescueBudget = getRescueBudget(hasOR, maxRetries);
                                return { ...item, status: FileStatus.IDLE, retryCount: (item.retryCount || 0) + 1, errorMessage: `Lỗi bộ lọc an toàn - Bàn giao ${getRescueLabel(target)} (${(item.retryCount || 0) + 1}/${rescueBudget})` };
                            } else {
                                const reason = hasOR ? "Đã hết lượt cứu hộ OpenRouter" : "Không có OpenRouter dự phòng";
                                return { ...item, status: FileStatus.ERROR, errorMessage: `Bị chặn bởi Safety Filter (${reason})` };
                            }
                        } else if (batchIds.includes(item.id)) {
                            // Safe files get reset without increasing retryCount so they can be re-batched
                            return { ...item, status: FileStatus.IDLE, errorMessage: "Chờ thử lại do vạ lây từ file lỗi trong batch", isSafeRebatch: true } as any;
                        }
                        return item;
                    }));
                } else {
                    // Nếu quét xong mà không có file nào lỗi safety thật, thì xử lý như retry bình thường
                    core.setFiles((prev: FileItem[]) => prev.map((item: FileItem) => {
                        if (batchIds.includes(item.id)) {
                            return { ...item, status: FileStatus.IDLE, retryCount: (item.retryCount || 0) + 1, errorMessage: "Lỗi kết nối hoặc format (Đã check Safety an toàn)" };
                        }
                        return item;
                    }));
                }
                
                if (myRunId === runIdRef?.current) {
                    setProcessingQueue(prev => reorderQueueWithPriority(prev, batchIds, priorityIdsForRescue));
                    setRetryTrigger(prev => prev + 1);
                }
                return;
            }

            if (isAllQuotaExhausted) {
                ui.addLog(`❌ Lỗi Batch: ${error.message}`, "error");
            } else if (!isQuotaError) {
                ui.addLog(`❌ Lỗi Batch: ${error.message}`, "error");
            }

            core.setFiles((prev: FileItem[]) => prev.map((f: FileItem) => {
                if (batchIds.includes(f.id)) {
                    if (isAllQuotaExhausted) {
                        return { ...f, status: FileStatus.ERROR, errorMessage: "Hết Quota tất cả model khả dụng" };
                    }
                    
                    const maxRetries = isFixPhaseRef?.current ? 1 : 2;
                    
                    if (error.message.includes("429") || error.message.toLowerCase().includes("quota")) {
                        if ((f.retryCount || 0) < maxRetries * 2) { // Allow more retries for quota (transient)
                            return { ...f, status: FileStatus.IDLE, retryCount: (f.retryCount || 0) + 1, errorMessage: "Lỗi Quota (429) - Sẽ thử lại" };
                        } else {
                            return { ...f, status: FileStatus.ERROR, errorMessage: "Lỗi Quota (Quá nhiều lần thử lại)" };
                        }
                    }
                    
                    // Lỗi Safety Filter được tách khỏi cổng `maxRetries` chung, dùng ngân sách cứu hộ
                    // riêng (rescueBudget = tổng lượt của OpenRouter) để có đủ lượt cứu hộ.
                    if (isSafetyError) {
                        const batchIndex = batchIds.indexOf(f.id);
                        if (batchIndex === 0) {
                            const hasOR = !!(core.openRouterKey && core.openRouterKey.trim().length > 0);
                            const target = getRescueTarget(f.retryCount || 0, hasOR, maxRetries);
                            if (target) {
                                const rescueBudget = getRescueBudget(hasOR, maxRetries);
                                const errMsg = `Nghi vấn lỗi nội dung nhạy cảm - Bàn giao ${getRescueLabel(target)} (${(f.retryCount || 0) + 1}/${rescueBudget})`;
                                return { ...f, status: FileStatus.IDLE, retryCount: (f.retryCount || 0) + 1, errorMessage: errMsg };
                            } else {
                                const reason = hasOR ? 'đã hết lượt xử lý' : 'không có OpenRouter dự phòng';
                                return { ...f, status: FileStatus.ERROR, errorMessage: `Bị chặn do lỗi bộ lọc an toàn (${reason})` };
                            }
                        } else {
                            const errMsg = `Chờ thử lại do vạ lây từ batch có file safety`;
                            return { ...f, status: FileStatus.IDLE, retryCount: (f.retryCount || 0), errorMessage: errMsg, isSafeRebatch: true } as any;
                        }
                    }
                    if ((f.retryCount || 0) < maxRetries) {
                        return { ...f, status: FileStatus.IDLE, retryCount: (f.retryCount || 0) + 1, errorMessage: `Lỗi: ${error.message} - Đang thử lại (${(f.retryCount || 0) + 1}/${maxRetries})` };
                    }
                    return { ...f, status: FileStatus.ERROR, errorMessage: `Lỗi: ${error.message}` };
                }
                return f;
            }));
            
            if (isAllQuotaExhausted) {
                ui.addToast("Tất cả model khả dụng đã hết Quota. Dừng hệ thống dịch.", "error");
                if (myRunId === runIdRef?.current) {
                    setProcessingQueue([]); // Clear queue to stop
                    setEndTime(Date.now());
                    setIsSmartAutoMode(false);
                    setAutoFixEnabled(false);
                    isFixPhaseRef.current = false;
                }
                return; // Stop execution, do not retry or push to queue
            } else if (error.message.includes("429") || error.message.includes("Quota")) {
                ui.addToast("Lỗi Quota (429). Đang tạm dừng 30s...", "warning");
                await new Promise(resolve => setTimeout(resolve, 30000));
                if (myRunId === runIdRef?.current) {
                    setRetryTrigger(prev => prev + 1);
                }
            } else {
                const maxRetries = isFixPhaseRef?.current ? 1 : 2;
                const maxRetryCount = Math.max(...batchFiles.map(f => f.retryCount || 0));
                if (maxRetryCount < maxRetries) {
                    const waitTime = Math.pow(2, maxRetryCount + 1) * 1000; // 2s, 4s, 8s
                    ui.addLog(`⏳ Tạm dừng ${waitTime/1000}s trước khi thử lại...`, "warning");
                    await new Promise(resolve => setTimeout(resolve, waitTime));
                    if (myRunId === runIdRef?.current) {
                        setRetryTrigger(prev => prev + 1);
                    }
                }
            }
        } finally {
            setActiveBatches(prev => Math.max(0, prev - 1));
            batchIds.forEach(id => scheduledBatchesRef?.current.delete(id));
        }
    }, [isProcessing, effectiveDictionary, core, ui, setRetryTrigger, setActiveBatches, scheduledBatchesRef, runIdRef, filesRef, isFixPhaseRef, setAutoFixEnabled, setEndTime, setIsSmartAutoMode, setProcessingQueue]);

    useEffect(() => {
        if (!isProcessing) return;

        const myRunId = runIdRef?.current;
        const currentFiles = filesRef?.current;
        // QUAN TRỌNG: phải duyệt theo THỨ TỰ của processingQueue (không phải thứ tự gốc của
        // currentFiles). Khi 1 file lỗi/hậu kiểm bị đưa xuống cuối processingQueue (xem các chỗ
        // setProcessingQueue([...otherIds, ...retryingIds]) ở trên/dưới), nếu ở đây vẫn lọc theo
        // currentFiles thì file đó vẫn nằm ở vị trí cũ trong mảng gốc -> vẫn bị chọn lại NGAY LẬP
        // TỨC làm batch kế tiếp (thử đi thử lại liên tục, phí request) thay vì nhường chỗ cho các
        // file mới/chưa thử trong hàng đợi. Duyệt theo processingQueue đảm bảo file lỗi thực sự bị
        // đẩy xuống cuối và chỉ được thử lại sau khi các file khác trong hàng đợi đã được xử lý.
        const fileMap = new Map<string, FileItem>(currentFiles.map((f: FileItem) => [f.id, f]));
        const pendingFiles = processingQueue
            .map((id: string) => fileMap.get(id))
            .filter((f: FileItem | undefined): f is FileItem => !!f && f.status === FileStatus.IDLE && !scheduledBatchesRef?.current.has(f.id));

        if (pendingFiles.length === 0 && activeBatches === 0) {
            if (isSmartAutoMode && !isFixPhaseRef?.current) {
                const hasIssues = handleSmartFix();
                if (!hasIssues) {
                    setIsProcessing(false);
                    setEndTime(Date.now());
                    setIsSmartAutoMode(false);
                    setAutoFixEnabled(false);
                    ui.addToast("Hoàn tất quy trình dịch tự động thông minh!", "success");
                    core.saveSession(true);
                }
            } else if (isSmartAutoMode && isFixPhaseRef?.current && autoFixEnabled) {
                // BUGFIX: file đang được Sửa Lỗi (Pro/Flash) mang status REPAIRING, không phải
                // COMPLETED lẫn IDLE, nên KHÔNG được lọt qua 2 điều kiện trên. Nếu không chặn ở đây,
                // effect sẽ tưởng "không còn gì để sửa" ngay khi 1 batch sửa lỗi còn đang chạy dở ở
                // dưới nền (performAggregatedRepair), tự tắt isProcessing/isFixPhaseRef và báo "Hoàn
                // tất" giả, khiến nút Smart Fix có thể bị gọi lại lần 2 -> tăng runIdRef -> phiên sửa
                // lỗi đang chạy bị coi là "người dùng hủy" ngay sau batch hiện tại.
                const repairingFiles = currentFiles.filter((f: FileItem) => f.status === FileStatus.REPAIRING);
                if (repairingFiles.length > 0) {
                    return;
                }
                const rawFiles = currentFiles.filter((f: FileItem) => f.status === FileStatus.COMPLETED && f.remainingRawCharCount > 0);
                if (rawFiles.length > 0) {
                    handleFixRemainingRaw();
                } else {
                    setIsProcessing(false);
                    setEndTime(Date.now());
                    setIsSmartAutoMode(false);
                    setAutoFixEnabled(false);
                    isFixPhaseRef.current = false;
                    ui.addToast("Hoàn tất quy trình dịch tự động thông minh!", "success");
                    core.saveSession(true);
                }
            } else {
                const totalInQueue = processingQueue.length;
                const completedCount = currentFiles.filter((f: FileItem) => processingQueue.includes(f.id) && f.status === FileStatus.COMPLETED).length;
                const errorFiles = currentFiles.filter((f: FileItem) => processingQueue.includes(f.id) && f.status === FileStatus.ERROR);
                const errorCount = errorFiles.length;
                const errorDetails = errorFiles.map(f => `File ${currentFiles.findIndex(cf => cf.id === f.id) + 1}: ${f.errorMessage || 'Lỗi không xác định'}`).join(', ');
                const errorMsgStr = errorCount > 0 ? `. Chi tiết thất bại: ${errorDetails}` : '';

                setIsProcessing(false);
                setEndTime(Date.now());
                ui.addToast(`✓ Hoàn tất dịch gộp (Batch) ${totalInQueue} tệp. (Thành công: ${completedCount}, Thất bại: ${errorCount})`, "success");
                ui.addLog(`✓ Hoàn tất dịch gộp (Batch) ${totalInQueue} tệp. (Thành công: ${completedCount}, Thất bại: ${errorCount})${errorMsgStr}`, errorCount > 0 ? "warning" : "success");
                core.saveSession(true);
            }
            return;
        }

        let maxConcurrentBatches = 3;
        if (core.concurrency === 'auto') {
            if (translationTier === 'flash') {
                maxConcurrentBatches = 3;
            } else if (translationTier === 'normal') {
                maxConcurrentBatches = 2;
            } else if (translationTier === 'pro') {
                maxConcurrentBatches = 2;
            } else if (translationTier === 'full') {
                maxConcurrentBatches = 3;
            } else if (translationTier === 'lite') {
                maxConcurrentBatches = 3;
            } else if (translationTier === 'openrouter') {
                maxConcurrentBatches = 1; // 1 luồng, 1 tệp theo yêu cầu
            }
        } else {
            maxConcurrentBatches = typeof core.concurrency === 'number' ? core.concurrency : parseInt(core.concurrency) || 3;
        }
        
        if (activeBatches < maxConcurrentBatches && pendingFiles.length > 0) {
            const lang = core.storyInfo.languages?.[0]?.toLowerCase() || '';
            const isLatin = lang.includes('việt') || lang.includes('convert') || lang.includes('en') || lang.includes('anh');
            const limits = isLatin ? (core.batchLimits?.latin || { v36: 6, v35: 6, v3: 6, v31: 12, v25: 6, maxTotalChars: 90000 }) : (core.batchLimits?.complex || { v36: 6, v35: 6, v3: 6, v31: 12, v25: 6, maxTotalChars: 45000 });
            const currentTier = isFixPhaseRef?.current ? (translationTier === 'lite' ? 'lite' : 'pro') : translationTier;
            const effectiveModels = getEffectiveModelsForTier(currentTier, 'translate', core.enabledModels);
            const bestModel = quotaManager.getBestModelForTask(effectiveModels) || effectiveModels[0];
            
            let batchSize = 15;
            if (bestModel.startsWith('openrouter:')) {
                batchSize = 1;
            } else if (bestModel.includes('pro')) {
                batchSize = parseInt(String(limits.v31)) || 12;
            } else if (bestModel.includes('3.6')) {
                batchSize = parseInt(String(limits.v36)) || 6;
            } else if (bestModel.includes('3.5')) {
                batchSize = parseInt(String(limits.v35)) || 6;
            } else if (bestModel.includes('3-') || bestModel.includes('3.0')) {
                batchSize = parseInt(String(limits.v3)) || 6;
            } else if (bestModel.includes('3.1')) {
                // If it's 3.1 but not pro, it's flash-lite
                batchSize = parseInt(String(limits.v36)) || 6;
            } else if (bestModel.includes('2.5')) {
                batchSize = parseInt(String(limits.v25)) || 6;
            } else {
                batchSize = parseInt(String(limits.v36)) || 6;
            }
            
            batchSize = Math.max(1, isNaN(batchSize) ? 15 : batchSize);
            
            const isFirstSafeRebatch = pendingFiles.length > 0 && !!(pendingFiles[0] as any).isSafeRebatch;
            if (pendingFiles.length > 0 && pendingFiles[0].errorMessage && 
                !isFirstSafeRebatch &&
                !pendingFiles[0].errorMessage.includes('vạ lây') &&
                (pendingFiles[0].errorMessage.includes('Nghi vấn lỗi nội dung') || 
                 pendingFiles[0].errorMessage.includes('Lỗi kiểm định AI') || 
                 pendingFiles[0].errorMessage.includes('Đã phân loại riêng') || 
                 pendingFiles[0].errorMessage.toLowerCase().includes('an toàn') || 
                 pendingFiles[0].errorMessage.toLowerCase().includes('safety') || 
                 pendingFiles[0].errorMessage.includes('Thiếu kết quả từ API') || pendingFiles[0].errorMessage.includes('Lỗi ngắt kết nối API') ||
                 pendingFiles[0].errorMessage.includes('BLOCKLIST'))) {
                
                batchSize = 1;
            }
            
            let maxChars = limits.maxTotalChars || (isLatin ? 100000 : 50000);
            if (bestModel.startsWith('openrouter:')) {
                maxChars = 15000;
            }
            
            // Co giãn theo tỷ lệ (nếu cấu hình batch lớn hơn chuẩn 15 thì tăng maxChars tương ứng).
            // Với batch nhỏ (ví dụ 6 của 2.5 Pro), giữ nguyên maxChars gốc để "đảm bảo tối đa 6 tệp nếu chưa chạm 55k".
            if (batchSize > 15 && !bestModel.startsWith('openrouter:')) {
                maxChars = Math.floor(maxChars * (batchSize / 15));
            }
            
            const nextBatchFiles = [];
            let currentChars = 0;
            for (let i = 0; i < pendingFiles.length && i < batchSize; i++) {
                const f = pendingFiles[i];
                const charCount = f.content.length;
                if (nextBatchFiles.length > 0 && currentChars + charCount > maxChars) {
                    break; // Ensure at least 1 file, but stop if limit exceeded
                }
                
                // Do not mix files with safety errors into a normal batch
                if (nextBatchFiles.length > 0) {
                     const isCurrentSpecial = !!(f.errorMessage && 
                         !(f as any).isSafeRebatch &&
                         !f.errorMessage.includes('vạ lây') && (
                         f.errorMessage.includes('phân loại riêng') || 
                         f.errorMessage.toLowerCase().includes('an toàn') ||
                         f.errorMessage.toLowerCase().includes('safety') ||
                         f.errorMessage.includes('BLOCKLIST') ||
                         f.errorMessage.includes('Lỗi kiểm định AI') ||
                         f.errorMessage.includes('Nghi vấn lỗi nội dung')
                     ));
                     if (isCurrentSpecial) break; 
                }
                
                nextBatchFiles.push(f);
                currentChars += charCount;
            }
            
            const batchIds = nextBatchFiles.map(f => f.id);
            
            batchIds.forEach(id => scheduledBatchesRef?.current.add(id));
            setActiveBatches(prev => prev + 1);
            
            processBatch(batchIds, currentTier, myRunId);
        }
    }, [isProcessing, processingQueue, activeBatches, core.concurrency, core.batchLimits, translationTier, processBatch, isSmartAutoMode, autoFixEnabled, retryTrigger, handleSmartFix, handleFixRemainingRaw, setIsProcessing, setEndTime, setIsSmartAutoMode, setAutoFixEnabled, ui, core, scheduledBatchesRef, runIdRef, isFixPhaseRef, filesRef, setActiveBatches, isProcessingRef]);

    const executeProcessing = (smartAuto: boolean = false, overrideTier?: TranslationTier) => {
        // BUGFIX (bước C): nếu đang có phiên Sửa Lỗi (Repair) thật sự chạy dưới nền, không cho bắt
        // đầu 1 lượt dịch mới đè lên (sẽ làm tăng runIdRef và khiến phiên repair đang chạy bị coi là
        // "người dùng hủy"). Báo cho người dùng biết và dừng ở đây.
        if (isRepairRunningRef?.current) {
            ui.addToast("Đang có phiên Sửa Lỗi chạy dở, vui lòng đợi hoàn tất trước khi Bắt đầu dịch lại.", 'info');
            return false;
        }
        const hasSelection = ui.selectedFiles && ui.selectedFiles.size > 0;

        const filesToReset = core.files.filter((f: FileItem) => {
            if (hasSelection && !ui.selectedFiles.has(f.id)) return false;
            
            const isSuspiciousContentError = f.errorMessage && (f.errorMessage.includes('Nghi vấn lỗi nội dung') || f.errorMessage.toLowerCase().includes('an toàn') || f.errorMessage.toLowerCase().includes('safety') || f.errorMessage.includes('BLOCKLIST') || f.errorMessage.includes('PROHIBITED_CONTENT'));

            // Ngoại trừ các file dịch từ thủ công nếu không chọn trực tiếp (NHƯNG NGOẠI TRỪ LỖI NGHI VẤN NỘI DUNG)
            if (!hasSelection && f.usedModel === 'Thủ công' && !isSuspiciousContentError) return false;

            if (f.status === FileStatus.ERROR) return true;
            if (f.status === FileStatus.IDLE && isSuspiciousContentError) return true;
            if (f.status === FileStatus.PROCESSING || f.status === FileStatus.REPAIRING) return true;
            if (f.status === FileStatus.COMPLETED && f.translatedContent) {
                if (f.translatedContent.trim() === f.content.trim()) return true;
                if (f.translatedContent.includes(BATCH_MISSING_TAG_WARNING)) return true;
                if (f.remainingRawCharCount > 100) return true;
            }
            return false;
        });

        const resetIds = new Set(filesToReset.map(f => f.id));

        const queue = core.files.filter((f: FileItem) => {
            if (hasSelection && !ui.selectedFiles.has(f.id)) return false;
            return f.status === FileStatus.IDLE || resetIds.has(f.id);
        }).map((f: FileItem) => f.id);
        
        if (queue.length === 0) {
            ui.addToast("Không có file nào để dịch", 'info');
            return false;
        }
        
        if (!smartAuto) {
            core.setFiles((prev: FileItem[]) => prev.map((f: FileItem) => {
                if (queue.includes(f.id)) {
                    return { ...f, status: FileStatus.IDLE, retryCount: 0, errorMessage: undefined };
                }
                return f;
            }));
        }
        
        if (runIdRef) runIdRef.current += 1;
        if (scheduledBatchesRef) scheduledBatchesRef.current.clear();
        setProcessingQueue(queue);
        setIsSmartAutoMode(smartAuto);
        setAutoFixEnabled(smartAuto);
        setStartTime(Date.now());
        setEndTime(null);
        setIsProcessing(true);
        isFixPhaseRef.current = false;
        
        const currentTier = overrideTier || translationTier;
        
        // Cập nhật synchronously cho filesRef để useEffect chạy ngay lập tức không bị lỗi batchSize=1 do vẫn còn cache error cũ
        if (filesRef && filesRef.current) {
            filesRef.current = filesRef.current.map((f: FileItem) => {
                if (queue.includes(f.id)) {
                    return { 
                        ...f, 
                        status: FileStatus.IDLE, 
                        retryCount: 0, 
                        usedModel: undefined, 
                        errorMessage: undefined,
                        translatedContent: resetIds.has(f.id) ? null : f.translatedContent,
                        hasStaleTranslation: resetIds.has(f.id) ? false : f.hasStaleTranslation,
                        remainingRawCharCount: resetIds.has(f.id) ? 0 : f.remainingRawCharCount
                    };
                }
                return f;
            });
        }

        core.setFiles((prev: FileItem[]) => prev.map((f: FileItem) => {
            if (queue.includes(f.id)) {
                return { 
                    ...f, 
                    status: FileStatus.IDLE, 
                    retryCount: 0, 
                    usedModel: undefined, 
                    errorMessage: undefined,
                    translatedContent: resetIds.has(f.id) ? null : f.translatedContent,
                    hasStaleTranslation: resetIds.has(f.id) ? false : f.hasStaleTranslation,
                    remainingRawCharCount: resetIds.has(f.id) ? 0 : f.remainingRawCharCount
                };
            }
            return f;
        }));
        
        const firstIndex = core.files.findIndex(f => f.id === queue[0]) + 1;
        const lastIndex = core.files.findIndex(f => f.id === queue[queue.length - 1]) + 1;
        
        ui.addToast(`🚀 Bắt đầu dịch gộp (Batch) ${queue.length} tệp (từ ${firstIndex} đến ${lastIndex})`, 'info');
        ui.addLog(`🚀 Bắt đầu dịch gộp (Batch) ${queue.length} tệp (từ ${firstIndex} đến ${lastIndex}) - ${currentTier} tier${smartAuto ? ' - Smart Auto Mode' : ''}`, 'info');
        if (resetIds.size > 0) {
            ui.addLog(`🔄 Auto Continue: Đã tự động reset và nối tiếp ${resetIds.size} file lỗi/treo/nghi vấn vào hàng đợi.`, 'info');
        }
        return true;
    };

    const stopProcessing = () => {
        // We don't increment runIdRef?.current here, so the current batch won't be aborted
        setIsProcessing(false);
        setProcessingQueue([]);
        // We don't clear scheduledBatchesRef or activeBatches here, let them finish naturally
        setEndTime(Date.now());
        setIsSmartAutoMode(false);
        setAutoFixEnabled(false);
        isFixPhaseRef.current = false;
        ui.addToast("Đã dừng tự động dịch. Đang chờ các batch hiện tại hoàn tất...", 'warning');
        // We don't set PROCESSING files to IDLE, we let them finish
    };

    const handleRetranslateConfirm = (selectedIds: string[], keepOld: boolean, tier: TranslationTier) => {
        if (selectedIds.length === 0) {
            ui.addToast("Chưa chọn file nào để dịch lại.", "warning");
            return;
        }
        core.setFiles((prev: FileItem[]) => prev.map((f: FileItem) => selectedIds.includes(f.id) ? { ...f, status: FileStatus.IDLE, translatedContent: keepOld ? f.translatedContent : null, remainingRawCharCount: 0, retryCount: 0, usedModel: undefined } : f));
        
        const newQueue = Array.from(new Set([...processingQueue, ...selectedIds]));
        setProcessingQueue(newQueue);
        setTranslationTier(tier);
        setIsProcessing(true);
        if (!startTime) setStartTime(Date.now());
        ui.addToast(`Đã thêm ${selectedIds.length} file vào hàng đợi dịch lại (${tier} tier).`, "success");
    };

    return {
        processBatch,
        executeProcessing,
        stopProcessing,
        handleRetranslateConfirm
    };
};
