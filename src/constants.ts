
import { ModelQuota } from './types';

// Export everything from the new split files
export * from './prompts';
export * from './defaultDictionary';

// Cấu hình truy cập ứng dụng (Intro Page)
// Bạn có thể chỉnh sửa mã code và thời hạn ở đây cho tiện dụng
export const ACCESS_CONFIG = {
  // Bật/tắt tính năng yêu cầu nhập code bảo vệ ở màn hình Intro
  REQUIRE_CODE: true,
  
  // Hash SHA-256 của mật khẩu (hex) — không thể đảo ngược thành plaintext
  PASSWORD_HASH: '2cdeb943ec144a3d96f66f6049f471e16360af2f92cf3e6d56d2fa049158765a',
  
  // Expiry dạng timestamp UTC (Unix timestamp ms của ngày hết hạn)
  EXPIRY_TS: 1817053140000, // 2027-07-31T23:59:00+07:00

  // Nhãn gói bản quyền, chỉ khác nhau giữa 2 bản đóng gói (6 Tháng / 1 Năm), hiển thị cạnh
  // tên app ở Header và IntroPage để người dùng biết đang dùng gói nào.
  EDITION: '1 Năm'
};

// UPDATED v11.3.6: Adjusted RPD Limits to hard limits based on user feedback
export const MODEL_CONFIGS: ModelQuota[] = [
  // PRO TIER: High Intelligence
  // Gemini 3.1 Pro: Giới hạn 100 RPD
  { id: 'gemini-3.1-pro-preview', name: 'Gemini 3.1 Pro (Siêu cấp)', rpmLimit: 2, rpdLimit: 100, priority: 1 },
  
  // FLASH TIER: High Speed
  // Gemini 3.7 Flash (ra mắt 13/8/2026): bản Flash mạnh nhất tính tới hiện tại, ưu tiên cao nhất
  // trong nhóm Flash (priority thấp nhất trong nhóm này = được chọn trước).
  { id: 'gemini-3.7-flash', name: 'Gemini 3.7 Flash (Mới nhất)', rpmLimit: 10, rpdLimit: 500, priority: 3.3 },
  { id: 'gemini-3.6-flash', name: 'Gemini 3.6 Flash (Tối ưu)', rpmLimit: 10, rpdLimit: 500, priority: 3.4 },
  // Gemini 3.5 Flash: Giới hạn 500 RPD
  { id: 'gemini-3.5-flash', name: 'Gemini 3.5 Flash (Kế Tiếp)', rpmLimit: 10, rpdLimit: 500, priority: 4 },
  // Gemini 3.0 Flash: Giới hạn 500 RPD
  { id: 'gemini-3-flash-preview', name: 'Gemini 3.0 Flash (Turbo)', rpmLimit: 10, rpdLimit: 500, priority: 3.5 },
  // Gemini 3.1 Flash Lite: Giới hạn 500 RPD
  { id: 'gemini-3.5-flash-lite', name: 'Gemini 3.5 Flash Lite', rpmLimit: 10, rpdLimit: 500, priority: 4.65 },
  { id: 'gemini-3.1-flash-lite', name: 'Gemini 3.1 Flash Lite', rpmLimit: 10, rpdLimit: 500, priority: 4.9 },
  
  // LITE TIER: Small models
  // UPDATED: thứ tự ưu tiên (priority càng thấp càng được chọn trước, xem quotaManager.getBestModelForTask)
  // giữa 4 model lite/gemma này được chỉnh lại thành 31B > 3.5 Flash Lite > 3.1 Flash Lite > 26B —
  // áp dụng cho MỌI nơi dùng chung MODEL_CONFIGS.priority (cả dịch Flash/Auto-Fix lẫn hậu kiểm Tier 2).
  { id: 'gemma-4-31b-it', name: 'Gemma 4 31B IT', rpmLimit: 10, rpdLimit: 500, priority: 4.55 },
  { id: 'gemma-4-26b-a4b-it', name: 'Gemma 4 26B A4B IT', rpmLimit: 10, rpdLimit: 500, priority: 4.95 },

  // IMAGE TIER
  { id: 'gemini-3.1-flash-lite-image', name: 'Nano Banana 2 Lite', rpmLimit: 5, rpdLimit: 500, priority: 7 },
];

export const TIER_MODELS = {
    PRO_POOL: ['gemini-3.1-pro-preview'], // Reverted: Keep Pro Pool strict
    FLASH_POOL: ['gemini-3.7-flash', 'gemini-3.6-flash', 'gemini-3.5-flash', 'gemini-3-flash-preview', 'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite', 'gemma-4-26b-a4b-it', 'gemma-4-31b-it'], // Dùng để dịch trong Flash & Auto-Fix
};

export const CONCURRENCY_CONFIG = { 
    FLASH: 3, // Reduced to 3 per user request
    NORMAL: 3, 
    PRO: 2, // Strict serial processing for Pro to avoid TPM hit, bumped to 2 with spacing
    FULL: 3, // Reduced to 3 per user request
    LITE: 3
};

export const BATCH_SIZE_CONFIG = { FLASH: 5, NORMAL: 5, PRO: 5, FULL: 5, LITE: 5 };

// UPDATED: Batch size for repair increased to 150 lines to optimize API calls while staying within limits
export const REPAIR_CONFIG = { BATCH_SIZE: 150, CONCURRENCY: 2 };

export const AVAILABLE_LANGUAGES = ['Convert thô', 'Tiếng Trung', 'Tiếng Anh', 'Tiếng Hàn', 'Tiếng Nhật'];
export const AVAILABLE_GENRES = ['Tiên Hiệp', 'Huyền Huyễn', 'Đô Thị', 'Khoa Huyễn', 'Võng Du', 'Đồng Nhân', 'Kiếm Hiệp', 'Ngôn Tình', 'Dị Giới', 'Mạt Thế', 'Ngự Thú', 'Linh Dị', 'Hệ Thống', 'Hài Hước', 'Fantasy', 'Action', 'Light Novel', 'Isekai'];
export const AVAILABLE_PERSONALITIES = ['Vô sỉ/Cợt nhả', 'Lạnh lùng/Sát phạt', 'Cẩn trọng/Vững vàng', 'Thông minh/Đa mưu'];
export const AVAILABLE_SETTINGS = ['Trung Cổ/Cổ Đại', 'Hiện đại/Đô thị', 'Thập niên 80-90', 'Tương lai/Sci-fi', 'Mạt thế/Zombie', 'Võng Du/Game', 'Phương Tây/Magic'];
export const AVAILABLE_FLOWS = ['Phàm nhân lưu', 'Vô địch lưu', 'Phế vật lưu', 'Hệ thống lưu', 'Xuyên không lưu', 'Vô hạn lưu'];
