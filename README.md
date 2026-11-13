<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://ai.google.dev/static/site-assets/images/share-ais-513315318.png" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/a66e8c47-2880-435e-a1da-2674238e0b3d

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Run the app with `npm run dev`.
3. Mở **API** trên thanh trên cùng. Nhập Project ID và một Gemini API key Free Tier cho mỗi project, bấm **Kiểm tra và thêm key**, rồi **Lưu API**. Key được lưu trong trình duyệt đến khi bạn xóa key hoặc xóa dữ liệu trang. App thử project theo thứ tự thêm. Các key thuộc cùng project dùng chung hạn mức.

Khi chạy local, bạn cũng có thể cấu hình `GEMINI_API_KEY` trong `.env.local` để dùng làm key mặc định. Khi thêm key riêng, app dùng danh sách project bạn đã nhập. Với bản web công khai, để trống biến này khi build để tránh đưa key dùng chung vào JavaScript tải xuống trình duyệt.

## Nhất quán và hậu kiểm bản dịch dài

- Kiểm tra tại máy chạy trước khi gọi API và trong hậu kiểm. Xung đột tên chuẩn hoặc cặp xưng hô đã xác nhận trong cùng giai đoạn sẽ giữ riêng chương liên quan; không chặn cả truyện. Xưng hô không rõ người nói/người nghe và thiếu tên do dùng đại từ chỉ là gợi ý, không tự thay hàng loạt.
- Trong bảng từ điển, mở **Biến thể & khóa tên** để khai báo các cách viết hợp lệ và dạng sai không được dùng. Dùng dấu `;` ngăn cách; rời ô nhập để áp dụng thay đổi. Dữ liệu vẫn là văn bản từ điển, ví dụ: `[林墨] = Lâm Mặc || aliases: Mặc ca; Tiểu Mặc || forbidden: Lâm Mỗ || lock`. Biến thể được phép không bị coi là lỗi.
- Hậu kiểm tồn đọng chạy từng đợt tối đa 6 chương, lưu tiến độ sau mỗi đợt, không còn giới hạn 12 chương cuối phiên. Bấm **Dừng lại** để tạm dừng; **Bắt đầu** hoặc **Hậu kiểm** để tiếp tục. Khi mở lại trang, bản dịch của đợt bị gián đoạn được giữ để kiểm tiếp, không tự dịch lại.
- Hết quota/mạng gián đoạn: chờ rồi thử lại khi model sẵn sàng. Lỗi cấu hình hoặc nghi vấn không giải quyết được sau 4 lượt kiểm sẽ dừng tự thử chương đó để tiết kiệm request; chương vẫn ở **Chờ hậu kiểm** để người dùng kiểm thủ công. Hậu kiểm AI vẫn dùng API; bộ kiểm tra tại máy không dùng API.
- Bộ nhớ bản dịch lưu trong IndexedDB của trình duyệt, chỉ nhận bản đã hậu kiểm **PASS**. Tái sử dụng yêu cầu khớp nguyên văn đầy đủ, vị trí chương, từ điển, prompt, quy tắc, bối cảnh và bộ nhớ chương trước; kiểm tra SHA-256 của nội dung đã lưu. Chương lấy từ bộ nhớ có nhãn **Bộ nhớ ✓** và không gọi API dịch. **Dịch lại** luôn bỏ qua cache.
- Cache tối đa 5.000 bản xác minh, tự loại bản cũ nhất; lỗi lưu cache không cản trở dịch bình thường. Cache không tự chuyển sang máy khác, không nằm trong file backup phiên và bị xóa khi reset toàn bộ dữ liệu hoặc xóa dữ liệu trang. Hàng đợi chỉ chạy khi ứng dụng đang mở; không chạy ngầm sau khi đóng trình duyệt.

Kiểm tra dự án: `npm test`, `npx tsc --noEmit`, `npm run lint`, `npm run build`.
