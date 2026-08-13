import { LogEntry } from '../types';

const STORAGE_KEY = 'app_system_logs_v1';
const MAX_ENTRIES = 500;

export function loadPersistedLogs(): LogEntry[] {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw) as LogEntry[];
        if (!Array.isArray(parsed)) return [];
        return parsed.map(l => ({ ...l, timestamp: new Date(l.timestamp) }));
    } catch {
        return [];
    }
}

export function persistLogs(logs: LogEntry[]): void {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(logs.slice(0, MAX_ENTRIES)));
    } catch {
        // localStorage đầy hoặc bị chặn (chế độ ẩn danh nghiêm ngặt...) - bỏ qua, không để việc
        // ghi log làm crash thêm lần nữa.
    }
}

// Trong lúc dịch hàng loạt, addLog có thể được gọi rất dày (nhiều dòng/giây). Ghi localStorage
// (JSON.stringify tới 500 mục) ở MỌI lần gọi sẽ gây giật lag không cần thiết cho các log thường
// (info/success) — vốn không quá quan trọng phải lưu ngay tức thì. Debounce lại việc ghi các log
// này (gộp nhiều lần gọi liên tiếp thành 1 lần ghi sau khi ngừng gọi ~800ms).
let persistTimer: ReturnType<typeof setTimeout> | null = null;
export function schedulePersistLogs(logs: LogEntry[]): void {
    if (persistTimer) clearTimeout(persistTimer);
    persistTimer = setTimeout(() => {
        persistLogs(logs);
        persistTimer = null;
    }, 800);
}

// Ghi trực tiếp 1 dòng log mới nhất vào localStorage. Hàm này dùng được cả NGOÀI cây React (ví
// dụ window.onerror/unhandledrejection chạy độc lập, hoặc bên trong ErrorBoundary SAU KHI toàn
// bộ state React trong App đã mất do crash) — vì nó tự đọc/ghi thẳng localStorage, không phụ
// thuộc vào state của bất kỳ component nào còn sống hay không.
export function appendPersistedLog(message: string, type: 'success' | 'error' | 'info' = 'info'): void {
    const current = loadPersistedLogs();
    const entry: LogEntry = {
        id: (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
        timestamp: new Date(),
        message,
        type,
    };
    persistLogs([entry, ...current]);
}

export function clearPersistedLogs(): void {
    try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
}
