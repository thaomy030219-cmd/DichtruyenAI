
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

export const MODEL_CONFIGS: ModelQuota[] = [
  { id: 'gemini-3.1-pro-preview', name: 'Gemini 3.1 Pro (Siêu cấp)', rpmLimit: 2, rpdLimit: 100, priority: 2 },
  { id: 'gemini-4-hydrogen', name: 'Gemini 4 Hydrogen', rpmLimit: 10, rpdLimit: 500, priority: 1 },
  { id: 'gemini-3.8-flash', name: 'Gemini 3.8 Flash', rpmLimit: 10, rpdLimit: 500, priority: 2.8 },
  { id: 'gemini-3.6-flash', name: 'Gemini 3.6 Flash', rpmLimit: 10, rpdLimit: 500, priority: 4 },
  { id: 'gemini-3-flash-preview', name: 'Gemini 3.0 Flash (Turbo)', rpmLimit: 10, rpdLimit: 500, priority: 3.5 },
  { id: 'gemini-3.5-flash-lite', name: 'Gemini 3.5 Flash Lite', rpmLimit: 10, rpdLimit: 500, priority: 4.65 },
  { id: 'gemma-4-31b-it', name: 'Gemma 4 31B IT', rpmLimit: 10, rpdLimit: 500, priority: 4.55 },
  { id: 'gemma-4-26b-a4b-it', name: 'Gemma 4 26B A4B IT', rpmLimit: 10, rpdLimit: 500, priority: 4.95 },
];

export const TIER_MODELS = {
  PRO_POOL: ['gemini-3.1-pro-preview'],
  FLASH_POOL: MODEL_CONFIGS.filter(model => model.id !== 'gemini-3.1-pro-preview').map(model => model.id),
};

export const TRANSLATION_MODEL_IDS = ['gemini-4-hydrogen', 'gemini-3.8-flash', 'gemini-3-flash-preview', 'gemini-3.1-pro-preview'] as const;
export const SUPPORT_MODEL_IDS = ['gemini-3.6-flash', 'gemini-3.5-flash-lite', 'gemma-4-31b-it', 'gemma-4-26b-a4b-it'] as const;

export const restoreEnabledModels = (saved: string[]): string[] =>
  MODEL_CONFIGS.filter(model => model.id !== 'gemini-3.1-pro-preview' || saved.includes(model.id)).map(model => model.id);

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
