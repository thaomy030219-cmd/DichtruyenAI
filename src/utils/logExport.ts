import { LogEntry } from '../types';
import { APP_VERSION } from '../changelog';

// Thông tin môi trường đính kèm đầu file log — giúp người nhận (dev) không cần hỏi lại
// "bạn dùng bản nào/trình duyệt gì/máy gì" mỗi lần debug.
function buildEnvironmentHeader(extra?: Record<string, string | number | boolean | undefined>): string {
    const lines: string[] = [];
    lines.push('='.repeat(60));
    lines.push('BÁO CÁO LỖI / NHẬT KÝ HỆ THỐNG');
    lines.push('='.repeat(60));
    lines.push(`Phiên bản app: v${APP_VERSION}`);
    lines.push(`Thời điểm xuất: ${new Date().toLocaleString('vi-VN')}`);
    try {
        lines.push(`Trình duyệt (User Agent): ${navigator.userAgent}`);
        lines.push(`Ngôn ngữ trình duyệt: ${navigator.language}`);
        lines.push(`Kích thước màn hình: ${window.screen.width}x${window.screen.height} (viewport ${window.innerWidth}x${window.innerHeight})`);
        lines.push(`Online: ${navigator.onLine ? 'Có' : 'Không'}`);
    } catch { /* môi trường không có window/navigator (SSR/test) - bỏ qua */ }

    if (extra) {
        Object.entries(extra).forEach(([key, value]) => {
            if (value !== undefined) lines.push(`${key}: ${value}`);
        });
    }

    lines.push('='.repeat(60));
    lines.push('');
    return lines.join('\n');
}

// Định dạng danh sách log thành text dễ đọc, sắp theo thời gian tăng dần (cũ -> mới) để đọc một
// mạch từ trên xuống giống như đang xem lại diễn biến phiên làm việc, dù trên UI hiển thị mới nhất
// lên đầu (dễ theo dõi lúc đang chạy) để export lại đảo ngược cho tự nhiên khi đọc như báo cáo.
function formatLogEntries(logs: LogEntry[]): string {
    if (logs.length === 0) return '(Không có log nào được ghi nhận trong phiên này)';
    const chronological = [...logs].reverse();
    return chronological.map(log => {
        const time = new Date(log.timestamp).toLocaleString('vi-VN');
        const tag = log.type === 'error' ? '[LỖI]' : log.type === 'success' ? '[OK]' : '[INFO]';
        return `${time} ${tag} ${log.message}`;
    }).join('\n');
}

export function buildLogFileContent(logs: LogEntry[], extra?: Record<string, string | number | boolean | undefined>): string {
    return buildEnvironmentHeader(extra) + formatLogEntries(logs);
}

// Tạo file .txt và kích hoạt tải xuống ngay trên trình duyệt (không cần server).
export function downloadTextFile(content: string, filenamePrefix: string): void {
    try {
        const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        a.href = url;
        a.download = `${filenamePrefix}_${stamp}.txt`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
        // Nếu Blob/download bị chặn (hiếm gặp) - fallback mở tab mới hiển thị nội dung thô để
        // người dùng tự copy, còn hơn là im lặng thất bại không xuất được gì.
        try {
            const win = window.open('', '_blank');
            if (win) {
                win.document.title = 'Log xuất (chế độ dự phòng - vui lòng copy toàn bộ nội dung)';
                win.document.body.style.whiteSpace = 'pre-wrap';
                win.document.body.style.fontFamily = 'monospace';
                win.document.body.textContent = content;
            }
        } catch { /* bó tay, môi trường quá hạn chế */ }
    }
}

// Gộp 2 bước lại cho gọn: định dạng + tải xuống ngay.
export function exportSystemLogs(logs: LogEntry[], extra?: Record<string, string | number | boolean | undefined>): void {
    const content = buildLogFileContent(logs, extra);
    downloadTextFile(content, 'nhat-ky-loi');
}

// Xuất báo cáo riêng cho trường hợp app CRASH (lỗi giao diện nghiêm trọng, React ErrorBoundary
// bắt được). Khác với exportSystemLogs thông thường: gộp thêm chi tiết stack trace của chính lỗi
// crash + component stack, đặt NGAY ĐẦU báo cáo (trước cả log lịch sử), vì đây mới là thông tin
// quan trọng nhất để dev tìm ra nguyên nhân, còn log lịch sử chỉ là bối cảnh dẫn tới crash.
export function exportCrashReport(error: Error | null, componentStack: string | null | undefined, priorLogs: LogEntry[]): void {
    const header = buildEnvironmentHeader({ 'Loại sự cố': 'CRASH - Lỗi giao diện nghiêm trọng (ErrorBoundary)' });
    const crashDetail = [
        '--- CHI TIẾT LỖI CRASH (quan trọng nhất, xem trước) ---',
        error ? (error.stack || error.toString()) : '(Không bắt được đối tượng lỗi)',
        '',
        '--- COMPONENT STACK (React) ---',
        componentStack || '(Không có)',
        '',
        '--- LOG HỆ THỐNG TRƯỚC KHI CRASH (cũ -> mới) ---',
    ].join('\n');
    const content = header + crashDetail + '\n' + formatLogEntries(priorLogs);
    downloadTextFile(content, 'bao-cao-crash');
}
