import { describe, expect, it } from 'vitest';
import { createSessionJsonStream } from '../src/utils/storage';

describe('large-session JSON streaming', () => {
    it('preserves the original JSON shape and escaping', async () => {
        const data = { title: 'Truyện "dài"', files: [{ content: 'a\nb' }, null, { content: '尾声' }], count: 3 };
        const json = await new Response(createSessionJsonStream(data)).text();
        expect(JSON.parse(json)).toEqual(data);
    });

    it('handles empty chapter arrays', async () => {
        const json = await new Response(createSessionJsonStream({ files: [] })).text();
        expect(JSON.parse(json)).toEqual({ files: [] });
    });
});
