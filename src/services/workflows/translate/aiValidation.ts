// Dùng AI để kiểm tra lại chất lượng bản dịch của cả batch (bổ sung cho validate bằng regex/rule).
import { getAiClient, smartExecution, SAFETY_SETTINGS } from '../../api/gemini';
import { fetchOpenRouter } from '../../api/openrouter';
import { removeJunkForValidation } from '../../../utils/text';

// Thứ tự ưu tiên RIÊNG cho hậu kiểm Tier 2 (không ảnh hưởng thứ tự dịch/Auto-Fix ở FLASH_POOL,
// vốn dùng chung trường `priority` trong MODEL_CONFIGS). Số càng thấp càng được ưu tiên chọn
// trước: Gemma 26B > Gemma 31B > 3.1 Flash Lite > 3.5 Flash Lite.
const HAU_KIEM_PRIORITY_OVERRIDE: Record<string, number> = {
    'gemma-4-26b-a4b-it': 1,
    'gemma-4-31b-it': 2,
    'gemini-3.1-flash-lite': 3,
    'gemini-3.5-flash-lite': 4,
};

export const validateBatchWithAI = async (
    files: { id: string, content: string, name?: string }[],
    results: Map<string, string>,
    enabledModels: string[],
    onLog?: (msg: string) => void,
    openRouterKey?: string,
    translationModel?: string // model (mid) đã dùng để dịch batch này, vd "openrouter:xxx" hoặc "gemini-3.5-flash"
): Promise<Map<string, { isValid: boolean, reason?: string }>> => {
    const aiReport = new Map<string, { isValid: boolean, reason?: string }>();
    if (files.length === 0 || results.size === 0) return aiReport;

    // NEW: Nếu batch này vừa được dịch/cứu hộ bằng OpenRouter, hậu kiểm (Tier 2) cũng PHẢI
    // dùng lại đúng vệ tinh đó thay vì quay về Gemini. Lý do: nội dung đã bị Gemini từ chối/lỗi
    // mới phải "cứu hộ" qua vệ tinh, nên đưa nó quay lại Gemini để hậu kiểm sẽ dính lại y hệt
    // lỗi cũ (Safety Filter / rỗng nội dung), khiến bản dịch hợp lệ bị hậu kiểm đánh rớt oan.
    const useOpenRouter = !!(translationModel && translationModel.startsWith('openrouter:') && openRouterKey && openRouterKey.trim().length > 0);

    let candidates: string[];
    if (useOpenRouter) {
        const orCandidateSet = new Set<string>();
        // Ưu tiên chính model OpenRouter vừa dịch thành công batch này (đã chứng minh xử lý được nội dung)
        orCandidateSet.add(translationModel!);
        orCandidateSet.add('openrouter:google/gemma-4-26b-a4b-it:free');
        candidates = Array.from(orCandidateSet);
    } else {
        // Lọc ra các model được phép dùng cho hậu kiểm Tier 2. Thứ tự ưu tiên hậu kiểm dùng
        // HAU_KIEM_PRIORITY_OVERRIDE riêng (không đụng vào `priority` mặc định trong
        // MODEL_CONFIGS ở constants.ts, vì trường đó còn dùng chung cho FLASH_POOL của
        // dịch/Auto-Fix) — xem quotaManager.getBestModelForTask(priorityOverrides).
        // Thứ tự ưu tiên hậu kiểm: Gemma 26B > Gemma 31B > 3.1 Flash Lite > 3.5 Flash Lite.
        const targetModels = ['gemma-4-26b-a4b-it', 'gemma-4-31b-it', 'gemini-3.1-flash-lite', 'gemini-3.5-flash-lite'];
        candidates = targetModels.filter(m => enabledModels.includes(m) || enabledModels.length === 0);
    }

    if (candidates.length === 0) {
        if (onLog) onLog(`ℹ️ Bỏ qua kiểm tra AI (Tier 2) do không có model phù hợp (Gemma 4/Flash Lite) được bật.`);
        return aiReport;
    }

    // QUY TẮC CHIA HẬU KIỂM (Tier 2 AI) — tránh phí request:
    // - Batch <= 6 file: hậu kiểm gộp 1 lượt duy nhất, không tách nhỏ.
    // - Batch > 6 file: chia đôi đều (vd 7 -> 3+4, 8 -> 4+4, 12 -> 6+6), thay vì cứ 5 file/lượt
    //   như trước (batch 15 file từng bị chia thành 3 lượt gọi AI không cần thiết).
    // - Chặn an toàn: không lượt hậu kiểm nào vượt quá 9 file (đệ quy chia đôi tiếp nếu 1 nửa vẫn
    //   > 9 — chỉ có thể xảy ra với batch cực lớn ngoài giới hạn cấu hình thông thường của app).
    const splitForValidation = (list: { id: string, content: string, name?: string }[]): { id: string, content: string, name?: string }[][] => {
        if (list.length <= 6) return [list];
        const half1 = Math.floor(list.length / 2);
        const a = list.slice(0, half1);
        const b = list.slice(half1);
        return [
            ...(a.length > 9 ? splitForValidation(a) : [a]),
            ...(b.length > 9 ? splitForValidation(b) : [b]),
        ];
    };
    const chunks: { id: string, content: string, name?: string }[][] = splitForValidation(files);

    const rescueLabel = useOpenRouter ? ' qua OpenRouter (batch này được dịch bằng OpenRouter)' : '';
    if (onLog) onLog(`🤖 Đang hậu kiểm Batch bằng AI (Tier 2)${rescueLabel}... (Chia ${chunks.length} luồng nhỏ)`);

    // LỊCH SỬ: từng thử cắt cửa sổ đầu/cuối theo số ký tự cố định, rồi theo tỉ lệ giãn nở
    // Việt/Hán, rồi neo theo dòng phân cảnh (……/...) — cả 3 cách đều dựa vào một giả định
    // không giữ được trong thực tế: rằng có thể ĐOÁN đúng vị trí "điểm bắt đầu tương ứng" bên
    // kia chỉ từ độ dài hoặc từ một ký tự định dạng model có thể lược bỏ bất kỳ lúc nào (đã xác
    // nhận qua dữ liệu backup thật: bản dịch không hề giữ lại dấu "……"/"..." nên cách neo phân
    // cảnh cũng vô dụng với đúng ca lỗi nó được sinh ra để sửa). Hễ còn CẮT bớt nội dung trước
    // khi gửi cho AI hậu kiểm, tức là đang tự tạo nguy cơ cắt sai chỗ với các chương có chuyển
    // cảnh/POV giữa chương — và không có công thức đo lường nào loại bỏ được nguy cơ đó hoàn
    // toàn. Cách triệt để: KHÔNG đoán nữa — gửi NGUYÊN VĂN cả gốc lẫn dịch để AI tự đối chiếu,
    // chỉ giữ lại cắt bớt (rất rộng rãi) như một van an toàn cho các file dài bất thường (vd
    // paste nhầm nguyên cả tập/nhiều chương vào 1 file) để tránh phình prompt vô kiểm soát.
    const FULL_SEND_SRC_CAP = 6000;   // ~ 1 chương tiêu chuẩn dài, kể cả chương gộp 2-in-1
    const FULL_SEND_TGT_CAP = 20000;  // dịch tiếng Việt thường dài gấp 2-4 lần bản Hán
    const SAFETY_WINDOW = 4000;       // cửa sổ đầu/cuối RẤT rộng, chỉ áp dụng cho file vượt cap

    const buildPrompt = (chunkFiles: { id: string, content: string, name?: string }[]) => {
        let prompt = `Bạn là một chuyên gia kiểm định bản dịch truyện. Nhiệm vụ của bạn là SO SÁNH đối chiếu giữa bản gốc và bản dịch để phát hiện lỗi ghép sai chương.
Cụ thể, bạn cần đảm bảo:
1. Nội dung phần ĐẦU bản dịch phải dịch chính xác từ phần ĐẦU bản gốc.
2. Nội dung phần CUỐI bản dịch phải dịch chính xác từ phần CUỐI bản gốc.
3. CHÚ Ý TIÊU ĐỀ: Nhiều tác giả/trang web đánh số post tự động chèn trước tên chương (vd: "1149.第1147章..." trong khi tên đúng là 1147). Bản dịch lược bỏ số tiền tố này (thành "Chương 1147:...") là chính xác. KHÔNG báo lỗi ảo giác sai chương.
4. QUẢNG CÁO/TÂM SỰ/CHÚ THÍCH: Đầu hoặc cuối bản GỐC có thể chứa quảng cáo web, lời tâm sự của tác giả, tên converter/dịch giả, chú thích ngoài lề. Việc bản DỊCH đã lược bỏ các phần này (hợp lý cho một bản dịch truyện sạch), hoặc ngược lại bản DỊCH có thêm ghi chú của người dịch mà bản GỐC không có — ĐỀU KHÔNG PHẢI LỖI. Chỉ so sánh phần NỘI DUNG TRUYỆN THỰC SỰ giữa gốc và dịch, bỏ qua các phần phụ trợ này.
5. ĐỊNH DẠNG TIÊU ĐỀ: Truyện gốc có thể thuộc 1 trong 3 dạng chương: (a) có số thứ tự + tên chương, (b) chỉ có số thứ tự không có tên, (c) không có tiêu đề gì cả (thuần văn bản). Ứng dụng dịch được PHÉP tự chuẩn hoá/format lại tiêu đề (thêm "Chương X:" hoặc đặt tên chương phù hợp) cho dạng (b) và (c). Việc bản dịch xuất hiện tiêu đề/số chương mà bản gốc không ghi rõ theo cách đó KHÔNG phải là dấu hiệu lệch nội dung, miễn là phần NỘI DUNG sau tiêu đề vẫn khớp với bản gốc.
6. THIÊN VỊ VỀ PHÍA "HỢP LỆ": Đây là bước kiểm tra CHỐNG GHÉP NHẦM CHƯƠNG, KHÔNG PHẢI chấm điểm chất lượng dịch thuật. Bạn KHÔNG cần bản dịch phải khớp từng chữ, chỉ cần khớp Ý và NHÂN VẬT/BỐI CẢNH chính giữa gốc và dịch. Nếu bạn CHỈ nghi ngờ mơ hồ, không chắc chắn tuyệt đối, hoặc bản dịch trông có vẻ ổn nhưng bạn không đối chiếu được hết do khác ngôn ngữ — PHẢI trả về isValid=true. CHỈ trả về isValid=false khi có bằng chứng RÕ RÀNG, CHẮC CHẮN rằng nội dung dịch nói về một tình huống/nhân vật HOÀN TOÀN KHÁC với bản gốc (dấu hiệu ghép nhầm chương thật sự). Báo sai một bản dịch ĐÚNG gây thiệt hại lớn hơn nhiều so với bỏ sót một bản dịch sai, vì nó làm mất một bản dịch tốt và tốn công dịch lại vô ích.
7. BÌNH LUẬN KHÁN GIẢ/NGƯỜI CHƠI (弹幕/观众们) LÀ CỐT TRUYỆN, KHÔNG PHẢI LỖI: Nhiều truyện thuộc dạng "nhân vật chính phát trực tiếp trong game" (game/livestream/hệ thống) có xen kẽ NGUYÊN VĂN trong bản GỐC các đoạn bình luận/tên hô của khán giả, người xem, người chơi khác (vd 弹幕, 观众们说, biệt danh do khán giả đặt cho nhân vật chính...). Đây LÀ nội dung truyện thật, KHÔNG phải rác quảng cáo, và KHÔNG phải dấu hiệu bản dịch bịa thêm/lệch chương.
8. CHƯƠNG CÓ NHIỀU CẢNH/CHUYỂN POV: Một chương gốc hoàn toàn có thể chứa nhiều cảnh khác nhau, chuyển góc nhìn giữa các nhóm nhân vật (vd đoạn giữa chương nhảy sang cảnh phe phái khác đang họp bàn, rồi quay lại nhân vật chính). Đây là cấu trúc truyện BÌNH THƯỜNG, KHÔNG phải dấu hiệu ghép nhầm chương. Vì bạn được xem TOÀN BỘ nội dung (không phải trích đoạn), hãy tìm ĐOẠN KẾT THỰC SỰ (đoạn văn cuối cùng, ngay trước khi hết bản gốc) và đối chiếu đúng đoạn đó — không nhầm với một cảnh ở giữa chương.
TUYỆT ĐỐI KHÔNG đánh giá tính logic hay sự liền mạch của cốt truyện giữa đoạn đầu và đoạn cuối. Kể cả cốt truyện chuyển cảnh đột ngột ở bản gốc, chỉ cần bản dịch khớp với bản gốc thì vẫn là ĐÚNG.
9. VĂN PHONG THOÁT Ý/MƯỢT MÀ KHÔNG PHẢI LỖI: Bản dịch được yêu cầu dịch THOÁT Ý, viết lại câu cho mượt mà tự nhiên theo văn phong Việt (không dịch word-by-word bám sát trật tự câu gốc), và có thể chêm nhẹ teencode/tiếng lóng thông dụng khi hợp bối cảnh. Vì vậy bản dịch có thể: đảo trật tự câu/đoạn trong CÙNG một cảnh, gộp hoặc tách câu, đổi cách diễn đạt/thành ngữ, thêm/bớt từ đệm — miễn Ý, NHÂN VẬT, HÀNH ĐỘNG và BỐI CẢNH của đoạn đó vẫn đúng với bản gốc. Đây KHÔNG phải dấu hiệu ghép nhầm chương hay lệch nội dung. CHỈ báo isValid=false khi nội dung nói về tình huống/nhân vật/sự kiện HOÀN TOÀN KHÁC, không phải khi chỉ khác cách diễn đạt.

`;
        let countToValidate = 0;
        chunkFiles.forEach(f => {
            const targetContent = results.get(f.id);
            if (!targetContent) return;
            countToValidate++;

            let safeContent = f.content;
            safeContent = safeContent.replace(/([1-9]\d*)0000(?!\d)/g, '$1万');
            safeContent = removeJunkForValidation(safeContent);
            const safeTarget = removeJunkForValidation(targetContent);

            const fitsFullSend = safeContent.length <= FULL_SEND_SRC_CAP && safeTarget.length <= FULL_SEND_TGT_CAP;

            prompt += `--- FILE ID: ${f.id} ---\n`;
            if (fitsFullSend) {
                // Trường hợp bình thường (đại đa số): gửi NGUYÊN VĂN, không đoán cửa sổ.
                prompt += `[GỐC - TOÀN BỘ]:\n${safeContent.trim()}\n\n`;
                prompt += `[DỊCH - TOÀN BỘ]:\n${safeTarget.trim()}\n\n`;
            } else {
                // Van an toàn cho file dài bất thường — cửa sổ RẤT rộng (4000 ký tự mỗi đầu,
                // mỗi bên) để giảm thiểu tối đa nguy cơ hụt cảnh, chỉ chấp nhận rủi ro nhỏ còn
                // sót lại thay vì gửi nguyên văn file cực lớn tốn prompt vô ích.
                const srcHead = safeContent.substring(0, SAFETY_WINDOW).trim();
                const srcTail = safeContent.substring(Math.max(0, safeContent.length - SAFETY_WINDOW)).trim();
                const tgtHead = safeTarget.substring(0, SAFETY_WINDOW).trim();
                const tgtTail = safeTarget.substring(Math.max(0, safeTarget.length - SAFETY_WINDOW)).trim();
                prompt += `[GỐC ĐẦU]:\n${srcHead}\n\n`;
                prompt += `[GỐC CUỐI]:\n${srcTail}\n\n`;
                prompt += `[DỊCH ĐẦU]:\n${tgtHead}\n\n`;
                prompt += `[DỊCH CUỐI]:\n${tgtTail}\n\n`;
            }
        });

        if (countToValidate === 0) return null;

        prompt += `Hãy trả về kết quả định dạng JSON chuẩn:
{
  "validations": {
    "file_id": {
      "isValid": true/false,
      "reason": "Giải thích ngắn gọn nếu false"
    }
  }
}`;
        return prompt;
    };

    const runValidationPass = async (
        chunkFiles: { id: string, content: string, name?: string }[],
        candidateList: string[],
        targetMap: Map<string, { isValid: boolean, reason?: string }>
    ) => {
        const prompt = buildPrompt(chunkFiles);
        if (!prompt) return;

        try {
            const jsonResultText = await smartExecution<string>(
                candidateList,
                async (modelId) => {
                    if (modelId.startsWith('openrouter:')) {
                        const openRouterModel = modelId.replace('openrouter:', '');
                        const text = await fetchOpenRouter(
                            openRouterKey || "",
                            openRouterModel,
                            "Bạn là một chuyên gia kiểm định bản dịch truyện. CHỈ trả lời bằng đúng 1 khối JSON hợp lệ theo định dạng được yêu cầu, không thêm lời dẫn hay giải thích ngoài JSON.",
                            prompt,
                            true // jsonMode
                        );
                        return text || "{}";
                    }
                    const ai = getAiClient();
                    const response = await ai.models.generateContent({
                        model: modelId,
                        contents: prompt,
                        config: { 
                            safetySettings: SAFETY_SETTINGS,
                            temperature: 0.1,
                            responseMimeType: "application/json"
                        }
                    });
                    return response.text || "{}";
                },
                "AI Batch Validator",
                undefined, // no direct logs to avoid spam
                candidateList[0],
                HAU_KIEM_PRIORITY_OVERRIDE
            );

            let parsed: any;
            try {
                const cleanJson = jsonResultText.replace(/```json/gi, '').replace(/```/g, '').trim();
                parsed = JSON.parse(cleanJson);
            } catch {
                if (onLog) onLog(`⚠️ Không thể parse JSON từ AI Validator: ${jsonResultText.substring(0, 100)}`);
                return;
            }

            if (parsed && parsed.validations) {
                Object.keys(parsed.validations).forEach(key => {
                    targetMap.set(key, parsed.validations[key]);
                });
            }
        } catch(e: any) {
            if (onLog) onLog(`⚠️ Lỗi khi chạy AI Validator chunk: ${e.message}`);
        }
    };

    // Lượt 1: hậu kiểm như bình thường (dùng candidates đã xác định ở trên - OpenRouter nếu batch
    // vừa dịch bằng OpenRouter, ngược lại Gemini Flash-Lite/Gemma).
    await Promise.all(chunks.map(chunk => runValidationPass(chunk, candidates, aiReport)));

    // FIX (fail-closed thay vì fail-open): nếu 1 chunk hậu kiểm gặp trục trặc — JSON không parse
    // được (dòng "catch" ở runValidationPass), gọi API lỗi hết toàn bộ candidate model, hoặc AI
    // trả JSON hợp lệ nhưng THIẾU hẳn 1 vài file_id trong "validations" (rất hay gặp khi model bị
    // cắt output giữa chừng ở batch nhiều file) — thì (các) file đó sẽ không có entry nào trong
    // aiReport. Trước đây điều này khiến file bị coi là "hợp lệ" một cách im lặng, vì vòng lặp tiêu
    // thụ kết quả ở streamTranslate.ts (aiValidationResults.forEach) chỉ chạy trên các entry THỰC
    // SỰ tồn tại trong Map — bỏ sót không có nghĩa là "AI xác nhận đúng", nhưng lại bị đối xử y hệt
    // như vậy. Chủ động điền các file bị thiếu bằng isValid=false + lý do rõ ràng ("chưa xác minh
    // được" chứ không phải "đã xác minh là đúng"), để file được đưa vào diện nghi vấn/dịch lại thay
    // vì lọt lưới. Đặt TRƯỚC Lượt 2 để các file bị điền bù này (nếu do vệ tinh OpenRouter
    // rớt) vẫn có cơ hội được Gemini xác nhận chéo lại thay vì bị đánh rớt oan luôn.
    files.forEach(f => {
        if (!aiReport.has(f.id)) {
            aiReport.set(f.id, {
                isValid: false,
                reason: "Hậu kiểm AI (Tier 2) không trả về kết quả cho file này (JSON thiếu file_id / lỗi gọi API / không parse được JSON) — tự động đánh dấu nghi vấn thay vì mặc định coi là hợp lệ."
            });
        }
    });

    // Lượt 2 (XÁC NHẬN CHÉO): CHỈ chạy khi lượt 1 dùng OpenRouter VÀ có ít nhất 1 file bị đánh
    // isValid=false. Lý do: các model free/nhẹ trên OpenRouter (Gemma 26B free, GPT-OSS free)
    // hay bị nhận thấy phán đoán sai khi phải so sánh nội dung KHÁC NGÔN NGỮ (gốc Trung/Hàn/Nhật
    // vs dịch Việt) — kể cả khi dịch từng-file-một (không có nguy cơ hoán vị chéo), Tier 2 vẫn có
    // thể tự báo oan "trả nhầm kết quả" do chính model giám định yếu chứ không phải do bản dịch
    // sai thật. Gemini Flash-Lite (model thường dùng, đáng tin cậy hơn cho việc so khớp đa ngôn
    // ngữ) sẽ xác nhận lại — CHỈ giữ nguyên cờ nghi vấn khi CẢ 2 lượt cùng đồng ý là sai, nếu Gemini
    // xác nhận là hợp lệ thì lật ngược lại kết quả, tránh báo oan hàng loạt.
    if (useOpenRouter) {
        const rescueSourceLabel = 'OpenRouter';
        const failedIds = Array.from(aiReport.entries()).filter(([, v]) => !v.isValid).map(([id]) => id);
        if (failedIds.length > 0) {
            const geminiCandidates = ['gemma-4-26b-a4b-it', 'gemma-4-31b-it', 'gemini-3.1-flash-lite', 'gemini-3.5-flash-lite'].filter(m => enabledModels.includes(m) || enabledModels.length === 0);
            if (geminiCandidates.length > 0) {
                if (onLog) onLog(`🔎 Xác nhận chéo bằng Gemini cho ${failedIds.length} file bị ${rescueSourceLabel} nghi vấn (tránh báo oan do model giám định yếu)...`);
                const filesToRecheck = files.filter(f => failedIds.includes(f.id));
                const confirmReport = new Map<string, { isValid: boolean, reason?: string }>();
                const confirmChunks = splitForValidation(filesToRecheck);
                await Promise.all(confirmChunks.map(chunk => runValidationPass(chunk, geminiCandidates, confirmReport)));

                failedIds.forEach(id => {
                    const confirmed = confirmReport.get(id);
                    if (confirmed && confirmed.isValid) {
                        // Gemini KHÔNG đồng ý với nghi vấn ban đầu -> lật lại thành hợp lệ.
                        aiReport.set(id, { isValid: true, reason: `(Đã xác nhận chéo bằng Gemini: hợp lệ. Nghi vấn ban đầu từ ${rescueSourceLabel}: ${aiReport.get(id)?.reason || 'không rõ'})` });
                        if (onLog) onLog(`✅ File ${id}: Gemini xác nhận HỢP LỆ, huỷ nghi vấn ban đầu từ ${rescueSourceLabel}.`);
                    }
                    // Nếu Gemini cũng đồng ý là sai (hoặc không xác nhận được do lỗi/parse fail),
                    // giữ nguyên cờ nghi vấn ban đầu — không cần làm gì thêm.
                });
            } else if (onLog) {
                onLog(`ℹ️ Không có model Gemini nào để xác nhận chéo (đang chỉ dùng ${rescueSourceLabel}) — giữ nguyên kết quả hậu kiểm ban đầu.`);
            }
        }
    }

    return aiReport;
};
