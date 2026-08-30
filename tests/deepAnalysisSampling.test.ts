import { describe, expect, it } from 'vitest';
import { FileItem, FileStatus } from '../src/types';
import { buildDeepAnalysisChunks, selectDeepAnalysisFiles } from '../src/utils/text/deepAnalysisSampling';

const makeFiles = (count: number, relationshipChapter = -1): FileItem[] =>
    Array.from({ length: count }, (_, index) => ({
        id: String(index),
        name: `Chương ${index + 1}`,
        content: index === relationshipChapter
            ? 'Lần đầu gặp lại, nàng hỏi: “Sư phụ, người vẫn khỏe chứ?” Hắn đáp lời đồ đệ.'
            : `Nội dung chương ${index + 1}. ${'Diễn biến thế giới. '.repeat(20)}`,
        translatedContent: null,
        status: FileStatus.IDLE,
        retryCount: 0,
        originalCharCount: 100,
        remainingRawCharCount: 0,
    }));

describe('deep analysis sampling', () => {
    it('keeps every chapter for short stories', () => {
        const selected = selectDeepAnalysisFiles(makeFiles(60));
        expect(selected).toHaveLength(60);
        expect(selected.map(item => item.originalIndex)).toEqual(Array.from({ length: 60 }, (_, index) => index));
    });

    it('caps very long stories while preserving both edges and timeline order', () => {
        const selected = selectDeepAnalysisFiles(makeFiles(3000));
        const indexes = selected.map(item => item.originalIndex);

        expect(selected.length).toBeLessThanOrEqual(180);
        expect(selected.length).toBeGreaterThanOrEqual(150);
        expect(indexes.slice(0, 8)).toEqual(Array.from({ length: 8 }, (_, index) => index));
        expect(indexes).toContain(2999);
        expect(indexes).toEqual([...indexes].sort((a, b) => a - b));
        expect(indexes.some(index => index > 1400 && index < 1600)).toBe(true);
    });

    it('prefers a relationship-dense chapter inside its timeline slot', () => {
        const selected = selectDeepAnalysisFiles(makeFiles(1000, 505));
        expect(selected.some(item => item.originalIndex === 505)).toBe(true);
    });

    it('packs multiple marked chapters into bounded requests', () => {
        const selected = selectDeepAnalysisFiles(makeFiles(200));
        const chunks = buildDeepAnalysisChunks(selected, 200, 5000, 1000);

        expect(chunks.length).toBeLessThan(selected.length);
        expect(chunks.every(chunk => chunk.length <= 5200)).toBe(true);
        expect(chunks.join('\n')).toContain('[MỐC CHƯƠNG GỐC 1/200]');
        expect(chunks.join('\n')).toContain('[MỐC CHƯƠNG GỐC 200/200]');
    });
});
