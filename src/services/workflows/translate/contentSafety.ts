// Kiểm tra nội dung có vi phạm chính sách an toàn nội dung của AI hay không (trước khi dịch).

export const testContentSafety = async (content: string, enabledModels: string[]): Promise<{ isSafe: boolean, modelUsed: string }> => {
    try {
        const { SAFETY_SETTINGS } = await import('../../api/gemini');
        const { getGeminiModelRoutes, getGeminiProjects, recordGeminiRateLimit } = await import('../../api/geminiProjects');
        
        // Use quotaManager to find available flash models to avoid 429 errors

        const priorityModels = ['gemini-3.5-flash-lite', 'gemma-4-31b-it', 'gemma-4-26b-a4b-it'];
        const modelsToTry = priorityModels.filter(m => enabledModels.includes(m) || enabledModels.length === 0);
        
        if (modelsToTry.length === 0) {
            const fallback = enabledModels[0];
            if (fallback) modelsToTry.push(fallback);
            else modelsToTry.push('gemini-3.5-flash-lite');
        }
        
        const prompt = `Đây là bài test. Chỉ cần trả lời đúng chữ "OK" và không làm gì khác, không cần đọc nội dung đoạn văn bên dưới.\n\n[NỘI DUNG]:\n${content.substring(0, 4000)}`;

        let lastErr: any;
        const routes = getGeminiModelRoutes(modelsToTry);
        for (const { project, id: targetModel } of routes) {
            const quotaManager = project.quota;
            try {
                if (!getGeminiProjects().includes(project) || !quotaManager.isModelAvailable(targetModel)) continue;

                console.log("testContentSafety recording request for:", targetModel);
                quotaManager.recordRequest(targetModel);

                await project.client.models.generateContent({
                    model: targetModel,
                    contents: prompt,
                    config: { maxOutputTokens: 10, safetySettings: SAFETY_SETTINGS }
                });
                
                console.log("testContentSafety success for:", targetModel);
                quotaManager.recordSuccess(targetModel);
                return { isSafe: true, modelUsed: targetModel }; // Safe
            } catch (err: any) {
                lastErr = err;
                const msg = err.message?.toLowerCase() || '';
                if (msg.includes("safety") || msg.includes("bộ lọc") || err.message?.includes("BLOCKLIST") || err.message?.includes("PROHIBITED_CONTENT") || err.message?.includes("OTHER") || err.message?.includes("RECITATION") || err.message?.includes("SPII")) {
                    quotaManager.recordSuccess(targetModel); // API still responded
                    return { isSafe: false, modelUsed: targetModel }; // Not Safe!
                }
                // If it's a quota error, continue to next model
                if (msg.includes("429") || msg.includes("quota") || msg.includes("exhausted")) {
                    recordGeminiRateLimit(project, targetModel, err);
                    continue;
                }
                if (msg.includes("trả về nội dung rỗng")) {
                    quotaManager.recordSuccess(targetModel);
                    return { isSafe: true, modelUsed: targetModel }; 
                }
                
                quotaManager.recordError(targetModel);
                // Try the next model or project if this request fails.
            }
        }
        
        // Không model nào xác nhận được kết quả (hết quota hoặc lỗi khác).
        // Vẫn coi là "an toàn" để không chặn oan quy trình dịch (giữ hành vi cũ),
        // nhưng LOG rõ lỗi cuối cùng thay vì nuốt im lặng, và phản ánh đúng lý do vào modelUsed
        // để log/UI không hiển thị nhầm "quota exhausted" khi thực ra là lỗi khác.
        if (lastErr) {
            console.warn("testContentSafety: không xác định được an toàn, mặc định coi là an toàn. Lỗi cuối cùng:", lastErr);
            return { isSafe: true, modelUsed: `unknown (error: ${lastErr.message || String(lastErr)})` };
        }
        return { isSafe: true, modelUsed: "unknown (quota exhausted)" };
    } catch (e: any) {
        console.error("testContentSafety error:", e);
        return { isSafe: true, modelUsed: `error (${e?.message || String(e)})` };
    }
};
