import { FileItem, FileStatus } from '../../types';

const NEWLINE = String.fromCharCode(10);
const CARRIAGE_RETURN = String.fromCharCode(13);

const normalizeExcerpt = (text: string): string => {
    let normalized = text.split(CARRIAGE_RETURN).join('');
    while (normalized.includes(NEWLINE + NEWLINE + NEWLINE)) {
        normalized = normalized.split(NEWLINE + NEWLINE + NEWLINE).join(NEWLINE + NEWLINE);
    }
    return normalized.trim();
};

/**
 * Builds compact deterministic memory from chapters immediately preceding the batch.
 * It uses completed Vietnamese output only, so it costs no extra API call.
 */
export const buildRollingChapterContext = (
    files: FileItem[],
    batchIds: string[],
    chapterLimit = 3,
    charsPerChapter = 1800
): string => {
    if (files.length === 0 || batchIds.length === 0) return '';

    const batchIndexes = batchIds
        .map(id => files.findIndex(file => file.id === id))
        .filter(index => index >= 0);
    if (batchIndexes.length === 0) return '';

    const firstIndex = Math.min(...batchIndexes);
    const previous = files
        .slice(0, firstIndex)
        .filter(file => file.status === FileStatus.COMPLETED && !!file.translatedContent)
        .slice(-Math.max(1, chapterLimit));

    if (previous.length === 0) return '';

    return [
        '[BỘ NHỚ CUỐN CHIẾU — CHỈ DÙNG ĐỂ GIỮ MẠCH TRUYỆN/XƯNG HÔ]',
        ...previous.map(file => {
            const normalized = normalizeExcerpt(file.translatedContent || '');
            const excerpt = normalized.slice(Math.max(0, normalized.length - charsPerChapter));
            return '--- ' + file.name + ' (đoạn cuối) ---' + NEWLINE + excerpt;
        }),
        '[HẾT BỘ NHỚ CUỐN CHIẾU]',
    ].join(NEWLINE + NEWLINE);
};