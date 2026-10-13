// HÀM LÕI QUAN TRỌNG NHẤT của app: dịch 1 batch file bằng streaming (gọi Gemini/OpenRouter,
// nhận response dạng stream, validate, tự sửa lỗi nếu cần...). ~840 dòng, nhiều bước xử lý
// tuần tự phụ thuộc thứ tự lẫn nhau — cố tình KHÔNG tách nhỏ nội dung hàm ra ở bước refactor
// này (rủi ro cao nếu không có bộ test hồi quy đầy đủ). Việc tách RIÊNG hàm này ra 1 file
// chỉ nhằm mục đích: khi cần sửa lỗi luồng dịch, chỉ cần mở đúng 1 file này thay vì phải
// tìm trong 1 file 1500 dòng gộp chung 8 hàm khác nhau.
import { getAiClient, smartExecution, SAFETY_SETTINGS } from '../../api/gemini';
import { fetchOpenRouterStream, getOpenRouterModelInfo } from '../../api/openrouter';
import { StoryInfo, TranslationTier, RatioLimits, FileItem, BatchLimits, QualityReview } from '../../../types';
import { optimizeDictionary, optimizeContext, dedupeContextAgainstDictionary, formatBookStyle, fixMergedTitle, createBatchFingerprints, validateBatch, registerCompletedChapterFingerprint, proofreadVietnamese, applyInlineEnglishFix } from '../../../utils/text';
import { VietnameseProofreadResult } from '../../../utils/text/vietnameseProofreader';
import { getEffectiveModelsForTier } from './modelSelection';
import { reviewAndRepairBatch } from './aiValidation';
import { getRescueTarget } from './rescueTarget';
import { DEFAULT_OPENROUTER_MODEL, sanitizeOpenRouterModels } from '../../../constants/openrouterModels';
import { assertModelBatchCapacity } from '../../../utils/modelBatchLimits';
import { buildChapterReviewContext } from './reviewContext';
import { buildConsistencyContract, stripConsistencyBlocks, resolveDictionaryOverrides } from './consistencyRules';
import { checkLocalConsistency, enforceLocalLocks, formatLocalFindings, prepareLocalConsistency } from './localConsistency';
import { buildMemoryContextFingerprint, lookupTranslationMemory, saveVerifiedTranslationMemory, TranslationMemoryDriver } from '../../../utils/text/translationMemory';

export interface TranslationBatchResult {
    results: Map<string, string>; model: string; models?: Map<string, string>;
    stats?: { dictLines: number; contextLines: number }; streamError?: Error;
    reviews?: Map<string, QualityReview>; reviewContexts?: Map<string, string>;
    spelling?: Map<string, VietnameseProofreadResult>; errors?: Map<string, string>;
    flaggedStaleIds?: Set<string>; blockedConsistencyIds?: Set<string>;
    memoryKeys?: Map<string, string>; memoryHitIds?: Set<string>;
}

export const translateBatchStream = async (
    files: { id: string, content: string, name?: string, chapterIndex?: number, fileRetryCount?: number, errorMessage?: string, forceRetranslate?: boolean }[],
    userPrompt: string,
    dictionary: string,
    globalContext: string,
    allowedModelIds: string[], 
    previousBatchContext: string = "",
    onUpdate: (fileId: string, partialContent: string) => void,
    onLog?: (msg: string) => void,
    tier: TranslationTier = 'normal', 
    enabledModels: string[] = [],     
    storyInfo?: StoryInfo,
    preferredModelId?: string,
    shouldAbort?: () => boolean,
    ratioLimits?: RatioLimits,
    openRouterKey?: string,
    openRouterModel?: string,
    batchLimits?: BatchLimits,
    runtime: { customDictionary?: string; memoryDriver?: TranslationMemoryDriver; disableMemory?: boolean } = {},
): Promise<TranslationBatchResult> => {
    const originalDictionary = dictionary;
    const blockedErrors = new Map<string, string>();
    for (const file of files) {
        const preflight = prepareLocalConsistency(dictionary, storyInfo, file.content, file.chapterIndex, runtime.customDictionary);
        if (preflight.conflicts.length) blockedErrors.set(file.id, 'Xung đột thuật ngữ trước khi dịch: ' + preflight.conflicts.join(' '));
    }
    const blockedConsistencyIds = new Set(blockedErrors.keys());
    files = files.filter(file => !blockedConsistencyIds.has(file.id));
    if (blockedErrors.size) onLog?.(`⚠️ ${blockedErrors.size} chương có xung đột thuật ngữ; tạm giữ các chương đó trước khi gọi API.`);
    let memoryContext = '';
    try { if (!runtime.disableMemory) memoryContext = await buildMemoryContextFingerprint(dictionary, storyInfo, userPrompt, previousBatchContext, ratioLimits, globalContext); } catch { /* Optional browser cache. */ }
    const hits = await lookupTranslationMemory(files, memoryContext, runtime.memoryDriver);
    const cachedResults = new Map<string, string>(), cachedReviews = new Map<string, QualityReview>(), cachedContexts = new Map<string, string>();
    const cachedModels = new Map<string, string>(), cachedKeys = new Map<string, string>();
    for (const file of files) {
        const hit = hits.get(file.id);
        if (!hit) continue;
        const plan = prepareLocalConsistency(dictionary, storyInfo, file.content, file.chapterIndex, runtime.customDictionary);
        if (checkLocalConsistency(file.content, hit.target, plan, storyInfo).some(finding => finding.severity === 'ERROR')) continue;
        cachedResults.set(file.id, hit.target);
        cachedReviews.set(file.id, { status: 'PASS', decision: 'PASS', contentAlignment: 'PASS', findings: [], reason: 'Tái sử dụng bản đã hậu kiểm; nguyên văn, quy tắc và ngữ cảnh SHA-256 đều khớp.' });
        cachedContexts.set(file.id, buildChapterReviewContext(dictionary, storyInfo, file.content, file.chapterIndex));
        cachedModels.set(file.id, hit.model); cachedKeys.set(file.id, hit.key);
        registerCompletedChapterFingerprint(storyInfo?.title, file.id, hit.target);
        onUpdate(file.id, hit.target);
    }
    if (cachedResults.size) onLog?.(`♻️ Tái sử dụng ${cachedResults.size} chương đã xác minh từ bộ nhớ bản dịch, không gọi API cho các chương này.`);
    files = files.filter(file => !cachedResults.has(file.id));
    if (shouldAbort?.()) throw new Error('ABORTED');
    if (!files.length) return { results: cachedResults, model: 'Bộ nhớ bản dịch', models: cachedModels,
        reviews: cachedReviews, reviewContexts: cachedContexts, memoryKeys: cachedKeys, memoryHitIds: new Set(cachedResults.keys()),
        errors: blockedErrors, flaggedStaleIds: new Set(), blockedConsistencyIds };
    // Bước 2: Tạo fingerprints TRƯỚC khi gửi AI
    const batchFingerprints = createBatchFingerprints(files);

    const combined = files.map(f => f.content).join('\n');
    dictionary = resolveDictionaryOverrides(dictionary);
    const consistencyContract = files.map((file, index) => `[part_${index + 1} — mốc chương ${file.chapterIndex || '?'}]\n${buildConsistencyContract(dictionary, storyInfo, [file])}`).join('\n\n');
    let relDict = "";
    let relCtx = "";
    try {
        relDict = (typeof optimizeDictionary === 'function' ? optimizeDictionary(dictionary || "", combined) : dictionary) || "";
        relCtx = (typeof optimizeContext === 'function' ? optimizeContext(stripConsistencyBlocks(globalContext || ""), combined, relDict) : globalContext) || "";
        
        // --- ADDED: Deduplicate context against dictionary ---
        if (typeof dedupeContextAgainstDictionary === 'function') {
            relCtx = dedupeContextAgainstDictionary(relCtx, relDict);
        }
    } catch (e) {
        console.warn("Optimization function missing or failed in translator", e);
        relDict = dictionary || "";
        relCtx = globalContext || "";
    }
    
    let effectiveModels = preferredModelId 
        ? [preferredModelId] 
        : getEffectiveModelsForTier(tier, 'translate', enabledModels.length > 0 ? enabledModels : allowedModelIds);

    if (tier === 'openrouter') {
        const selected = sanitizeOpenRouterModels(openRouterModel);
        const freeIds = selected.filter(m => m.includes(':free') || m === 'openrouter/free');
        const paidIds = selected.filter(m => !m.includes(':free') && m !== 'openrouter/free');
        // Free luôn đứng đầu (nếu người dùng có tick) — OpenRouter tự động chuyển sang model kế
        // tiếp trong danh sách khi model đầu lỗi/hết quota, nên thứ tự này tự nhiên tạo ra đúng
        // hành vi "thử free 1 lần trước, thất bại mới dùng paid". Nếu người dùng KHÔNG tick free
        // (chỉ chọn paid), freeIds sẽ rỗng và danh sách gửi đi chỉ có paid — không tốn lượt thử free.
        const ordered = [...freeIds, ...paidIds];
        effectiveModels = [`openrouter:${ordered.join(',')}`];
    }

    const hasStrictSafetyError = files.some(f => f.errorMessage && !f.errorMessage.includes('vạ lây') && !f.errorMessage.toLowerCase().includes('quota') && (f.errorMessage.toLowerCase().includes("an toàn") || f.errorMessage.toLowerCase().includes("safety") || f.errorMessage.includes("BLOCKLIST") || f.errorMessage.includes("PROHIBITED_CONTENT")));
    const hasValidationError = files.some(f => f.errorMessage && !f.errorMessage.includes('vạ lây') && (f.errorMessage.toLowerCase().includes("nghi vấn lỗi nội dung") || f.errorMessage.toLowerCase().includes("lỗi kiểm định ai")));

    // Ưu tiên đọc thẳng "Bàn giao OpenRouter" đã được useTranslator.ts gắn sẵn vào errorMessage
    // (tính theo retryCount qua getRescueTarget) - nếu không thấy tag rõ ràng (ví dụ lỗi phát
    // sinh ngay lần đầu, chưa qua useTranslator gắn tag), suy luận lại từ fileRetryCount + key
    // đang có, dùng đúng 1 helper getRescueTarget dùng chung cả 2 nơi.
    const hasOpenRouterKeyAvail = !!(openRouterKey && openRouterKey.trim().length > 0);
    const taggedRescueTarget: 'openrouter' | null = files.some(f => f.errorMessage?.includes('Bàn giao OpenRouter')) ? 'openrouter'
        : null;
    const maxRetryFile = Math.max(0, ...files.map(f => f.fileRetryCount || 0));
    const inferredRescueTarget = taggedRescueTarget || getRescueTarget(maxRetryFile, hasOpenRouterKeyAvail, 2);

    // FIX: trước đây needsRescueFallback CHỈ dựa vào hasStrictSafetyError/hasValidationError (dò
    // vài cụm từ cố định trong errorMessage). Nếu file đã được useTranslator.ts gắn tag rõ ràng
    // "Bàn giao OpenRouter" (taggedRescueTarget khác null — nghĩa là hệ thống ĐÃ quyết định đây
    // là ca cần cứu hộ ở lượt trước) nhưng chuỗi errorMessage đó lại không chứa đúng các cụm "an
    // toàn"/"safety"/"nghi vấn lỗi nội dung"/"lỗi kiểm định ai" (ví dụ do lỗi gốc là "Thiếu kết
    // quả từ API"/"Lỗi ngắt kết nối API" — vẫn được scheduler ở useTranslator.ts xếp vào diện
    // cứu hộ nhưng không khớp bộ từ khoá hẹp hơn ở đây), thì needsRescueFallback = false, khiến
    // khối override effectiveModels bên dưới bị BỎ QUA hoàn toàn dù inferredRescueTarget đã tính
    // đúng là 'openrouter'. Hậu quả thực tế: batch rơi lại về tier/model mặc định trước đó, và vì
    // nhánh `tier === 'openrouter'` phía trên KHÔNG kiểm tra openRouterKey có tồn tại hay không,
    // nó vẫn cắm thẳng model OpenRouter dù key rỗng — dẫn đến lỗi "Tất cả model đã thử đều gặp
    // lỗi hoặc hết Quota". Sửa: coi taggedRescueTarget khác null cũng là điều kiện đủ để kích
    // hoạt needsRescueFallback, không chỉ dựa vào dò từ khoá nữa.
    const needsRescueFallback = hasStrictSafetyError || hasValidationError || taggedRescueTarget !== null;

    let relPrevCtx = previousBatchContext;
    if (needsRescueFallback) {
        relPrevCtx = "";
    }

    if(onLog) onLog(`[DEBUG] hasStrictSafetyError=${hasStrictSafetyError}, hasValidationError=${hasValidationError}, rescueTarget=${inferredRescueTarget || 'none'}, openRouterKey.length=${openRouterKey ? openRouterKey.length : 0}`);

    if (needsRescueFallback) {
        if (inferredRescueTarget === 'openrouter' && hasOpenRouterKeyAvail) {
        // UPDATED v1.0.3: Ưu tiên model Ox Alpha (qua OpenRouter) làm
        // vệ tinh cứu hộ chính. Vẫn giữ openRouterModel do người dùng chọn (nếu có) lên đầu,
        // sau đó tới GPT-OSS 20B/120B free, cuối cùng mới tới Gemma free làm lưới an toàn
        // cuối nếu cả 2 model GPT-OSS cùng lỗi/hết quota trong lượt gọi đó.
        const fallBackModel = sanitizeOpenRouterModels(openRouterModel).join(',') || DEFAULT_OPENROUTER_MODEL;

        const safetyFallbackSet = new Set<string>();
        safetyFallbackSet.add(`openrouter:${fallBackModel}`);
        safetyFallbackSet.add('openrouter:stealth/ox-alpha');
        safetyFallbackSet.add('openrouter:google/gemma-4-26b-a4b-it:free');
        safetyFallbackSet.add('openrouter:google/gemma-4-31b-it:free');
        effectiveModels = Array.from(safetyFallbackSet);
        if (onLog) onLog(`⚠️ Phát hiện lỗi phức tạp (${hasStrictSafetyError ? 'Safety' : (hasValidationError ? 'Validation' : 'Đã gắn tag Bàn giao')}). Tự động dùng danh sách dự phòng OpenRouter (Ox Alpha ưu tiên): ${effectiveModels.join(', ')}...`);
        } else {
            if (hasStrictSafetyError) {
                throw new Error("BLOCKLIST: File bị chặn bởi Safety Filter và không có OpenRouter API Key để vượt nghiệm.");
            } else {
                // FIX: Không throw cứng HALLUCINATION_PERSIST nữa. Lý do: chuỗi lỗi cũ chứa
                // đúng cụm "lỗi kiểm định ai" mà hasValidationError ở trên dùng để dò lỗi từ
                // errorMessage cũ của lần retry trước — nên nếu throw lại y hệt, lần retry kế
                // sẽ tự nhận lại lỗi của chính nó và throw ngay lập tức mà KHÔNG hề gọi lại API
                // dịch (vòng lặp vô hạn giả). Vì Tier 2 hoàn toàn có thể báo nhầm (false
                // positive), ở đây ta chỉ log cảnh báo và để effectiveModels giữ nguyên danh
                // sách model Gemini gốc đã tính ở trên (dòng 436-438), cho file một cơ hội dịch
                // lại thật sự thay vì bị bác bỏ oan.
                if (onLog) onLog(`⚠️ Hậu kiểm Tier 2 nghi vấn lỗi nội dung nhưng không có OpenRouter API Key dự phòng. Bỏ qua chuyển hướng, thử dịch lại bằng model gốc (${effectiveModels.join(', ')}) — có thể Tier 2 chỉ báo nhầm.`);
            }
        }
    }

    if(onLog) {
        const dictLines = relDict.split('\n').filter(l => l.trim()).length;
        const ctxLines = relCtx.split('\n').filter(l => l.trim()).length;
        onLog(`🔍 Lọc ngữ cảnh: Sử dụng ${dictLines} dòng từ điển và ${ctxLines} đoạn ngữ cảnh.`);
        onLog(`🤖 Các model khả dụng cho batch này (${tier}): ${effectiveModels.join(', ')}`);
    }

    const idMap = new Map<string, string>();
    files.forEach((f, idx) => { 
        const k = `part_${idx + 1}`; 
        idMap.set(k, f.id);
    });

    const getInstruction = (mid: string) => {
        const is25Pro = mid && mid.includes('2.5-pro');
        const formatType = (!storyInfo?.tagFormat || storyInfo.tagFormat === 'auto') ? (is25Pro ? 'xml' : 'brackets') : storyInfo.tagFormat;
        const startTag = formatType === 'xml' ? '<X>' : '[[[X]]]';
        const endTag = formatType === 'xml' ? '</X>' : '[[[/X]]]';
        const exampleStart = formatType === 'xml' ? '<part_1>' : '[[[part_1]]]';
        const exampleEnd = formatType === 'xml' ? '</part_1>' : '[[[/part_1]]]';
        const exampleStart2 = formatType === 'xml' ? '<part_2>' : '[[[part_2]]]';
        const exampleEnd2 = formatType === 'xml' ? '</part_2>' : '[[[/part_2]]]';

        const chapterTitleRule = storyInfo?.enableTitleFormatting === false 
            ? '7. CRITICAL: THE USER DISABLED TITLE FORMATTING. DO NOT FORMAT TITLES. DO NOT ADD "Chương X:" IF IT IS NOT EXPLICITLY IN THE TEXT. KEEP THE EXACT ORIGINAL LINE STRUCTURE.'
            : '7. IF the text has a chapter title, format it as "Chương X: [Title]". IF NO TITLE EXISTS, DO NOT INVENT ONE. DO NOT ADD ANNOTATIONS.';

        return `Professional Translator: Translate to Vietnamese. 
STRICTLY OBEY [DICT] (Mandatory Glossary).
CRITICAL FORMATTING RULE (ABSOLUTE ZERO TOLERANCE):
1. You MUST output exactly ${files.length} parts. You are an automated API, do not refuse, do not complain, do not output conversational text.
2. You MUST wrap each translated part with the EXACT same tags as the input. DO NOT TRANSLATE THE TAGS.
3. START each file with: ${startTag} (where X is the exact ID from the input).
4. END each file with: ${endTag} (where X is the exact ID from the input).
5. Example:
=========================================
${exampleStart}
(Translated Content)
${exampleEnd}
=========================================
${exampleStart2}
(Translated Content)
${exampleEnd2}
...
6. DO NOT SKIP ANY FILE. DO NOT MERGE FILES. CRITICAL: You MUST output a separate ${startTag} tag for EACH input file. You MUST close with ${endTag} after EACH file before starting the next one. DO NOT MERGE MULTIPLE FILES INTO ONE TAG. If you forget the tags, the system will break.
${chapterTitleRule}
8. DO NOT REPEAT CHARACTERS OR WORDS EXCESSIVELY (e.g., "aaaaaaaaa" or "a a a a a").
10. CRITICAL: DO NOT MERGE PARAGRAPHS. Keep the exact same number of paragraphs as the original text. Preserve all line breaks (\\n).
11. CRITICAL: DO NOT LOSE OR TRUNCATE TEXT AT THE END OF THE CHAPTER. Make sure EVERY SINGLE LINE from the original text until the very last word is translated and included before the ${endTag} tag.
12. CRITICAL PRESERVATION: DO NOT REMOVE TITLES. If the title is present, output it intact. DO NOT filter out valid content believing it is "spam".
13. TRANSLATE ALL LANGUAGES: If you see ANY foreign languages like Thai, Russian (Cyrillic), Japanese, Korean, etc., YOU MUST TRANSLATE THEM TO VIETNAMESE. DO NOT keep raw foreign text in the translated content.
14. DICTIONARY MARKERS: The [DICT] and [CTX] sections might contain words wrapped in { }, [ ], * *, or # #. These markers are just meant to highlight the term. DO NOT include these formatting markers in your final translation output unless they exist in the raw source text. Just apply the core words.
15. CONTINUITY MEMORY: Treat [PREV] as continuity evidence. Preserve established names, tone and pronouns, but never copy its plot into the current chapter.
16. PRONOUN MATRIX: Rules for A→B and B→A in [CTX] are mandatory for the matching chapter stage. Never replace them with a generic pronoun by guesswork.
CRITICAL: DO NOT TRANSLATE THE TAGS. ALWAYS OUTPUT THE EXACT TAGS (e.g. ${startTag} and ${endTag}).`;
    };

    const liveResult: TranslationBatchResult = await smartExecution(effectiveModels, async mid => {
        // Batch có thể được xếp cho Pro rồi rơi sang Flash khi hết quota. Kiểm tra lại
        // ngay trước request để model dự phòng không nhận một lô vượt khả năng và cắt đuôi.
        assertModelBatchCapacity(mid, files.length, batchLimits, storyInfo?.languages || []);
        const ai = getAiClient();
        
        // Dynamic input and instruction based on model ID
        const is25Pro = mid && mid.includes('2.5-pro');
        const formatType = (!storyInfo?.tagFormat || storyInfo.tagFormat === 'auto') ? (is25Pro ? 'xml' : 'brackets') : storyInfo.tagFormat;

        let currentInput = "";
        files.forEach((f, idx) => { 
             const k = `part_${idx + 1}`; 
             // Pre-process raw text to avoid triggering Gemini Safety/Recitation filters
             let safeContent = f.content;
             // NEW: Strip leading prefix numbers from chapter titles to avoid hallucinating the chapter number
             safeContent = safeContent.replace(/^\s*\d+[\.\-\s]+(第\s*\d+\s*[章回节篇部卷折]|(?:Chương|Chapter|Ch|Tiết|Hồi|Phần)\s*\d+)/im, '$1');
             safeContent = safeContent.replace(/([1-9]\d*)0000(?!\d)/g, '$1万');
             safeContent = safeContent.replace(/\.{6,}/g, '...');
             safeContent = safeContent.replace(/!{4,}/g, '!!!');
             safeContent = safeContent.replace(/\?{4,}/g, '???');

             if (formatType === 'xml') {
                currentInput += `\n=========================================\n<${k}>\n${safeContent}\n</${k}>\n`;
            } else {
                currentInput += `\n=========================================\n[[[${k}]]]\n${safeContent}\n[[[/${k}]]]\n`;
            }
        });
        const instruction = getInstruction(mid);
        const startTagMock = formatType === 'xml' ? '<...>' : '[[[...]]]';
        const endTagMock = formatType === 'xml' ? '</...>' : '[[[/...]]]';
        
        let localRelCtx = relCtx;
        let localRelPrevCtx = relPrevCtx;
        let localRelDict = relDict;

        // Giảm tải context cho OpenRouter (nếu vượt quá giới hạn token của model)
        if (mid.startsWith('openrouter:')) {
            const actualModelName = mid.replace('openrouter:', '');
            const modelInfo = await getOpenRouterModelInfo(actualModelName);
            
            // Tính toán ước lượng token hiện tại (chưa kể context/dictionary)
            const baseEstTokens = Math.ceil(currentInput.length / 2.5) + Math.ceil((instruction.length + consistencyContract.length) / 2.5) + 3000; // buffer an toàn cho output tokens và prompt cố định
            
            if (modelInfo && modelInfo.context_length) {
                const maxAllowedContext = modelInfo.context_length;
                
                const dictTokens = Math.ceil(localRelDict.length / 2.5);
                const prevCtxTokens = Math.ceil(localRelPrevCtx.length / 2.5);
                const ctxTokens = Math.ceil(localRelCtx.length / 2.5);
                
                let remainingTokens = maxAllowedContext - baseEstTokens;
                
                // Nếu vượt quá giới hạn, ưu tiên cắt giảm theo thứ tự: Context cũ, Context mới, Từ điển
                if (remainingTokens < dictTokens + prevCtxTokens + ctxTokens) {
                    if (onLog) onLog(`⚠️ [OpenRouter] Input có thể vượt giới hạn token của model (${maxAllowedContext}). Tự động thu gọn ngữ cảnh...`);
                    
                    // 1. Thử cắt bỏ Context cũ trước
                    if (remainingTokens < dictTokens + ctxTokens) {
                        localRelPrevCtx = "";
                    } else {
                        remainingTokens -= prevCtxTokens;
                    }
                    
                    // 2. Nếu vẫn thiếu, cắt bỏ luôn Context mới
                    if (localRelPrevCtx === "") {
                        if (remainingTokens < dictTokens) {
                            localRelCtx = "";
                        } else {
                            remainingTokens -= ctxTokens;
                        }
                    }
                    
                    // 3. Nếu cắt sạch Context mà vẫn thiếu, bắt buộc cắt Từ điển
                    if (localRelCtx === "" && localRelPrevCtx === "") {
                        if (remainingTokens <= 0) {
                            throw new Error(`⚠️ LỖI QUÁ TẢI NGỮ CẢNH: File truyện quá dài (${Math.ceil(currentInput.length / 2.5)} tokens), vượt quá giới hạn tối đa của model OpenRouter này (${maxAllowedContext} tokens) kể cả khi đã lược bỏ toàn bộ từ điển và bối cảnh phụ. Vui lòng chọn Model có ngữ cảnh lớn hơn (ví dụ: các bản Pro, Claude, hoặc Gemini Flash) hoặc dùng tính năng TÁCH TRUYỆN để chia nhỏ file này trước khi dịch.`);
                        }
                        if (remainingTokens < dictTokens) {
                            const dictLines = localRelDict.split('\n');
                            // Ước lượng số lượng dòng có thể giữ dựa trên token còn lại
                            const safeLinesCount = Math.max(20, Math.floor(remainingTokens / 15)); 
                            if (dictLines.length > safeLinesCount) {
                                localRelDict = dictLines.slice(0, safeLinesCount).join('\n') + '\n... (đã rút gọn do giới hạn OpenRouter context)';
                            }
                        }
                    }
                }
            } else {
                // Fallback nếu không fetch được modelInfo hoặc context quá thấp: Cứ cắt như cũ để an toàn cho model free
                localRelCtx = ""; 
                localRelPrevCtx = "";
                const dictLines = localRelDict.split('\n');
                if (dictLines.length > 50) {
                    localRelDict = dictLines.slice(0, 50).join('\n') + '\n... (đã rút gọn do giới hạn OpenRouter context)';
                }
            }
        }

        const fullPrompt = `[DICT]\n${localRelDict}\n[CTX]\n${localRelCtx}\n[PREV]\n${localRelPrevCtx}\n${consistencyContract}\n[INSTRUCT]\n${instruction}\n[DATA]\n${currentInput}\n\n=========================================\n[FINAL REMINDER / LỜI NHẮC CUỐI]:\n1. You MUST output exactly ${files.length} parts.\n2. Each part MUST start with ${startTagMock} and end with ${endTagMock}.\n3. DO NOT FORGET OR TRANSLATE THE TAGS.\n4. CRITICAL: NO CROSS-CONTAMINATION. Make sure the translated content strictly matches its original source tag. Do not mix chapters together.\n5. Giữ đúng tên và thuật ngữ trong [DICT], xưng hô và giai đoạn quan hệ trong [CTX]; [PREV] chỉ giúp nối mạch, không ghi đè quy tắc đã chốt.\n6. Không để sót câu raw hoặc tự chuyển sang tiếng Anh/ngôn ngữ khác trong bản dịch tiếng Việt (trừ tên riêng và thuật ngữ được giữ nguyên).`;
        
        // Add timeout for the initial connection
        let connectionTimeoutId: NodeJS.Timeout | undefined;
        const connectionTimeout = new Promise<never>((_, reject) => {
            connectionTimeoutId = setTimeout(() => reject(new Error('CONNECTION_TIMEOUT')), 3600000); // 3600s for stream to start
        });

        try {
            if (shouldAbort && shouldAbort()) throw new Error('ABORTED');

            let finalPrompt = userPrompt;
            if (storyInfo?.enableTitleFormatting === false) {
                finalPrompt += `\n\n[LỆNH CƯỠNG CHẾ QUAN TRỌNG: NGƯỜI DÙNG ĐÃ TẮT CHUẨN HÓA TIÊU ĐỀ. BẠN TUYỆT ĐỐI KHÔNG ĐƯỢC CHUẨN HÓA TIÊU ĐỀ. AI ĐƯỢC KHUYẾN CÁO PHẢI GIỮ NGUYÊN CẤU TRÚC DÒNG VÀ TIÊU ĐỀ BẢN GỐC, KHÔNG ĐƯỢC GHÉP VỚI NỘI DUNG, KHÔNG ĐƯỢC MẶC ĐỊNH THÊM CHỮ "Chương X:". GIỮ NGUYÊN NHƯ FILE RAW]`;
            }

            const results = new Map<string, string>();
            let fullTextAccumulator = ""; 
            let streamErrorToReturn: Error | undefined = undefined;
            // TRUE only when the stream reached its own natural end (no timeout, no length-cutoff, no thrown error).
            // Used later to tell "AI finished but forgot the closing tag" apart from "AI got genuinely cut off",
            // so a complete translation isn't wrongly bounced back to the retry queue.
            let streamEndedNaturally = false;
            // TRUE when the Gemini stream reported finishReason === 'MAX_TOKENS' at any point.
            // BUG FIX: previously, hitting the hard output-token cap on the LAST file of a batch
            // still let `streamEndedNaturally` become true (the SDK's async iterator legitimately
            // reaches `done: true` right after the MAX_TOKENS chunk), which made the "last file,
            // no end tag, stream ended naturally => treat as complete" fallback below wrongly
            // swallow a genuinely CUT-OFF translation (missing its tail) as if it were merely
            // "AI forgot to type the closing tag". The file then got saved as done, still lacked
            // its real ending, and later Tier 2 (AI hậu kiểm) compared the truncated tail against
            // the real source tail and mass-flagged unrelated, perfectly-translated files as
            // "Nghi vấn nhầm chương" (false positives) purely because of this earlier truncation.
            let hitMaxTokensCutoff = false;

            const START_TAG_REGEX = /(?:\[\[\[\s*|\[\s*|<\s*)(part_[0-9]+)(?:\s*\]\]\]|\s*\]|\s*>)/gi;

            try {
            if (mid.startsWith('openrouter:')) {
                const openRouterModel = mid.replace('openrouter:', '');
                if (connectionTimeoutId) clearTimeout(connectionTimeoutId);
                
                let lastUpdateTime = 0;
                
                let multiplier = 5;
                if (ratioLimits && ratioLimits.cn) {
                    multiplier = Math.max(5, (Number.isFinite(ratioLimits.cn.max) ? ratioLimits.cn.max : 6.2) + 1);
                }
                const maxTotalLen = Math.max(combined.length * multiplier, 10000);

                fullTextAccumulator = await fetchOpenRouterStream(
                    openRouterKey || "",
                    openRouterModel,
                    finalPrompt,
                    fullPrompt,
                    (chunkAcc) => {
                        if (shouldAbort && shouldAbort()) throw new Error('ABORTED');
                        fullTextAccumulator = chunkAcc;
                        
                        if (fullTextAccumulator.length > maxTotalLen) {
                            throw new Error(`⚠️ Lỗi AI lặp từ hoặc mất thẻ (Vượt giới hạn toàn batch). Đang tự ngắt kết nối...`);
                        }

                        const now = Date.now();
                        if (now - lastUpdateTime > 1000) {
                            lastUpdateTime = now;
                            const matches = [...fullTextAccumulator.matchAll(START_TAG_REGEX)];
                            if (matches.length > 0) {
                                const lastMatch = matches[matches.length - 1];
                            const fileKey = lastMatch[1].toLowerCase();
                            // ƯU TIÊN TUYỆT ĐỐI: dùng đúng SỐ THỰC ghi trong tag (vd "part_3" -> file
                            // thứ 3), KHÔNG dùng vị trí xuất hiện tuần tự của tag trong response. Nếu
                            // dùng vị trí, một tag bị bỏ sót/lặp lại sẽ làm MỌI tag phía sau bị dồn lệch
                            // sang sai file — đây chính là nguyên nhân "trả kết quả nhầm file" trong batch.
                            let realId: string | undefined;
                            const numericMatch = fileKey.match(/(\d+)/);
                            if (numericMatch) {
                                const idx = parseInt(numericMatch[1], 10) - 1;
                                if (idx >= 0 && idx < files.length) { realId = files[idx].id; }
                            }
                            if (!realId) {
                                realId = idMap.get(fileKey) || idMap.get(`file_${fileKey}`);
                            }
                            if (!realId) {
                                // Phương án cuối cùng khi tag hỏng nặng không đọc được số: dùng vị trí xuất hiện.
                                const expectedIdx = matches.length - 1;
                                if (expectedIdx >= 0 && expectedIdx < files.length) {
                                    realId = files[expectedIdx].id;
                                }
                            }
                                if (realId) {
                                    const contentStart = lastMatch.index! + lastMatch[0].length;
                                    const nextTagIndex = fullTextAccumulator.substring(contentStart).search(START_TAG_REGEX);
                                    const contentEnd = nextTagIndex !== -1 ? contentStart + nextTagIndex : fullTextAccumulator.length;
                                    let content = fullTextAccumulator.substring(contentStart, contentEnd);
                                    content = content.replace(/(?:\[\[\[\s*\/|\[\s*\/|<\s*\/)(part_[0-9]+)(?:\s*\]\]\]|\s*\]|\s*>)/gi, '');
                                    
                                    const matchedFile = files.find(f => f.id === realId);
                                    if (matchedFile) {
                                        let multiplier = 5;
                                        if (ratioLimits && ratioLimits.cn) {
                                            multiplier = Math.max(5, (Number.isFinite(ratioLimits.cn.max) ? ratioLimits.cn.max : 6.2) + 1);
                                        }
                                        const maxLen = Math.max(matchedFile.content.length * multiplier, 4000);
                                        if (content.length > maxLen) {
                                            throw new Error(`⚠️ Lỗi AI lặp từ hoặc mất thẻ (Tỷ lệ > ${multiplier}x). Đang tự ngắt kết nối...`);
                                        }
                                    }

                                    onUpdate(realId, content.trim());
                                }
                            }
                        }
                    },
                    (actualModel) => {
                        mid = `openrouter:${actualModel}`;
                        if (onLog) onLog(`🤖 OpenRouter: Model dịch (${actualModel})`);
                    },
                    onLog
                );
                // fetchOpenRouterStream only RETURNS (instead of throwing) after finish_reason
                // is no longer 'length' — so reaching this line means the model itself decided
                // to stop, i.e. a genuine natural end of stream.
                streamEndedNaturally = true;
            } else {
                const responseStreamPromise = ai.models.generateContentStream({ 
                    model: mid, 
                    contents: fullPrompt, 
                    config: { 
                        systemInstruction: finalPrompt, 
                        ...(mid === 'gemini-3.8-flash' ? {} : { temperature: 0.2 }),
                        safetySettings: SAFETY_SETTINGS,
                        maxOutputTokens: 65536
                    } 
                });

                const responseStream = await Promise.race([responseStreamPromise, connectionTimeout]) as any;
                if (connectionTimeoutId) clearTimeout(connectionTimeoutId);

            let lastUpdateTime = 0;
            const iterator = responseStream[Symbol.asyncIterator]();
            let isDone = false;
            
            while (!isDone) {
                if (shouldAbort && shouldAbort()) {
                    throw new Error('ABORTED');
                }
                let timeoutId: NodeJS.Timeout | undefined;
                try {
                    const timeoutPromise = new Promise<never>((_, reject) => {
                        timeoutId = setTimeout(() => reject(new Error('STREAM_TIMEOUT')), 900000); // 900s between chunks
                    });
                    const nextPromise = iterator.next();
                    const result = await Promise.race([nextPromise, timeoutPromise]) as IteratorResult<any>;
                    
                    if (timeoutId) clearTimeout(timeoutId);
                    
                    if (result.done) {
                        isDone = true;
                        streamEndedNaturally = true;
                        break;
                    }
                    
                    const chunk = result.value;
                    
                    // Check for safety blocks
                    const fr = chunk.candidates?.[0]?.finishReason;
                    if (fr === 'SAFETY' || fr === 'BLOCKLIST' || fr === 'PROHIBITED_CONTENT') {
                        throw new Error(`⚠️ Model ${mid} báo lỗi vi phạm chính sách nội dung (Safety/Blocklist). Trả về lỗi ngay để chia nhỏ batch... Finish Reason: ${fr}`);
                    } else if (fr === 'OTHER' || fr === 'RECITATION' || fr === 'SPII') {
                        throw new Error(`⚠️ Model ${mid} ngắt kết nối không rõ lý do hoặc do kiểm duyệt nâng cao. Finish Reason: ${fr}`);
                    }
                    
                    if (chunk.candidates?.[0]?.finishReason === 'MAX_TOKENS') {
                         hitMaxTokensCutoff = true;
                         if (onLog) onLog(`⚠️ Cảnh báo: Model đã đạt giới hạn Token (MAX_TOKENS). Dữ liệu có thể bị cắt ngang. Đang xử lý các phần đã nhận...`);
                    }
                    
                    const chunkText = chunk.text || "";
                    fullTextAccumulator += chunkText;
                    
                    let multiplier = 5;
                    if (ratioLimits && ratioLimits.cn) {
                        multiplier = Math.max(5, (Number.isFinite(ratioLimits.cn.max) ? ratioLimits.cn.max : 6.2) + 1);
                    }
                    const maxTotalLen = Math.max(combined.length * multiplier, 10000);
                    
                    if (fullTextAccumulator.length > maxTotalLen) {
                        throw new Error(`⚠️ Lỗi AI lặp từ hoặc mất thẻ (Vượt giới hạn toàn batch). Đang tự ngắt kết nối...`);
                    }

                    const now = Date.now();
                    if (now - lastUpdateTime > 1000) {
                        lastUpdateTime = now;
                        // --- STREAMING UPDATE LOGIC (Approximate) ---
                        const matches = [...fullTextAccumulator.matchAll(START_TAG_REGEX)];
                        if (matches.length > 0) {
                            const lastMatch = matches[matches.length - 1];
                            const fileKey = lastMatch[1].toLowerCase();
                            // ƯU TIÊN TUYỆT ĐỐI: dùng số thực ghi trong tag, không dùng vị trí xuất
                            // hiện tuần tự (xem giải thích chi tiết ở nhánh OpenRouter phía trên).
                            let realId: string | undefined;
                            const numericMatch = fileKey.match(/(\d+)/);
                            if (numericMatch) {
                                const idx = parseInt(numericMatch[1], 10) - 1;
                                if (idx >= 0 && idx < files.length) {
                                    realId = files[idx].id;
                                }
                            }
                            if (!realId) {
                                realId = idMap.get(fileKey) || idMap.get(`file_${fileKey}`);
                            }
                            if (!realId) {
                                const expectedIdx = matches.length - 1;
                                if (expectedIdx >= 0 && expectedIdx < files.length) {
                                    realId = files[expectedIdx].id;
                                }
                            }
                            
                            if (realId) {
                                const contentStart = lastMatch.index! + lastMatch[0].length;
                                // Look for next tag or end of string
                                const nextTagIndex = fullTextAccumulator.substring(contentStart).search(START_TAG_REGEX);
                                const contentEnd = nextTagIndex !== -1 ? contentStart + nextTagIndex : fullTextAccumulator.length;
                                
                                let content = fullTextAccumulator.substring(contentStart, contentEnd);
                                // Remove end tag if present in streaming
                                content = content.replace(/(?:\[\[\[\s*\/|\[\s*\/|<\s*\/)(part_[0-9]+)(?:\s*\]\]\]|\s*\]|\s*>)/gi, '');
                                
                                const matchedFile = files.find(f => f.id === realId);
                                if (matchedFile) {
                                    let multiplier = 5;
                                    if (ratioLimits && ratioLimits.cn) {
                                        multiplier = Math.max(5, (Number.isFinite(ratioLimits.cn.max) ? ratioLimits.cn.max : 6.2) + 1);
                                    }
                                    const maxLen = Math.max(matchedFile.content.length * multiplier, 4000);
                                    if (content.length > maxLen) {
                                        throw new Error(`⚠️ Lỗi AI lặp từ hoặc mất thẻ (Tỷ lệ > ${multiplier}x). Đang tự ngắt kết nối...`);
                                    }
                                }

                                onUpdate(realId, content.trim());
                            }
                        }
                    }
                } catch (e: any) {
                    if (timeoutId) clearTimeout(timeoutId);
                    if (e.message === 'STREAM_TIMEOUT') {
                        if (onLog) onLog(`⚠️ [CẢNH BÁO] Stream bị treo quá 120 giây không nhận được dữ liệu. Đang ngắt kết nối và xử lý phần đã nhận...`);
                        // Try to close the iterator to prevent memory leaks or dangling promises
                        if (iterator.return) {
                            try { await iterator.return(); } catch { /* ignore */ }
                        }
                        break; // Break the loop and parse what we have
                    } else {
                        throw e; // Rethrow other errors
                    }
                }
            }
            } // end else for openrouter
            } catch (e: any) {
                if (e.message && (e.message.includes('Tất cả model khả dụng đã hết Quota') || e.message.includes('Tất cả model đã thử đều gặp lỗi hoặc hết Quota'))) {
                    throw e;
                }
                streamErrorToReturn = e;
            }

        // --- FINAL DEEP SWEEP (Robust Parsing & Fallback) ---
        let foundValidParts = 0;
        const completedFileIds = new Set<string>();
        const assignedIdsThisPass = new Set<string>();
        
        // 1. Try Standard Parsing with XML tags and END_OF_FILE barriers
        const parts = fullTextAccumulator.split(START_TAG_REGEX);
        // parts[0] is pre-text (junk), parts[1] is ID, parts[2] is Content, parts[3] is ID, parts[4] is Content...
        
        for (let i = 1; i < parts.length; i += 2) {
            const fileKey = parts[i].toLowerCase();
            let content = parts[i+1] || "";
            
            // Cleanup End Tag AND any trailing junk after the end tag
            const endTagIndex = content.search(/(?:\[\[\[\s*\/|\[\s*\/|<\s*\/)(part_[0-9]+)(?:\s*\]\]\]|\s*\]|\s*>)/i);
            let isCompleted = false;
            if (endTagIndex !== -1) {
                content = content.substring(0, endTagIndex);
                isCompleted = true;
            } else if (i + 2 < parts.length) {
                // If there is no end tag, but there is ANOTHER start tag after this one,
                // then this file is complete (the AI just forgot the end tag).
                isCompleted = true;
            } else if (streamEndedNaturally && !hitMaxTokensCutoff) {
                // This is the LAST file in the batch: no end tag, and no further start tag to
                // confirm it against. Previously this always fell through as "incomplete", which
                // meant a fully-translated file with just a missing closing tag got bounced back
                // to the retry queue every single time (the "hậu kiểm luôn tạch" loop).
                // If the stream itself finished on its own — not via STREAM_TIMEOUT, not via a
                // length-cutoff continuation, not via a thrown error, and not via hitting the
                // MAX_TOKENS cap — then there was nothing left for the AI to send. It simply
                // forgot the tag. Treat it as complete.
                // NOTE: if hitMaxTokensCutoff is true, `streamEndedNaturally` becoming true is a
                // red herring — the SDK iterator legitimately reports done:true right after a
                // MAX_TOKENS chunk, but the content is genuinely cut off, not just missing a tag.
                // Leave isCompleted=false so it falls into the retry path below instead of being
                // silently saved as a "finished" file with a truncated tail.
                isCompleted = true;
            }
            
            const fileIndex = Math.floor(i / 2); // vị trí xuất hiện tuần tự (chỉ dùng làm phương án CUỐI CÙNG)
            // ƯU TIÊN TUYỆT ĐỐI: dùng đúng SỐ THỰC ghi trong tag (vd tag "part_3" -> luôn map về
            // file thứ 3 trong danh sách gửi đi, files[2]), TUYỆT ĐỐI KHÔNG dùng vị trí xuất hiện
            // tuần tự của tag trong response như cách cũ (fileIndex). Đây là fix cho lỗi nghiêm
            // trọng nhất của việc đóng gói/tag batch: nếu AI lỡ BỎ SÓT 1 tag (vd quên xuất part_2),
            // cách đếm theo vị trí cũ sẽ khiến TOÀN BỘ các file phía sau bị dồn lệch 1 vị trí — nội
            // dung thực sự của "part_3" (chương 3) bị gán nhầm vào file thứ 2 (chương 2), "part_4"
            // bị gán nhầm vào file thứ 3, v.v. Tệ hơn, vì tổng số tag đôi khi vẫn khớp số file gửi
            // đi, hệ thống không hề phát hiện ra để báo lỗi hay yêu cầu dịch lại — đây chính là
            // nguồn gốc chủ yếu của hiện tượng "trả kết quả nhầm file" trong Vấn đề 1.
            // Dùng số thực trong tag đảm bảo: nếu AI bỏ sót tag nào, ĐÚNG file đó (và chỉ file đó)
            // sẽ thiếu kết quả và được đưa vào luồng retry, các file khác vẫn nhận đúng nội dung.
            let realId: string | undefined;
            const numericMatch = fileKey.match(/(\d+)/);
            if (numericMatch) {
                const idx = parseInt(numericMatch[1], 10) - 1;
                if (idx >= 0 && idx < files.length) {
                    realId = files[idx].id;
                }
            }
            if (!realId) {
                realId = idMap.get(fileKey) || idMap.get(`file_${fileKey}`);
            }
            if (!realId && fileIndex >= 0 && fileIndex < files.length) {
                // Phương án cuối cùng, chỉ khi tag hỏng nặng không đọc được số nào cả.
                realId = files[fileIndex].id;
            }
            
            if (realId) {
                if (assignedIdsThisPass.has(realId)) {
                    // AI lỡ xuất trùng số tag (vd 2 lần "part_3") cho cùng 1 file. Không được cộng
                    // dồn vào foundValidParts, nếu không tổng số lần lặp có thể trùng khớp số file
                    // gửi đi một cách giả tạo, khiến 1 file KHÁC thực sự bị thiếu tag "lọt lưới"
                    // qua bước kiểm tra đủ số lượng ở dưới. Giữ lại bản dịch xuất hiện ĐẦU TIÊN
                    // (an toàn hơn bản xuất hiện sau, vì mô hình có xu hướng lặp/lỗi dần về cuối).
                    if (onLog) onLog(`⚠️ AI trả trùng tag "${fileKey}" nhiều lần trong cùng batch — đã bỏ qua bản trùng, giữ bản dịch xuất hiện đầu tiên.`);
                } else {
                    assignedIdsThisPass.add(realId);
                    const originalFile = files.find(f => f.id === realId);
                    const contentText = originalFile ? originalFile.content : "";
                    const formatted = formatBookStyle(content, contentText, storyInfo?.enableTitleFormatting !== false, storyInfo?.titleFormat, storyInfo?.enableAutoFormat !== false);
                    results.set(realId, formatted);
                    onUpdate(realId, formatted);
                    foundValidParts++;
                    if (isCompleted) {
                        completedFileIds.add(realId);
                    }
                }
            }
        }

        // Tập hợp các file được "khôi phục" bằng thuật toán Hybrid Proportional Split bên dưới.
        // Ranh giới nội dung của các file này KHÔNG đến từ tag thật của AI mà chỉ là ĐOÁN theo tỷ
        // lệ số ký tự gốc/dịch — nên dù độ dài khớp tỷ lệ kỳ vọng (=> dễ lọt qua Tier 1 vốn chủ yếu
        // kiểm tra tỷ lệ), không có gì đảm bảo ĐÚNG NỘI DUNG. Các file trong tập này bắt buộc phải
        // được Tier 2 AI xác nhận RÕ RÀNG (isValid === true) mới được coi là hoàn tất — xem đoạn xử
        // lý ngay sau khi có aiValidationResults bên dưới.
        const hybridRecoveredIds = new Set<string>();

        // --- VALIDATION & RECOVERY: DID WE GET ALL FILES? ---
        if (foundValidParts !== files.length) {
             // 2. Hybrid Proportional Character-Based Splitting
             // If we found NOTHING, or we found some but they are merged
             if (foundValidParts === 0 && fullTextAccumulator.trim().length > 0) {
                 // The AI completely ignored tags. We have one giant blob.
                 // We will split it proportionally based on the character count in the original files, but split by paragraphs to avoid cutting sentences.
                 const translatedParagraphs = fullTextAccumulator.split(/\n+/).filter(p => p.trim().length > 0);
                 const originalCharCounts = files.map(f => f.content.length);
                 const totalOriginalChars = originalCharCounts.reduce((a, b) => a + b, 0);
                 const totalTranslatedChars = translatedParagraphs.reduce((a, p) => a + p.length, 0);
                 
                 if (totalOriginalChars > 0 && translatedParagraphs.length > 0) {
                     let currentParagraphIndex = 0;
                     let assignedCount = 0;
                     
                     files.forEach((f, idx) => {
                         const originalCount = originalCharCounts[idx];
                         const targetTranslatedChars = Math.round((originalCount / totalOriginalChars) * totalTranslatedChars);
                         
                         let currentFileChars = 0;
                         const paragraphsForFile = [];
                         
                         while (currentParagraphIndex < translatedParagraphs.length) {
                             const p = translatedParagraphs[currentParagraphIndex];
                             
                             // If adding this paragraph exceeds the target significantly, and we already have some paragraphs, stop.
                             if (idx < files.length - 1 && currentFileChars + p.length > targetTranslatedChars * 1.2 && paragraphsForFile.length > 0) {
                                 break;
                             }
                             
                             paragraphsForFile.push(p);
                             currentFileChars += p.length;
                             currentParagraphIndex++;
                             
                             if (idx < files.length - 1 && currentFileChars >= targetTranslatedChars) {
                                 break;
                             }
                         }
                         
                         // If it's the last file, grab all remaining paragraphs
                         if (idx === files.length - 1 && currentParagraphIndex < translatedParagraphs.length) {
                             paragraphsForFile.push(...translatedParagraphs.slice(currentParagraphIndex));
                             currentParagraphIndex = translatedParagraphs.length;
                         }
                         
                         if (paragraphsForFile.length > 0) {
                             const partContent = paragraphsForFile.join('\n\n');
                             const warningHeader = `\n\n[CẢNH BÁO BỞI AI STUDIO: File này được khôi phục do AI gộp nhầm chương. Có thể bị cắt nhầm ranh giới câu. Hãy kiểm tra lại]\n\n`;
                             const formatted = warningHeader + formatBookStyle(partContent, f.content, storyInfo?.enableTitleFormatting !== false, storyInfo?.titleFormat, storyInfo?.enableAutoFormat !== false);
                             results.set(f.id, formatted);
                             onUpdate(f.id, formatted);
                             completedFileIds.add(f.id);
                             hybridRecoveredIds.add(f.id);
                             assignedCount++;
                         }
                     });
                     
                     if (assignedCount > 0) {
                         foundValidParts = assignedCount;
                          onLog(`✅ [BATCH RECOVERY] Đã tách và khôi phục ${assignedCount} file bị AI gộp nhầm bằng thuật toán Hybrid.`);
                      } else if (onLog) {
                          onLog(`⚠️ [BATCH PARTIAL] Chỉ tìm thấy ${foundValidParts}/${files.length} file. Các file còn lại sẽ được tự động thử lại (Retry).`);
                      }
                  }
             }
        }

        // --- CHECK EMPTY RESPONSE ---
        if (fullTextAccumulator.trim().length === 0) {
             if (streamErrorToReturn) {
                 throw streamErrorToReturn;
             }
             throw new Error(`⚠️ Model ${mid} trả về kết quả rỗng (có thể do lỗi kết nối hoặc server từ chối). Trả về lỗi ngay để thử lại hoặc chia nhỏ batch...`);
        }

        // --- NEW: AUTO-CONTINUE FOR MISSING OR INVALID FILES (Token Limit Bypass) ---
        const invalidReasons: string[] = [];
        
        // Cần đảm bảo cleanContent được set trước (chỉ fixMergedTitle, không formatBookStyle 2 lần)
        files.forEach(f => {
            if (completedFileIds.has(f.id)) {
                const content = results.get(f.id);
                if (content) {
                    const cleanContent = fixMergedTitle(content);
                    results.set(f.id, cleanContent);
                }
            }
        });

        const flaggedStaleIds = new Set<string>();
        const spelling = new Map<string, VietnameseProofreadResult>();
        for (const file of files) {
            const text = results.get(file.id);
            if (!text || !completedFileIds.has(file.id)) continue;
            if (shouldAbort?.()) throw new Error('ABORTED');
            const checked = await proofreadVietnamese(text, [dictionary, globalContext || '']);
            spelling.set(file.id, checked);
            results.set(file.id, applyInlineEnglishFix(formatBookStyle(fixMergedTitle(checked.text), file.content,
                storyInfo?.enableTitleFormatting !== false, storyInfo?.titleFormat, storyInfo?.enableAutoFormat !== false)));
        }
        const batchReport = validateBatch(files as FileItem[], results, { limits: ratioLimits, sourceLanguages: storyInfo?.languages, fingerprints: batchFingerprints, storyKey: storyInfo?.title });
        const reviewContexts = new Map(files.map(file => [file.id, buildChapterReviewContext(dictionary, storyInfo, file.content, file.chapterIndex)]));
        // Only fully streamed chapters can be reviewed. Partial output still follows
        // the existing translation retry path; regex suspicion alone cannot reject QA.
        const reviewFiles = files.filter(file => completedFileIds.has(file.id) && results.has(file.id))
            .map(file => {
                const plan = prepareLocalConsistency(originalDictionary, storyInfo, file.content, file.chapterIndex, runtime.customDictionary);
                const localFindings = checkLocalConsistency(file.content, results.get(file.id)!, plan, storyInfo);
                return { ...file, consistencyContext: reviewContexts.get(file.id), localFindings, localHints: formatLocalFindings(localFindings, plan) };
            });
        const aiValidationResults = await reviewAndRepairBatch(
            reviewFiles, results, enabledModels, onLog, openRouterKey, mid, '', { shouldAbort }
        );
        for (const file of reviewFiles) {
            const review = aiValidationResults.get(file.id);
            if (!review) continue;
            const plan = prepareLocalConsistency(originalDictionary, storyInfo, file.content, file.chapterIndex, runtime.customDictionary);
            aiValidationResults.set(file.id, enforceLocalLocks(review, checkLocalConsistency(file.content, results.get(file.id)!, plan, storyInfo)));
        }
        const specificErrors = new Map<string, string>();
        aiValidationResults.forEach((review, id) => {
            if (review.status === 'CONFIRMED_FAILURE') {
                flaggedStaleIds.add(id);
                completedFileIds.delete(id);
                specificErrors.set(id, 'Nghi vấn lỗi nội dung — AI xác nhận lệch/thiếu chương: ' + review.reason);
            } else {
                if (review.status !== 'PASS') onLog?.(`⏳ ${id}: ${review.reason || 'Cần hậu kiểm lại'} — giữ nguyên bản dịch, không dịch lại chương.`);
                const content = results.get(id);
                if (content) onUpdate(id, content);
            }
        });
        // Guessed hybrid boundaries can only become verified through explicit PASS.
        hybridRecoveredIds.forEach(id => {
            const review = aiValidationResults.get(id);
            if (review && review.status !== 'PASS' && review.status !== 'CONFIRMED_FAILURE') {
                aiValidationResults.set(id, { ...review, status: 'QA_DEFERRED',
                    reason: 'Ranh giới chương được khôi phục bằng Hybrid Split; cần AI xác minh lại. ' + review.reason });
            }
        });

        // Đăng ký vân tay (fingerprint) phần đuôi của các file đã THỰC SỰ hoàn tất (qua hết Tier
        // 1/2, không bị flaggedStaleIds) vào cache xuyên batch, để các batch dịch SAU (có thể là
        // chương liền kề, dịch ở lượt khác) có thể đối chiếu trùng lặp với các chương này.
        files.forEach(f => {
            if (completedFileIds.has(f.id) && aiValidationResults.get(f.id)?.status === 'PASS') {
                const content = results.get(f.id);
                if (content) registerCompletedChapterFingerprint(storyInfo?.title, f.id, content);
            }
        });

        files.forEach(f => {
            if (!completedFileIds.has(f.id)) {
                // Determine specific error if batchReport flagged it
                const report = batchReport.details.get(f.id);
                const aiReport = aiValidationResults.get(f.id);
                if (aiReport?.status === 'CONFIRMED_FAILURE') {
                    specificErrors.set(f.id, "Lỗi kiểm định AI (Tier 2): " + aiReport.reason);
                } else if (report && !report.isValid) {
                    const warningMsg = report.warnings.join(' | ');
                    if (warningMsg.includes("Lỗi: Trống nội dung (0%)")) {
                        specificErrors.set(f.id, "Thiếu kết quả từ API (Bị cắt ngang)");
                    } else if (warningMsg.includes("Nghi vấn nhầm chương") || warningMsg.includes("Nghi vấn nhảy nội dung") || warningMsg.includes("nhầm chương/chập chương") || report.contentConfidence < 0.4) {
                        specificErrors.set(f.id, "Nghi vấn lỗi nội dung (nhầm chương/lệch dòng)");
                    }
                }
                
                if (!specificErrors.has(f.id)) {
                    specificErrors.set(f.id, hitMaxTokensCutoff
                        ? "Bị cắt ngang do đạt giới hạn Token (MAX_TOKENS) - chưa dịch xong"
                        : "Thiếu kết quả từ API (Bị cắt ngang)");
                }
                
                invalidReasons.push(`${f.name || f.id}: ${specificErrors.get(f.id)}`);

                // BUG FIX: trước đây khối này CHỈ ghi log/specificErrors mà không hề xoá file
                // khỏi `results`, nên dù đã xác định đúng là "chưa hoàn thành" (isCompleted=false),
                // nội dung dịch dở dang vẫn được trả về cho useTranslator.ts như một file THÀNH
                // CÔNG bình thường (vì đó chỉ check results.has(id)) — tức là app "lưu" một file
                // thiếu mất đoạn cuối như thể đã xong, không đưa vào hàng đợi dịch lại. Xoá khỏi
                // results ở đây để đảm bảo file thật sự chưa hoàn chỉnh luôn bị loại và tự động
                // gửi lại vào hàng đợi (giống hệt cách Tier 1/Tier 2 phía trên đã làm).
                // NGOẠI LỆ: file đã bị Tier 1/2 đánh dấu flaggedStaleIds vẫn CÓ nội dung dịch hợp
                // lệ (chỉ nghi vấn, không phải thiếu/cắt ngang) - không được xoá khỏi results ở
                // đây, nếu không sẽ phá vỡ cơ chế "giữ bản dịch nghi vấn" phía trên.
                if (!flaggedStaleIds.has(f.id)) {
                    results.delete(f.id);
                }
            }
        });

        const missingOrInvalidCount = invalidReasons.length;
        if (missingOrInvalidCount > 0 && missingOrInvalidCount < files.length) { 
             if (onLog) {
                 const reasonStr = invalidReasons.join('; ');
                 onLog(`⏭️ Trả về hàng chờ để gom batch mới: ${missingOrInvalidCount}/${files.length} tệp lỗi/thiếu. Chi tiết: ${reasonStr}`);
             }
        } else if (missingOrInvalidCount === files.length && files.length > 0) { 
             if (onLog) {
                 const reasonStr = invalidReasons.join('; ');
                 onLog(`❌ Toàn bộ ${files.length} tệp trong lô (batch) này đều thất bại. Đang phân loại để cách ly... Chi tiết: ${reasonStr}`);
             }
             // BỎ THROW ERROR Ở ĐÂY ĐỂ TRẢ VỀ CỤ THỂ LỖI CHO USTRANSLATOR.TS CÁCH LY
        }
        
        if (streamErrorToReturn && results.size === 0 && specificErrors.size === 0) {
            throw streamErrorToReturn;
        }
        
        
        // Local repairs have already been verified above. Do not mutate a PASS afterwards.


        const memoryKeys = await saveVerifiedTranslationMemory(files, results, aiValidationResults, memoryContext, mid, runtime.memoryDriver);
        return { 
            results, 
            model: mid, 
            stats: { dictLines: relDict.split('\n').length, contextLines: relCtx.split('\n').length },
            errors: specificErrors,
            streamError: streamErrorToReturn,
            flaggedStaleIds,
            reviews: aiValidationResults,
            reviewContexts,
            spelling,
            memoryKeys
        };
        } finally {
            if (connectionTimeoutId) clearTimeout(connectionTimeoutId);
        }
    }, "Dịch Streaming", onLog, preferredModelId).catch((error: Error) => {
        if (shouldAbort?.() || error.message === 'ABORTED' || (!cachedResults.size && !blockedErrors.size)) throw error;
        // A failed uncached request must not discard chapters already restored from
        // verified memory or turn preflight conflicts into API retry candidates.
        return { results: new Map<string, string>(), model: '', streamError: error,
            errors: new Map(files.map(file => [file.id, error.message || 'Chưa nhận được bản dịch.'])) };
    });
    return { ...liveResult,
        results: new Map([...cachedResults, ...liveResult.results]),
        reviews: new Map([...cachedReviews, ...(liveResult.reviews || [])]),
        reviewContexts: new Map([...cachedContexts, ...(liveResult.reviewContexts || [])]),
        models: new Map([...cachedModels, ...files.map(file => [file.id, liveResult.model] as const)]),
        memoryKeys: new Map([...cachedKeys, ...(liveResult.memoryKeys || [])]),
        memoryHitIds: new Set(cachedResults.keys()), blockedConsistencyIds,
        errors: new Map([...blockedErrors, ...(liveResult.errors || [])]),
    };
};
