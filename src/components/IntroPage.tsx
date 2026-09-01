import React, { useState, useEffect } from 'react';
import { Coffee, ArrowRight, Languages, Heart } from 'lucide-react';
import { ACCESS_CONFIG } from '../constants';

// UPDATED v1.0.2: Thiết kế lại HOÀN TOÀN trang chào mừng — trước là nền tối xanh dương/cyan,
// bố cục badge lặp lại kiểu "pill". Giờ chuyển sang tông SÁNG/thân thiện lấy cảm hứng từ trang
// sách: nền trắng ngà điểm xanh ngọc (primary), tiêu đề dùng font chữ văn học (Playfair Display,
// qua class font-heading — khác hẳn Outfit dùng trong toàn app), biểu tượng "Languages" trong
// khung tròn làm dấu ấn nhận diện (thay vì badge chữ lặp lại), và card Donate viết lại giọng văn
// gần gũi hơn ("Mời tác giả một cốc cà phê" thay vì tiêu đề khô khan "Donate").
export const IntroPage: React.FC<{ onEnter: () => void }> = ({ onEnter }) => {
  // Khởi tạo error ngay từ đầu nếu đã hết hạn — quan trọng cho trường hợp App.tsx
  // "đá" người dùng về lại trang này giữa chừng do hết hạn (xem checkExpiry trong App.tsx):
  // màn hình phải hiện thông báo hết hạn NGAY LẬP TỨC, không cần chờ họ bấm "Bắt đầu" mới biết.
  const [error, setError] = useState(() =>
    (ACCESS_CONFIG.EXPIRY_TS && Date.now() > ACCESS_CONFIG.EXPIRY_TS) ? 'expired' : ''
  );

  // Phòng trường hợp trang Intro này được mount từ trước (hiếm khi xảy ra) rồi mới tới giờ hết hạn
  // trong lúc người dùng đang đứng nhìn màn hình Intro (chưa bấm Enter) — tự cập nhật thông báo.
  useEffect(() => {
    const expiryTimer = window.setTimeout(() => {
      if (ACCESS_CONFIG.EXPIRY_TS && Date.now() > ACCESS_CONFIG.EXPIRY_TS) {
        setError('expired');
      }
    }, 0);
    return () => window.clearTimeout(expiryTimer);
  }, []);

  const handleEnter = () => {
    if (ACCESS_CONFIG.EXPIRY_TS && Date.now() > ACCESS_CONFIG.EXPIRY_TS) {
      setError('expired');
      return;
    }
    onEnter();
  };

  return (
    <div className="min-h-[100dvh] w-full bg-[#f7faf8] text-teal-950 flex flex-col items-center justify-center p-4 sm:p-6 font-sans selection:bg-teal-200 overflow-y-auto relative">
      {/* Ambient background wash — 2 quầng màu mờ, tạo chiều sâu nhẹ nhàng, không lòe loẹt */}
      <div className="pointer-events-none absolute top-0 left-1/2 -translate-x-1/2 w-[520px] h-[520px] bg-teal-200/40 rounded-full blur-3xl" />
      <div className="pointer-events-none absolute top-52 right-0 w-[360px] h-[360px] bg-amber-100/50 rounded-full blur-3xl" />

      <div className="max-w-5xl w-full grid gap-4 animate-in fade-in slide-in-from-bottom-8 duration-700 relative">

        {/* Hero */}
        <div className="text-center space-y-2.5">
          <div className="inline-flex items-center gap-2 mx-auto bg-white border border-teal-200 rounded-full pl-1.5 pr-3 py-1 shadow-sm">
            <span className="w-6 h-6 rounded-full bg-teal-600 text-white flex items-center justify-center shrink-0">
              <Languages className="w-3.5 h-3.5" />
            </span>
            <span className="text-xs font-semibold text-teal-700 tracking-wide">CÔNG CỤ DỊCH TRUYỆN BẰNG AI</span>
          </div>

          <h1 className="font-heading font-bold text-3xl sm:text-4xl tracking-tight text-teal-950">
            Dịch truyện AI
            <span className="align-super text-sm sm:text-base font-sans font-bold text-teal-500 ml-2">v1.0.8</span>
          </h1>

          <p className="text-teal-900/60 max-w-md mx-auto text-sm">
            Công cụ dịch truyện chuyên nghiệp bằng AI.
          </p>

          <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-[11px] text-teal-700/60 font-semibold uppercase tracking-wide">
            <span>Thiết kế bởi AI</span>
            <span className="w-1 h-1 rounded-full bg-teal-300" />
            <span>Ý tưởng: Đỗ Xuân Quyết</span>
          </div>
        </div>

        <div className="grid lg:grid-cols-2 gap-4 items-stretch">
        {/* Enter Card */}
        <div className="bg-white border border-teal-100 rounded-2xl p-5 shadow-[0_8px_30px_-12px_rgba(13,148,136,0.25)] flex items-center">
          <div className="w-full flex flex-col items-center justify-center gap-3">
            <button
              onClick={handleEnter}
              className="w-full group relative flex items-center justify-center gap-3 px-6 py-3.5 bg-teal-600 text-white hover:bg-teal-700 rounded-xl font-bold text-base transition-all hover:scale-[1.02] shadow-lg shadow-teal-600/25 hover:shadow-teal-600/40 active:scale-[0.98] shrink-0"
            >
              Bắt đầu
              <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
            </button>

            {/* Error Message */}
            {error === 'expired' && (
              <div className="text-sm font-medium animate-in fade-in bg-rose-50 border border-rose-200 p-4 rounded-xl text-center w-full space-y-2 text-rose-900">
                <p className="text-rose-600 font-bold mb-3">Phiên bản hiện tại đã hết hạn sử dụng.</p>
                <p>Vui lòng liên hệ:</p>
                <div className="space-y-1">
                  <p>Telegram cá nhân: <a href="https://t.me/truyendichlinhdi" target="_blank" rel="noopener noreferrer" className="text-teal-600 hover:text-teal-700 hover:underline font-semibold">t.me/truyendichlinhdi</a></p>
                  <p>Hoặc Nhóm trao đổi: <span className="text-rose-400">đang cập nhật</span></p>
                </div>
              </div>
            )}
            {error && error !== 'expired' && (
              <p className="text-red-500 text-sm font-medium animate-in fade-in">
                {error}
              </p>
            )}
          </div>
        </div>

        {/* Thông tin tác giả. QR donate đã được chuyển vào sidebar của ứng dụng. */}
        <div className="bg-white border border-teal-100 rounded-2xl p-4 space-y-3 shadow-[0_8px_30px_-12px_rgba(13,148,136,0.15)]">
          <div className="flex items-center gap-3 text-left">
            <div className="w-10 h-10 shrink-0 bg-amber-50 rounded-xl flex items-center justify-center border border-amber-200">
              <Coffee className="w-5 h-5 text-amber-500" />
            </div>
            <div>
              <h3 className="font-heading text-lg font-bold text-teal-950">Về tác giả</h3>
              <p className="text-xs text-teal-900/60 leading-relaxed">Cảm ơn bạn đã sử dụng và đồng hành cùng công cụ dịch truyện.</p>
            </div>
          </div>

          <div className="p-4 bg-teal-50/60 rounded-xl border border-teal-100">
            <div className="min-w-0 space-y-2 text-center sm:text-left">
              <div>
                <p className="text-[10px] font-semibold text-teal-600 uppercase tracking-widest">Dịch truyện AI</p>
                <p className="text-base font-bold text-teal-950 uppercase tracking-tight">ĐỖ XUÂN QUYẾT</p>
              </div>
              <div className="space-y-1 pt-2 border-t border-teal-100">
                <p className="text-xs text-teal-900/65">Liên hệ để nhận link cập nhật và tham gia góp ý tính năng.</p>
                <p className="text-xs text-teal-900/70">Telegram: <a href="https://t.me/truyendichlinhdi" target="_blank" rel="noopener noreferrer" className="text-teal-600 hover:text-teal-700 hover:underline font-semibold">t.me/truyendichlinhdi</a></p>
                <p className="text-xs text-teal-900/70">Nhóm trao đổi: <span className="text-teal-700/40">đang cập nhật</span></p>
              </div>
            </div>
          </div>
        </div>
        </div>

        <div className="text-center flex items-center justify-center gap-1.5 text-[11px] text-teal-700/40">
          Làm với <Heart className="w-3 h-3 fill-rose-400 text-rose-400" /> cho cộng đồng dịch truyện Việt
        </div>

      </div>
    </div>
  );
};
