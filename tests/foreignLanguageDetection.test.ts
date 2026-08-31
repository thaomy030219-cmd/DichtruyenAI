import { describe, expect, it } from 'vitest';
import { detectUnmappedInlineEnglish } from '../src/utils/text/inlineEnglishFixer';
import { countForeignChars, findLinesWithForeignChars } from '../src/utils/text/analysis';

describe('foreign language detection', () => {
    it('detects a fully English sentence without Vietnamese accents', () => {
        const text = 'Hắn bước vào căn phòng.\nShe looked at him and asked why he was there.';
        const matches = detectUnmappedInlineEnglish(text);
        expect(matches).toHaveLength(1);
        expect(matches[0].lineIndex).toBe(1);
    });

    it('detects common English embedded in Vietnamese prose', () => {
        const matches = detectUnmappedInlineEnglish('Hắn quay lại, but she was already gone khỏi nơi đó.');
        expect(matches).toHaveLength(1);
        expect(matches[0].enWords.length).toBeGreaterThan(0);
    });

    it('does not flag ordinary Vietnamese or a short proper name', () => {
        const text = 'Harry Potter\nHom nay troi dep va chung ta se len duong.\nHôm nay trời đẹp và chúng ta sẽ lên đường.';
        expect(detectUnmappedInlineEnglish(text)).toEqual([]);
    });

    it('finds English and several non-Latin scripts in repair lines', () => {
        const text = [
            'Nội dung tiếng Việt.',
            'They were waiting outside the old house.',
            'ยังมีข้อความที่ไม่ได้แปล',
            'Остался непереведенный текст',
            'بقي نص غير مترجم'
        ].join('\n');
        expect(findLinesWithForeignChars(text).map(line => line.index)).toEqual([1, 2, 3, 4]);
        expect(countForeignChars(text)).toBeGreaterThan(0);
    });
});
