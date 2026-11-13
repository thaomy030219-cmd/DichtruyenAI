
import { logger } from "../../utils/logger";
import { GoogleGenAI, HarmCategory, HarmBlockThreshold } from '@google/genai';
import { getGeminiProjects, type GeminiProject, isGeminiDailyQuota, isGeminiRateLimit, recordGeminiRateLimit } from './geminiProjects';
import { MODEL_CONFIGS } from '../../constants';


const SAFETY_SETTINGS = [
    { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
    { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
    { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
    { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
    { category: HarmCategory.HARM_CATEGORY_CIVIC_INTEGRITY, threshold: HarmBlockThreshold.BLOCK_NONE },
];

export { SAFETY_SETTINGS };

export const testModelConnection = async (modelId: string): Promise<{ success: boolean; message: string }> => {
    try {
        await smartExecution([modelId], (id, client) => client.models.generateContent({
            model: id,
            contents: 'Trả lời OK.',
            config: { safetySettings: SAFETY_SETTINGS }
        }), 'Kiểm tra model');
        return { success: true, message: 'Kết nối thành công! Model sẵn sàng.' };
    } catch (error) {
        return { success: false, message: error instanceof Error ? error.message : 'Không thể kiểm tra model.' };
    }
};

// Select a compatible project and reserve quota before starting an API request.
export const smartExecution = async <T>(
    candidateModels: string[],
    operation: (modelId: string, client: GoogleGenAI) => Promise<T>,
    taskName: string = "Tác vụ",
    onLog?: (msg: string) => void,
    preferredModelId?: string,
    priorityOverrides?: Record<string, number>
): Promise<T> => {
    logger.log(`[smartExecution] task: ${taskName}, candidateModels:`, candidateModels);
    const validCandidates = candidateModels.filter(id => MODEL_CONFIGS.some(c => c.id === id));
    logger.log(`[smartExecution] task: ${taskName}, validCandidates:`, validCandidates);
    const blocked = new Map<GeminiProject, Set<string>>();
    let accessError = "";
    let quotaLimited = false;
    let retryModel: string | undefined;
    
    if (validCandidates.length === 0) {
        throw new Error(`[${taskName}] Không có model nào khả dụng. Vui lòng kiểm tra lại cài đặt.`);
    }

    const MAX_ITERATIONS = 50;
    let iterations = 0;

    while (iterations++ < MAX_ITERATIONS) {
        const projects = getGeminiProjects();
        if (!projects.length) throw new Error("Chưa có Gemini API key. Mở mục API để nhập key.");
        const candidates = projects.flatMap(project => {
            const excluded = blocked.get(project) ?? new Set<string>();
            blocked.set(project, excluded);
            const models = validCandidates.filter(id => project.modelIds.includes(id) && !excluded.has(id)
                && project.quota.isModelEnabled(id) && !project.quota.isModelDepleted(id));
            if (!models.length) return [];
            const waitModels = preferredModelId && models.includes(preferredModelId) ? [preferredModelId] : models;
            return [{ project, models, waitModels }];
        });
        if (!candidates.length) {
            throw new Error((!quotaLimited && accessError) || `[${taskName}] Tất cả model khả dụng đã hết Quota hoặc bị tắt hoặc bị lỗi.`);
        }

        const retry = retryModel;
        const readyProject = retry && candidates.find(({ project, models }) =>
            models.includes(retry) && project.quota.isModelAvailable(retry));
        const selection = readyProject ? { project: readyProject.project, id: retry } : candidates.map(({ project, models }) => ({
            project,
            id: project.quota.getBestModelForTask(models, [], preferredModelId, priorityOverrides)
        })).find(candidate => candidate.id);

        if (!selection?.id) {
            const wait = Math.min(...candidates.flatMap(({ project, waitModels }) =>
                waitModels.map(id => project.quota.getWaitTimeForModel(id))));
            const delay = Number.isFinite(wait) && wait > 0 ? wait : 2000;
            onLog?.(`[${taskName}] Chờ quota trong ${(delay / 1000).toFixed(1)} giây...`);
            await new Promise(resolve => setTimeout(resolve, delay));
            continue;
        }

        const { project, id: selectedId } = selection;
        retryModel = undefined;
        const quota = project.quota;
        const temporaryBlacklist = blocked.get(project)!;

        // --- MODEL SELECTED ---
        quota.recordRequest(selectedId);

        try {
            if (onLog) onLog(`🚀 [${taskName}] Đang chạy trên model: ${selectedId}...`);
            await new Promise(r => setTimeout(r, 600)); // Giãn cách request
            if (!getGeminiProjects().includes(project)) continue;
            const result = await operation(selectedId, project.client);
            
            // SUCCESS: Reset consecutive errors
            quota.recordSuccess(selectedId);
            return result;
        } catch (error: any) {
            let msg = (error.message || error.toString()).toLowerCase();
            if (error.statusText) msg += " " + error.statusText.toLowerCase();
            
            const isQuotaError = isGeminiRateLimit(error);
            const isInvalidKey = msg.includes('api key not valid') || msg.includes('api_key_invalid') || (error.status === 400 && msg.includes('key')) || msg.includes('401 unauthorized') || msg.includes('không tìm thấy api key');
            const isSafetyError = !isQuotaError && (msg.includes('bộ lọc an toàn') || msg.includes('safety') || msg.includes('blocklist') || msg.includes('prohibited_content'));
            const isHallucinationError = msg.includes('lặp từ hoặc mất thẻ') || msg.includes('tỷ lệ >') || msg.includes('vượt giới hạn');
            
            if (isInvalidKey) {
                accessError = "Gemini API key không hợp lệ. Kiểm tra key trong mục API.";
                onLog?.(accessError);
                validCandidates.forEach(id => temporaryBlacklist.add(id));
                continue;
            }
            
            if (isSafetyError) {
                if (onLog) onLog(`⚠️ Model ${selectedId} trả về lỗi (có thể do Safety Filter / rỗng). Trả về lỗi ngay để chia nhỏ batch và thử lại...`);
                throw error; // Throw immediately so useTranslator can split the batch
            }
            
            if (isHallucinationError) {
                if (onLog) onLog(`⚠️ Model ${selectedId} bị ảo giác (lặp từ). Bỏ qua model này cho mẻ hiện tại.`);
                temporaryBlacklist.add(selectedId);
                continue; // Skip this model and try another one
            }
            
            if (isQuotaError) {
                quotaLimited = true;
                quota.recordQuotaError(selectedId);
                const count = quota.getModelUsage(selectedId).consecutiveQuotaErrors || 1;
                if (isGeminiDailyQuota(error)) {
                    retryModel = selectedId;
                    onLog?.(`${selectedId} hết quota ngày ở project hiện tại. Đang tìm project còn lượt.`);
                }
                recordGeminiRateLimit(project, selectedId, error, Math.min(5 * count, 30) * 1000);
                if (count > 6) temporaryBlacklist.add(selectedId);
                continue;
            }

            if (msg === 'aborted') throw error;

            if (error.status === 400 || msg.includes('400')) {
                if (onLog) onLog(`⚠️ CẢNH BÁO LỖI trên model ${selectedId}: ${msg.substring(0, 150)}.`);
            }

            if (msg.includes('500') || error.status >= 500 || msg.includes('503') || msg.includes('overloaded')) {
                quota.recordError(selectedId);
                const usage = quota.getModelUsage(selectedId);
                const errorCount = usage.consecutiveErrors || 0;
                
                if (errorCount >= 3) {
                     if (onLog) onLog(`🚨 Lỗi máy chủ Google (${selectedId}) 3 lần liên tiếp. Bỏ qua model này cho mẻ hiện tại.`);
                     temporaryBlacklist.add(selectedId);
                     // DO NOT markAsDepleted() vì đây chỉ là lỗi server tạm thời
                     continue;
                } else {
                     if (onLog) onLog(`🚨 Lỗi máy chủ Google trên ${selectedId}. Đợi 5s rồi thử lại...`);
                     quota.recordRateLimit(selectedId, 5000);
                     await new Promise(r => setTimeout(r, 5000));
                     continue;
                }
            }

            if (error.status === 403 || msg.includes('403') || msg.includes('permission_denied')) {
                accessError = "Google từ chối quyền gọi model (403). Kiểm tra quyền của Gemini API key.";
                onLog?.(accessError);
                temporaryBlacklist.add(selectedId);
                continue;
            }

            // Normal Error Handle (Network, Parsed, Unknown)
            quota.recordError(selectedId);
            
            const usage = quota.getModelUsage(selectedId);
            const errorCount = usage.consecutiveErrors || 0;
            const maxRetries = 3;
            const hardErrorLimit = selectedId.includes("pro") ? 25 : 105;
            if (errorCount >= hardErrorLimit) {
                if (onLog) onLog(`⛔ CƯỠNG CHẾ HẾT QUOTA: Model ${selectedId} lỗi liên tiếp ${errorCount} lần. Đánh dấu hết Quota!`);
                quota.markAsDepleted(selectedId);
                temporaryBlacklist.add(selectedId);
                continue;
            }

            if (errorCount <= maxRetries) {
                // STRIKE: Exponential Backoff (2s, 4s, 8s)
                const backoffSeconds = Math.pow(2, errorCount); 
                const waitTime = backoffSeconds * 1000;
                
                if (onLog) onLog(`⚠️ Lỗi lần ${errorCount}/${maxRetries} trên ${selectedId}. Đợi ${backoffSeconds}s trước khi thử lại... (${msg.substring(0, 50)}...)`);
                
                quota.recordRateLimit(selectedId, waitTime);
                await new Promise(r => setTimeout(r, waitTime));
            } else {
                // MAX STRIKES: Lỗi nặng, bỏ qua cho mẻ dịch này, NHƯNG không đánh dấu hết Quota
                if (onLog) onLog(`⛔ Model ${selectedId} lỗi ${maxRetries} lần liên tiếp không xác định rõ. Loại khỏi lần thử hiện tại.`);
                temporaryBlacklist.add(selectedId);
            }
            
            // Short pause
            await new Promise(r => setTimeout(r, 500));
        }
    }

    throw new Error(`[${taskName}] Vượt quá số lần thử tối đa (${MAX_ITERATIONS}). Dừng tác vụ để tránh lặp vô hạn.`);
};
