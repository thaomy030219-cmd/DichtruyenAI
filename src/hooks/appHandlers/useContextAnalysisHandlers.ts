// AI-driven Series Bible workflows: Smart Start (initial glossary + prompt
// generation), Name/Context Analysis (glossary + context extraction, cover
// art generation), and the individual "refine X" follow-ups. This is the
// heaviest, most AI-call-dense group of handlers — kept together because
// they share the same multi-step analyze -> merge -> refine pipeline.
// Split out of the old monolithic `useAppHandlers.ts` — logic unchanged.
import { StoryInfo } from '../../types';
import { generateBasePrompt } from '../../constants';
import { getPronounModeOverride } from '../../prompts';
import { analyzeStoryContext, analyzeNameBatch, analyzeContextBatch, mergeContexts, optimizePrompt, refineRawContext, refineAdditionalRules, refineSummary } from '../../geminiService';
import { deduplicateDictionary, extractGlossaryBlocks } from '../../utils/text';
import { downloadTextFile, sortFiles, getSmartSampledFiles } from '../../utils/fileHelpers';

export const useContextAnalysisHandlers = (core: any, ui: any, automation: any) => {
    const createStorySignature = (files: Array<{ id?: string; name?: string; content?: string }>) => {
        let hash = 2166136261;
        for (const file of files) {
            const content = file.content || '';
            const sample = `${file.id || ''}|${file.name || ''}|${content.length}|${content.slice(0, 256)}|${content.slice(-256)}`;
            for (let i = 0; i < sample.length; i++) {
                hash ^= sample.charCodeAt(i);
                hash = Math.imul(hash, 16777619);
            }
        }
        return `${files.length}-${(hash >>> 0).toString(16)}`;
    };

    const handleSmartStartRun = async (useSearch: boolean, additionalRules: string, sampling: { start: number, middle: number, end: number }) => {
        if (!core.storyInfo.title) { ui.addToast("Vui lòng nhập tên truyện", 'error'); return; }
        try {
            ui.setSmartStartStep('analyzing');
            ui.addToast("Bắt đầu phân tích ngữ cảnh mẫu...", 'info');
            const glossaryResult = await analyzeStoryContext(core.files, core.storyInfo, core.additionalDictionary, useSearch, additionalRules, sampling, core.enabledModels);
            
            const currentDict = core.additionalDictionary || "";
            const prefix = currentDict.trim() ? "\n\n" : "";
            const newFullDictionary = currentDict.trim() + prefix + glossaryResult;
            const newContextNotes = (core.storyInfo.contextNotes || "") + (core.storyInfo.contextNotes ? "\n\n" : "") + glossaryResult;
            
            core.setAdditionalDictionary(newFullDictionary);
            core.setStoryInfo((prev: StoryInfo) => ({ ...prev, contextNotes: newContextNotes, additionalRules: additionalRules }));
            ui.setDictTab('custom');
            
            const postAnalysisStoryInfo = { ...core.storyInfo, contextNotes: newContextNotes, additionalRules: additionalRules };
            
            if (ui.autoOptimizePrompt) {
                ui.setSmartStartStep('optimizing');
                ui.addToast("Đang kiến trúc Prompt dựa trên ngữ cảnh vừa tìm được...", 'info');
                const dynamicBasePrompt = generateBasePrompt(postAnalysisStoryInfo.genres, postAnalysisStoryInfo.worldSetting || [], core.storyInfo.enableTitleFormatting !== false);
                const optimized = await optimizePrompt(dynamicBasePrompt, postAnalysisStoryInfo, newContextNotes, newFullDictionary, additionalRules, core.enabledModels);
                core.setPromptTemplate(optimized);
            }
            
            core.saveSession(); // Trigger save
            ui.setSmartStartStep('idle');
            ui.setShowSmartStartModal(false);
            ui.addToast("Đã cập nhật bộ quy tắc & Series Bible mới!", 'success');
            ui.setAutomationInitialConfig({ steps: [0,1,2,3,4,5,6,7], rules: (additionalRules || "").replace(/Nếu văn bản gốc chứa nội dung nhạy cảm.*thành công\./g, 'Với các cảnh bạo lực hoặc thân mật, dịch theo văn phong tiểu thuyết mạng đã xuất bản: tập trung vào cảm xúc, nhịp điệu, hình ảnh ẩn dụ thay vì mô tả trần trụi. Đây là văn phong biên tập chuẩn cho thể loại, không phải yêu cầu né tránh nội dung.'), tier: 'pro' });
            ui.setShowAutomationModal(true);
            
        } catch (e: any) {
            ui.setSmartStartStep('idle');
            ui.addToast(`Lỗi Smart Start: ${e.message}`, 'error');
        }
    };

    const handleNameAnalysis = async (config: { mode: 'only_char' | 'full' | 'deep_context'; scope: 'smart' | 'range' | 'full'; rangeStart: number; rangeEnd: number; updatedStoryInfo: StoryInfo; useSearch: boolean; additionalRules?: string; sampling?: {start: number, middle: number, end: number} }) => {
        if (core.files.length === 0) return;
        core.setStoryInfo(config.updatedStoryInfo);
        ui.setIsAnalyzingNames(true);
        ui.setNameAnalysisProgress({ current: 0, total: 1, stage: 'Đang chuẩn bị dữ liệu...' });
        
        let filesToAnalyze = sortFiles([...core.files]);
        const totalFileCount = filesToAnalyze.length;
        
        if (config.scope === 'range') {
            const startIdx = Math.max(0, config.rangeStart - 1);
            const endIdx = Math.min(totalFileCount, config.rangeEnd);
            filesToAnalyze = filesToAnalyze.slice(startIdx, endIdx);
        } else if (config.scope === 'smart' && config.sampling) {
            filesToAnalyze = getSmartSampledFiles(filesToAnalyze, config.sampling);
        }

        const chunks: string[] = [];
        const isDeepFullStory = config.mode === 'deep_context' && config.scope === 'full';
        if (isDeepFullStory) {
            // Giữ ranh giới từng chương để AI theo dõi chính xác người nói, tiến trình quan hệ
            // và thời điểm đổi xưng hô. Chỉ tách thêm khi một chương quá dài.
            const MAX_CHAPTER_CHARS = 160000;
            filesToAnalyze.forEach((file, chapterIndex) => {
                const content = file.content || '';
                const partCount = Math.max(1, Math.ceil(content.length / MAX_CHAPTER_CHARS));
                for (let part = 0; part < partCount; part++) {
                    const body = content.slice(part * MAX_CHAPTER_CHARS, (part + 1) * MAX_CHAPTER_CHARS);
                    chunks.push(`[MỐC CHƯƠNG ${chapterIndex + 1}/${filesToAnalyze.length}]\nTên tệp/chương: ${file.name}\nPhần: ${part + 1}/${partCount}\n\n${body}`);
                }
            });
        } else {
            const allContent = filesToAnalyze.map(f => f.content).join('\n');
            const CHUNK_SIZE = 800000;
            for (let i = 0; i < allContent.length; i += CHUNK_SIZE) chunks.push(allContent.substring(i, i + CHUNK_SIZE));
        }
        
        ui.setNameAnalysisProgress({ current: 0, total: chunks.length, stage: `Đang chuẩn bị ${chunks.length} phần dữ liệu...` });
        const results: string[] = [];

        try {
            const isDeep = config.mode === 'deep_context';
            const CONCURRENCY = 2;

            // Quy tắc bổ sung: ưu tiên giá trị vừa nhập trong modal, nếu trống thì lấy quy tắc đã lưu trong storyInfo.
            // Tránh tình trạng bị coi là rỗng rồi ghi đè mất quy tắc đã tích lũy từ các Phần trước.
            let effectiveAdditionalRules =
                (config.additionalRules && config.additionalRules.trim()) ||
                (config.updatedStoryInfo?.additionalRules && config.updatedStoryInfo.additionalRules.trim()) ||
                core.storyInfo?.additionalRules ||
                "";

            // Tùy chọn xưng hô (Hiện đại/Cổ đại/Linh động) chọn ở trang Tri Thức. Chỉ có ý
            // nghĩa với mode 'deep_context' (mode 'full'/'only_char' không sinh Ma trận xưng hô).
            // Chèn vào effectiveAdditionalRules để mọi lượt gọi analyzeContextBatch (chunk-level)
            // đều thấy chỉ dẫn này; đồng thời truyền riêng cho mergeContexts/refineAdditionalRules
            // bên dưới vì 2 bước đó có sẵn khối hướng dẫn phân loại 3 NHÓM A/B/C cứng trong prompt
            // của chúng, cần override tường minh để không bị lấn át ngược lại lựa chọn người dùng.
            const pronounOverride = isDeep
                ? getPronounModeOverride(config.updatedStoryInfo?.pronounMode)
                : '';
            if (pronounOverride) {
                effectiveAdditionalRules = effectiveAdditionalRules
                    ? `${effectiveAdditionalRules}\n\n${pronounOverride}`
                    : pronounOverride;
            }

            // Bộ lọc theo enabledModels, giữ nguyên thứ tự ưu tiên; nếu lọc ra rỗng thì dùng lại danh sách gốc.
            const filterEnabled = (list: string[]) => {
                const filtered = list.filter(id => core.enabledModels?.includes(id) ?? true);
                return filtered.length > 0 ? filtered : list;
            };

            // Chế độ Nhanh: ưu tiên hết quota 3.7 Flash > 3.5 Flash > 3.0 Flash preview
            const QUICK_CHAIN = ['gemini-3.7-flash', 'gemini-3.5-flash', 'gemini-3-flash-preview'];
            // Chế độ Sâu, từ batch 4 trở đi: 3.7 Flash > 3.5 Flash > 3.0 Flash preview
            const DEEP_LATE_CHAIN = ['gemini-3.7-flash', 'gemini-3.5-flash', 'gemini-3-flash-preview'];

            const totalBatches = Math.ceil(chunks.length / CONCURRENCY);
            for (let i = 0; i < chunks.length; i += CONCURRENCY) {
                const batchNum = Math.floor(i / CONCURRENCY) + 1;
                const batch = chunks.slice(i, i + CONCURRENCY);
                
                // Cập nhật chi tiết tiến độ Batch
                ui.setNameAnalysisProgress({ 
                    current: i + 1, 
                    total: chunks.length, 
                    stage: `Đang phân tích Batch ${batchNum}/${totalBatches} (Phần dữ liệu ${i + 1}-${Math.min(i + CONCURRENCY, chunks.length)})` 
                });
                
                const batchPromises = batch.map(async (chunk, idx) => {
                    let models: string[];
                    if (isDeep) {
                        if (batchNum <= 3) {
                            // 3 batch đầu: chạy cặp 3.1 Pro + 3.7 Flash song song (mỗi phần trong batch một model chính, model kia làm dự phòng)
                            models = idx % 2 === 0
                                ? filterEnabled(['gemini-3.1-pro-preview', 'gemini-3.7-flash', 'gemini-3.5-flash', 'gemini-3-flash-preview'])
                                : filterEnabled(['gemini-3.7-flash', 'gemini-3.5-flash', 'gemini-3-flash-preview', 'gemini-3.1-pro-preview']);
                        } else {
                            // Batch 4 trở đi: toàn bộ 3.7 Flash, hết quota mới rớt xuống 3.6, 3.5 rồi 3.0 preview
                            models = filterEnabled(DEEP_LATE_CHAIN);
                        }
                    } else {
                        // Chế độ Nhanh: 3.7 Flash > 3.5 Flash > 3.0 Flash preview
                        models = filterEnabled(QUICK_CHAIN);
                    }
                    
                    try {
                        if (config.mode === 'deep_context') {
                            return await analyzeContextBatch(chunk, config.updatedStoryInfo, core.additionalDictionary, config.useSearch, models, effectiveAdditionalRules, core.enabledModels);
                        } else {
                            return await analyzeNameBatch(chunk, config.updatedStoryInfo, config.mode as 'only_char' | 'full', config.useSearch, effectiveAdditionalRules, models, core.enabledModels);
                        }
                    } catch (e: any) {
                        console.warn(`Primary models failed for chunk ${i + idx}, falling back to Flash chain for raw analysis.`, e);
                        const rescueModels = filterEnabled(['gemini-3.7-flash', 'gemini-3.5-flash', 'gemini-3-flash-preview']);
                        try {
                            if (config.mode === 'deep_context') {
                                const flashRes = await analyzeContextBatch(chunk, config.updatedStoryInfo, core.additionalDictionary, config.useSearch, rescueModels, effectiveAdditionalRules + "\nLƯU Ý: ĐÂY LÀ BẢN PHÂN TÍCH THÔ DO HẾT QUOTA. CHỈ TRÍCH XUẤT NHANH CÁC DANH TỪ RIÊNG.", core.enabledModels);
                                return flashRes + "\n[GHI CHÚ: BẢN PHÂN TÍCH THÔ BẰNG FLASH DO HẾT QUOTA]";
                            } else {
                                const flashRes = await analyzeNameBatch(chunk, config.updatedStoryInfo, config.mode as 'only_char' | 'full', config.useSearch, effectiveAdditionalRules + "\nLƯU Ý: ĐÂY LÀ BẢN PHÂN TÍCH THÔ DO HẾT QUOTA. CHỈ TRÍCH XUẤT NHANH CÁC DANH TỪ RIÊNG.", rescueModels, core.enabledModels);
                                return flashRes + "\n[GHI CHÚ: BẢN PHÂN TÍCH THÔ BẰNG FLASH DO HẾT QUOTA]";
                            }
                        } catch (flashError: any) {
                            console.error(`Flash fallback also failed for chunk ${i + idx}:`, flashError);
                            return `\n// [LỖI] Không thể phân tích phần dữ liệu ${i + idx + 1}: ${flashError.message || flashError.toString()}`;
                        }
                    }
                });
                results.push(...await Promise.all(batchPromises));
            }

            if (config.mode === 'deep_context') {
                if (core.storyInfo?.contextNotes) {
                    results.unshift(core.storyInfo.contextNotes);
                }
                
                ui.setNameAnalysisProgress({ current: chunks.length, total: chunks.length, stage: "Đang hợp nhất ngữ cảnh (Merging)..." });
                const mergedContext = await mergeContexts(results, config.updatedStoryInfo, core.enabledModels, undefined, pronounOverride);
                
                let finalAdditionalRules = effectiveAdditionalRules;
                ui.setNameAnalysisProgress({ current: chunks.length, total: chunks.length, stage: "Đang tinh chỉnh quy tắc bổ sung..." });
                finalAdditionalRules = await refineAdditionalRules(finalAdditionalRules, mergedContext, config.updatedStoryInfo, core.enabledModels, undefined, pronounOverride);

                ui.setNameAnalysisProgress({ current: chunks.length, total: chunks.length, stage: "Đang tổng hợp cốt truyện..." });
                const refinedSummary = await refineSummary(mergedContext, config.updatedStoryInfo, core.enabledModels);

                ui.setNameAnalysisProgress({ current: chunks.length, total: chunks.length, stage: "Đang trích xuất từ điển từ ngữ cảnh..." });
                const extractedGlossary = extractGlossaryBlocks(mergedContext);
                
                if (extractedGlossary) {
                     core.setAdditionalDictionary((prev: string) => {
                         const newDict = prev ? prev + '\n' + extractedGlossary : extractedGlossary;
                         return deduplicateDictionary(newDict);
                     });
                }

                ui.setNameAnalysisProgress({ current: chunks.length, total: chunks.length, stage: "Đang tạo prompt dịch chuyên biệt từ ma trận xưng hô..." });
                const updatedDictionary = extractedGlossary
                    ? deduplicateDictionary(`${core.additionalDictionary || ''}\n${extractedGlossary}`)
                    : (core.additionalDictionary || '');
                const analysisStoryInfo = {
                    ...config.updatedStoryInfo,
                    summary: refinedSummary,
                    contextNotes: mergedContext,
                    additionalRules: finalAdditionalRules
                };
                const specializedBasePrompt = generateBasePrompt(analysisStoryInfo.genres, analysisStoryInfo.worldSetting || [], analysisStoryInfo.enableTitleFormatting !== false);
                const specializedPrompt = await optimizePrompt(specializedBasePrompt, analysisStoryInfo, mergedContext, updatedDictionary, finalAdditionalRules, core.enabledModels);
                core.setPromptTemplate(specializedPrompt);
                
                core.setStoryInfo((prev: StoryInfo) => ({ 
                    ...prev, 
                    summary: refinedSummary,
                    contextNotes: mergedContext,
                    additionalRules: finalAdditionalRules,
                    deepAnalysisSignature: createStorySignature(filesToAnalyze),
                    deepAnalysisChapterCount: filesToAnalyze.length,
                    deepAnalysisCompletedAt: new Date().toISOString()
                }));

            } else {
                ui.setNameAnalysisProgress({ current: chunks.length, total: chunks.length, stage: "Đang lọc trùng và tạo từ điển..." });
                const cleanDictionary = deduplicateDictionary(results.join("\n"));
                core.setAdditionalDictionary((prev: string) => (prev ? prev + '\n' + cleanDictionary : cleanDictionary));
                ui.setDictTab('custom');
                downloadTextFile(`${config.updatedStoryInfo.title}_Dictionary.txt`, cleanDictionary);
            }
            ui.addToast(config.mode === 'deep_context'
                ? "Phân tích chuyên sâu hoàn tất. Series Bible, ma trận xưng hô và prompt đã được lưu để tái sử dụng."
                : "Phân tích hoàn tất!", "success");
            
            // --- FIX AUTOMATION HANG: Resume automation if running ---
            if (automation.automationState.isRunning && automation.automationState.currentStep === 2) {
                automation.resumeAutomationWithCooldown();
            }

        } catch (e: any) {
            ui.addToast(`Lỗi phân tích: ${e.message}`, "error");
        } finally {
            ui.setIsAnalyzingNames(false);
            ui.setShowNameAnalysisModal(false);
        }
    };

    const handleRefineContext = async () => {
        if (!core.storyInfo.contextNotes) return;
        ui.setIsRefiningContext(true);
        try {
            const refined = await refineRawContext(core.storyInfo.contextNotes, core.storyInfo, core.enabledModels);
            core.setStoryInfo((prev: StoryInfo) => ({ ...prev, contextNotes: refined }));
            ui.addToast("Đã hợp nhất ngữ cảnh thành công!", "success");
        } catch (e: any) {
            ui.addToast(`Lỗi hợp nhất: ${e.message}`, "error");
        } finally {
            ui.setIsRefiningContext(false);
        }
    };

    const handleRefineSummary = async () => {
        if (!core.storyInfo.contextNotes) {
            ui.addToast("Không có ngữ cảnh (Series Bible) để tạo tóm tắt. Cần phân tích ngữ cảnh trước.", "warning");
            return;
        }
        ui.addToast("Đang tạo tóm tắt...", "info");
        try {
            const refinedSummary = await refineSummary(core.storyInfo.contextNotes, core.storyInfo, core.enabledModels);
            core.setStoryInfo((prev: StoryInfo) => ({ ...prev, summary: refinedSummary }));
            ui.addToast("Tạo tóm tắt thành công!", "success");
        } catch (e: any) {
            ui.addToast(`Lỗi tạo tóm tắt: ${e.message}`, "error");
        }
    };

    const handleRefineAdditionalRules = async () => {
        if (!core.storyInfo.contextNotes) {
            ui.addToast("Không có ngữ cảnh (Series Bible) để tạo quy tắc. Cần phân tích ngữ cảnh trước.", "warning");
            return;
        }
        ui.addToast("Đang tinh chỉnh quy tắc bổ sung...", "info");
        try {
            const finalAdditionalRules = await refineAdditionalRules(core.storyInfo.additionalRules || "", core.storyInfo.contextNotes, core.storyInfo, core.enabledModels);
            core.setStoryInfo((prev: StoryInfo) => ({ ...prev, additionalRules: finalAdditionalRules }));
            ui.addToast("Tinh chỉnh quy tắc thành công!", "success");
        } catch (e: any) {
            ui.addToast(`Lỗi tinh chỉnh quy tắc: ${e.message}`, "error");
        }
    };

    return { handleSmartStartRun, handleNameAnalysis, handleRefineContext, handleRefineSummary, handleRefineAdditionalRules };
};
