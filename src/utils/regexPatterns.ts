
/**
 * CENTRALIZED REGEX ENGINE v1.1
 * Contains advanced patterns for Chapter Splitting and Text Cleaning.
 */

// Danh sách tên trang web nguồn convert/raw dùng CHUNG cho cả removeJunkContent (xóa cứng khỏi
// nội dung khi cleanup) và removeJunkForValidation (chỉ tạm loại khi hậu kiểm, không mutate file).
// Trước đây 2 nơi này tự liệt kê 2 danh sách khác nhau (removeJunkContent thiếu "TruyenYY",
// removeJunkForValidation thiếu "Wikidich/Uukanshu/Qidian/Faloo/Wattpad/TTV/Bachngocsach"), khiến
// hậu kiểm và cleanup không đồng bộ với nhau: có site bị cleanup xóa nhưng hậu kiểm vẫn tính vào
// fingerprint (hoặc ngược lại), gây lệch kết quả so khớp. Sửa tại đây 1 lần, dùng chung ở cả 2 nơi.
export const JUNK_SITE_NAMES = [
    'TruyenFull', 'TangThuVien', 'Metruyenchu', 'Wikidich', 'Uukanshu', 'Qidian',
    'Faloo', 'Wattpad', 'TTV', 'Bachngocsach', 'TruyenYY'
];

export const REGEX_PATTERNS = {
    // --- UNIVERSAL CHAPTER SPLITTER ---
    // Matches:
    // 1. CJK: 第10章, 第十章, 第10话, 卷一, 番外, 【Title】, [Title]
    // 2. VN: Chương 10, Hồi 10, Quyển 1, Phần 2, Màn 1
    // 3. EN: Chapter 10, Vol 1, Book 1, Episode 5, Part 3, Arc 1, Act 1
    // 4. Roman: Chapter IV, Part X
    // 5. Special: Prologue, Epilogue, Side Story, Ngoại truyện, Phiên ngoại, Lời dẫn, Kết thúc
    // 6. Generic Numeric: "1. Title" or "1、Title" at start of line
    // --- UNIVERSAL CHAPTER SPLITTER ---
    // Matches:
    // 1. CJK: 第10章, 第十章, 第10话, 卷一, 番外, 【Title】, [Title]
    // 2. VN: Chương 10, Hồi 10, Quyển 1, Phần 2, Tập 1
    // 3. EN: Chapter 10, Vol 1, Book 1, Episode 5, Arc 1, Act 1
    // 4. Roman: Chapter IV, Part X
    // 5. Special: Prologue, Epilogue, Side Story, Ngoại truyện, Phiên ngoại, Mở đầu
    // 6. Generic Numeric: "#1" or "01"
    UNIVERSAL_CHAPTER_MATCH: /^\s*(?:(?:【[^】]*】|\[[^\]]*\]|《[^》]*》|「[^」]*」|『[^』]*』|<[^>]*>|(?:第\s*[0-9０-９零〇一二三四五六七八九十百千万萬两兩]+\s*[卷部])|[0-9０-９]+[\s\-.、_]+)\s*)*(?:(?:[#＃]\s*[0-9０-９]+)|(?:(?:第|제)\s*[0-9０-９零〇一二三四五六七八九十百千万萬两兩]+(?:\.[0-9]+)?\s*[章回节節卷集話话篇幕部화장편])|(?:[0-9０-９]+(?:\.[0-9]+)?\s*[章回节節卷集話话篇幕部화장편])|(?:(?:Chương|Hồi|Phần|Quyển|Tập|Tiết|Màn|Chapter|Chap|Ch|Episode|Ep|Vol\.?|Book|Arc|Act|Session|Part|Q|C)\s+(?:[0-9０-９]+(?:\.[0-9]+)?|[IVXLCDMivxlcdm]+)(?=[.:\s\-_，：,\]】》>」』\)]|$))|(?:\d+\s*[화장편])|(?:Ngoại\s*truyện|Side\s*Story|Phiên\s*ngoại|Prologue|Epilogue|Mở\s*đầu|Lời\s*dẫn|Kết\s*thúc|Phần\s*kết|番外|序章|终章|終章|楔子)|(?:(?:###)?\s*EPUB_CHAPTER_SPLIT)).*/im,
    INLINE_CHAPTER_MATCH: /(?:(?:第|제)\s*[0-9０-９一二三四五六七八九十百千万萬零〇]+(?:\.[0-9]+)?\s*[章回節节卷集話话篇部]|[0-9０-９]+\s*[話话](?!\w)|제\s*[0-9０-９]+\s*[장화편권절부]|[0-9０-９]+\s*[화장편](?!\w)|(?:Chương|Hồi|Phần|Quyển|Tập|Chapter|Volume|Book|Part)\s*\d+(?:\.\d+)?|序章|终章|終章|楔子|番外|后记|後記|あとがき|プロローグ|エピローグ|(?:Prologue|Epilogue|Ngoại\s*[Tt]ruyện|Mở\s*đầu|Kết\s*thúc))/i,
    // Cleans keys like [Key] -> Key
    DICT_KEY_CLEANER: /^\[|\]$/g,

    // --- JUNK KEYWORDS (DETECTION) ---
    // Keywords indicating "Junk" chapters (Author notes, leave requests, voting begging)
    JUNK_KEYWORDS: /thông báo|xin nghỉ|cầu phiếu|đề cử|tác giả|phiếu|nghỉ phép|lời nói đầu|cảm nghĩ|tổng kết|đôi lời|chúc mừng|nghỉ ngơi|convert|converter|cầu nguyệt phiếu|cầu donate|ps:|p\/s:|nhảm nhí|chương chống trộm|momo|banking|chuyển khoản|donate|ủng hộ|viettinbank|vcb|agribank|網頁朗讀|加入書籤|đọc trên trang web|thêm đánh dấu|感谢|求票|求收藏|求月票|biên tập viên|hiệu đính|người dịch|nhóm dịch|team dịch|dịch bởi|edit bởi|nguồn dịch|beta\s*reader|sponsor|patreon|kofi|ko-fi|buymeacoffee/i,

    // --- JUNK / WATERMARK CLEANER (REMOVAL) ---
    // Aggressive patterns to strip noise from convert/raw sources
    JUNK_PATTERNS: [
        /<\/?(?:i|b|u|strong|em|span|div|font|a)[^>]*>/gim, // Strip empty or style tags causing hallucinations
        /^\s*(?:Convert|Cv|Converter|Edit)\s*(?:by|:)?\s*.*$/gim, // Convert by...
        /^\s*(?:Nguồn|Source)\s*[:]\s*.*$/gim, // Nguồn: ...
        new RegExp(`^\\s*(?:${JUNK_SITE_NAMES.join('|')})\\s*.*$`, 'gim'), // Site names (đồng bộ với JUNK_SITE_NAMES)
        /^\s*(?:Cầu|Xin)\s*(?:phiếu|nguyệt phiếu|đề cử|donate|hoa|kẹo|lì xì|cất chứa|theo dõi|đánh giá|bình luận).*$/gim, // Begging
        /^\s*(?:Momo|Banking|Stk|Ck|Agribank|Vietcombank|Techcombank|Paypal)\s*[:].*$/gim, // Payment info
        /^\s*(?:-{3,}|={3,}|\*{3,}|_{3,})\s*$/gm, // Separators lines
        /https?:\/\/[^\s]+/g, // URL Links
        /^\s*(?:Ps|P\/s|Note|Ghi chú|Chú thích)[:：].*$/gim, // Postscripts and annotations
        /^\s*[\(\[]\s*(?:Chú thích|Note)[:：]?\s*.*[\)\]]\s*$/gim, // Inline annotations like (Chú thích: ...) or [Note: ...]
        /^\s*Mời\s*(?:bạn|các)\s*đọc\s*.*$/gim, // Invitation
        /^\s*(?:Chào bạn|Dưới đây là|Đây là|Văn bản của bạn|Tôi đã xử lý|Nội dung|Bản dịch|Văn bản|Sau đây là).*?(?:biên tập|định dạng|yêu cầu|tiêu chuẩn|nội dung|xử lý|hoàn thành|chuẩn hóa|dịch).*$/gim, // AI conversational garbage
        /^\s*Tuyệt đối không thêm chú thích.*$/gim, // AI instruction leak
        /^\s*(?:Hai ngày nay có độc giả|Tiểu tác giả|File txt|Tài nguyên này).*$/gim, // Author notes and resource links
        /^\s*(?:網頁朗讀|加入書籤|Đọc trên trang web|Thêm đánh dấu|Bookmark|Read on website)\b.*$/gim, // Scraping UI artifacts
        /^\s*(?:Người dịch|Biên tập viên|Hiệu đính|Beta\s*reader|Nhóm dịch|Team dịch|Nguồn dịch)\s*[:\-].*$/gim, // Translator/editor credit lines missed by the old list
        /^\s*(?:Sponsor|Patreon|Ko-?fi|Buymeacoffee|Ủng hộ tác giả|Ủng hộ team|Đọc chương raw|Chương raw tại)\s*[:\-]?.*$/gim, // Sponsor/ad banners (can appear mid-chapter too, not just head/tail)
        /^\s*[\(（]\s*(?:感谢|求票|求收藏|求月票)[^)\）]*[\)）]\s*$/gim, // Chinese-only thank-you/vote-begging asides in parentheses
    ],

    // --- PUNCTUATION NORMALIZATION ---
    // Rules to fix spacing and standardizing characters
    PUNCTUATION_NORMALIZE: [
        { find: /\.{4,}/g, replace: '...' }, // .... -> ...
        { find: /([?!])\1+/g, replace: '$1' }, // ?? -> ?
        { find: /([,.?!:;])(?=[A-Za-z0-9À-ỹ])/g, replace: '$1 ' }, // "word.word" -> "word. word" (Add space)
        { find: /\s+([,.?!:;])/g, replace: '$1' }, // "word , word" -> "word, word" (Remove space before)
        { find: /([.?!]["'”’»」』】》])([A-ZÀÁÂÃÈÉÊÌÍÒÓÔÕÙÚÝĂĐĨŨƠƯẠẢẤẦẨẪẬẮẰẲẴẶẸẺẼẾỀỂỄỆỈỊỌỎỐỒỔỖỘỚỜỞỠỢỤỦỨỪỬỮỰỲỴỶỸ])/g, replace: '$1\n\n$2' }, // Split merged sentences with quotes
        { find: /[「『【《]/g, replace: '“' }, // Open quotes to standard
        { find: /[」』】》]/g, replace: '”' }, // Close quotes to standard
        { find: /^”/gm, replace: '“' }, // Fix closing quote at start of line
        { find: /([A-Za-z0-9À-ỹ])([“])/g, replace: '$1 $2' }, // BÙ KHOẢNG TRẮNG TRƯỚC NGOẶC: chữ“ -> chữ “ (không ảnh hưởng trong ngoặc)
        { find: /([”])([A-Za-z0-9À-ỹ])/g, replace: '$1 $2' }, // BÙ KHOẢNG TRẮNG SAU NGOẶC: ”chữ -> ” chữ (không ảnh hưởng trong ngoặc)
        { find: /\u200B|\u200C|\u200D|\uFEFF/g, replace: '' }, // Zero width chars (Invisible garbage)
        { find: / {2,}/g, replace: ' ' }, // Collapse multiple spaces to single
    ]
};
