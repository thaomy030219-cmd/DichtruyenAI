// Helper dùng chung để quyết định OpenRouter (vệ tinh cứu hộ) có nên đảm nhận 1 lượt thử
// lại của tệp bị nghi vấn vi phạm bộ lọc an toàn / lỗi nội dung hay không, dựa trên
// retryCount hiện tại của tệp đó và OpenRouter Key đang có.
//
// UPDATED v11.5.9: Đã xóa hẳn DeepSeek khỏi app (không có model miễn phí thật, gây nhầm lẫn
// khi dùng làm cứu hộ). OpenRouter (ưu tiên model GPT-OSS miễn phí - xem streamTranslate.ts)
// giờ là vệ tinh cứu hộ DUY NHẤT, đảm nhận toàn bộ `perRescueBudget * 2` lượt khi có Key.
export type RescueTarget = 'openrouter' | null;

export const getRescueTarget = (
    retryCount: number,
    hasOpenRouter: boolean,
    perRescueBudget: number
): RescueTarget => {
    if (hasOpenRouter && retryCount < perRescueBudget * 2) return 'openrouter';
    return null;
};

// Tổng số lượt cứu hộ khả dụng (dùng để hiển thị "x/y" trong errorMessage).
export const getRescueBudget = (
    hasOpenRouter: boolean,
    perRescueBudget: number
): number => {
    return hasOpenRouter ? perRescueBudget * 2 : 0;
};

export const getRescueLabel = (target: RescueTarget): string => {
    return target === 'openrouter' ? 'OpenRouter' : '';
};
