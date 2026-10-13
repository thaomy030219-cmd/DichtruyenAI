import { StoryInfo } from '../../../types';
import { buildConsistencyContract, stripConsistencyBlocks, resolveDictionaryOverrides } from './consistencyRules';
import { optimizeContext, optimizeDictionary } from '../../../utils/text/optimization';

// Keep the quality gate's limited context focused on canonical names and
// relationship rules. Previously the rolling chapter excerpt could consume the
// entire 14k-character allowance before the dictionary was reached.
const fitLines = (text: string, limit: number): string => {
    const lines: string[] = [];
    let used = 0;
    for (const line of text.split(/\r?\n/)) {
        if (used + line.length + 1 > limit) {
            if (used === 0) lines.push(line.slice(0, limit));
            break;
        }
        lines.push(line);
        used += line.length + 1;
    }
    return lines.join('\n').trim();
};

export const buildReviewConsistencyContext = (
    dictionary: string,
    context: string,
    previousChapters: string,
    source = '',
): string => {
    const sourceLower = source.toLocaleLowerCase('vi');
    const dictionaryLines = dictionary.split(/\r?\n/);
    const relevantLines = source ? dictionaryLines.filter(line => {
        const separator = line.indexOf('=');
        const raw = separator > 0 ? line.slice(0, separator).trim() : '';
        return raw.length >= 2 && sourceLower.includes(raw.toLocaleLowerCase('vi'));
    }) : [];
    const relevantSet = new Set(relevantLines);
    const prioritizedDictionary = [...relevantLines, ...dictionaryLines.filter(line => !relevantSet.has(line))].join('\n');
    const pronounLines = context.split(/\r?\n/)
        .filter(line => /xưng hô|quan hệ|cách gọi|đại từ|→|->|↔|gọi nhau/i.test(line))
        .slice(0, 80)
        .join('\n');
    const prioritizedContext = [pronounLines, context].filter(Boolean).join('\n');
    return [
        `[TỪ ĐIỂN TÊN VÀ THUẬT NGỮ]\n${fitLines(prioritizedDictionary, 5000)}`,
        `[BỐI CẢNH VÀ QUY TẮC XƯNG HÔ]\n${fitLines(prioritizedContext, 6500)}`,
        `[CÁC CHƯƠNG LIỀN TRƯỚC — THAM KHẢO, KHÔNG GHI ĐÈ TỪ ĐIỂN]\n${previousChapters.slice(-2000)}`,
    ].join('\n\n');
};

// Advisory only: absence of a name can be valid when a sentence uses a pronoun.
// The reviewer must compare source and target before declaring a mismatch.
export const buildRelevantTermChecklist = (
    dictionary: string,
    source: string,
    translation: string,
    maxTerms = 40,
): string => {
    const sourceLower = source.toLocaleLowerCase('vi');
    const translationLower = translation.toLocaleLowerCase('vi');
    const lines: string[] = [];
    const seen = new Set<string>();
    for (const line of dictionary.split(/\r?\n/)) {
        const separator = line.indexOf('=');
        if (separator < 1) continue;
        const raw = line.slice(0, separator).replace(/^\s*\[|\]\s*$/g, '').trim();
        const canonical = line.slice(separator + 1).split('||')[0].replace(/\*\*/g, '').trim();
        if (raw.length < 2 || !canonical || canonical.length > 100 || seen.has(raw)) continue;
        if (!sourceLower.includes(raw.toLocaleLowerCase('vi'))) continue;
        seen.add(raw);
        lines.push(`${raw} → ${canonical} (${translationLower.includes(canonical.toLocaleLowerCase('vi')) ? 'đã thấy tên chuẩn' : 'chưa thấy tên chuẩn; có thể do dùng đại từ, cần AI đối chiếu'})`);
        if (lines.length >= maxTerms) break;
    }
    return lines.join('\n');
};

export const buildChapterReviewContext = (dictionary: string, story: StoryInfo | undefined, source: string, chapterIndex?: number): string => {
    dictionary = resolveDictionaryOverrides(dictionary);
    const relevantDictionary = optimizeDictionary(dictionary, source);
    const relevantContext = optimizeContext(stripConsistencyBlocks(story?.contextNotes || ''), source, relevantDictionary);
    return [
    buildConsistencyContract(dictionary, story, [{ content: source, chapterIndex }]),
    buildReviewConsistencyContext(relevantDictionary, relevantContext, '', source),
    `[QUY TẮC NGƯỜI DÙNG — ƯU TIÊN CAO NHẤT]\n${story?.additionalRules || ''}`,
    `[THẾ GIỚI/THỜI ĐẠI]\n${(story?.worldSetting || []).join(', ')}; kiểu xưng hô: ${story?.pronounMode || 'flexible'}`,
].join('\n\n');
};
