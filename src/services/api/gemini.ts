
import { logger } from "../../utils/logger";
import { GoogleGenAI, HarmCategory, HarmBlockThreshold } from '@google/genai';
import { quotaManager } from '../../utils/quotaManager';
import { MODEL_CONFIGS } from '../../constants';

export const getAiClient = () => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("Không tìm thấy API Key. Vui lòng kiểm tra biến môi trường.");
  }
  return new GoogleGenAI({ apiKey });
};

const SAFETY_SETTINGS = [
    { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
    { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
    { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
    { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
    { category: HarmCategory.HARM_CATEGORY_CIVIC_INTEGRITY, threshold: HarmBlockThreshold.BLOCK_NONE },
];

export { SAFETY_SETTINGS };

export const testCurrentKey = async (): Promise<{ success: boolean; message: string }> => {
    const ai = getAiClient();
    try {
        await ai.models.generateContent({
            model: 'gemini-3.5-flash',
            contents: "Hi",
            config: { safetySettings: SAFETY_SETTINGS }
        });
        return { success: true, message: "Key hợp lệ và còn Quota!" };
    } catch (error: any) {
        const msg = (error.message || error.toString()).toLowerCase();
        if (msg.includes("resource exhausted") || msg.includes("quota")) {
            return { success: false, message: "Key này đã hết Quota (Resource Exhausted)." };
        }
        if (msg.includes("api key not valid") || msg.includes("api_key_invalid") || (error.status === 400 && msg.includes('key'))) {
            return { success: false, message: "API Key không hợp lệ hoặc đã bị khóa." };
        }
        return { success: false, message: error.message };
    }
};

export const testModelConnection = async (modelId: string): Promise<{ success: boolean; message: string }> => {
    const ai = getAiClient();
    try {
        const response = await ai.models.generateContent({
            model: modelId,
            contents: "Hi",
            config: { safetySettings: SAFETY_SETTINGS }
        });
        return response ? { success: true, message: "Kết nối thành công! Model sẵn sàng." } : { success: false, message: "Không có phản hồi." };
    } catch (error: any) {
        const msg = (error.message || error.toString()).toLowerCase();
        if (msg.includes("resource exhausted") || msg.includes("quota")) {
            quotaManager.markAsDepleted(modelId);
            return { success: false, message: "Model đã hết Quota (Resource Exhausted)." };
        }
        return { success: false, message: error.message };
    }
};

/**
 * "Vệ tinh" = các model không thuộc hệ Gemini nội bộ, không dùng quotaManager của Gemini,
 * mà tự quản lý key/rate limit riêng (OpenRouter). Smart Execution chọn tuần tự theo danh
 * sách, lỗi thì loại khỏi danh sách thử (blacklist) thay vì đánh dấu "hết quota" theo kiểu Gemini.
 */
const isSatelliteModel = (id: string) => id.startsWith('openrouter:');

/**
 * SMART EXECUTION ENGINE v3.1 (Retry Strategy)
 * - 2 Consecutive Errors -> Depleted.
 * - 1 Error -> Wait 1 minute -> Retry.
 * - Success -> Reset error count.
 */
export const smartExecution = async <T>(
    candidateModels: string[],
    operation: (modelId: string) => Promise<T>,
    taskName: string = "Tác vụ",
    onLog?: (msg: string) => void,
    preferredModelId?: string,
    priorityOverrides?: Record<string, number>
): Promise<T> => {
    logger.log(`[smartExecution] task: ${taskName}, candidateModels:`, candidateModels);
    const validCandidates = candidateModels.filter(id => isSatelliteModel(id) || MODEL_CONFIGS.some(c => c.id === id));
    logger.log(`[smartExecution] task: ${taskName}, validCandidates:`, validCandidates);
    const temporaryBlacklist: string[] = []; // Models that completely failed in this execution
    
    if (validCandidates.length === 0) {
        throw new Error(`[${taskName}] Không có model nào khả dụng. Vui lòng kiểm tra lại cài đặt.`);
    }

    const MAX_ITERATIONS = 50;
    let iterations = 0;

    while (iterations++ < MAX_ITERATIONS) {
        // 1. Get Best Model
        let selectedId: string | null = null;
        const satelliteCandidates = validCandidates.filter(id => isSatelliteModel(id));
        
        if (satelliteCandidates.length > 0) {
            selectedId = satelliteCandidates.find(id => !temporaryBlacklist.includes(id)) || null;
        } else {
            selectedId = quotaManager.getBestModelForTask(validCandidates, temporaryBlacklist, preferredModelId, priorityOverrides);
            if (!selectedId && validCandidates.includes('gemini-3.1-flash-lite-image') && !temporaryBlacklist.includes('gemini-3.1-flash-lite-image')) {
                selectedId = 'gemini-3.1-flash-lite-image';
            }
        }

        if (!selectedId) {
            // All exhausted or temporary blacklisted
            const allDepletedOrBlacklisted = validCandidates.every(id => 
                isSatelliteModel(id) ? temporaryBlacklist.includes(id) :
                ( (id !== 'gemini-3.1-flash-lite-image' && quotaManager.isModelDepleted(id)) || (id !== 'gemini-3.1-flash-lite-image' && !quotaManager.isModelEnabled(id)) || temporaryBlacklist.includes(id))
            );

            logger.log(`[smartExecution] task: ${taskName}, allDepletedOrBlacklisted:`, allDepletedOrBlacklisted, validCandidates.map(id => ({
                id,
                isDepleted: quotaManager.isModelDepleted(id),
                isEnabled: quotaManager.isModelEnabled(id),
                inBlacklist: temporaryBlacklist.includes(id)
            })));

            if (allDepletedOrBlacklisted) {
                 if (temporaryBlacklist.length > 0 && temporaryBlacklist.length === validCandidates.length) {
                     throw new Error(`[${taskName}] Tất cả model đã thử đều gặp lỗi hoặc hết Quota. Dừng tác vụ. ${temporaryBlacklist.join(', ')}`);
                 }
                 
                 const diagnostics = validCandidates.map(id => 
                     `${id}: enabled=${quotaManager.isModelEnabled(id)}, depleted=${quotaManager.isModelDepleted(id)}, waitTime=${quotaManager.getWaitTimeForModel(id)}`
                 ).join('; ');
                 
                 throw new Error(`[${taskName}] Tất cả model khả dụng đã hết Quota hoặc bị tắt hoặc bị lỗi. Debug: ${diagnostics}`);
            }

            // Waiting logic (Cooldown)
            const activeCandidates = validCandidates.filter(id => !isSatelliteModel(id) && !temporaryBlacklist.includes(id));
            const waitTimes = activeCandidates.map(id => quotaManager.getWaitTimeForModel(id));
            const minWaitTime = Math.min(...waitTimes);
            
            const actualWait = minWaitTime > 0 && minWaitTime !== Infinity ? minWaitTime : 2000;
            const waitSeconds = (actualWait / 1000).toFixed(1);

            if (onLog) onLog(`💤 Hệ thống đang điều phối tải (Chờ xen kẽ). Đợi ${waitSeconds}s...`);
            await new Promise(resolve => setTimeout(resolve, actualWait));
            continue; // Retry loop
        }

        // --- MODEL SELECTED ---
        if (!isSatelliteModel(selectedId)) {
            quotaManager.recordRequest(selectedId);
        }

        try {
            if (onLog) onLog(`🚀 [${taskName}] Đang chạy trên model: ${selectedId}...`);
            if (!isSatelliteModel(selectedId)) {
                await new Promise(r => setTimeout(r, 600)); // Nhỏ giọt chống 429
            }
            const result = await operation(selectedId);
            
            // SUCCESS: Reset consecutive errors
            if (!isSatelliteModel(selectedId)) {
                quotaManager.recordSuccess(selectedId);
            }
            return result;
        } catch (error: any) {
            let msg = (error.message || error.toString()).toLowerCase();
            if (error.statusText) msg += " " + error.statusText.toLowerCase();
            
            const isQuotaError = msg.includes('429') || msg.includes('exceeded quota') || msg.includes('quota exceeded') || msg.includes('resource exhausted') || msg.includes('quota');
            // UPDATED v1.0.2: bổ sung "không tìm thấy api key" (thông báo getAiClient() ném ra khi
            // biến môi trường GEMINI_API_KEY trống/không được nạp — hay gặp nhất khi bản Publish
            // chưa cấu hình đúng Secrets trong AI Studio). Trước đây lỗi này không khớp điều kiện
            // nào, bị rơi xuống nhánh lỗi chung ở cuối hàm, âm thầm tích lũy consecutiveErrors và
            // SAU 25-105 LẦN THỬ mới bị đánh dấu "hết Quota" — khiến người dùng tưởng lầm là vấn đề
            // quota trong khi gốc rễ là thiếu Key ngay từ đầu. Giờ nhận diện và báo lỗi rõ ràng, tức
            // thì thay vì chờ tích lũy.
            const isInvalidKey = msg.includes('api key not valid') || msg.includes('api_key_invalid') || (error.status === 400 && msg.includes('key')) || msg.includes('401 unauthorized') || msg.includes('không tìm thấy api key');
            const isSafetyError = !isQuotaError && (msg.includes('bộ lọc an toàn') || msg.includes('safety') || msg.includes('blocklist') || msg.includes('prohibited_content'));
            const isHallucinationError = msg.includes('lặp từ hoặc mất thẻ') || msg.includes('tỷ lệ >') || msg.includes('vượt giới hạn');
            
            if (isInvalidKey) {
                 throw new Error("API Key không hợp lệ, đã bị khóa, hoặc chưa được cấu hình (kiểm tra mục Secrets nếu đang chạy bản Publish trên AI Studio).", { cause: error });
            }
            
            if (isSafetyError) {
                if (onLog) onLog(`⚠️ Model ${selectedId} trả về lỗi (có thể do Safety Filter / rỗng). Trả về lỗi ngay để chia nhỏ batch và thử lại...`);
                throw error; // Throw immediately so useTranslator can split the batch
            }
            
            if (isHallucinationError) {
                if (onLog) onLog(`⚠️ Model ${selectedId} bị ảo giác (lặp từ). Bỏ qua model này cho mẻ hiện tại.`);
                temporaryBlacklist.push(selectedId);
                continue; // Skip this model and try another one
            }
            
            if (isQuotaError) {
                // We no longer strictly isolate 'per day' strings to immediately deplete the model
                // because Google often returns 'GenerateRequestsPerDayPerProjectPerModel' even for rate limits.
                // It will go through the normal 429 retry logic below.
                
                quotaManager.recordQuotaError(selectedId);
                const usage = quotaManager.getModelUsage(selectedId);
                const quotaErrorCount = usage.consecutiveQuotaErrors || 0;
                
                // Check hard request limit from config
                const modelConfig = quotaManager.getConfigs().find((m: any) => m.id === selectedId);
                const isHardLimitReached = modelConfig && usage.requestsToday >= modelConfig.rpdLimit;

                if (isHardLimitReached) {
                    if (onLog) onLog(`⛔ CƯỠNG CHẾ HẾT QUOTA: Model ${selectedId} đã chạm ngưỡng giới hạn request cứng (${usage.requestsToday}/${modelConfig.rpdLimit}).`);
                    quotaManager.markAsDepleted(selectedId);
                    temporaryBlacklist.push(selectedId);
                    continue;
                }

                if (quotaErrorCount > 2) {
                     if (onLog) onLog(`⛔ Model ${selectedId} báo lỗi Quota (429) liên tục ${quotaErrorCount} lần. Nhận định đã hết Quota thực sự.`);
                     quotaManager.markAsDepleted(selectedId);
                     temporaryBlacklist.push(selectedId);
                     continue;
                } else {
                     let waitTimeSeconds = 5;
                     if (quotaErrorCount === 1) waitTimeSeconds = 5;
                     else if (quotaErrorCount === 2) waitTimeSeconds = 10;
                     
                     const waitTime = waitTimeSeconds * 1000;
                     if (onLog) onLog(`⚠️ Model ${selectedId} dính Quota/Rate limit (429). Lần ${quotaErrorCount}, thử lại sau ${waitTimeSeconds}s...`);
                     quotaManager.recordRateLimit(selectedId, waitTime);
                     await new Promise(r => setTimeout(r, waitTime));
                     continue;
                }
            }

            if (error.status === 400 || msg.includes('400')) {
                if (onLog) onLog(`⚠️ CẢNH BÁO LỖI trên model ${selectedId}: ${msg.substring(0, 150)}.`);
            }

            if (msg.includes('500') || error.status >= 500 || msg.includes('503') || msg.includes('overloaded')) {
                quotaManager.recordError(selectedId);
                const usage = quotaManager.getModelUsage(selectedId);
                const errorCount = usage.consecutiveErrors || 0;
                
                if (errorCount >= 3) {
                     if (onLog) onLog(`🚨 Lỗi máy chủ Google (${selectedId}) 3 lần liên tiếp. Bỏ qua model này cho mẻ hiện tại.`);
                     temporaryBlacklist.push(selectedId);
                     // DO NOT markAsDepleted() vì đây chỉ là lỗi server tạm thời
                     continue;
                } else {
                     if (onLog) onLog(`🚨 Lỗi máy chủ Google trên ${selectedId}. Đợi 5s rồi thử lại...`);
                     quotaManager.recordRateLimit(selectedId, 5000);
                     await new Promise(r => setTimeout(r, 5000));
                     continue;
                }
            }

            // UPDATED v1.0.2: FIX lỗi nghiêm trọng — 403 (Permission Denied) TRƯỚC ĐÂY bị coi là
            // "hết Quota" (gọi markAsDepleted), khiến quota bị đánh dấu "HẾT" vĩnh viễn dù request
            // đầu tiên trong ngày còn chưa thực hiện được lần nào (0 request). 403 và "hết Quota"
            // (429/Resource Exhausted) là 2 LOẠI LỖI HOÀN TOÀN KHÁC NHAU:
            //   - 429/Resource Exhausted = Key ĐÚNG, chỉ là đã dùng hết định mức trong ngày.
            //   - 403/Permission Denied = Key SAI/bị chặn/bị giới hạn quyền truy cập — có thể do
            //     Key bị giới hạn theo domain (HTTP referrer restriction) chỉ cho phép domain
            //     preview của AI Studio, không có domain của bản Publish (Cloud Run) trong danh
            //     sách cho phép. Đây chính là nguyên nhân phổ biến nhất gây ra hiện tượng "chạy
            //     tốt trong AI Studio nhưng lỗi khi Publish" — Reset Quota không giải quyết được
            //     vì vấn đề gốc không nằm ở quota.
            // Sửa: KHÔNG markAsDepleted() nữa. Chỉ loại model này khỏi danh sách thử của LƯỢT NÀY
            // (temporaryBlacklist, không ảnh hưởng tới trạng thái quota lưu trong ngày), đồng thời
            // in rõ nguyên nhân thật + hướng khắc phục ra log để người dùng tự sửa đúng chỗ.
            if (error.status === 403 || msg.includes('403') || msg.includes('permission_denied')) {
                if (onLog) onLog(`⛔ LỖI QUYỀN TRUY CẬP (403) trên model ${selectedId} — KHÔNG PHẢI hết Quota. API Key hiện tại bị từ chối truy cập. Nguyên nhân thường gặp: Key bị giới hạn theo domain (HTTP referrer restriction) trong Google Cloud Console/AI Studio API Key settings chưa cho phép domain của bản Publish này. Vào Google AI Studio > API Keys, kiểm tra lại giới hạn của Key đang dùng.`);
                temporaryBlacklist.push(selectedId);
                continue;
            }

            // For satellite models (OpenRouter), we handle failures directly, không đụng quotaManager Gemini
            if (isSatelliteModel(selectedId)) {
                if (onLog) onLog(`⛔ CẢNH BÁO: Model ${selectedId} lỗi (${msg.substring(0, 150)}). Loại bỏ khỏi danh sách thử.`);
                temporaryBlacklist.push(selectedId);
                continue;
            }

            // Normal Error Handle (Network, Parsed, Unknown)
            quotaManager.recordError(selectedId);
            
            const usage = quotaManager.getModelUsage(selectedId);
            const errorCount = usage.consecutiveErrors || 0;
            const maxRetries = 3;
            const hardErrorLimit = selectedId.includes("pro") ? 25 : 105;
            if (errorCount >= hardErrorLimit) {
                if (onLog) onLog(`⛔ CƯỠNG CHẾ HẾT QUOTA: Model ${selectedId} lỗi liên tiếp ${errorCount} lần. Đánh dấu hết Quota!`);
                quotaManager.markAsDepleted(selectedId);
                temporaryBlacklist.push(selectedId);
                continue;
            }

            if (errorCount <= maxRetries) {
                // STRIKE: Exponential Backoff (2s, 4s, 8s)
                const backoffSeconds = Math.pow(2, errorCount); 
                const waitTime = backoffSeconds * 1000;
                
                if (onLog) onLog(`⚠️ Lỗi lần ${errorCount}/${maxRetries} trên ${selectedId}. Đợi ${backoffSeconds}s trước khi thử lại... (${msg.substring(0, 50)}...)`);
                
                quotaManager.recordRateLimit(selectedId, waitTime);
                await new Promise(r => setTimeout(r, waitTime));
            } else {
                // MAX STRIKES: Lỗi nặng, bỏ qua cho mẻ dịch này, NHƯNG không đánh dấu hết Quota
                if (onLog) onLog(`⛔ Model ${selectedId} lỗi ${maxRetries} lần liên tiếp không xác định rõ. Loại khỏi lần thử hiện tại.`);
                temporaryBlacklist.push(selectedId);
            }
            
            // Short pause
            await new Promise(r => setTimeout(r, 500));
        }
    }

    throw new Error(`[${taskName}] Vượt quá số lần thử tối đa (${MAX_ITERATIONS}). Dừng tác vụ để tránh lặp vô hạn.`);
};
