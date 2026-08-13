import React, { useState, useEffect } from 'react';
import { Coffee, ArrowRight } from 'lucide-react';
import { ACCESS_CONFIG } from '../constants';

export const IntroPage: React.FC<{ onEnter: () => void }> = ({ onEnter }) => {
  // Khởi tạo error ngay từ đầu nếu đã hết hạn — quan trọng cho trường hợp App.tsx
  // "đá" người dùng về lại trang này giữa chừng do hết hạn (xem checkExpiry trong App.tsx):
  // màn hình phải hiện thông báo hết hạn NGAY LẬP TỨC, không cần chờ họ bấm "Vào Ứng Dụng" mới biết.
  const [error, setError] = useState(() =>
    (ACCESS_CONFIG.EXPIRY_TS && Date.now() > ACCESS_CONFIG.EXPIRY_TS) ? 'expired' : ''
  );

  // Phòng trường hợp trang Intro này được mount từ trước (hiếm khi xảy ra) rồi mới tới giờ hết hạn
  // trong lúc người dùng đang đứng nhìn màn hình Intro (chưa bấm Enter) — tự cập nhật thông báo.
  useEffect(() => {
    if (ACCESS_CONFIG.EXPIRY_TS && Date.now() > ACCESS_CONFIG.EXPIRY_TS && error !== 'expired') {
      setError('expired');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleEnter = () => {
    if (ACCESS_CONFIG.EXPIRY_TS && Date.now() > ACCESS_CONFIG.EXPIRY_TS) {
      setError('expired');
      return;
    }
    onEnter();
  };

  return (
    <div className="min-h-[100dvh] w-full bg-gradient-to-br from-slate-950 via-slate-900 to-cyan-950 text-slate-200 flex flex-col items-center justify-start pt-12 pb-12 p-4 sm:p-8 font-sans selection:bg-cyan-500/30 overflow-y-auto">
      <div className="max-w-2xl w-full grid gap-8 animate-in fade-in slide-in-from-bottom-8 duration-700 pb-8">
        
        {/* Header */}
        <div className="text-center space-y-3">
          <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-white">
            Dịch truyện AI - v1.0.1
          </h1>
          <p className="text-zinc-400 max-w-lg mx-auto">
            Công cụ dịch truyện chuyên nghiệp bằng AI.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-2 mt-4 text-zinc-400 font-medium">
            <span className="text-xs sm:text-sm bg-zinc-800/50 px-3 py-1.5 rounded-full border border-zinc-800">Công cụ được thiết kế bởi AI</span>
            <span className="text-xs sm:text-sm bg-zinc-800/50 px-3 py-1.5 rounded-full border border-zinc-800">Ý tưởng: Đỗ Xuân Quyết</span>
          </div>
        </div>

        {/* Access Control Card */}
        <div className="bg-slate-900/70 backdrop-blur-sm border border-cyan-900/40 rounded-3xl p-6 sm:p-8 shadow-2xl shadow-black/50">
          <div className="w-full flex flex-col items-center justify-center gap-5">
            {/* Security Code Input (Hidden if inside App) */}
            {/* Enter Button */}
            <button 
              onClick={handleEnter}
              className="w-full group relative flex items-center justify-center gap-3 px-8 py-4 bg-white text-zinc-950 hover:bg-zinc-100 rounded-xl font-bold text-lg transition-all hover:scale-[1.02] hover:shadow-[0_0_40px_-10px_rgba(255,255,255,0.5)] active:scale-[0.98] shrink-0"
            >
              Bắt đầu
              <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
            </button>
            
            {/* Error Message */}
            {error === 'expired' && (
              <div className="text-sm font-medium animate-in fade-in bg-rose-500/10 border border-rose-500/20 p-4 rounded-xl text-center w-full space-y-2 text-zinc-300">
                <p className="text-rose-400 font-bold mb-3">Phiên bản hiện tại đã hết hạn sử dụng.</p>
                <p>Vui lòng liên hệ:</p>
                <div className="space-y-1">
                  <p>Telegram cá nhân: <a href="https://t.me/truyendichlinhdi" target="_blank" rel="noopener noreferrer" className="text-emerald-400 hover:text-emerald-300 hover:underline">t.me/truyendichlinhdi</a></p>
                  <p>Hoặc Nhóm trao đổi: <span className="text-zinc-500">đang cập nhật</span></p>
                </div>
              </div>
            )}
            {error && error !== 'expired' && (
              <p className="text-red-400 text-sm font-medium animate-in fade-in">
                {error}
              </p>
            )}
          </div>
        </div>

        {/* Donate Card */}
        <div className="bg-slate-900/70 backdrop-blur-sm border border-cyan-900/40 rounded-3xl p-6 sm:p-8 space-y-6 shadow-2xl shadow-black/50">
          <div className="flex flex-col items-center text-center space-y-2">
            {/* Coffee Icon */}
            <div className="w-14 h-14 shrink-0 bg-amber-500/10 rounded-2xl flex items-center justify-center border border-amber-500/20 mb-2">
              <Coffee className="w-7 h-7 text-amber-500" />
            </div>

            <h3 className="text-xl font-semibold text-zinc-100 pt-2">
              Donate (Ủng hộ tác giả)
            </h3>
            <p className="text-sm text-zinc-400 leading-relaxed max-w-sm">
              Nếu bạn thấy bộ công cụ này hữu ích, hãy mời mình một cốc cà phê để mình có thêm động lực duy trì và phát triển nhé. Cảm ơn tấm lòng của bạn!
            </p>
          </div>
          
          <div className="flex flex-col items-center gap-6 py-6 bg-slate-950/50 rounded-2xl border border-cyan-900/30 shadow-inner">
            <div className="text-center space-y-1.5">
              <p className="text-xs font-semibold text-cyan-500/80 uppercase tracking-widest">Ngân Hàng Quân Đội (MB Bank)</p>
              <p className="text-lg font-bold text-zinc-100 uppercase tracking-tight">DO XUAN QUYET</p>
            </div>

            <div className="bg-white p-4 rounded-3xl shadow-2xl shadow-emerald-500/10 transform transition hover:scale-[1.02] duration-300">
              <div className="relative group">
                <img 
                  src="/donate-qr.jpg" 
                  alt="MB Bank QR Donate" 
                  className="w-56 h-56 object-contain rounded-xl"
                />
                <div className="absolute inset-0 border-4 border-white rounded-xl pointer-events-none"></div>
              </div>
            </div>
            
            <p className="text-xs text-zinc-600 font-medium tracking-widest">QUÉT MÃ ĐỂ CHUYỂN KHOẢN</p>
            
            {/* Telegram Contact Info */}
            <div className="flex flex-col items-center text-center space-y-1.5 pt-4 border-t border-zinc-800 w-full px-4">
              <p className="text-sm text-zinc-300">
                Inb liên hệ và donate để nhận link cập nhật tính năng và model mới nhất đồng thời tham gia góp ý về tính năng của app.
              </p>
              <p className="text-sm text-zinc-400 mt-1">Vui lòng liên hệ:</p>
              <div className="space-y-1">
                <p className="text-sm text-zinc-300">Telegram cá nhân: <a href="https://t.me/truyendichlinhdi" target="_blank" rel="noopener noreferrer" className="text-emerald-400 hover:text-emerald-300 hover:underline">t.me/truyendichlinhdi</a></p>
                <p className="text-sm text-zinc-300">Nhóm trao đổi: <span className="text-zinc-500">đang cập nhật</span></p>
              </div>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
};
