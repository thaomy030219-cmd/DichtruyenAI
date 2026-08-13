// Phân tích tên nhân vật/địa danh (glossary) trong 1 đoạn nội dung.
import { getAiClient, smartExecution, SAFETY_SETTINGS } from '../../api/gemini';
import { StoryInfo } from '../../../types';
import { cleanRepetitiveContent, extractPotentialEntities } from '../../../utils/text';
import { NAME_ANALYSIS_PROMPT } from '../../../constants';

export const analyzeNameBatch = async (
    contentChunk: string, storyInfo: StoryInfo, mode: 'only_char' | 'full', useSearch: boolean = false,
    additionalRules: string = "", forcedCandidates?: string[], enabledModels?: string[]
): Promise<string> => {
    const ai = getAiClient();
    let candidates = forcedCandidates || (useSearch ? ['gemini-3.1-pro-preview'] : ['gemini-3.1-pro-preview', 'gemini-3.6-flash', 'gemini-3-flash-preview', 'gemini-3.5-flash']);
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
        ? `\n\n[GỢI Ý TỪ HỆ THỐNG (LOCAL EXTRACTION)]\nHệ thống đã quét sơ bộ và tìm thấy các cụm từ đáng chú ý sau. Hãy kiểm tra xem chúng là gì, dịch chúng và tìm thêm các tên riêng khác mà hệ thống bỏ sót:\n${potentialEntities.join(', ')}` 
        : "";

    const metaHeader = `[METADATA]\nTên: ${storyInfo.title}\nNgôn ngữ truyện: ${storyInfo.languages.join(', ')}\nYêu cầu: ${mode === 'only_char' ? 'Chỉ nhân vật' : 'Toàn bộ tên riêng'}.\nCHẾ ĐỘ: ${sourceInstruction}${additionalRules ? `\nQUY TẮC BỔ SUNG: ${additionalRules}` : ''}${hintSection}`;

    return await smartExecution(candidates, async (modelId) => {
             const config: any = { systemInstruction: NAME_ANALYSIS_PROMPT, temperature: 0.1, safetySettings: SAFETY_SETTINGS, maxOutputTokens: 65536 };
             if (useSearch && (modelId.includes('gemini-3.1-pro') || modelId.includes('gemini-3-pro'))) config.tools = [{googleSearch: {}}];
             const res = await ai.models.generateContent({ model: modelId, contents: `${metaHeader}\n${contentChunk}`, config });
             
             if (res.candidates?.[0]?.finishReason === 'SAFETY' || res.candidates?.[0]?.finishReason === 'BLOCKLIST' || res.candidates?.[0]?.finishReason === 'PROHIBITED_CONTENT' || res.candidates?.[0]?.finishReason === 'OTHER' || res.candidates?.[0]?.finishReason === 'RECITATION' || res.candidates?.[0]?.finishReason === 'SPII') {
                 throw new Error(`Bị chặn bởi bộ lọc an toàn (Safety Filter). Mặc dù đã dùng lệnh lách luật, nhưng nội dung quá nhạy cảm nên API vẫn từ chối. Vui lòng kiểm tra lại nội dung gốc. Finish Reason: ${res.candidates[0].finishReason}`);
             }
             
             let text = res.text || "";
             // Fix Gemini Math Mode hallucinations for arrows
             text = text.replace(/->/g, '=').replace(/\\rightarrow/g, '=').replace(/\(\$\s*=\s*\$\)/g, '=').replace(/\(\s*rightarrow\s*\)/gi, '=').replace(/\(\s*\\rightarrow\s*\)/gi, '=');
             return cleanRepetitiveContent(text);
        }, "Phân Tích Tên Riêng", undefined, candidates[0]
    );
};
