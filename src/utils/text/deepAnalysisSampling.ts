import { FileItem } from '../../types';

export interface IndexedAnalysisFile {
    file: FileItem;
    originalIndex: number;
}

const RELATIONSHIP_SIGNAL_RE = /(?:“|”|「|」|『|』|"|\b(?:said|asked|replied|father|mother|brother|sister|master|disciple|husband|wife)\b|(?:nói|hỏi|đáp|gọi|xưng|cha|mẹ|anh|em|chị|đệ|huynh|muội|sư\s*phụ|đồ\s*đệ|phu\s*quân|thê\s*tử|bệ\s*hạ|điện\s*hạ|tiền\s*bối|vãn\s*bối)|(?:说|问|答|叫|称|父|母|兄|弟|姐|妹|师父|徒弟|夫君|娘子|陛下|殿下|前辈|晚辈)|(?:言った|尋ねた|父|母|兄|弟|姉|妹|師匠|弟子))/giu;
const TRANSITION_SIGNAL_RE = /(?:lần\s+đầu|gặp\s+lại|tái\s+ngộ|chia\s+tay|kết\s+hôn|đính\s+hôn|phản\s+bội|nhận\s+thân|bái\s+sư|thăng\s+chức|登场|初见|重逢|分别|结婚|订婚|背叛|拜师|再会|婚約|裏切)/giu;

const countMatches = (text: string, pattern: RegExp): number => {
    pattern.lastIndex = 0;
    return Math.min(80, text.match(pattern)?.length || 0);
};

const relationshipDensity = (file: FileItem): number => {
    const content = file.content || '';
    const sample = content.length > 50000
        ? `${content.slice(0, 20000)}\n${content.slice(Math.floor(content.length / 2) - 5000, Math.floor(content.length / 2) + 5000)}\n${content.slice(-20000)}`
        : content;
    return countMatches(sample, RELATIONSHIP_SIGNAL_RE) + countMatches(`${file.name}\n${sample}`, TRANSITION_SIGNAL_RE) * 8;
};

/**
 * Lấy mẫu phân tầng cho Phân tích sâu:
 * - truyện ngắn vẫn đọc toàn bộ;
 * - truyện dài luôn giữ đầu/cuối và phủ đều toàn timeline;
 * - trong mỗi khoảng ưu tiên chương có nhiều hội thoại/tín hiệu đổi quan hệ.
 */
export const selectDeepAnalysisFiles = (files: FileItem[], maxSamples = 180): IndexedAnalysisFile[] => {
    const total = files.length;
    if (total <= 96) return files.map((file, originalIndex) => ({ file, originalIndex }));

    const target = Math.min(maxSamples, Math.max(72, Math.ceil(Math.sqrt(total) * 3)));
    const edgeCount = Math.min(12, Math.max(6, Math.floor(target * 0.08)));
    const selected = new Map<number, IndexedAnalysisFile>();
    const add = (originalIndex: number) => selected.set(originalIndex, { file: files[originalIndex], originalIndex });

    for (let index = 0; index < edgeCount; index++) add(index);
    for (let index = Math.max(edgeCount, total - edgeCount); index < total; index++) add(index);

    const middleStart = edgeCount;
    const middleEnd = total - edgeCount;
    const slots = Math.max(0, target - selected.size);

    for (let slot = 0; slot < slots; slot++) {
        const start = middleStart + Math.floor(((middleEnd - middleStart) * slot) / slots);
        const end = middleStart + Math.floor(((middleEnd - middleStart) * (slot + 1)) / slots);
        const center = (start + end - 1) / 2;
        let bestIndex = start;
        let bestScore = -Infinity;

        for (let index = start; index < Math.max(start + 1, end); index++) {
            const density = relationshipDensity(files[index]);
            const score = density * 1000 - Math.abs(index - center);
            if (score > bestScore) {
                bestScore = score;
                bestIndex = index;
            }
        }
        add(bestIndex);
    }

    return [...selected.values()].sort((a, b) => a.originalIndex - b.originalIndex);
};

const excerptLongChapter = (content: string, maxChars: number): string => {
    if (content.length <= maxChars) return content;
    const headSize = Math.floor(maxChars * 0.4);
    const middleSize = Math.floor(maxChars * 0.2);
    const tailSize = maxChars - headSize - middleSize;
    const middleStart = Math.max(headSize, Math.floor(content.length / 2) - Math.floor(middleSize / 2));
    return `${content.slice(0, headSize)}

[... LƯỢC ĐOẠN DÀI, GIỮ MẪU GIỮA CHƯƠNG ...]

${content.slice(middleStart, middleStart + middleSize)}

[... LƯỢC ĐOẠN DÀI, GIỮ ĐOẠN CUỐI CHƯƠNG ...]

${content.slice(-tailSize)}`;
};

export const buildDeepAnalysisChunks = (
    selectedFiles: IndexedAnalysisFile[],
    totalChapters: number,
    maxChunkChars = 420000,
    maxChapterChars = 90000,
): string[] => {
    const chunks: string[] = [];
    let current = '';

    for (const { file, originalIndex } of selectedFiles) {
        const content = file.content || '';
        const excerpt = excerptLongChapter(content, maxChapterChars);
        const block = `[MỐC CHƯƠNG GỐC ${originalIndex + 1}/${totalChapters}]
Tên tệp/chương: ${file.name}
${content.length > maxChapterChars ? `Phạm vi: trích đầu–giữa–cuối từ chương dài ${content.length.toLocaleString('vi-VN')} ký tự` : 'Phạm vi: toàn chương'}

${excerpt}`;

        if (current && current.length + block.length + 2 > maxChunkChars) {
            chunks.push(current);
            current = block;
        } else {
            current = current ? `${current}\n\n${block}` : block;
        }
    }

    if (current) chunks.push(current);
    return chunks;
};
