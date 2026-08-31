interface SpellChecker {
    correct(word: string): boolean;
    suggest(word: string): string[];
}

export interface VietnameseProofreadResult {
    text: string;
    correctedCount: number;
    suspiciousCount: number;
}

// Chỉ sửa các lỗi một nghĩa, thường gặp trong bản dịch máy. Các cặp phụ thuộc
// ngữ cảnh (dành/giành, sửa/xửa...) tuyệt đối không được đoán sửa tự động.
const SAFE_CORRECTIONS: Record<string, string> = {
    'chỉnh chu': 'chỉn chu', 'sát nhập': 'sáp nhập', 'trót vót': 'chót vót',
    'suy nghỉ': 'suy nghĩ', 'nghĩ ngơi': 'nghỉ ngơi', 'nghỉ rằng': 'nghĩ rằng',
    'xử lí': 'xử lý', 'quản lí': 'quản lý', 'lí do': 'lý do', 'vật lí': 'vật lý',
    'tâm lí': 'tâm lý', 'địa lí': 'địa lý', 'kĩ năng': 'kỹ năng', 'kĩ thuật': 'kỹ thuật',
    'mĩ lệ': 'mỹ lệ', 'mĩ nhân': 'mỹ nhân', 'hổ trợ': 'hỗ trợ', 'hổn loạn': 'hỗn loạn',
    'hổn độn': 'hỗn độn', 'ẩn nhẩn': 'ẩn nhẫn', 'miển cưỡng': 'miễn cưỡng',
    'miển phí': 'miễn phí', 'mảnh liệt': 'mãnh liệt', 'mãn liệt': 'mãnh liệt',
    'dử dội': 'dữ dội', 'hoản loạn': 'hoảng loạn', 'hoản hốt': 'hoảng hốt',
    'thản thốt': 'thảng thốt', 'xuất xắc': 'xuất sắc', 'suất sắc': 'xuất sắc',
    'đột suất': 'đột xuất', 'xúc tích': 'súc tích', 'cọ sát': 'cọ xát',
    'sáng lạng': 'xán lạn', 'thăm quan': 'tham quan', 'vô hình chung': 'vô hình trung',
    'tựu chung': 'tựu trung', 'chuẩn đoán': 'chẩn đoán', 'giành dụm': 'dành dụm',
    'dành giật': 'giành giật', 'rành giật': 'giành giật'
};

const SAFE_ENTRIES = Object.entries(SAFE_CORRECTIONS).sort((a, b) => b[0].length - a[0].length);
let checkerPromise: Promise<SpellChecker> | null = null;

const loadChecker = async (): Promise<SpellChecker> => {
    if (!checkerPromise) {
        checkerPromise = Promise.all([
            import('nspell'),
            import('../../../node_modules/dictionary-vi/index.aff?raw'),
            import('../../../node_modules/dictionary-vi/index.dic?raw')
        ]).then(([nspellModule, affModule, dicModule]) =>
            nspellModule.default(affModule.default, dicModule.default)
        );
    }
    return checkerPromise;
};

const escapeRegex = (value: string): string => value.replace(/[.*+?^$(){}|[\]\\]/g, '\\$&');

const preserveCase = (source: string, replacement: string): string => {
    if (source === source.toUpperCase()) return replacement.toUpperCase();
    if (/^\p{Lu}/u.test(source)) return replacement.charAt(0).toUpperCase() + replacement.slice(1);
    return replacement;
};

const collectProtectedWords = (sources: string[]): Set<string> => {
    const result = new Set<string>();
    sources.forEach(source => (source.match(/\p{L}+/gu) || []).forEach(word => {
        if (/^\p{Lu}/u.test(word) || /^[A-Z]{2,}$/.test(word)) result.add(String(word).toLocaleLowerCase('vi'));
    }));
    return result;
};

export const proofreadVietnamese = async (
    input: string,
    protectedSources: string[] = []
): Promise<VietnameseProofreadResult> => {
    if (!input) return { text: input, correctedCount: 0, suspiciousCount: 0 };

    const checker = await loadChecker();
    const protectedWords = collectProtectedWords(protectedSources);
    let text = input.normalize('NFC');
    let correctedCount = 0;

    for (const [wrong, right] of SAFE_ENTRIES) {
        const regex = new RegExp(`(?<!\\p{L})${escapeRegex(wrong)}(?!\\p{L})`, 'giu');
        text = text.replace(regex, match => {
            correctedCount++;
            return preserveCase(match, right);
        });
    }

    text = text.replace(/(?<!\p{L})(và|nhưng|thì|là|đã|đang|sẽ|cũng|vẫn|mà|của)\s+\1(?!\p{L})/giu, (_match, word: string) => {
        correctedCount++;
        return word;
    });

    const suspicious = new Set<string>();
    for (const original of text.match(/\p{L}+/gu) || []) {
        const word = original.toLocaleLowerCase('vi');
        if (word.length < 4 || protectedWords.has(word) || /^\p{Lu}/u.test(original) || checker.correct(word)) continue;
        const suggestions = checker.suggest(word).filter(item => item.length > 2);
        if (suggestions.length > 0 && suggestions.length <= 5) suspicious.add(word);
    }

    return { text, correctedCount, suspiciousCount: suspicious.size };
};

export const warmupVietnameseProofreader = (): Promise<void> => loadChecker().then(() => undefined);
