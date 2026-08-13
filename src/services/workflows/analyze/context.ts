// Nhóm hàm PHÂN TÍCH NGỮ CẢNH truyện: phân tích từng đoạn (analyzeContextBatch), gộp nhiều
// kết quả phân tích lại (mergeContexts - đệ quy chia đôi), điều phối lấy mẫu + phân tích toàn
// bộ truyện (analyzeStoryContext), và gộp ngữ cảnh thô khi hết quota AI (refineRawContext).
import { getAiClient, smartExecution, SAFETY_SETTINGS } from '../../api/gemini';
import { StoryInfo, FileItem } from '../../../types';
import { cleanRepetitiveContent, extractPotentialEntities } from '../../../utils/text';
import { getSmartSampledFiles } from '../../../utils/fileHelpers';
import { GLOSSARY_ANALYSIS_PROMPT, MERGE_CONTEXT_PROMPT } from '../../../constants';

export const analyzeContextBatch = async (
    contentChunk: string, storyInfo: StoryInfo, existingDictionary: string, useSearch: boolean = false,
    forcedCandidates?: string[], additionalRules: string = "", enabledModels?: string[]
): Promise<string> => {
    const ai = getAiClient();
    let candidates = forcedCandidates || ['gemini-3.1-pro-preview', 'gemini-3.6-flash', 'gemini-3-flash-preview', 'gemini-3.5-flash'];
    candidates = candidates.filter(id => enabledModels?.includes(id) ?? true);
    if (candidates.length === 0) candidates = forcedCandidates || ['gemini-3.1-pro-preview', 'gemini-3.6-flash', 'gemini-3-flash-preview', 'gemini-3.5-flash'];
    const langs = storyInfo.languages.join(' ').toLowerCase();
    let sourceInstruction = "";
    
    if (langs.includes('trung') || langs.includes('chinese') || langs.includes('raw') || 
        langs.includes('anh') || langs.includes('english') || 
        langs.includes('nhật') || langs.includes('japan') || 
        langs.includes('hàn') || langs.includes('korea')) {
        sourceInstruction = "NGUỒN: RAW (NGOẠI NGỮ). BẮT BUỘC GIỮ NGUYÊN MẶT CHỮ GỐC Ở VẾ TRÁI (KEY). TUYỆT ĐỐI KHÔNG DỊCH VẾ TRÁI.";
    } else {
        sourceInstruction = "NGUỒN: CONVERT/TIẾNG VIỆT. BẮT BUỘC GIỮ TỪ GỐC TRONG VĂN BẢN (DÙ SAI CHÍNH TẢ) Ở VẾ TRÁI.";
    }

    const potentialEntities = extractPotentialEntities(contentChunk);
    const hintSection = potentialEntities.length > 0 
        ? `\n\n[GỢI Ý TỪ HỆ THỐNG (LOCAL EXTRACTION)]\nHệ thống đã quét sơ bộ và tìm thấy các cụm từ đáng chú ý sau. Hãy kiểm tra xem chúng là gì (Tên người, Địa danh, Chiêu thức, Vật phẩm...), dịch chúng và tìm thêm các tên riêng khác mà hệ thống bỏ sót:\n${potentialEntities.join(', ')}` 
        : "";

    const metaHeader = `[METADATA]\n- Tên: ${storyInfo.title}\n- Thể loại: ${storyInfo.genres.join(', ')}\n- Ngôn ngữ truyện: ${storyInfo.languages.join(', ')}\n- CHẾ ĐỘ: ${sourceInstruction}${additionalRules ? `\n- QUY TẮC BỔ SUNG: ${additionalRules}` : ''}${hintSection}`;

    return await smartExecution(candidates, async (modelId) => {
            const config: any = { systemInstruction: GLOSSARY_ANALYSIS_PROMPT, temperature: 0.2, safetySettings: SAFETY_SETTINGS, maxOutputTokens: 65536 };
            if (useSearch && (modelId.includes('gemini-3.1-pro') || modelId.includes('gemini-3-pro'))) config.tools = [{googleSearch: {}}];
            const response = await ai.models.generateContent({ model: modelId, contents: `${metaHeader}\n${contentChunk}`, config });
            
            if (response.candidates?.[0]?.finishReason === 'SAFETY' || response.candidates?.[0]?.finishReason === 'BLOCKLIST' || response.candidates?.[0]?.finishReason === 'PROHIBITED_CONTENT' || response.candidates?.[0]?.finishReason === 'OTHER' || response.candidates?.[0]?.finishReason === 'RECITATION' || response.candidates?.[0]?.finishReason === 'SPII') {
                throw new Error(`Bị chặn bởi bộ lọc an toàn (Safety Filter). Mặc dù đã dùng lệnh lách luật, nhưng nội dung quá nhạy cảm nên API vẫn từ chối. Vui lòng kiểm tra lại nội dung gốc. Finish Reason: ${response.candidates[0].finishReason}`);
            }
            
            return cleanRepetitiveContent(response.text || "");
        }, "Phân Tích Ngữ Cảnh", undefined, candidates[0]
    );
};

export const mergeContexts = async (
    contexts: string[], storyInfo: StoryInfo, enabledModels?: string[], forcedCandidates?: string[], pronounOverride?: string
): Promise<string> => {
    if (contexts.length === 0) return "";
    if (contexts.length === 1) return cleanRepetitiveContent(contexts[0]);
    
    // Recursive merge for large sets to avoid token limits
    if (contexts.length > 5) {
        const half = Math.ceil(contexts.length / 2);
        const left = await mergeContexts(contexts.slice(0, half), storyInfo, enabledModels, forcedCandidates, pronounOverride);
        const right = await mergeContexts(contexts.slice(half), storyInfo, enabledModels, forcedCandidates, pronounOverride);
        return mergeContexts([left, right], storyInfo, enabledModels, forcedCandidates, pronounOverride);
    }

    // Try 3.0 Pro first, then 2.5 Pro as backup
    // Try 3.1 Pro first
    const proModels = (forcedCandidates || ['gemini-3.1-pro-preview']).filter(id => id.includes('pro') && (enabledModels?.includes(id) ?? true));
    if (proModels.length === 0) proModels.push('gemini-3.1-pro-preview');
    
    try {
        return await smartExecution(proModels, async (modelId) => {
                const response = await getAiClient().models.generateContent({
                    model: modelId,
                    contents: `[DỮ LIỆU ĐẦU VÀO - GỒM ${contexts.length} PHẦN]\n${contexts.join("\n\n=== HẾT PHẦN ===\n\n")}${pronounOverride ? `\n\n${pronounOverride}` : ''}`,
                    config: { systemInstruction: MERGE_CONTEXT_PROMPT, temperature: 0.2, safetySettings: SAFETY_SETTINGS, maxOutputTokens: 65536 }
                });
                   
                if (response.candidates?.[0]?.finishReason === 'SAFETY' || response.candidates?.[0]?.finishReason === 'BLOCKLIST' || response.candidates?.[0]?.finishReason === 'PROHIBITED_CONTENT' || response.candidates?.[0]?.finishReason === 'OTHER' || response.candidates?.[0]?.finishReason === 'RECITATION' || response.candidates?.[0]?.finishReason === 'SPII') {
                    throw new Error(`Bị chặn bởi bộ lọc an toàn (Safety Filter). Mặc dù đã dùng lệnh lách luật, nhưng nội dung quá nhạy cảm nên API vẫn từ chối. Vui lòng kiểm tra lại nội dung gốc. Finish Reason: ${response.candidates[0].finishReason}`);
                }
                   
                return cleanRepetitiveContent(response.text || contexts[0]);
            }, "Hợp Nhất Ngữ Cảnh (Tích Lũy)", undefined, proModels[0]
        );
    } catch (e: any) {
        // FALLBACK: Try Flash models for a "Rough Merge" before giving up
        try {
            console.warn("Merge API (Pro) failed. Trying Flash for Rough Merge.", e);
            const fallbackModels = ['gemini-3.6-flash', 'gemini-3-flash-preview', 'gemini-3.5-flash'].filter(id => enabledModels?.includes(id) ?? true);
            if (fallbackModels.length === 0) fallbackModels.push('gemini-3.6-flash', 'gemini-3-flash-preview', 'gemini-3.5-flash');
            
            return await smartExecution(fallbackModels, async (modelId) => {
                const response = await getAiClient().models.generateContent({
                    model: modelId,
                    contents: `[DỮ LIỆU ĐẦU VÀO - GỒM ${contexts.length} PHẦN]\n${contexts.join("\n\n=== HẾT PHẦN ===\n\n")}\n\nNHIỆM VỤ: TỔNG HỢP THÔ DỮ LIỆU TRÊN. GIỮ NGUYÊN CÁC MỤC QUAN TRỌNG.${pronounOverride ? `\n\n${pronounOverride}` : ''}`,
                    config: { systemInstruction: MERGE_CONTEXT_PROMPT, temperature: 0.2, safetySettings: SAFETY_SETTINGS, maxOutputTokens: 65536 }
                });
                   
                if (response.candidates?.[0]?.finishReason === 'SAFETY' || response.candidates?.[0]?.finishReason === 'BLOCKLIST' || response.candidates?.[0]?.finishReason === 'PROHIBITED_CONTENT' || response.candidates?.[0]?.finishReason === 'OTHER' || response.candidates?.[0]?.finishReason === 'RECITATION' || response.candidates?.[0]?.finishReason === 'SPII') {
                    throw new Error(`Bị chặn bởi bộ lọc an toàn (Safety Filter). Mặc dù đã dùng lệnh lách luật, nhưng nội dung quá nhạy cảm nên API vẫn từ chối. Vui lòng kiểm tra lại nội dung gốc. Finish Reason: ${response.candidates[0].finishReason}`);
                }
                   
                return cleanRepetitiveContent(response.text || contexts[0]);
            }, "Hợp Nhất Thô", undefined, fallbackModels[0]);
        } catch (flashError) {
            // FINAL FALLBACK: RAW LOCAL MERGE (Tổng hợp thô)
            console.warn("Merge API (Flash) failed. Performing Local Raw Merge.", flashError);
            
            const rawMerge = contexts.join("\n\n# ==================================================\n# [HỆ THỐNG: CHẾ ĐỘ TỔNG HỢP THÔ (LOCAL MERGE)]\n# Do hết Quota, các phần dữ liệu được nối trực tiếp bên dưới.\n# ==================================================\n\n");
            return rawMerge;
        }
    }
};


export const analyzeStoryContext = async (files: FileItem[], storyInfo: StoryInfo, dictionary: string = "", useSearch: boolean = false, additionalRules: string = "", sampling: { start: number, middle: number, end: number } = { start: 100, middle: 100, end: 100 }, enabledModels?: string[]): Promise<string> => {
    const filesToAnalyze = getSmartSampledFiles(files, sampling);

    const CHUNK_SIZE = 800000;
    const allContent = filesToAnalyze.map(f => {
        let safeContent = f.content;
        safeContent = safeContent.replace(/([1-9]\d*)0000(?!\d)/g, '$1万');
        safeContent = safeContent.replace(/\.{6,}/g, '...');
        safeContent = safeContent.replace(/!{4,}/g, '!!!');
        safeContent = safeContent.replace(/\?{4,}/g, '???');
        return safeContent;
    }).join('\n');
    const chunks = [];
    for (let i = 0; i < allContent.length; i += CHUNK_SIZE) {
        chunks.push(allContent.substring(i, i + CHUNK_SIZE));
    }

    const results: string[] = [];
    const targetModels = ['gemini-3.1-pro-preview', 'gemini-3.6-flash', 'gemini-3-flash-preview', 'gemini-3.5-flash'].filter(id => enabledModels?.includes(id) ?? true);
    if (targetModels.length === 0) targetModels.push('gemini-3.1-pro-preview', 'gemini-3.6-flash', 'gemini-3-flash-preview', 'gemini-3.5-flash');
    
    const CONCURRENCY = 2;
    let completedChunks = 0;
    let progressNote = "";

    try {
        for (let i = 0; i < chunks.length; i += CONCURRENCY) {
            const batch = chunks.slice(i, i + CONCURRENCY);
            const batchPromises = batch.map(async (chunk, idx) => {
                const batchNum = Math.floor(i / CONCURRENCY) + 1;
                let models: string[] = [];
                if (batchNum <= 3) {
                    models = idx % 2 === 0 
                             ? ['gemini-3.1-pro-preview', 'gemini-3.6-flash', 'gemini-3-flash-preview', 'gemini-3.5-flash']
                             : ['gemini-3.6-flash', 'gemini-3-flash-preview', 'gemini-3.5-flash'];
                } else {
                    models = ['gemini-3.6-flash', 'gemini-3-flash-preview', 'gemini-3.5-flash'];
                }
                
                try {
                    return await analyzeContextBatch(chunk, storyInfo, dictionary, useSearch, models, additionalRules, enabledModels);
                } catch (e: any) {
                    console.warn(`Primary models failed for chunk ${i + idx}, falling back to Flash for raw analysis.`, e);
                    try {
                        const flashRes = await analyzeContextBatch(chunk, storyInfo, dictionary, useSearch, ['gemini-3.6-flash', 'gemini-3-flash-preview', 'gemini-3.5-flash'], additionalRules + "\nLƯU Ý: ĐÂY LÀ BẢN PHÂN TÍCH THÔ DO HẾT QUOTA. CHỈ TRÍCH XUẤT NHANH CÁC DANH TỪ RIÊNG.", enabledModels);
                        progressNote = "\n\n[CẢNH BÁO: Quá trình phân tích bị gián đoạn do hết Quota/Lỗi mạng. Một số phần được lưu dưới dạng phân tích thô bằng Flash.]";
                        return flashRes + "\n[GHI CHÚ: BẢN PHÂN TÍCH THÔ BẰNG FLASH DO HẾT QUOTA]";
                    } catch (flashError) {
                        console.error(`Flash fallback also failed for chunk ${i + idx}:`, flashError);
                        progressNote = "\n\n[CẢNH BÁO: Quá trình phân tích bị gián đoạn do hết Quota/Lỗi mạng. Một số phần bị bỏ qua.]";
                        return "";
                    }
                }
            });
            
            const batchResults = await Promise.all(batchPromises);
            const validResults = batchResults.filter(r => r.length > 50);
            results.push(...validResults);
            completedChunks += validResults.length;
            
            if (i + CONCURRENCY < chunks.length) await new Promise(r => setTimeout(r, 2000));
        }
    } catch (e: any) {
        console.warn("Analysis interrupted (Quota/Network):", e);
        const percent = Math.round((completedChunks / chunks.length) * 100);
        
        // Fallback: Use 2.5 Flash to save raw progress if possible, otherwise just note it.
        // The user said: "sử dụng 2.5 flash để lưu lại thông tin phân tích theo dạng thô"
        // We will append a note saying we are saving raw data.
        progressNote = `\n\n# === [HỆ THỐNG GHI CHÚ TIẾN ĐỘ] ===\n- Trạng thái: TẠM DỪNG (Interrupted)\n- Lý do: Hết Quota API hoặc Lỗi mạng.\n- Tiến độ: Đã phân tích ${completedChunks}/${chunks.length} phần dữ liệu (~${percent}%).\n- Dữ liệu thô đã được lưu lại. Khi có Quota, hãy chạy lại Phân tích.`;
    }

    if (results.length === 0) return "Chưa phân tích được dữ liệu nào do lỗi kết nối/quota ngay từ đầu.";
    
    // Attempt merge even if interrupted
    let finalMerge = "";
    try {
        finalMerge = await mergeContexts(results, storyInfo);
    } catch {
        // Should not happen as mergeContexts now has local fallback, but safe check
        finalMerge = results.join("\n\n=== [DỮ LIỆU THÔ CHƯA HỢP NHẤT] ===\n\n");
    }

    return finalMerge + progressNote;
};

export const refineRawContext = async (rawContext: string, storyInfo: StoryInfo, enabledModels?: string[]): Promise<string> => {
    const parts = rawContext.split("# ==================================================\n# [HỆ THỐNG: CHẾ ĐỘ TỔNG HỢP THÔ (LOCAL MERGE)]\n# Do hết Quota, các phần dữ liệu được nối trực tiếp bên dưới.\n# ==================================================\n\n");
    if (parts.length <= 1) return rawContext; // Not raw merged data
    
    return await mergeContexts(parts, storyInfo, enabledModels);
};
