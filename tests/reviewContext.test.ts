import { describe, expect, it } from 'vitest';
import { buildRelevantTermChecklist, buildReviewConsistencyContext } from '../src/services/workflows/translate/reviewContext';

describe('quality review context', () => {
    it('keeps names and pronoun rules ahead of long rolling memory', () => {
        const context = `${'Bối cảnh dài. '.repeat(600)}\nA → B: anh/em`;
        const result = buildReviewConsistencyContext('林墨=Lâm Mặc', context, 'chương cũ '.repeat(1000));
        expect(result.indexOf('林墨=Lâm Mặc')).toBeLessThan(result.indexOf('A → B: anh/em'));
        expect(result).toContain('A → B: anh/em');
        expect(result.length).toBeLessThan(15_000);
    });

    it('only checks glossary terms present in the source without hard-failing pronouns', () => {
        const list = buildRelevantTermChecklist('林墨=Lâm Mặc\n王朝=Vương triều', '林墨 bước vào', 'Hắn bước vào');
        expect(list).toContain('林墨 → Lâm Mặc');
        expect(list).toContain('có thể do dùng đại từ');
        expect(list).not.toContain('Vương triều');
    });

    it('brings late glossary entries into a bounded review context when present in the batch', () => {
        const dictionary = `${Array.from({ length: 300 }, (_, index) => `旧名${index}=Tên cũ ${index}`).join('\n')}\n林墨=Lâm Mặc`;
        const result = buildReviewConsistencyContext(dictionary, '', '', '林墨 xuất hiện trong chương');
        expect(result).toContain('林墨=Lâm Mặc');
        expect(result.length).toBeLessThan(14_000);
    });
});
