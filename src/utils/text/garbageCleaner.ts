// Lọc rác sơ bộ trong nội dung 1 chương SAU KHI đã tách — tham khảo/port lại từ
// "Tool Tách Chương Truyện Pro" (novel_engine.py: clean_garbage_text). Chỉ xử lý
// những ký tự/ chuỗi rác mang tính TRANG TRÍ/ĐỊNH DẠNG THỪA (thẻ HTML rỗng, ký tự
// *, #, = trơ trọi, chuỗi _ hoặc - lặp lại nhiều lần, chấm/than lặp quá dài...).
// KHÔNG đụng tới các JUNK_PATTERNS hiện có trong regexPatterns.ts (vốn nhắm tới nội
// dung theo NGỮ NGHĨA như tên trang web, credit dịch giả, xin phiếu...) — 2 tầng lọc
// bổ sung cho nhau, không thay thế nhau.

const HTML_TAG_RE = /<[^>]+>/g;
const GARBAGE_SYMBOLS_RE = /[*#=]+/g;
// Giữ lại ký tự "_" / "-" đơn lẻ (gạch nối từ ghép, gạch đầu dòng thoại "- Xin chào"),
// chỉ xoá khi lặp lại từ 2 lần trở lên (kể cả đứt quãng bởi khoảng trắng: "_ _ _").
const UNDERSCORE_RUN_RE = /(?:_[ \t]*){2,}/g;
const DASH_RUN_RE = /(?:-[ \t]*){2,}/g;
const DOT_RUN_RE = /[.…]{2,}/g;
const EXCLAIM_RUN_RE = /!{4,}/g;

// Mỗi ký tự "…" tính tương đương 3 dấu chấm; tổng >= 4 thì rút gọn còn "...".
function normalizeDotRun(match: string): string {
    let weight = 0;
    for (const ch of match) weight += ch === '…' ? 3 : 1;
    return weight >= 4 ? '...' : match;
}

export interface GarbageCleanOptions {
    removeHtmlTags?: boolean;
    removeSymbols?: boolean;
    removeUnderscoreRuns?: boolean;
    removeDashRuns?: boolean;
    normalizeDots?: boolean;
    normalizeExclaim?: boolean;
}

export function cleanGarbageText(text: string, options: GarbageCleanOptions = {}): string {
    const {
        removeHtmlTags = true,
        removeSymbols = true,
        removeUnderscoreRuns = true,
        removeDashRuns = true,
        normalizeDots = true,
        normalizeExclaim = true,
    } = options;

    let result = text;
    if (removeHtmlTags) result = result.replace(HTML_TAG_RE, '');
    if (removeSymbols) result = result.replace(GARBAGE_SYMBOLS_RE, '');
    if (removeUnderscoreRuns) result = result.replace(UNDERSCORE_RUN_RE, ' ');
    if (removeDashRuns) result = result.replace(DASH_RUN_RE, ' ');
    if (normalizeDots) result = result.replace(DOT_RUN_RE, normalizeDotRun);
    if (normalizeExclaim) result = result.replace(EXCLAIM_RUN_RE, '!!!');

    // Dọn khoảng trắng / dòng trống thừa phát sinh sau khi xoá ký tự rác.
    result = result.replace(/[ \t]{2,}/g, ' ');
    result = result.replace(/[ \t]+\n/g, '\n');
    result = result.replace(/\n[ \t]+/g, '\n');
    result = result.replace(/\n{3,}/g, '\n\n');
    return result;
}
