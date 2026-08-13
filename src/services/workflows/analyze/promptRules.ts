// Nhóm hàm liên quan PROMPT/QUY TẮC dịch: tối ưu prompt, tinh chỉnh additionalRules, tóm tắt.
import { getAiClient, smartExecution, SAFETY_SETTINGS } from '../../api/gemini';
import { StoryInfo } from '../../../types';
import { replacePromptVariables } from '../../../prompts';

export const optimizePrompt = async (
  promptTemplate: string,
  storyInfo: StoryInfo,
  context: string = "",
  dictionary: string = "",
  additionalRules: string = "",
  enabledModels?: string[]
): Promise<string> => {
  const ai = getAiClient();
  // User requested 3.1 Pro. We keep 3.0 Pro as a high-quality backup, but remove 2.5 to ensure quality.
  const candidates = ['gemini-3.1-pro-preview', 'gemini-3.6-flash', 'gemini-3-flash-preview', 'gemini-3.5-flash'].filter(id => enabledModels?.includes(id) ?? true);
  if (candidates.length === 0) candidates.push('gemini-3.1-pro-preview', 'gemini-3.6-flash', 'gemini-3-flash-preview', 'gemini-3.5-flash');
  const filledTemplate = replacePromptVariables(promptTemplate, storyInfo);
  const isGameOrWestern = storyInfo.genres.some(g => ['Light Novel', 'Isekai', 'Fantasy', 'Đồng Nhân', 'Võng Du', 'Game'].includes(g)) || storyInfo.worldSetting.some(s => ['Phương Tây/Magic', 'Võng Du/Game'].includes(s));
  
  // DETECT MODE STRICTLY
  const lang = storyInfo.languages.join(' ').toLowerCase();
  const isConvert = lang.includes('convert') || lang.includes('cv') || lang.includes('thô');
  const isRaw = lang.includes('trung') || lang.includes('anh') || lang.includes('nhật') || lang.includes('hàn') || lang.includes('raw') || lang.includes('chinese') || lang.includes('english');

  let modeDirective = "";
  if (isConvert) {
      modeDirective = `
### 🛑 THIẾT QUÂN LUẬT VỀ CHẾ ĐỘ (MODE LOCK):
- Dữ liệu đầu vào được xác định là: **CONVERT / TIẾNG VIỆT THÔ**.
- **YÊU CẦU BẮT BUỘC:** Hãy viết lại Prompt để **CHỈ SỬ DỤNG CHẾ ĐỘ 1 (BIÊN TẬP / REWRITE)**.
- **HÀNH ĐỘNG CỤ THỂ:** XÓA BỎ hoàn toàn các chỉ thị liên quan đến "DỊCH THUẬT" (TRANSLATE) hoặc "CHẾ ĐỘ 2".
- Prompt mới phải tập trung tuyệt đối vào việc: Đọc hiểu văn bản tiếng Việt lủng củng -> Viết lại thành văn bản tiếng Việt mượt mà, đúng ngữ pháp.`;
  } else if (isRaw) {
      modeDirective = `
### 🛑 THIẾT QUÂN LUẬT VỀ CHẾ ĐỘ (MODE LOCK):
- Dữ liệu đầu vào được xác định là: **RAW / NGOẠI NGỮ**.
- **YÊU CẦU BẮT BUỘC:** Hãy viết lại Prompt để **CHỈ SỬ DỤNG CHẾ ĐỘ 2 (DỊCH THUẬT / TRANSLATE)**.
- **HÀNH ĐỘNG CỤ THỂ:** XÓA BỎ hoàn toàn các chỉ thị liên quan đến "BIÊN TẬP" (REWRITE) hoặc "CHẾ ĐỘ 1".
- Prompt mới phải tập trung tuyệt đối vào việc: Dịch từ ngoại ngữ (Trung/Anh/Nhật...) sang tiếng Việt.`;
  } else {
      modeDirective = `
### ⚠️ CẢNH BÁO CHẾ ĐỘ:
- Không xác định rõ nguồn Convert hay Raw. Hãy giữ nguyên cơ chế "Tự động xác định" (Dual Mode) trong Prompt để AI tự quyết định khi chạy.`;
  }

  const instruction = `Bạn là một Kỹ sư Prompt và Chuyên gia Ngôn ngữ học Văn học (Series Architect).
NHIỆM VỤ: Tái thiết kế Prompt dịch thuật để nó trở thành chỉ thị hoàn hảo cho bộ truyện cụ thể này. BẮT BUỘC GIỮ NGUYÊN CÁC QUY TẮC BẢO VỆ NỘI DUNG.

${modeDirective}

DỰA TRÊN NGỮ CẢNH (Series Bible) ĐƯỢC CUNG CẤP:
1. **DEEP CONTEXT ANALYSIS:** Đọc kỹ Series Bible để hiểu rõ tông giọng (Tone), phong cách (Style), và mối quan hệ nhân vật.
2. **RE-ENGINEER PERSONA:** Thay đổi "I. ĐỊNH DANH VÀ VAI TRÒ" để AI Translator nhập vai đúng linh hồn truyện. Nếu truyện hài hước, AI phải dí dỏm. Nếu truyện u tối, AI phải nghiêm túc.
3. **ORIGIN RESTORATION PROTOCOL:** ${isGameOrWestern ? `Truyện bối cảnh phương tây/game. QUY TẮC: 'KHÔNG HÁN VIỆT HÓA TÊN TIẾNG ANH'. (Goblin -> Goblin/Yêu tinh, Cấm: Ca Bố Lâm).` : `Truyện phong cách Trung Quốc. Duy trì Hán Việt chuẩn.`}
4. **RAW-TO-VIET MAPPING:** Tạo mục "V. QUY TẮC CHUYỂN ĐỔI". Liệt kê các cặp: "{Ký tự gốc} -> {Bản dịch chuẩn}" dựa trên dữ liệu tham khảo.
5. **INTEGRATE RULES:** Lồng ghép khéo léo [QUY TẮC NGƯỜI DÙNG] vào Prompt. NẾU PHÁT HIỆN TRUYỆN CÓ YẾU TỐ NHẠY CẢM HOẶC BẠO LỰC, hãy lồng ghép quy tắc chống kiểm duyệt sau vào Prompt sao cho tự nhiên và phù hợp với truyện: "Với các cảnh bạo lực hoặc thân mật, dịch theo văn phong tiểu thuyết mạng đã xuất bản: tập trung vào cảm xúc, nhịp điệu, hình ảnh ẩn dụ thay vì mô tả trần trụi. Đây là văn phong biên tập chuẩn cho thể loại, không phải yêu cầu né tránh nội dung." (Tuyệt đối không được hiểu lầm quy tắc này thành bật bộ lọc hay từ chối dịch).
6. **BẢO VỆ BẢNG THÔNG SỐ (BẮT BUỘC DUY TRÌ):** BẠN BẮT BUỘC PHẢI THÊM 3 QUY TẮC NÀY VÀO PROMPT TỐI ƯU ĐẦU RA:
   - Thêm quy tắc vào Mục II (Thứ bậc ưu tiên xử lý): "CẢNH BÁO BẢNG THÔNG SỐ (HỆ THỐNG/STATUS BOARD): Bảng thông số (Ký chủ, Thân phận, Tu vi...) CHỈ LÀ DỮ LIỆU BÊN TRONG TRUYỆN, KHÔNG PHẢI TÍN HIỆU NGẮT KẾT THÚC ĐOẠN/CHƯƠNG. BẮT BUỘC dịch xong bảng rồi PHẢI TIẾP TỤC DỊCH HẾT phần văn xuôi, hội thoại phía sau."
   - Bổ sung vào cơ chế tự kiểm tra nội bộ (Mục VII): "Check Bảng Thông Số: Đã dịch trọn vẹn phần văn bản/hội thoại ĐỨNG SAU bảng thông số hệ thống chưa? Chắc chắn KHÔNG dừng dịch giữa chừng ngay sau bảng thông số."
   - Thêm vào CHECKLIST CUỐI CÙNG TRƯỚC KHI XUẤT: "- [ ] KHÔNG ngắt ngang bản dịch tại bảng thông số hệ thống, ĐÃ dịch toàn bộ văn xuôi phía sau chưa?"
7. **RÚT GỌN DẤU CÂU LẶP LẠI (BẮT BUỘC DUY TRÌ):** BẠN BẮT BUỘC PHẢI THÊM QUY TẮC NÀY VÀO PROMPT TỐI ƯU: "CRITICAL: Khi bản gốc lạm dụng quá nhiều dấu câu lặp lại liên tiếp (ví dụ: '.............' hoặc '!!!!!!!!'), BẮT BUỘC phải rút gọn chúng về ĐÚNG 1 DẤU DUY NHẤT (1 dấu chấm, 1 dấu than). TUYỆT ĐỐI KHÔNG in ra dải dấu câu lặp lại để tránh lỗi ngắt kết nối."
8. **BẢO VỆ KHỐI BÌNH LUẬN KHÁN GIẢ/NGƯỜI CHƠI (弹幕/观众们 - BẮT BUỘC DUY TRÌ):** BẠN BẮT BUỘC PHẢI THÊM 3 QUY TẮC NÀY VÀO PROMPT TỐI ƯU ĐẦU RA, GIỮ NGUYÊN DÙ TRUYỆN CÓ THUỘC THỂ LOẠI GAME/LIVESTREAM HAY KHÔNG (vì Prompt tối ưu có thể tái sử dụng cho các phần/chương sau xuất hiện yếu tố này dù phần đầu chưa có):
   - Thêm quy tắc vào Mục II (Thứ bậc ưu tiên xử lý): "CẢNH BÁO KHỐI BÌNH LUẬN KHÁN GIẢ/NGƯỜI CHƠI (弹幕/观众们): Nếu văn bản gốc xen kẽ đoạn bình luận của khán giả/người xem/người chơi khác (thường ở truyện dạng nhân vật chính phát trực tiếp trong game/hệ thống), đây CHỈ LÀ MỘT ĐOẠN CHÊM trong mạch truyện, KHÔNG PHẢI TÍN HIỆU KẾT THÚC CHƯƠNG. BẮT BUỘC dịch đủ khối bình luận rồi PHẢI TIẾP TỤC DỊCH HẾT phần cốt truyện chính (hành động, hội thoại nhân vật, diễn biến) ngay sau đó cho tới hết chương, không được dừng lại ngay sau khối bình luận."
   - Bổ sung vào cơ chế tự kiểm tra nội bộ (Mục VII): "Check Bình Luận Khán Giả: Nếu đoạn văn có khối bình luận khán giả/người chơi, đã dịch trọn vẹn phần cốt truyện chính ĐỨNG SAU khối đó chưa? Chắc chắn KHÔNG dừng dịch giữa chừng ngay sau khối bình luận."
   - Thêm vào CHECKLIST CUỐI CÙNG TRƯỚC KHI XUẤT: "- [ ] KHÔNG ngắt ngang bản dịch ngay sau khối bình luận khán giả/người chơi, ĐÃ dịch toàn bộ cốt truyện chính phía sau chưa?"
9b. **BẢO TOÀN NGUYÊN VẸN QUY TẮC ĐỒNG BỘ ID FILE VÀ ĐỊNH DẠNG SRT (BẮT BUỘC DUY TRÌ — KHÔNG ĐƯỢC RÚT GỌN, DIỄN GIẢI LẠI HAY LƯỢC BỎ DÙ CHỈ 1 CHỮ):** Prompt gốc có 2 khối quy tắc kỹ thuật bắt buộc: (a) "ĐỒNG BỘ ID FILE & CHỐNG LẪN LỘN" — dạy AI giữ nguyên 100% các thẻ ID dạng [[[part_X]]]...[[[/part_X]]] khi dịch nhiều file gộp batch; (b) "ĐỊNH DẠNG PHỤ ĐỀ SRT" — dạy AI khi gặp văn bản phụ đề .srt (khối lặp lại: dòng số thứ tự + dòng mã thời gian "00:00:03,500 --> 00:00:05,300") thì BẮT BUỘC chép nguyên văn 100% hai dòng đó, chỉ dịch phần lời thoại phía sau, không được coi là định dạng thừa rồi xóa. Đây là 2 khối quy tắc AN TOÀN KỸ THUẬT — không liên quan văn phong hay thể loại truyện nên KHÔNG được rút gọn, diễn giải lại bằng lời khác, gộp chung với quy tắc khác, hay lược bỏ trong Prompt tối ưu đầu ra, BẤT KỂ bộ truyện đang tối ưu có phải truyện phụ đề hay không (vì Prompt tối ưu có thể được tái sử dụng sau này cho nội dung phụ đề).
9. **BẢO TOÀN & TÙY CHỈNH QUY TẮC VĂN PHONG TỰ NHIÊN (BẮT BUỘC DUY TRÌ):** Prompt gốc có quy tắc nền tảng: dịch/biên tập phải thoát ý, mượt mà, nghệ thuật câu từ, không cụt lủn/thô ráp/word-by-word; hạn chế Hán Việt tối nghĩa ít thông dụng (trừ tên riêng/địa danh/thuật ngữ đã xác định qua Series Bible/từ điển); được dùng teencode/tiếng lóng/thuật ngữ mượn (hack, cheat, bug...) ở mức độ nhẹ, thông dụng, không lạm dụng. BẠN BẮT BUỘC GIỮ NGUYÊN tinh thần quy tắc này trong Prompt tối ưu, đồng thời TÙY CHỈNH LẠI cho phù hợp với bộ truyện cụ thể (dựa trên Series Bible, từ điển và [QUY TẮC NGƯỜI DÙNG] ở trên) — ví dụ: nêu rõ mức độ/loại teencode-tiếng lóng nào hợp với bối cảnh truyện này (đô thị/học đường/game thì có thể dùng nhiều hơn; cổ trang/nghiêm túc thì gần như không dùng), và liệt kê cụ thể hơn những cụm Hán Việt nào nên tránh hay nên giữ dựa trên văn phong đã phân tích được.

ĐẦU VÀO:
- Tên: ${storyInfo.title} | Thể loại: ${storyInfo.genres.join(', ')}
[QUY TẮC NGƯỜI DÙNG BẮT BUỘC]
${additionalRules}

[DỮ LIỆU THAM KHẢO (SERIES BIBLE)]
${dictionary.substring(0, 20000)}
${context.substring(0, 50000)}

[PROMPT GỐC CẦN TỐI ƯU]
${filledTemplate}`;

  try {
      const proModels = ['gemini-3.1-pro-preview'].filter(id => enabledModels?.includes(id) ?? true);
      if (proModels.length === 0) proModels.push('gemini-3.1-pro-preview');

      const performTask = async (modelId: string) => {
        const response = await ai.models.generateContent({
          model: modelId,
          contents: "Thực hiện kiến trúc lại Prompt dựa trên Series Bible.",
          config: { systemInstruction: instruction, temperature: 0.7, safetySettings: SAFETY_SETTINGS, maxOutputTokens: 65536 },
        });
        return response.text?.trim() || filledTemplate;
      };

      try {
          return await smartExecution(proModels, performTask, "Optimize Prompt (Pro)", undefined, proModels[0]);
      } catch (e) {
          console.warn("Pro model failed for optimizePrompt, falling back to Flash.", e);
          const fallbackModels = ['gemini-3.6-flash', 'gemini-3-flash-preview', 'gemini-3.5-flash'].filter(id => enabledModels?.includes(id) ?? true);
          if (fallbackModels.length === 0) fallbackModels.push('gemini-3.6-flash', 'gemini-3-flash-preview', 'gemini-3.5-flash');
          return await smartExecution(fallbackModels, performTask, "Optimize Prompt (Flash)", undefined, fallbackModels[0]);
      }
  } catch {
      return filledTemplate;
  }
};

export const refineAdditionalRules = async (
    additionalRules: string, mergedContext: string, storyInfo: StoryInfo, enabledModels?: string[],
    forcedCandidates?: string[], pronounOverride?: string
): Promise<string> => {
    const proModels = (forcedCandidates || ['gemini-3.1-pro-preview']).filter(id => id.includes('pro') && (enabledModels?.includes(id) ?? true));
    if (proModels.length === 0) proModels.push('gemini-3.1-pro-preview');

    const hasExistingRules = additionalRules && additionalRules.trim().length > 0;

    // Khi người dùng đã chọn tuỳ chọn xưng hô cố định (Hiện đại/Cổ đại) ở bước Phân Tích Sâu,
    // GHI ĐÈ hẳn khối hướng dẫn phân loại 3 NHÓM (A/B/C) mặc định của mục 4 — nếu vẫn giữ cả 2
    // (mặc định + override) trong cùng prompt, chỉ dẫn "phân loại theo bối cảnh" bên dưới có thể
    // lấn át phần override và khiến mục "4. Xưng hô" bị sinh ra lẫn lộn cả 2 kiểu.
    const pronounSection = pronounOverride
        ? `4. Xưng hô: (Chi tiết cách xưng hô của Main với kẻ thù, người thân, tiền bối...)\n\n${pronounOverride}`
        : `4. Xưng hô: (Chi tiết cách xưng hô của Main với kẻ thù, người thân, tiền bối... QUAN TRỌNG: Phải khớp 100% với bối cảnh, phân loại theo 3 NHÓM sau:
   - NHÓM A (Cổ trang Trung Hoa/Kiếm hiệp/Tiên hiệp, KỂ CẢ Dị giới/Xuyên không nhưng thế giới đến có bản chất kiếm hiệp/tiên hiệp/cổ trang Trung Hoa - tông môn, tu luyện, giang hồ): TUYỆT ĐỐI dùng ta - ngươi, vãn bối - tiền bối, huynh đệ, tỷ muội... CẤM dùng anh - em, tôi - cậu.
   - NHÓM B (Hiện đại/Đô thị/Thập niên 80-90, bối cảnh Trái Đất đời thực): dùng xưng hô hiện đại (chú, dì, anh, em, tôi).
   - NHÓM C (Light Novel Hàn/Nhật/Anh, Fantasy/Dị giới/Học viện phương Tây - KHÔNG phải Trung Hoa cổ trang, KHÔNG phải hiện đại Trái Đất): BẮT BUỘC dùng xưng hô tự nhiên kiểu phương Tây/light novel (tôi/ta - ngài/cô/cậu/anh, tiểu thư, ngài + tước hiệu, huân tước, bệ hạ nếu có hoàng gia). TUYỆT ĐỐI CẤM dùng xưng hô Hán Việt kiểu kiếm hiệp (tiền bối, hậu bối, vãn bối, huynh đệ, tỷ muội) cho nhóm này.)`;

    const prompt = `Bạn là một chuyên gia thiết kế Prompt và biên tập viên văn học.
Nhiệm vụ của bạn là ${hasExistingRules ? 'tinh chỉnh, hoàn thiện và bổ sung' : 'tạo ra'} "Quy Tắc Bổ Sung" (Additional Rules) cho việc dịch thuật/biên tập truyện dựa trên "Ngữ Cảnh" (Context) đã được phân tích chi tiết.

[THÔNG TIN TRUYỆN]
Tên truyện: ${storyInfo.title}
Tác giả: ${storyInfo.author}
Thể loại: ${storyInfo.genres?.join(', ') || ''}

[NGỮ CẢNH ĐÃ PHÂN TÍCH]
${mergedContext}

${hasExistingRules ? `[QUY TẮC BỔ SUNG HIỆN TẠI]\n${additionalRules}\n` : ''}
[YÊU CẦU QUAN TRỌNG VỀ THIẾT KẾ PROMPT (ADVANCED LINGUISTIC PROCESSING)]
Bạn PHẢI áp dụng "Động cơ ngôn ngữ nội tại" chuyên biệt hóa cho dòng ngôn ngữ gốc/bản convert của truyện này (nếu có thể nhận dạng) vào phần 1 (Ngôn ngữ / Văn phong) để đảm bảo bản dịch KHÔNG BỊ SƯỢNG, KHÔNG WORD-BY-WORD (WBW):
- NẾU LÀ BẢN CONVERT (Tiếng Việt thô, VP): Yêu cầu AI biên tập thoát ý, sắp xếp lại trật tự Chủ-Vị-Tân chuẩn Việt, loại bỏ cấu trúc "bị... hắn...", sửa từ gốc Hán Việt thô cứng (ví dụ: kiến quỷ, hãn nhan, nhượng nhân tâm hàn) đổi về thành ngữ/từ thuần Việt mượt mà, gọt giũa hội thoại bỏ hư từ dư thừa ("đích", "của").
- NẾU GỐC TRUNG: Nhấn mạnh việc giữ âm Hán Việt cho danh xưng, chiêu thức, địa danh; nhưng phải dùng thuần Việt 100% cho miêu tả hành động, cảm xúc. Cấm dùng Hán Việt dư thừa cho hội thoại đời thường. Mạnh dạn yêu cầu ngắt câu dài lê thê đặc trưng của văn Trung.
- NẾU GỐC HÀN: Yêu cầu AI nối câu rơi vãi/vỡ vụn (đặc trưng xuống dòng liên tục của Hàn), dịch chuẩn xác kính ngữ ẩn vào giọng điệu (Anh/Chị/Tiền bối đi kèm dạ/vâng/ạ), KHÔNG dịch WBW thán từ "ah", "oh", "kuku...". Chú ý trật tự động từ cuối câu phải lật lại đúng ngữ pháp Việt.
- NẾU GỐC NHẬT: Lọc sạch "Anime Slop" và đại từ nhân xưng dư thừa (watashi, ore...). Không dịch lậm wibu quá đà nếu bối cảnh nghiêm túc. CRITICAL: BẮT BUỘC giữ nguyên hậu tố kính ngữ (-san, -kun, -chan, -sama, -sensei...) sát tên riêng (áp dụng chung với cả Hàn, LN nếu có), KHÔNG dịch sang tiếng Việt để bảo toàn văn hóa truyện. Diễn giải Việt hóa tự nhiên phần nội tâm.
- NẾU GỐC ANH: Yêu cầu AI xóa bỏ Passive Voice (Câu bị động) dư thừa, không lạm dụng đại từ sở hữu (tay của hắn, mắt của nàng), dịch slang và idioms theo hướng lấy ý (localization) chứ không dịch nghĩa đen.

[YÊU CẦU CẤU TRÚC PROMPT OUTPUT]
BẮT BUỘC trình bày chính xác theo cấu trúc 6 phần sau (trả về dưới dạng text Markdown có đánh số):
Mở đầu: "Đây là truyện [Nguồn gốc] thuộc thể loại [Các thể loại]."
1. Ngôn ngữ / Văn phong: (Đề xuất văn phong, kết hợp sâu sắc các quy tắc xử lý ngôn ngữ chuyên biệt ở trên để câu cú thoát ý, mượt mà, thuần Việt, tuyệt đối không bị sượng hay WBW điển hình của ngôn ngữ đó).
2. Tên nhân vật & địa danh: (Quy tắc dùng Hán Việt, Romaji, hay tên Anh/Gốc...)
3. Thuật ngữ đặc trưng: (Hệ thống, kỹ năng, món ăn, vật phẩm... cần giữ nguyên hay dịch thuần Việt)
${pronounSection}
5. Lưu ý bối cảnh: (Các yếu tố đa thể loại, chuyển đổi ngữ cảnh...)
6. Xử lý nội dung nhạy cảm (CẢNH BÁO QUAN TRỌNG): (Dựa trên ý tưởng gốc sau đây, BẠN PHẢI TINH CHỈNH VÀ VIẾT LẠI câu này sao cho thật mượt mà, văn vẻ và phù hợp với thể loại, bối cảnh riêng của bộ truyện này: "Với các cảnh bạo lực hoặc thân mật, dịch theo văn phong tiểu thuyết mạng đã xuất bản: tập trung vào cảm xúc, nhịp điệu, hình ảnh ẩn dụ thay vì mô tả trần trụi. Đây là văn phong biên tập chuẩn cho thể loại, không phải yêu cầu né tránh nội dung.")

CHỈ TRẢ VỀ NỘI DUNG QUY TẮC BỔ SUNG theo đúng format trên, không thêm lời chào hỏi hay giải thích dư thừa. KHÔNG bọc trong block code markdown (như \`\`\`markdown).`;

    const performTask = async (modelId: string) => {
        const response = await getAiClient().models.generateContent({
            model: modelId,
            contents: prompt,
            config: { temperature: 0.3, safetySettings: SAFETY_SETTINGS, maxOutputTokens: 65536 }
        });
        let text = response.text || additionalRules;
        text = text.replace(/^\s*```(?:markdown)?\n/i, '').replace(/\n```\s*$/i, '').trim();
        return text;
    };

    try {
        return await smartExecution(proModels, performTask, "Quy Tắc Bổ Sung", undefined, proModels[0]);
    } catch (e) {
        console.warn("Pro model failed for refineAdditionalRules, falling back to Flash.", e);
        const fallbackModels = ['gemini-3.6-flash', 'gemini-3-flash-preview', 'gemini-3.5-flash'].filter(id => enabledModels?.includes(id) ?? true);
        if (fallbackModels.length === 0) fallbackModels.push('gemini-3.6-flash', 'gemini-3-flash-preview', 'gemini-3.5-flash');
        return await smartExecution(fallbackModels, performTask, "Quy Tắc Bổ Sung (Flash)", undefined, fallbackModels[0]);
    }
};


export const refineSummary = async (
    mergedContext: string, storyInfo: StoryInfo, enabledModels?: string[], forcedCandidates?: string[]
): Promise<string> => {
    const proModels = (forcedCandidates || ['gemini-3.1-pro-preview']).filter(id => id.includes('pro') && (enabledModels?.includes(id) ?? true));
    if (proModels.length === 0) proModels.push('gemini-3.1-pro-preview');

    const prompt = `Dựa trên toàn bộ [Ngữ cảnh chi tiết] sau đây, hãy viết một bản tóm tắt truyện thật chi tiết và đầy đủ. Vì đây là ngữ cảnh từ toàn bộ câu chuyện (đầu-giữa-cuối), bạn KHÔNG ĐƯỢC rút gọn. Hãy trình bày theo cấu trúc các mục sau, mỗi mục có thể viết nhiều đoạn nếu ngữ cảnh cho phép:

📖 Tổng quan & Bối cảnh: [BẮT BUỘC mở đầu mục này bằng 3 dòng: "Tên truyện: ${storyInfo.title || '(chưa xác định)'}", "Tác giả: ${storyInfo.author || '(chưa xác định)'}", "Thể loại: ${storyInfo.genres?.join(', ') || '(chưa xác định)'}", sau đó mới đến phần mô tả chi tiết bối cảnh/thế giới quan...]
⚔️ Hành trình nhân vật chính: [Mô tả chi tiết...]
⚔️ Hệ thống tu luyện/sức mạnh: [Mô tả chi tiết...]
✅ Điểm mạnh & Đặc sắc: [Mô tả chi tiết...]
📌 Nhận xét & Kết luận: [Mô tả chi tiết...]

LƯU Ý: Giữ nguyên Tên Nhân Vật và Thuật Ngữ chính. Không trả về Markdown code block.

🛑 QUY TẮC BẮT BUỘC VỀ ĐẦU RA: TUYỆT ĐỐI KHÔNG được xuất ra bất kỳ lời dẫn, lời chào, hay câu giao tiếp nào của AI trước hoặc sau bản tóm tắt (ví dụ nghiêm cấm các câu như "Dưới đây là bản tóm tắt...", "Chào bạn, đây là...", "Hy vọng bản tóm tắt này hữu ích..."). Output CHỈ được bắt đầu ngay bằng "📖 Tổng quan & Bối cảnh" và kết thúc ngay sau mục "📌 Nhận xét & Kết luận", không thêm bất kỳ câu nào khác.

[Ngữ cảnh chi tiết]
${mergedContext}`;

    const performTask = async (modelId: string) => {
        const response = await getAiClient().models.generateContent({
            model: modelId,
            contents: prompt,
            config: { temperature: 0.3, safetySettings: SAFETY_SETTINGS, maxOutputTokens: 65536 }
        });
        let text = response.text || storyInfo.summary || "";
        text = text.replace(/^\s*```(?:markdown)?\n/i, '').replace(/\n```\s*$/i, '').trim();
        // Fix Gemini Math Mode hallucinations for arrows and markdown chars
        text = text.replace(/\\rightarrow/g, '->').replace(/\$\\rightarrow\$/g, '->').replace(/\(#\)/g, '').replace(/[\*\#]/g, '');
        // Defense-in-depth: cắt bỏ mọi câu dẫn/giao tiếp của AI còn sót lại trước khi đến mục "📖 Tổng quan & Bối cảnh"
        const overviewIdx = text.indexOf('📖');
        if (overviewIdx > 0) {
            text = text.slice(overviewIdx).trim();
        }
        return text;
    };

    try {
        return await smartExecution(proModels, performTask, "Tinh Chỉnh Tóm Tắt Truyện", undefined, proModels[0]);
    } catch (e) {
        console.warn("Pro model failed for refineSummary, falling back to Flash.", e);
        const fallbackModels = ['gemini-3.6-flash', 'gemini-3-flash-preview', 'gemini-3.5-flash'].filter(id => enabledModels?.includes(id) ?? true);
        if (fallbackModels.length === 0) fallbackModels.push('gemini-3.6-flash', 'gemini-3-flash-preview', 'gemini-3.5-flash');
        return await smartExecution(fallbackModels, performTask, "Tinh Chỉnh Tóm Tắt (Flash)", undefined, fallbackModels[0]);
    }
};
