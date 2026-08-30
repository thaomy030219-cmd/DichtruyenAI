import { DEFAULT_OPENROUTER_MODEL } from '../../constants/openrouterModels';

export interface OpenRouterKeyStatus {
    key: string;
    index: number;
    maskedKey: string;
    status: 'Active' | 'Exhausted' | 'Error' | 'Pending';
    successCount: number;
}

type EventCallback = () => void;

class OpenRouterKeyManager {
    private originalKeyStr: string = "";
    private keys: string[] = [];
    private currentIndex: number = 0;
    private keyStatuses: Map<string, OpenRouterKeyStatus> = new Map();
    private subscribers: Set<EventCallback> = new Set();
    private isRotating: boolean = false;

    public syncKeys(apiKeyStr: string) {
        if (this.originalKeyStr === apiKeyStr) return;
        this.originalKeyStr = apiKeyStr;
        const newKeys = apiKeyStr.split(/[,\n]/).map(k => k.trim()).filter(Boolean);
        
        this.keys = newKeys;
        this.keyStatuses.clear();
        this.keys.forEach((key, idx) => {
            const masked = key.length > 12 ? key.substring(0, 8) + '...' + key.substring(key.length - 4) : 'Invalid Key';
            this.keyStatuses.set(key, {
                key: key,
                index: idx,
                maskedKey: masked,
                status: idx === 0 ? 'Active' : 'Pending',
                successCount: 0
            });
        });
        this.currentIndex = 0;
        this.notify();
    }

    public getKeys(): string[] {
        return this.keys;
    }

    public getKeyStatuses(): OpenRouterKeyStatus[] {
        return this.keys.map(k => this.keyStatuses.get(k)!);
    }

    public getCurrentKeyInfo(): OpenRouterKeyStatus | null {
        if (this.keys.length === 0) return null;
        return this.keyStatuses.get(this.keys[this.currentIndex]) || null;
    }
    
    public getCurrentKey(): string {
        if (this.keys.length === 0) return "";
        return this.keys[this.currentIndex];
    }

    public switchToKey(index: number) {
        if (index >= 0 && index < this.keys.length) {
            // Reset previous active to pending if it wasn't exhausted/error
            const prevKey = this.keys[this.currentIndex];
            const prevStatus = this.keyStatuses.get(prevKey);
            if (prevStatus && prevStatus.status === 'Active') {
                prevStatus.status = 'Pending';
            }
            
            this.currentIndex = index;
            const newKey = this.keys[this.currentIndex];
            const newStatus = this.keyStatuses.get(newKey);
            if (newStatus) {
                newStatus.status = 'Active';
                newStatus.successCount = 0; // reset for this run
            }
            this.notify();
        }
    }

    public rotateToNext(): boolean {
        if (this.keys.length <= 1) return false;
        if (this.isRotating) return false;
        
        this.isRotating = true;
        const prevKey = this.keys[this.currentIndex];
        const prevStatus = this.keyStatuses.get(prevKey);
        if (prevStatus && prevStatus.status === 'Active') {
            prevStatus.status = 'Exhausted';
        }
        
        this.currentIndex = (this.currentIndex + 1) % this.keys.length;
        const newKey = this.keys[this.currentIndex];
        const newStatus = this.keyStatuses.get(newKey);
        
        // If we looped around and all are exhausted, we might want to reset them all to Pending and try again
        let allExhausted = true;
        for (const [, st] of this.keyStatuses) {
            if (st.status !== 'Exhausted' && st.status !== 'Error') {
                allExhausted = false;
                break;
            }
        }
        
        if (allExhausted) {
            console.log("All OpenRouter keys exhausted. Resetting statuses.");
            for (const [, st] of this.keyStatuses) {
                st.status = 'Pending';
                st.successCount = 0;
            }
        }

        if (newStatus && newStatus.status !== 'Exhausted' && newStatus.status !== 'Error') {
            newStatus.status = 'Active';
        } else if (allExhausted && newStatus) {
            newStatus.status = 'Active';
        }

        this.isRotating = false;
        this.notify();
        return true;
    }

    public reportSuccess() {
        const currentKey = this.keys[this.currentIndex];
        const status = this.keyStatuses.get(currentKey);
        if (status) {
            status.successCount++;
            if (status.status !== 'Active') {
                status.status = 'Active';
            }
            this.notify();
        }
    }

    public reportError(errorMsg: string) {
        const currentKey = this.keys[this.currentIndex];
        const status = this.keyStatuses.get(currentKey);
        if (status) {
            const isQuotaError = errorMsg.includes("429") || errorMsg.toLowerCase().includes("rate limit") || errorMsg.toLowerCase().includes("no credits") || errorMsg.toLowerCase().includes("insufficient credits") || errorMsg.toLowerCase().includes("too many requests") || errorMsg.toLowerCase().includes("quota");
            status.status = isQuotaError ? 'Exhausted' : 'Error';
            // UPDATED v1.0.3: TRƯỚC ĐÂY chỉ rotateToNext() khi lỗi khớp đúng 1 trong các từ khóa
            // quota ở trên -> mọi lỗi khác (vd "Provider returned error", "model unavailable",
            // sai key, lỗi mạng tạm thời từ nhà cung cấp...) bị coi là lỗi thường và KHÔNG nhảy
            // key, khiến app cứ đứng yên thử đi thử lại đúng 1 key dù danh sách còn nhiều key khác
            // đang "Chờ". Giờ hễ còn >1 key trong danh sách, BẤT KỲ lỗi nào cũng nhảy sang key kế
            // tiếp ngay — 1 key hỏng vì lý do gì cũng không nên chặn đứng cả tiến trình khi vẫn
            // còn key khác chưa dùng.
            if (this.keys.length > 1) {
                this.rotateToNext();
            }
            this.notify();
        }
    }

    public resetQuota() {
        this.currentIndex = 0;
        this.keys.forEach((key, idx) => {
            const st = this.keyStatuses.get(key);
            if (st) {
                st.status = idx === 0 ? 'Active' : 'Pending';
                st.successCount = 0;
            }
        });
        this.notify();
    }

    public subscribe(callback: EventCallback): () => void {
        this.subscribers.add(callback);
        return () => this.subscribers.delete(callback);
    }

    private notify() {
        this.subscribers.forEach(cb => cb());
    }
}

export const openRouterKeyManager = new OpenRouterKeyManager();

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const openRouterModelCache = new Map<string, { context_length: number, max_completion_tokens?: number }>();
let isModelCacheFetching = false;

export const getOpenRouterModelInfo = async (modelId: string): Promise<{ context_length: number, max_completion_tokens?: number } | null> => {
    if (openRouterModelCache.has(modelId)) return openRouterModelCache.get(modelId) || null;
    if (isModelCacheFetching) return null;
    
    isModelCacheFetching = true;
    try {
        const response = await fetch("https://openrouter.ai/api/v1/models");
        if (response.ok) {
            const data = await response.json();
            if (data && data.data && Array.isArray(data.data)) {
                data.data.forEach((m: any) => {
                    openRouterModelCache.set(m.id, {
                        context_length: m.context_length,
                        max_completion_tokens: m.top_provider?.max_completion_tokens
                    });
                });
            }
        }
    } catch (e) {
        console.warn("Failed to fetch OpenRouter models info:", e);
    } finally {
        isModelCacheFetching = false;
    }
    
    return openRouterModelCache.get(modelId) || null;
};

let liveFreeModelsCache: string[] | null = null;
let liveFreeModelsCacheTime = 0;
const CACHE_DURATION = 30 * 60 * 1000;

export const getLiveFreeNonGoogleModels = async (): Promise<string[]> => {
    if (liveFreeModelsCache && Date.now() - liveFreeModelsCacheTime < CACHE_DURATION) {
        return liveFreeModelsCache;
    }
    
    try {
        const response = await fetch("https://openrouter.ai/api/v1/models");
        if (response.ok) {
            const data = await response.json();
            if (data && data.data && Array.isArray(data.data)) {
                const freeModels = data.data.filter((m: any) => {
                    const promptPrice = parseFloat(m.pricing?.prompt || "1");
                    const completionPrice = parseFloat(m.pricing?.completion || "1");
                    return promptPrice === 0 && completionPrice === 0 && !m.id.startsWith('google/');
                });
                
                freeModels.sort((a: any, b: any) => (b.context_length || 0) - (a.context_length || 0));
                
                const top5 = freeModels.slice(0, 5).map((m: any) => m.id);
                liveFreeModelsCache = top5;
                liveFreeModelsCacheTime = Date.now();
                return top5;
            }
        }
    } catch (e) {
        console.warn("Failed to fetch live free OpenRouter models:", e);
    }
    
    return [];
};

export const fetchOpenRouter = async (
    apiKeyStr: string,
    model: string,
    systemInstruction: string,
    prompt: string,
    jsonMode = false,
    onModelInfo?: (model: string) => void
): Promise<string> => {
    openRouterKeyManager.syncKeys(apiKeyStr);
    
    const keys = openRouterKeyManager.getKeys();
    if (keys.length === 0) {
        throw new Error("OpenRouter API Key not provided.");
    }

    const modelsArray = model.split(',').map(m => m.trim()).filter(Boolean);
    const fallbackModels = modelsArray.length > 0 ? modelsArray : [DEFAULT_OPENROUTER_MODEL];
    
    const primaryModel = fallbackModels[0];
    const modelInfo = await getOpenRouterModelInfo(primaryModel);
    
    // Estimate max tokens
    const estInputTokens = Math.ceil(prompt.length / 2.5) + Math.ceil(systemInstruction.length / 2.5);
    let estimatedOutputTokens = Math.min(Math.ceil(prompt.length / 2.5) + 1000, 16000);
    
    if (modelInfo) {
        const remainingContext = modelInfo.context_length - estInputTokens - 200; // margin
        if (remainingContext > 0) {
            estimatedOutputTokens = Math.min(estimatedOutputTokens, remainingContext);
        }
        if (modelInfo.max_completion_tokens) {
            estimatedOutputTokens = Math.min(estimatedOutputTokens, modelInfo.max_completion_tokens);
        }
    }

    const payload: any = {
        models: fallbackModels,
        messages: [
            { role: "system", content: systemInstruction },
            { role: "user", content: prompt }
        ],
        temperature: 0.2,
        max_tokens: estimatedOutputTokens
    };

    if (jsonMode) {
        payload.response_format = { type: 'json_object' };
    }

    let lastError: Error | null = null;
    const maxRetries = 7;
    let attempt = 0;

    while (attempt < maxRetries) {
        const currentKey = openRouterKeyManager.getCurrentKey();
        try {
            const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
                method: "POST",
                headers: {
                    "Authorization": `Bearer ${currentKey}`,
                    "Content-Type": "application/json"
                },
                body: JSON.stringify(payload)
            });

            if (!response.ok) {
                const errObj = await response.json().catch(() => ({}));
                const errMsg = errObj.error?.message || `OpenRouter API error: ${response.status} ${response.statusText}`;
                throw new Error(errMsg);
            }

            const data = await response.json();
            if (onModelInfo && data.model) {
                onModelInfo(data.model);
            }
            openRouterKeyManager.reportSuccess();
            return data.choices?.[0]?.message?.content || "";
        } catch (error: any) {
            lastError = error;
            openRouterKeyManager.reportError(error.message);
            attempt++;
            
            if (attempt >= maxRetries) break;
            
            if (attempt === 1) {
                await delay(3000);
            } else if (attempt === 2) {
                await delay(5000);
            } else if (attempt === 3) {
                await delay(10000);
            } else {
                if (keys.length > 1) {
                    // Already rotated by reportError if 429
                } else {
                    await delay(30000);
                }
            }
        }
    }

    throw new Error(`OpenRouter failed after ${maxRetries} attempts. Last Error: ${lastError?.message}`);
};

export const fetchOpenRouterStream = async (
    apiKeyStr: string,
    model: string,
    systemInstruction: string,
    prompt: string,
    onChunk: (text: string) => void,
    onModelInfo?: (model: string) => void,
    onLog?: (msg: string) => void
): Promise<string> => {
    openRouterKeyManager.syncKeys(apiKeyStr);
    
    const keys = openRouterKeyManager.getKeys();
    if (keys.length === 0) {
        throw new Error("OpenRouter API Key not provided.");
    }

    const modelsArray = model.split(',').map(m => m.trim()).filter(Boolean);
    const fallbackModels = modelsArray.length > 0 ? modelsArray : [DEFAULT_OPENROUTER_MODEL];

    let lastError: Error | null = null;
    const maxRetries = 7;
    let attempt = 0;
    let fullText = "";

    const primaryModel = fallbackModels[0];
    const modelInfo = await getOpenRouterModelInfo(primaryModel);

    let currentPrompt = prompt;
    let continuationAttempts = 0;
    const MAX_CONTINUATIONS = 6;

    while (attempt < maxRetries) {
        const currentKey = openRouterKeyManager.getCurrentKey();
        try {
            const estInputTokens = Math.ceil(currentPrompt.length / 2.5) + Math.ceil(systemInstruction.length / 2.5);
            let estimatedOutputTokens = Math.min(Math.ceil(currentPrompt.length / 2.5) + 1000, 16000);
            
            if (modelInfo) {
                const remainingContext = modelInfo.context_length - estInputTokens - 200;
                if (remainingContext > 0) {
                    estimatedOutputTokens = Math.min(estimatedOutputTokens, remainingContext);
                }
                if (modelInfo.max_completion_tokens) {
                    estimatedOutputTokens = Math.min(estimatedOutputTokens, modelInfo.max_completion_tokens);
                }
            }

            const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
                method: "POST",
                headers: {
                    "Authorization": `Bearer ${currentKey}`,
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    models: fallbackModels,
                    messages: [
                        { role: "system", content: systemInstruction },
                        { role: "user", content: currentPrompt }
                    ],
                    stream: true,
                    temperature: 0.2,
                    max_tokens: estimatedOutputTokens
                })
            });

            if (!response.ok) {
                const errObj = await response.json().catch(() => ({}));
                throw new Error(errObj.error?.message || `OpenRouter API error: ${response.status} ${response.statusText}`);
            }

            if (!response.body) {
                throw new Error("No response body from OpenRouter.");
            }

            const reader = response.body.getReader();
            const decoder = new TextDecoder("utf-8");
            let buffer = "";
            let modelReported = false;
            let needsContinuation = false;

            while (true) {
                const { value, done } = await reader.read();
                if (done) break;
                buffer += decoder.decode(value, { stream: true });
                let newlineIdx;
                
                while ((newlineIdx = buffer.indexOf('\n')) !== -1) {
                    const line = buffer.substring(0, newlineIdx).trim();
                    buffer = buffer.substring(newlineIdx + 1);
                    if (line.startsWith('data: ')) {
                        const dataStr = line.substring(6).trim();
                        if (dataStr === '[DONE]') continue;
                        try {
                            const data = JSON.parse(dataStr);
                            
                            if (onModelInfo && !modelReported && data.model) {
                                onModelInfo(data.model);
                                modelReported = true;
                            }
                            
                            const content = data.choices?.[0]?.delta?.content;
                            if (content) {
                                fullText += content;
                                onChunk(fullText);
                            }
                            
                            if (data.choices?.[0]?.finish_reason === 'length') {
                                if (continuationAttempts < MAX_CONTINUATIONS) {
                                    continuationAttempts++;
                                    currentPrompt = `${prompt}\n\n[ĐÃ DỊCH ĐƯỢC MỘT PHẦN LÀ:\n${fullText}\n]\n\nBẠN HÃY VIẾT TIẾP CHÍNH XÁC TỪ CHỖ BỊ CẮT. KHÔNG LẶP LẠI PHẦN ĐÃ DỊCH, KHÔNG MỞ LẠI THẺ START NỮA.`;
                                    attempt = 0; // reset attempt since it's a new continuation
                                    openRouterKeyManager.reportSuccess();
                                    needsContinuation = true;
                                    if (onLog) onLog(`🔄 OpenRouter bị cắt ngang (max_tokens). Tự động nối tiếp phần ${continuationAttempts}/${MAX_CONTINUATIONS}...`);
                                    break;
                                } else {
                                    throw new Error("Lỗi OpenRouter: Đã đạt giới hạn số lần nối tự động do max_tokens.");
                                }
                            }
                            
                        } catch (e: any) {
                            if (e.message === 'ABORTED' || (e.message && e.message.includes('Lỗi AI lặp từ')) || e.message.includes('Lỗi OpenRouter:')) {
                                throw e; // Abort immediately
                            }
                            // Ignore parse errors
                        }
                    }
                }
                if (needsContinuation) break;
            }
            
            if (needsContinuation) {
                continue; // Continue the outer while (attempt < maxRetries) loop to fetch again
            }

            openRouterKeyManager.reportSuccess();
            return fullText;
        } catch (error: any) {
            if (error.message === 'ABORTED' || (error.message && error.message.includes('Lỗi AI lặp từ'))) {
                throw error;
            }
            lastError = error;
            openRouterKeyManager.reportError(error.message);
            attempt++;
            
            if (attempt >= maxRetries) break;
            
            if (attempt === 1) {
                await delay(3000);
            } else if (attempt === 2) {
                await delay(5000);
            } else if (attempt === 3) {
                await delay(10000);
            } else {
                if (keys.length > 1) {
                    // rotated
                } else {
                    await delay(30000);
                }
            }
        }
    }

    throw new Error(`OpenRouter stream failed after ${maxRetries} attempts. Last Error: ${lastError?.message}`);
};
