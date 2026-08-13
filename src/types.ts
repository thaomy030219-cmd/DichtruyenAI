
export enum FileStatus {
  IDLE = 'IDLE',
  PROCESSING = 'PROCESSING',
  REPAIRING = 'REPAIRING',
  COMPLETED = 'COMPLETED',
  ERROR = 'ERROR',
}

export type TranslationTier = 'flash' | 'normal' | 'pro' | 'full' | 'lite' | 'openrouter';

export interface BatchLimits {
    latin: { v36: number; v35: number; v31: number; v3: number; v25: number; maxTotalChars: number }; // Tiếng Việt, Convert
    complex: { v36: number; v35: number; v31: number; v3: number; v25: number; maxTotalChars: number }; // Raw, English, CJK
}

export interface RatioLimits {
    vn: { min: number; max: number };   // Vietnamese / Convert
    en: { min: number; max: number };   // English / Western
    krjp: { min: number; max: number }; // Korea / Japan
    cn: { min: number; max: number };   // Chinese
}

export interface FileItem {
  id: string;
  name: string;
  content: string;
  translatedContent: string | null;
  status: FileStatus;
  errorMessage?: string;
  retryCount: number;
  originalCharCount: number;
  remainingRawCharCount: number;
  usedModel?: string; // Track which model translated this file
  processingDuration?: number; // Time taken to process in milliseconds
  integrityRatio?: number;
  isFragmentedSource?: boolean;
  integrityOverrideAccepted?: boolean;
  ratioWarning?: string;
  // True khi tiêu đề chương hiện tại là do bước "Chuẩn hoá tiêu đề" (AI) tự sinh/format lại,
  // KHÔNG phải lấy nguyên văn từ bản gốc. Hậu kiểm (Tier 1 + Tier 2) dùng cờ này để không báo
  // oan "gốc không có tiêu đề nhưng dịch lại có tiêu đề" — vì đây là tính năng được cho phép.
  titleGeneratedByAI?: boolean;
  // Dạng chương phát hiện được lúc tách file từ văn bản gốc: có tiêu đề đầy đủ / chỉ có số thứ
  // tự / không có gì (thuần văn bản). Dùng để hậu kiểm áp đúng mức độ kỳ vọng cho từng dạng,
  // tránh áp tiêu chí "phải có tiêu đề" cho những chương vốn dĩ không có gì để đối chiếu.
  chapterFormat?: 'titled' | 'numbered' | 'untitled';
  // Đánh dấu translatedContent hiện tại là bản dịch bị hậu kiểm (Tier 1/2 trong validateBatch/
  // validateBatchWithAI) từ chối do nghi vấn nhầm/chập chương hay lệch tỷ lệ - nhưng KHÔNG bị
  // xoá, chỉ giữ lại để người dùng xem xét, và bị đẩy xuống cuối hàng chờ dịch lại. Bản dịch
  // nghi vấn này chỉ bị thay thế khi có bản dịch mới thành công (không còn bị hậu kiểm từ chối).
  // Cờ được reset (về false) khi: chạy Smart Fix, khôi phục Backup ở phiên làm việc mới, hoặc
  // khi người dùng bấm bắt đầu dịch lại (executeProcessing).
  hasStaleTranslation?: boolean;
}

export interface ProcessingStats {
  total: number;
  completed: number;
  failed: number;
  pending: number;
  processing: number;
}

export interface ContextPreset {
  id: string;
  name: string;
  content: string;
}

export interface StoryInfo {
  title: string;
  author: string;
  languages: string[]; // Multi-select support
  genres: string[];
  // New Fields
  mcPersonality: string[]; // Tính cách main (Vô sỉ, Cẩn trọng...)
  worldSetting: string[];  // Bối cảnh (Mạt thế, Hiện đại...)
  sectFlow: string[];      // Lưu phái (Phàm nhân lưu, Vô địch lưu...)
  contextNotes?: string; 
  summary?: string; // Tóm tắt cốt truyện (New v9.0)
  imagePrompt?: string; // Lưu prompt tạo ảnh để tái sử dụng hoặc tham khảo
  additionalRules?: string; // Quy tắc bổ sung từ người dùng (New v10.1)
  // Tùy chọn xưng hô khi chạy "Phân Tích Sâu" (deep_context): ép toàn bộ Series Bible/Ma trận
  // xưng hô theo 1 kiểu duy nhất (Hiện đại hoặc Cổ đại) thay vì để AI tự phân loại theo 3 NHÓM
  // A/B/C mặc định. 'flexible' (mặc định) = giữ nguyên hành vi phân tích sâu hiện tại.
  pronounMode?: 'modern' | 'ancient' | 'flexible';
  enableTitleFormatting?: boolean; // Tắt bật chuẩn hóa tiêu đề
  enableAutoFormat?: boolean; // Tắt bật định dạng đoạn văn và lọc rác chung
  enableGarbageCleanOnImport?: boolean; // Tắt bật lọc rác sơ bộ (HTML rác, *#=, __/-- lặp...) tự động ngay lúc thêm file (zip/epub/docx/txt/pdf)
  titleFormat?: 'colon' | 'dash' | 'newline' | 'bracket'; // Định dạng tiêu đề chương
  tagFormat?: 'auto' | 'bracket' | 'xml'; // Tùy chọn định dạng tag
}

export interface ModelQuota {
  id: string;
  name: string;
  rpmLimit: number; // Requests Per Minute
  rpdLimit: number; // Requests Per Day
  priority: number; // 1 is highest
}

export interface ModelUsage {
  requestsToday: number; // Count for today
  lastResetDate: string; // YYYY-MM-DD
  recentRequests: number[]; // Timestamps for RPM calculation
  cooldownUntil: number; // Timestamp when model is available again (0 if ready)
  isDepleted: boolean; // True if daily limit reached
  consecutiveErrors: number; // Track consecutive general failures
  consecutiveQuotaErrors?: number; // Track consecutive QUOTA failures
}

// --- SHARED UI TYPES ---
export interface Toast { 
    id: string; 
    message: string; 
    type: 'success' | 'error' | 'info' | 'warning'; 
}

export interface LogEntry { 
    id: string; 
    timestamp: Date; 
    message: string; 
    type: 'success' | 'error' | 'info'; 
}

export interface AutomationConfig {
    steps: number[];
    additionalRules: string;
    tier: TranslationTier;
}

export interface GlobalRepairEntry { 
    fileId: string; 
    lineIndex: number; 
    originalLine: string; 
}

export interface CreativeChapter {
    id: string;
    title: string;
    content: string;
    status?: 'completed' | 'failed' | 'retrying';
    retryCount?: number;
}

export interface SinoVietnameseState {
    unfixedList: string;
    fixedList: string;
}

export interface FixErrorState {
    prompt: string;
    rawErrors?: string;
    processedFixes?: string;
    fixImages?: string[];
    imageBase64: string | null;
}

export interface Character {
    id: string;
    name: string;
    gender: string;
    age: string;
    role: string;
    appearance: string;
    personality: string;
}

export interface CreativeState {
    prompt: string;
    chapters: CreativeChapter[];
    summary: string;
    suggestions: string[];
    isGenerating: boolean;
    isSummarizing: boolean;
    targetChapters: number; // Used as batch size now
    totalTargetChapters?: number; // Total chapters for the whole book
    autoGenerateTarget?: number;
    customNextPrompt?: string;
    setup?: any;
    characters?: Character[];
}
