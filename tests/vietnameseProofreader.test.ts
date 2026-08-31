import { describe, expect, it } from 'vitest';
import { proofreadVietnamese } from '../src/utils/text/vietnameseProofreader';

describe('offline Vietnamese proofreader', () => {
    it('automatically fixes only high-confidence spelling mistakes', async () => {
        const result = await proofreadVietnamese('Hắn suy nghỉ hồi lâu giữa khung cảnh hổn loạn.');
        expect(result.text).toBe('Hắn suy nghĩ hồi lâu giữa khung cảnh hỗn loạn.');
        expect(result.correctedCount).toBe(2);
    });

    it('preserves capitalization when applying a safe correction', async () => {
        const result = await proofreadVietnamese('Suy nghỉ một lát, nàng mới lên tiếng.');
        expect(result.text).toBe('Suy nghĩ một lát, nàng mới lên tiếng.');
    });

    it('removes only duplicated Vietnamese function words', async () => {
        const result = await proofreadVietnamese('Hắn đã đã rời đi, lòng rất rất bất an.');
        expect(result.text).toBe('Hắn đã rời đi, lòng rất rất bất an.');
        expect(result.correctedCount).toBe(1);
    });

    it('does not rewrite protected names or unknown story terminology', async () => {
        const input = 'Lâm Khuyết vận chuyển Huyền Minh Thần Công.';
        const result = await proofreadVietnamese(input, ['Lâm Khuyết = nhân vật\nHuyền Minh Thần Công = công pháp']);
        expect(result.text).toBe(input);
    });
});
