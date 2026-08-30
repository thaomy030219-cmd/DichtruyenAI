import { describe, expect, it } from 'vitest';
import { removeAuthorNotesAtEdges, removeJunkContent } from '../src/utils/text/optimization';

const STORY = `Chương 12: Trở về

Trời vừa sáng, Lâm An đã rời khỏi khách điếm. Hắn men theo con đường nhỏ dẫn về phía bắc.

Đến chiều, bóng thành cũ cuối cùng cũng hiện ra sau màn mưa.`;

describe('safe author-note filtering', () => {
    it('removes a labelled multi-paragraph author note at the chapter tail', () => {
        const input = `${STORY}

Lời tác giả:

Cảm ơn mọi người đã đồng hành với mình trong thời gian qua.

Tuần này công việc hơi bận nên lịch đăng chương có thể chậm hơn một chút.`;

        expect(removeAuthorNotesAtEdges(input)).toBe(STORY);
    });

    it('removes strong standalone thanks and vote solicitation at the tail', () => {
        expect(removeAuthorNotesAtEdges(`${STORY}

Cảm ơn các bạn đã đọc và ủng hộ tác giả!

Xin mọi người bỏ phiếu đề cử và theo dõi truyện nhé!`)).toBe(STORY);
    });

    it('supports explicit Chinese and Japanese author-note headings', () => {
        expect(removeAuthorNotesAtEdges(`${STORY}

作者有话说：

感谢大家一直以来的支持，请多多收藏。`)).toBe(STORY);

        expect(removeAuthorNotesAtEdges(`${STORY}

あとがき：

最後まで読んでいただき、ありがとうございました。`)).toBe(STORY);
    });

    it('keeps dialogue, letters and first-person story reflections', () => {
        const dialogue = `${STORY}

“Cảm ơn mọi người đã ủng hộ tôi,” nàng nói rồi cúi đầu trước dân làng.`;
        const diary = `${STORY}

Nhật ký của Minh: Tôi bị ốm nên xin nghỉ buổi tuần tra ngày mai.`;

        expect(removeAuthorNotesAtEdges(dialogue)).toBe(dialogue);
        expect(removeAuthorNotesAtEdges(diary)).toBe(diary);
    });

    it('never scans matching phrases out of the middle of a chapter', () => {
        const input = `Chương 7: Khán đài

Xin mọi người bỏ phiếu cho đội Lam! Người dẫn chương trình hét lớn.

Khán giả đồng loạt giơ tay, tiếng reo hò làm rung chuyển đấu trường.

Cuối cùng, đội Lam giành chiến thắng và rời sân trong tiếng vỗ tay.`;

        expect(removeAuthorNotesAtEdges(input)).toBe(input);
    });

    it('runs before the existing line-level junk cleanup', () => {
        const input = `${STORY}

Author's note:

Thanks to all readers for your support and patience.`;

        expect(removeJunkContent(input)).toBe(STORY);
    });
});
