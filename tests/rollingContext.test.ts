import { describe, expect, it } from 'vitest';
import { FileItem, FileStatus } from '../src/types';
import { buildRollingChapterContext } from '../src/utils/text/rollingContext';

const file = (id: string, status: FileStatus, translatedContent: string | null): FileItem => ({
    id,
    name: 'Chương ' + id,
    content: 'raw-' + id,
    translatedContent,
    status,
    retryCount: 0,
    originalCharCount: 10,
    remainingRawCharCount: 0,
});

describe('rolling chapter context', () => {
    it('keeps only completed chapters immediately before the batch', () => {
        const files = [
            file('1', FileStatus.COMPLETED, 'đuôi chương một'),
            file('2', FileStatus.ERROR, 'không được dùng'),
            file('3', FileStatus.COMPLETED, 'đuôi chương ba'),
            file('4', FileStatus.IDLE, null),
        ];

        const result = buildRollingChapterContext(files, ['4']);
        expect(result).toContain('đuôi chương một');
        expect(result).toContain('đuôi chương ba');
        expect(result).not.toContain('không được dùng');
    });

    it('limits memory to recent chapters and tail excerpts', () => {
        const files = [
            file('1', FileStatus.COMPLETED, 'cũ'),
            file('2', FileStatus.COMPLETED, 'A'.repeat(40) + 'đuôi hai'),
            file('3', FileStatus.COMPLETED, 'đuôi ba'),
            file('4', FileStatus.IDLE, null),
        ];

        const result = buildRollingChapterContext(files, ['4'], 2, 12);
        expect(result).not.toContain('Chương 1');
        expect(result).not.toContain('A'.repeat(20));
        expect(result).toContain('đuôi hai');
        expect(result).toContain('đuôi ba');
    });
});