// Nhóm hàm SỬA LỖI TUỲ CHỈNH: phân tích 1 lỗi người dùng mô tả (dùng AI), rồi áp dụng
// sửa lỗi đó cho toàn bộ/1 phần các chương đã dịch. Có state isCustomFixing/customFixProgress
// dùng chung, nên 3 hàm này (bao gồm cả stopCustomFixing) được giữ trong cùng 1 file.
import { useState, useRef, useEffect } from 'react';
import { FileItem, FileStatus } from '../../types';
import { smartFixChunk } from '../../geminiService';

export const useCustomErrorFix = (core: any, ui: any, sharedState: any) => {
    const { setStartTime, setEndTime, translationTier } = sharedState;

    const [isCustomFixing, setIsCustomFixing] = useState<boolean>(false);
    const [customFixProgress, setCustomFixProgress] = useState<{ completed: number, total: number } | null>(null);
    const isCustomFixingRef = useRef<boolean>(false);

    useEffect(() => {
        isCustomFixingRef.current = isCustomFixing;
    }, [isCustomFixing]);

    const handleAnalyzeCustomError = async (userPrompt: string, scope: 'all' | 'selected' = 'all', imageBase64?: string): Promise<string> => {
        const candidates = core.files.filter((f: FileItem) => {
            if (scope === 'selected' && !ui.selectedFiles.has(f.id)) return false;
            return !!f.translatedContent;
        });

        if (candidates.length === 0) {
            ui.addToast("Không tìm thấy chương nào đã dịch để phân tích lỗi.", "info");
            return "";
        }

        ui.setAutoAnalyzeStatus("Đang tải dữ liệu mẫu và phân tích lỗi...");
        try {
            // Get sample text (first 80,000 chars)
            let sampleText = "";
            let currentLen = 0;
            for (const f of candidates) {
                const text = f.translatedContent || "";
                if (currentLen + text.length > 80000) {
                    sampleText += text.substring(0, 80000 - currentLen);
                    break;
                } else {
                    sampleText += text + "\n";
                    currentLen += text.length;
                }
            }

            const analyzer = await import('../../services/workflows/analyzer');
            const analysis = await analyzer.analyzeCustomError(sampleText, userPrompt, core.enabledModels, imageBase64);
            return analysis;
        } catch (e: any) {
             ui.addToast("Lỗi phân tích: " + e.message, "error");
             return "";
        } finally {
             ui.setAutoAnalyzeStatus("");
        }
    };

    const handleCustomErrorCorrection = async (userPrompt: string, scope: 'all' | 'selected' = 'all', imageBase64?: string) => {
        const candidates = core.files.filter((f: FileItem) => {
            if (scope === 'selected' && !ui.selectedFiles.has(f.id)) return false;
            return !!f.translatedContent;
        });

        if (candidates.length === 0) {
            ui.addToast("Không tìm thấy chương nào đã dịch để sửa lỗi.", "info");
            return false;
        }

        setIsCustomFixing(true);
        isCustomFixingRef.current = true;
        setStartTime(Date.now());
        setEndTime(null);
        ui.addToast(`Bắt đầu sửa lỗi thông minh cho ${candidates.length} chương...`, "info");

        const MAX_CHUNK_SIZE = 800000;
        const chunks: FileItem[][] = [];
        let currentChunk: FileItem[] = [];
        let currentLength = 0;

        for (const file of candidates) {
            const fileLen = file.translatedContent?.length || 0;
            if (currentLength + fileLen > MAX_CHUNK_SIZE && currentChunk.length > 0) {
                chunks.push(currentChunk);
                currentChunk = [file];
                currentLength = fileLen;
            } else {
                currentChunk.push(file);
                currentLength += fileLen;
            }
        }
        if (currentChunk.length > 0) {
            chunks.push(currentChunk);
        }

        let completed = 0;
        let successCount = 0;
        const total = chunks.length;
        setCustomFixProgress({ completed, total });
        ui.setAutoAnalyzeStatus(`Đang phân tích và sửa lỗi... (0/${total} phần)`);

        const CONCURRENCY = 2;

        const processChunk = async (chunk: FileItem[]) => {
            if (!isCustomFixingRef.current) return;
            
            core.setFiles((prev: FileItem[]) => prev.map((f: FileItem) => {
                if (chunk.some(cf => cf.id === f.id)) {
                    return { ...f, status: FileStatus.PROCESSING };
                }
                return f;
            }));

            const textToFix = chunk.map(f => f.translatedContent).join('\n\n');
            
            const hasOpenRouterFile = chunk.some(f => f.usedModel?.startsWith('openrouter:'));
            let modelsForFix = core.enabledModels;
            if (hasOpenRouterFile && core.openRouterKey && core.openRouterModel) {
                const safetyFallbackSet = new Set<string>();
                safetyFallbackSet.add(`openrouter:${core.openRouterModel}`);
                safetyFallbackSet.add('openrouter:google/gemma-4-26b-a4b-it:free');
                modelsForFix = Array.from(safetyFallbackSet);
            }

            try {
                const rules = await smartFixChunk(
                    textToFix, 
                    userPrompt, 
                    translationTier,
                    (msg) => console.log(msg), 
                    modelsForFix,
                    () => !isCustomFixingRef.current,
                    imageBase64,
                    core.openRouterKey
                );
                
                if (!rules || rules.length === 0) {
                    console.log("Smart Fix: No rules generated by AI for this chunk.");
                    core.setFiles((prev: FileItem[]) => prev.map((f: FileItem) => {
                        if (chunk.some(cf => cf.id === f.id)) {
                            return { ...f, status: FileStatus.COMPLETED };
                        }
                        return f;
                    }));
                } else {
                    let hasChanges = false;
                    core.setFiles((prev: FileItem[]) => prev.map((f: FileItem) => {
                        const isFileInChunk = chunk.some(cf => cf.id === f.id);
                        if (!isFileInChunk || !f.translatedContent) return f;

                        let newContent = f.translatedContent;
                        for (const rule of rules) {
                            if (rule.find && rule.replace && rule.find.trim() !== "") {
                                const escapedFind = rule.find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                                const regex = new RegExp(escapedFind, 'g');
                                newContent = newContent.replace(regex, rule.replace);
                            }
                        }

                        if (f.translatedContent !== newContent) {
                            hasChanges = true;
                            return { ...f, translatedContent: newContent, status: FileStatus.COMPLETED };
                        }
                        return { ...f, status: FileStatus.COMPLETED };
                    }));
                    
                    if (hasChanges) {
                        successCount++;
                    }
                }
            } catch (error: any) {
                if (error.message === 'ABORTED') {
                    console.log("Smart Fix: Aborted by user.");
                    return;
                }
                console.error("Smart Fix Error:", error);
                ui.addToast(`Lỗi khi sửa chunk: ${error.message}`, "error");
                core.setFiles((prev: FileItem[]) => prev.map((f: FileItem) => {
                    if (chunk.some(cf => cf.id === f.id)) {
                        return { ...f, status: FileStatus.COMPLETED };
                    }
                    return f;
                }));
            }

            completed++;
            setCustomFixProgress({ completed, total });
            ui.setAutoAnalyzeStatus(`Đang phân tích và sửa lỗi... (${completed}/${total} phần)`);
        };

        const activePromises = new Set<Promise<void>>();
        for (const chunk of chunks) {
            if (!isCustomFixingRef.current) break;
            
            const promise = processChunk(chunk);
            activePromises.add(promise);
            promise.finally(() => activePromises.delete(promise));
            
            if (activePromises.size >= CONCURRENCY) {
                await Promise.race(activePromises);
            }
        }
        await Promise.all(activePromises);

        setIsCustomFixing(false);
        setCustomFixProgress(null);
        setEndTime(Date.now());
        if (successCount > 0) {
            ui.addToast(`Đã hoàn thành sửa lỗi thông minh (${successCount}/${total} phần)!`, "success");
            core.saveSession(true);
        } else {
            ui.addToast("Sửa lỗi thất bại. Vui lòng thử lại với yêu cầu rõ ràng hơn.", "error");
        }
        return true;
    };

    const stopCustomFixing = () => {
        setIsCustomFixing(false);
        isCustomFixingRef.current = false;
        setCustomFixProgress(null);
        ui.setAutoAnalyzeStatus("");
        ui.addToast("Đã dừng sửa lỗi theo yêu cầu.", "info");
    };

    return {
        isCustomFixing, customFixProgress, setIsCustomFixing, isCustomFixingRef,
        handleAnalyzeCustomError, handleCustomErrorCorrection, stopCustomFixing
    };
};
