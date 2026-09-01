
import React, { useState, useEffect } from 'react';
import { 
    Cpu, RefreshCw, Zap, Clock, Timer, CheckCircle, HelpCircle, 
    Terminal, FileText, Loader2, AlertCircle, Settings,
    Activity, Moon, Sun, ChevronUp, ChevronDown, 
    Scale, HardDrive, Maximize, Minimize,
    Ban, Hourglass, Languages
} from 'lucide-react';
import { ModelQuota, BatchLimits, RatioLimits } from '../types';
import { TIER_MODELS } from '../constants';
import { DEFAULT_RATIO_LIMITS } from '../constants/ratioLimits';

// --- LIVE TIMER COMPONENT (ISOLATED FOR PERFORMANCE) ---
const LiveTimer = ({ startTime, endTime }: { startTime: number, endTime: number | null }) => {
    const [now, setNow] = useState(() => Date.now());

    useEffect(() => {
        if (endTime) return;
        
        // Update every second
        const intervalId = setInterval(() => {
            setNow(Date.now());
        }, 1000);
        return () => clearInterval(intervalId);
    }, [startTime, endTime]);

    const targetTime = endTime || now;
    const diff = Math.max(0, Math.floor((targetTime - startTime) / 1000));
    
    const h = Math.floor(diff / 3600).toString().padStart(2, '0');
    const m = Math.floor((diff % 3600) / 60).toString().padStart(2, '0');
    const s = (diff % 60).toString().padStart(2, '0');

    return (
        <div className="flex items-center gap-1.5 text-primary-600 dark:text-primary-400 font-bold min-w-[60px]">
            <Timer className={`w-3 h-3 ${!endTime ? 'animate-pulse' : ''}`} />
            <span>{h}:{m}:{s}</span>
        </div>
    );
};

const CustomNumberInput = ({ value, onChange, className = "", step = 1, min, max, widthClass = "w-14" }: any) => {
    // FIX (crash "z.toFixed is not a function"): input type="number" của trình duyệt
    // tự "sanitize" các giá trị dở dang không hợp lệ (vd đang gõ "6" rồi bấm "." ra "6.")
    // về chuỗi rỗng '' ngay trong e.target.value, TRƯỚC KHI code kịp xử lý. Giá trị ''
    // đó bị lưu thẳng vào state ratioLimits, và vì '' không phải null/undefined nên toán
    // tử ?? DEFAULT_RATIO_LIMITS không "cứu" được, dẫn tới ''.toFixed() crash ứng dụng.
    // => Chuyển sang input type="text" (inputMode decimal) để giữ lại đúng chuỗi người
    // dùng đang gõ (kể cả trạng thái dở dang như "6." hay "-"), không để trình duyệt
    // âm thầm biến nó thành rỗng.
    const toDisplayStr = (v: any) => (v === '' || v === undefined || v === null || Number.isNaN(v)) ? '' : String(v);
    const [localValue, setLocalValue] = React.useState<string>(toDisplayStr(value));

    // Đồng bộ lại từ prop khi giá trị thay đổi từ bên ngoài (vd bấm nút tăng/giảm,
    // load lại cấu hình...), nhưng không ghi đè khi người dùng đang gõ dở một chuỗi
    // mà về mặt số học là tương đương (vd đang gõ "6." trong khi prop value = 6).
    React.useEffect(() => {
        setLocalValue(prev => {
            const prevNum = parseFloat(prev);
            if (prev !== '' && !Number.isNaN(prevNum) && prevNum === value) return prev;
            return toDisplayStr(value);
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [value]);

    const commit = (raw: string) => {
        if (raw === '' || raw === '-' || raw === '.') {
            onChange('');
            return;
        }
        let val = parseFloat(raw);
        if (Number.isNaN(val)) return; // Giá trị chưa hợp lệ (đang gõ dở) -> chưa đẩy lên state cha
        if (max !== undefined && val > max) val = max;
        if (min !== undefined && val < min) val = min;
        onChange(val);
    };

    const handleIncrement = () => {
        const val = parseFloat(localValue);
        const base = Number.isNaN(val) ? (parseFloat(value) || 0) : val;
        let next = base + step;
        if (max !== undefined && next > max) next = max;
        setLocalValue(String(next));
        onChange(next);
    };
    const handleDecrement = () => {
        const val = parseFloat(localValue);
        const base = Number.isNaN(val) ? (parseFloat(value) || 0) : val;
        let next = base - step;
        if (min !== undefined && next < min) next = min;
        setLocalValue(String(next));
        onChange(next);
    };

    const handleChange = (e: any) => {
        const raw = e.target.value;
        // Chỉ chấp nhận ký tự hợp lệ của một số thập phân đang gõ dở: số, tối đa 1 dấu
        // chấm, tối đa 1 dấu trừ ở đầu. Ký tự khác (chữ, dấu chấm thứ 2...) bị bỏ qua,
        // giữ nguyên nội dung ô nhập trước đó thay vì để crash phía sau.
        if (!/^-?\d*\.?\d*$/.test(raw)) return;
        setLocalValue(raw);
        commit(raw);
    };

    return (
        <div className={`relative flex items-center ${widthClass}`}>
            <input 
                type="text" 
                inputMode="decimal"
                className={`config-input w-full pr-3.5 ${className}`} 
                value={localValue} 
                onChange={handleChange} 
            />
            <div className="absolute right-0 top-0 bottom-0 flex flex-col border-l border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 rounded-r overflow-hidden w-3.5 opacity-80 hover:opacity-100">
                <button onClick={handleIncrement} className="flex-1 flex items-center justify-center text-[7px] text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-600 leading-none">▲</button>
                <div className="h-px w-full bg-slate-200 dark:bg-slate-700"></div>
                <button onClick={handleDecrement} className="flex-1 flex items-center justify-center text-[7px] text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-600 leading-none">▼</button>
            </div>
        </div>
    );
};

interface HeaderProps {
    stats: any;
    showLogs: boolean;
    setShowLogs: (v: boolean) => void;
    showSettings: boolean;
    setShowSettings: (v: boolean) => void;
    onShowChangelog: () => void;
    onShowIntro: () => void;
    enabledModels: string[];
    modelConfigs: ModelQuota[];
    modelUsages: any;
    toggleModel: (id: string) => void;
    handleManualResetQuota: () => void;
    handleTestModel: (id: string) => void;
    testingModelId: string | null;
    startTime: number | null;
    endTime: number | null;
    hasLogErrors: boolean;
    progressPercentage?: number; 
    batchLimits: BatchLimits;
    setBatchLimits: React.Dispatch<React.SetStateAction<BatchLimits>>;
    ratioLimits: RatioLimits; // Added Ratio Limits
    setRatioLimits: React.Dispatch<React.SetStateAction<RatioLimits>>; // Added Ratio Limits Setter
    concurrency: number | 'auto';
    setConcurrency: React.Dispatch<React.SetStateAction<number | 'auto'>>;
    isDarkMode?: boolean;
    toggleDarkMode?: () => void;
    onShowComicToNovel?: () => void;
}

export const Header: React.FC<HeaderProps> = (props) => {
    const [now, setNow] = useState(() => Date.now());
    const [isExpanded, setIsExpanded] = useState(false);
    const [isAdvancedOpen, setIsAdvancedOpen] = useState(false);
    const [isFullscreen, setIsFullscreen] = useState(false);
    const [estimatedTimeRemaining, setEstimatedTimeRemaining] = useState<string | null>(null);

    useEffect(() => {
        if (props.startTime && !props.endTime && props.progressPercentage && props.progressPercentage > 0 && props.progressPercentage < 100) {
            const interval = setInterval(() => {
                const elapsed = Date.now() - props.startTime!;
                const rate = props.progressPercentage! / elapsed; // percentage per ms
                const remainingPercentage = 100 - props.progressPercentage!;
                const remainingMs = remainingPercentage / rate;
                
                if (remainingMs > 0 && isFinite(remainingMs)) {
                    const seconds = Math.floor((remainingMs / 1000) % 60);
                    const minutes = Math.floor((remainingMs / (1000 * 60)) % 60);
                    const hours = Math.floor((remainingMs / (1000 * 60 * 60)));
                    setEstimatedTimeRemaining(`${hours > 0 ? hours + 'h ' : ''}${minutes}m ${seconds}s`);
                }
            }, 1000);
            return () => clearInterval(interval);
        } else {
            setTimeout(() => setEstimatedTimeRemaining(null), 0);
        }
    }, [props.startTime, props.endTime, props.progressPercentage]);

    useEffect(() => {
        const interval = setInterval(() => setNow(Date.now()), 1000);
        const handleFullscreenChange = () => setIsFullscreen(!!document.fullscreenElement);
        document.addEventListener('fullscreenchange', handleFullscreenChange);
        return () => {
            clearInterval(interval);
            document.removeEventListener('fullscreenchange', handleFullscreenChange);
        };
    }, []);

    const toggleFullScreen = () => {
        if (!document.fullscreenElement) {
            document.documentElement.requestFullscreen().catch((err) => console.error(err));
        } else {
            if (document.exitFullscreen) document.exitFullscreen();
        }
    };

    const formatNumber = (num: number) => new Intl.NumberFormat('vi-VN').format(num);
    const proModels = props.modelConfigs.filter(m => TIER_MODELS.PRO_POOL.includes(m.id));
    const flashModels = props.modelConfigs.filter(m => TIER_MODELS.FLASH_POOL.includes(m.id));
    
    const renderModelBadge = (config: ModelQuota) => {
        const isEnabled = props.enabledModels.includes(config.id);
        const usage = props.modelUsages[config.id] || { requestsToday: 0, recentRequests: [], isDepleted: false, cooldownUntil: 0 };
        const requestsToday = usage.requestsToday || 0;
        const recentReqs = usage.recentRequests || [];
        const currentRpmCount = recentReqs.filter((t: number) => now - t < 60000).length;
        const isRpmFull = currentRpmCount >= config.rpmLimit;
        const isDepleted = usage.isDepleted;
        
        // Calculate Wait Time
        const cooldownRemaining = Math.max(0, (usage.cooldownUntil || 0) - now);
        const isCoolingDown = cooldownRemaining > 0;
        const rpdPct = Math.min(100, Math.round((requestsToday / Math.max(1, config.rpdLimit)) * 100));

        // UPDATED v1.0.2: Vẽ lại hoàn toàn — bỏ kiểu "khung viền đổi màu toàn khối" của bản gốc,
        // thay bằng 1 vạch màu trạng thái mảnh bên trái (giống thẻ trạng thái server/uptime) +
        // thanh tiến trình mini thể hiện % dùng RPD trực quan thay vì chỉ hiện số khô khan.
        const stateColor = isDepleted ? 'bg-rose-500' : isCoolingDown ? 'bg-amber-500' : isEnabled ? 'bg-primary-500' : 'bg-slate-300 dark:bg-slate-700';

        return (
            <div key={config.id} className={`relative flex items-stretch gap-0 rounded-md overflow-hidden transition-all duration-200 ease-smooth whitespace-nowrap shadow-elevation-1 min-w-[148px] bg-white dark:bg-slate-800
                ${isEnabled && !isDepleted ? 'hover:shadow-elevation-2 hover:-translate-y-px' : 'opacity-70'}`}>
                <div className={`w-1 shrink-0 ${stateColor}`} />
                <div className="flex items-center gap-2 px-2.5 py-1.5 w-full">
                    {isDepleted ? <Ban className="w-3.5 h-3.5 text-rose-500 shrink-0" /> : (
                        <button
                            onClick={() => props.toggleModel(config.id)}
                            aria-label={isEnabled ? 'Tắt model' : 'Bật model'}
                            className={`w-3.5 h-3.5 rounded-sm border shrink-0 flex items-center justify-center transition-colors ${isEnabled ? 'bg-primary-500 border-primary-500' : 'border-slate-300 dark:border-slate-600'}`}
                        >
                            {isEnabled && <CheckCircle className="w-2.5 h-2.5 text-white" strokeWidth={3} />}
                        </button>
                    )}

                    <div className="flex flex-col w-full">
                        <div className="flex items-center justify-between gap-2">
                            <span className={`text-[11px] font-display font-semibold ${isDepleted ? 'text-rose-600 dark:text-rose-400' : 'text-slate-800 dark:text-slate-200'}`} title={config.name}>
                                {config.name.replace('Gemini ', '')}
                            </span>
                            {isDepleted ? (
                                <span className="text-[8px] font-black text-rose-500 leading-tight shrink-0">HẾT</span>
                            ) : (
                                <button aria-label="Test tốc độ" onClick={() => props.handleTestModel(config.id)} disabled={!!props.testingModelId} className="p-0.5 hover:bg-slate-100 dark:hover:bg-slate-700 rounded text-slate-400 hover:text-primary-600 transition-colors shrink-0">
                                    {props.testingModelId === config.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Zap className="w-3 h-3" />}
                                </button>
                            )}
                        </div>

                        {/* Logic hiển thị Stats (Vẫn hiện khi Hết RPD) */}
                        {isCoolingDown && !isDepleted ? (
                            <div className="text-[10px] font-bold text-amber-600 dark:text-amber-500 flex items-center gap-1 animate-pulse mt-0.5">
                                <Hourglass className="w-2.5 h-2.5" /> Chờ {(cooldownRemaining/1000).toFixed(0)}s
                            </div>
                        ) : (
                            <>
                                <div className="flex items-center justify-between text-[10px] font-mono text-slate-500 dark:text-slate-400 mt-0.5">
                                    <span className={isDepleted ? "text-rose-600 dark:text-rose-400 font-bold" : ""}>
                                        {requestsToday}/{config.rpdLimit}
                                    </span>
                                    <span className={`font-bold ${isDepleted ? "text-rose-400" : isRpmFull ? "text-amber-600 animate-pulse" : "text-primary-600"}`}>
                                        {currentRpmCount}/{config.rpmLimit} RPM
                                    </span>
                                </div>
                                {/* Thanh tiến trình mini — thay cho việc chỉ hiện số suông */}
                                <div className="w-full h-[3px] bg-slate-100 dark:bg-slate-700 rounded-full mt-1 overflow-hidden">
                                    <div className={`h-full rounded-full transition-all ${isDepleted ? 'bg-rose-400' : 'bg-primary-400'}`} style={{ width: `${isDepleted ? 100 : rpdPct}%` }} />
                                </div>
                            </>
                        )}
                    </div>
                </div>
            </div>
        );
    };

    return (
        <header className="bg-white/90 dark:bg-slate-900/90 backdrop-blur-md border-b border-slate-200 dark:border-slate-800 shrink-0 shadow-elevation-1 flex flex-col transition-colors duration-300 relative z-40">
            {/* Top Bar */}
            <div className="px-3 py-1.5 flex items-center justify-between border-b border-slate-100 dark:border-slate-800">
                <div className="flex items-center gap-2">
                    {/* UPDATED v1.0.2: logomark riêng (icon Languages, viền tròn đơn sắc teal thay vì
                        vuông bo góc gradient tím-teal của bản gốc) — dấu hiệu nhận diện nhất quán
                        với huy hiệu ở IntroPage, không còn icon Cpu (chip máy tính) chung chung. */}
                    <div className="w-6 h-6 rounded-full bg-primary-600 flex items-center justify-center text-white shrink-0"><Languages className="w-3.5 h-3.5" /></div>
                    <div>
                        <h1 className="text-sm font-display font-extrabold text-slate-800 dark:text-slate-100 leading-none tracking-tight">Dịch truyện AI <span className="text-primary-500 font-semibold">· v1.0.6</span></h1>
                    </div>
                    <button onClick={props.onShowIntro} className="px-2 py-0.5 ml-2 text-[10px] font-bold bg-amber-100/50 dark:bg-amber-900/30 text-amber-600 dark:text-amber-500 rounded-full border border-amber-200/50 dark:border-amber-800/50 hover:bg-amber-100 dark:hover:bg-amber-900/50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 focus-visible:ring-offset-1">Về tác giả</button>
                    <button aria-label="Hướng dẫn sử dụng" onClick={props.onShowChangelog} className="text-slate-400 hover:text-primary-600 dark:hover:text-primary-400 transition-colors rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 focus-visible:ring-offset-1"><HelpCircle className="w-3.5 h-3.5" /></button>
                </div>
                
                <div className="flex items-center gap-1 relative z-50">
                    {props.startTime && (
                        <div className="hidden md:flex items-center gap-2 px-2 py-1 bg-slate-50 dark:bg-slate-800 rounded-full border border-slate-200 dark:border-slate-700 text-[10px] font-mono font-medium text-slate-600 dark:text-slate-300 shadow-sm">
                            <Clock className="w-3 h-3 text-primary-500" />
                            <LiveTimer startTime={props.startTime} endTime={props.endTime} />
                        </div>
                    )}
                    
                    <button aria-label="Chuyển đổi giao diện" onClick={props.toggleDarkMode} className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-amber-500 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 focus-visible:ring-offset-1">
                        {props.isDarkMode ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
                    </button>

                    <button aria-label="Toàn màn hình" onClick={toggleFullScreen} className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-primary-500 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 focus-visible:ring-offset-1">
                        {isFullscreen ? <Minimize className="w-3.5 h-3.5" /> : <Maximize className="w-3.5 h-3.5" />}
                    </button>

                    <button aria-label="Cài đặt API" onClick={() => props.setShowSettings(true)} className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-primary-500 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 focus-visible:ring-offset-1">
                        <Settings className="w-3.5 h-3.5" />
                    </button>

                    <button aria-label="Xem Nhật ký (Logs)" onClick={() => props.setShowLogs(true)} className={`relative p-1.5 rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 focus-visible:ring-offset-1 ${props.showLogs ? 'bg-primary-50 dark:bg-primary-900/30 text-primary-600' : 'hover:bg-slate-100 text-slate-400'}`}>
                        <Terminal className="w-3.5 h-3.5" />
                        {props.hasLogErrors && <span className="absolute top-1 right-1 w-1.5 h-1.5 bg-danger-500 rounded-full animate-ping" />}
                    </button>

                    <button aria-label="Thu gọn/Mở rộng Header" onClick={() => setIsExpanded(!isExpanded)} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 focus-visible:ring-offset-1">
                        {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                    </button>
                </div>
            </div>

            {/* Expandable Area */}
            <div className={`overflow-hidden transition-all duration-300 ease-in-out ${isExpanded ? 'max-h-[500px] opacity-100' : 'max-h-0 opacity-0'}`}>
                {/* Models & Stats */}
                <div className="px-3 py-2 overflow-x-auto no-scrollbar flex items-center gap-3">
                    <div className="flex items-center gap-2 shrink-0">
                        {proModels.map(renderModelBadge)}
                        <div className="w-px h-6 bg-slate-200 dark:bg-slate-700 shrink-0 mx-1"></div>
                        {flashModels.map(renderModelBadge)}
                    </div>
                    <div className="w-px h-6 bg-slate-200 dark:bg-slate-700 shrink-0 mx-1"></div>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1 shrink-0 text-[10px] bg-slate-50 dark:bg-slate-800 px-3 py-1.5 rounded border border-slate-100 dark:border-slate-700">
                        <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-1.5 text-slate-500 dark:text-slate-400">
                                <FileText className="w-3 h-3" />
                                <span>Tổng:</span>
                            </div>
                            <span className="font-bold text-slate-700 dark:text-slate-200">{formatNumber(props.stats.total)}</span>
                        </div>
                        <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-1.5 text-primary-500 dark:text-primary-400">
                                <Activity className="w-3 h-3" />
                                <span>Xử lý:</span>
                            </div>
                            <span className="font-bold text-primary-700 dark:text-primary-300">{formatNumber(props.stats.processing)}</span>
                        </div>
                        <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-1.5 text-emerald-500 dark:text-emerald-400">
                                <CheckCircle className="w-3 h-3" />
                                <span>Xong:</span>
                            </div>
                            <span className="font-bold text-emerald-700 dark:text-emerald-300">{formatNumber(props.stats.completed)}</span>
                        </div>
                        <div className="flex items-center justify-between gap-2" title="Tệp lỗi / Tệp đang chờ">
                            <div className="flex items-center gap-1.5 text-rose-500 dark:text-rose-400">
                                <AlertCircle className="w-3 h-3" />
                                <span>Lỗi/Chờ:</span>
                            </div>
                            <span className="font-bold text-rose-700 dark:text-rose-300">{props.stats.failed}/{props.stats.pending}</span>
                        </div>
                    </div>
                    <div className="w-px h-6 bg-slate-200 dark:bg-slate-700 shrink-0 mx-1"></div>
                    <button onClick={props.handleManualResetQuota} className="px-2 py-1.5 text-[10px] font-bold text-slate-500 bg-white border border-slate-200 rounded-lg hover:text-primary-600 flex items-center gap-1 whitespace-nowrap shadow-elevation-1 shrink-0 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 focus-visible:ring-offset-1">
                        <RefreshCw className="w-3 h-3" /> Reset Quota
                    </button>
                </div>

                {/* Advanced Settings Toggle — gộp Batch/Ratio thành khu thu gọn, mặc định
                    đóng, để hàng model phía trên nhẹ nhàng hơn khi mới mở app; ai cần chỉnh
                    thông số kỹ thuật thì bấm mở ra. */}
                <button
                    onClick={() => setIsAdvancedOpen(!isAdvancedOpen)}
                    className="w-full flex items-center justify-center gap-1.5 py-1 border-t border-slate-100 dark:border-slate-800 text-[10px] font-bold text-slate-400 dark:text-slate-500 hover:text-primary-600 dark:hover:text-primary-400 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors duration-200 ease-smooth focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 focus-visible:ring-inset"
                >
                    <Scale className="w-3 h-3" /> Cài Đặt Nâng Cao (Batch / Ratio Control)
                    {isAdvancedOpen ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                </button>

                {/* Config Bar */}
                <div className={`overflow-hidden transition-all duration-300 ease-in-out ${isAdvancedOpen ? 'max-h-[200px] opacity-100' : 'max-h-0 opacity-0'}`}>
                <div className="border-t border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50 px-3 py-1.5 text-[10px]">
                    <div className="flex items-center gap-4 overflow-x-auto no-scrollbar whitespace-nowrap">
                        {/* Batch */}
                        <div className="flex items-center gap-2 shrink-0">
                            <div className="flex items-center gap-1 font-bold text-slate-500 uppercase tracking-wider"><HardDrive className="w-3 h-3" /> Batch</div>
                            
                            {/* Concurrency Config */}
                            <div className="flex items-center gap-1 pl-2 border-l border-slate-200 dark:border-slate-700">
                                <span className="font-bold text-teal-600 text-[10px]">Luồng</span>
                                <div className="flex items-center gap-1">
                                    <select 
                                        className="config-input text-teal-600 font-bold py-1 px-2 text-xs"
                                        value={props.concurrency === 'auto' ? 'auto' : 'manual'}
                                        onChange={(e) => props.setConcurrency(e.target.value === 'auto' ? 'auto' : 3)}
                                    >
                                        <option value="auto">Auto</option>
                                        <option value="manual">Tùy chỉnh</option>
                                    </select>
                                    {props.concurrency !== 'auto' && (
                                        <CustomNumberInput widthClass="w-14" className="text-teal-600 font-bold" value={props.concurrency ?? ''} onChange={(val: any) => props.setConcurrency(val === '' ? 1 : val)} />
                                    )}
                                </div>
                            </div>

                            {/* Batch Limits Config */}
                            <div className="flex flex-col gap-1.5 pl-3 border-l border-slate-200 dark:border-slate-700">
                                <div className="flex items-center gap-3">
                                    <span className="font-bold text-slate-500 dark:text-slate-400 text-[10px] uppercase tracking-wider">Số kí tự tối đa:</span>
                                    <div className="flex items-center gap-1.5">
                                        <span className="text-[10px] text-primary-600 font-medium uppercase">Latin:</span>
                                        <CustomNumberInput widthClass="w-16" value={props.batchLimits.latin.maxTotalChars ?? ''} onChange={(val: any) => props.setBatchLimits(prev => ({...prev, latin: {...prev.latin, maxTotalChars: val === '' ? 0 : val}}))} />
                                    </div>
                                    <div className="flex items-center gap-1.5">
                                        <span className="text-[10px] text-amber-600 font-medium uppercase">Raw:</span>
                                        <CustomNumberInput widthClass="w-16" value={props.batchLimits.complex.maxTotalChars ?? ''} onChange={(val: any) => props.setBatchLimits(prev => ({...prev, complex: {...prev.complex, maxTotalChars: val === '' ? 0 : val}}))} />
                                    </div>
                                </div>
                                <div className="flex items-center gap-3">
                                    <span className="font-bold text-slate-500 dark:text-slate-400 text-[10px] uppercase tracking-wider">Số tệp tối đa:</span>
                                    <div className="flex items-center gap-1.5 pl-2">
                                        <span className="text-[10px] text-purple-600 font-medium uppercase">Pro:</span>
                                        <CustomNumberInput widthClass="w-12" value={props.batchLimits.latin.v31 ?? ''} onChange={(val: any) => { const num = val === '' ? 0 : val; props.setBatchLimits(prev => ({ ...prev, latin: { ...prev.latin, v31: num }, complex: { ...prev.complex, v31: num } })) }} />
                                    </div>
                                    <div className="flex items-center gap-1.5">
                                        <span className="text-[10px] text-teal-600 font-medium uppercase">Flash/Lite:</span>
                                        <CustomNumberInput widthClass="w-12" value={props.batchLimits.latin.v36 ?? ''} onChange={(val: any) => { const num = val === '' ? 0 : val; props.setBatchLimits(prev => ({ ...prev, latin: { ...prev.latin, v36: num, v35: num, v3: num, v25: num }, complex: { ...prev.complex, v36: num, v35: num, v3: num, v25: num } })) }} />
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div className="w-px h-8 bg-slate-300 dark:bg-slate-700 shrink-0 mx-1"></div>

                        {/* Ratio Config */}
                        <div className="flex items-center gap-3 shrink-0">
                            <div className="flex items-center gap-1 font-bold text-slate-500 uppercase tracking-wider"><Scale className="w-3 h-3" /> Ratio Control</div>
                            
                            <div className="flex items-center gap-3 pl-2 border-l border-slate-200 dark:border-slate-700">
                                <div className="flex flex-col items-center gap-0.5">
                                    <span className="text-[8px] font-bold text-primary-600">VN/Convert</span>
                                    <div className="flex items-center gap-0.5">
                                        <CustomNumberInput step={0.1} widthClass="w-14" className="text-primary-600" value={props.ratioLimits.vn?.min ?? DEFAULT_RATIO_LIMITS.vn.min} onChange={(val: any) => props.setRatioLimits(prev => ({...prev, vn: {...prev.vn, min: val}}))} />
                                        <span className="text-slate-300">-</span>
                                        <CustomNumberInput step={0.1} widthClass="w-14" className="text-primary-600" value={props.ratioLimits.vn?.max ?? DEFAULT_RATIO_LIMITS.vn.max} onChange={(val: any) => props.setRatioLimits(prev => ({...prev, vn: {...prev.vn, max: val}}))} />
                                    </div>
                                </div>
                                <div className="flex flex-col items-center gap-0.5">
                                    <span className="text-[8px] font-bold text-primary-600">EN/Western</span>
                                    <div className="flex items-center gap-0.5">
                                        <CustomNumberInput step={0.1} widthClass="w-14" className="text-primary-600" value={props.ratioLimits.en?.min ?? DEFAULT_RATIO_LIMITS.en.min} onChange={(val: any) => props.setRatioLimits(prev => ({...prev, en: {...prev.en, min: val}}))} />
                                        <span className="text-slate-300">-</span>
                                        <CustomNumberInput step={0.1} widthClass="w-14" className="text-primary-600" value={props.ratioLimits.en?.max ?? DEFAULT_RATIO_LIMITS.en.max} onChange={(val: any) => props.setRatioLimits(prev => ({...prev, en: {...prev.en, max: val}}))} />
                                    </div>
                                </div>
                                <div className="flex flex-col items-center gap-0.5">
                                    <span className="text-[8px] font-bold text-fuchsia-600">KR/JP</span>
                                    <div className="flex items-center gap-0.5">
                                        <CustomNumberInput step={0.1} widthClass="w-14" className="text-fuchsia-600" value={props.ratioLimits.krjp?.min ?? DEFAULT_RATIO_LIMITS.krjp.min} onChange={(val: any) => props.setRatioLimits(prev => ({...prev, krjp: {...prev.krjp, min: val}}))} />
                                        <span className="text-slate-300">-</span>
                                        <CustomNumberInput step={0.1} widthClass="w-14" className="text-fuchsia-600" value={props.ratioLimits.krjp?.max ?? DEFAULT_RATIO_LIMITS.krjp.max} onChange={(val: any) => props.setRatioLimits(prev => ({...prev, krjp: {...prev.krjp, max: val}}))} />
                                    </div>
                                </div>
                                <div className="flex flex-col items-center gap-0.5">
                                    <span className="text-[8px] font-bold text-amber-600">Trung (CN)</span>
                                    <div className="flex items-center gap-0.5">
                                        <CustomNumberInput step={0.1} widthClass="w-14" className="text-amber-600" value={props.ratioLimits.cn?.min ?? DEFAULT_RATIO_LIMITS.cn.min} onChange={(val: any) => props.setRatioLimits(prev => ({...prev, cn: {...prev.cn, min: val}}))} />
                                        <span className="text-slate-300">-</span>
                                        <CustomNumberInput step={0.1} widthClass="w-14" className="text-amber-600" value={props.ratioLimits.cn?.max ?? DEFAULT_RATIO_LIMITS.cn.max} onChange={(val: any) => props.setRatioLimits(prev => ({...prev, cn: {...prev.cn, max: val}}))} />
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
                </div>
            </div>

            {/* Global Progress Bar */}
             <div className="w-full h-0.5 bg-slate-100 dark:bg-slate-800 relative group">
                 <div className="h-full bg-gradient-to-r from-primary-400 via-primary-500 to-primary-600 transition-all duration-300 ease-out" style={{ width: `${props.progressPercentage || 0}%` }} />
                 {estimatedTimeRemaining && (
                    <div className="absolute bottom-full right-0 mb-1 bg-slate-800 text-white text-[10px] px-2 py-1 rounded shadow-lg opacity-0 group-hover:opacity-100 transition-opacity font-mono whitespace-nowrap z-50 pointer-events-none">
                        ETA: {estimatedTimeRemaining}
                    </div>
                 )}
            </div>

            <style>{`
                .config-input {
                    @apply px-1 py-0.5 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-center font-mono font-bold text-slate-700 dark:text-slate-200 focus:ring-1 focus:ring-primary-300 outline-none text-[10px];
                    -moz-appearance: textfield;
                }
                /* Hide native spinners completely */
                .config-input::-webkit-inner-spin-button, 
                .config-input::-webkit-outer-spin-button { 
                    -webkit-appearance: none !important;
                    margin: 0 !important;
                }
            `}</style>
        </header>
    );
};
