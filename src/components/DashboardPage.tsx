import React from 'react';
import { Archive, ArchiveRestore, BookOpen, Check, ImageIcon, RefreshCw, Sparkles, Tags, Trash2, Upload, Wand2 } from 'lucide-react';
import { StoryInfo } from '../types';
import { TagInput } from './modals';
import { AVAILABLE_FLOWS, AVAILABLE_GENRES, AVAILABLE_LANGUAGES, AVAILABLE_PERSONALITIES, AVAILABLE_SETTINGS } from '../constants';

interface DashboardPageProps {
    storyInfo: StoryInfo; setStoryInfo: React.Dispatch<React.SetStateAction<StoryInfo>>;
    coverPreviewUrl: string | null; handleCoverUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
    handleAutoAnalyze: () => void; isAutoAnalyzing: boolean; autoAnalyzeStatus: string;
    quickInput: string; setQuickInput: (v: string) => void; handleQuickParse: () => void;
    handleBackup: () => void; handleRestore: (e: React.ChangeEvent<HTMLInputElement>) => Promise<boolean> | void;
    requestResetApp: () => void; handleResetQuota: () => void; setShowGuide: (v: boolean) => void; handleRefineSummary: () => void;
}

const Panel = ({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) => (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="mb-4 flex items-center gap-2 border-b border-slate-100 pb-3 text-sm font-extrabold uppercase tracking-tight text-slate-800 dark:border-slate-800 dark:text-slate-100">
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600 dark:bg-emerald-950/50 dark:text-emerald-400">{icon}</span>{title}
        </div>{children}
    </section>
);

const Toggle = ({ checked, onChange, title, note }: { checked: boolean; onChange: (v: boolean) => void; title: string; note: string }) => (
    <label className="flex cursor-pointer items-start gap-3 rounded-xl p-2 hover:bg-slate-50 dark:hover:bg-slate-800/60">
        <input type="checkbox" className="peer sr-only" checked={checked} onChange={e => onChange(e.target.checked)} />
        <span className="mt-0.5 h-5 w-9 shrink-0 rounded-full bg-slate-300 p-0.5 transition peer-checked:bg-emerald-500"><span className="block h-4 w-4 rounded-full bg-white shadow transition peer-checked:translate-x-4" /></span>
        <span><strong className="block text-xs text-slate-700 dark:text-slate-200">{title}</strong><small className="mt-0.5 block text-[10px] leading-4 text-slate-500">{note}</small></span>
    </label>
);

export const DashboardPage: React.FC<DashboardPageProps> = props => {
    const update = (patch: Partial<StoryInfo>) => props.setStoryInfo({ ...props.storyInfo, ...patch });
    const field = "w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none transition focus:border-emerald-400 focus:bg-white focus:ring-2 focus:ring-emerald-100 dark:border-slate-700 dark:bg-slate-800 dark:focus:bg-slate-900";
    const label = "mb-1.5 block text-[10px] font-bold uppercase tracking-wide text-slate-500";
    return <div className="mx-auto w-full max-w-[1500px] p-3 md:p-4">
        <div className="mb-3 flex items-center justify-between"><div><h2 className="text-lg font-extrabold text-slate-900 dark:text-white">Không gian dự án</h2><p className="text-xs text-slate-500">Thiết lập tác phẩm, phân loại và dữ liệu tại một nơi.</p></div><button onClick={() => props.setShowGuide(true)} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-600 hover:border-emerald-300 hover:text-emerald-600 dark:border-slate-700 dark:bg-slate-900">Hướng dẫn</button></div>
        <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
            <Panel title="1. Thông tin tác phẩm" icon={<BookOpen className="h-4 w-4" />}>
                <div className="grid gap-4 sm:grid-cols-[130px_1fr]">
                    <label className="group relative flex min-h-[205px] cursor-pointer flex-col items-center justify-center overflow-hidden rounded-xl border-2 border-dashed border-slate-200 bg-slate-50 text-center hover:border-emerald-400 dark:border-slate-700 dark:bg-slate-800">
                        {props.coverPreviewUrl ? <img src={props.coverPreviewUrl} alt="Ảnh bìa" className="absolute inset-0 h-full w-full object-cover" /> : <><ImageIcon className="mb-2 h-8 w-8 text-slate-400" /><b className="text-[11px] text-slate-600 dark:text-slate-300">CHỌN ẢNH BÌA</b><span className="mt-1 text-[9px] text-slate-400">PNG, JPG · tối đa 5MB</span></>}
                        <span className="absolute inset-x-2 bottom-2 rounded-lg bg-slate-950/70 py-1.5 text-[10px] font-bold text-white opacity-0 backdrop-blur-sm transition group-hover:opacity-100"><Upload className="mr-1 inline h-3 w-3" />{props.coverPreviewUrl ? 'Đổi ảnh' : 'Tải ảnh lên'}</span><input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={props.handleCoverUpload} />
                    </label>
                    <div className="space-y-3">
                        <div className="grid grid-cols-2 gap-3"><div><label className={label}>Tên truyện *</label><input className={field} value={props.storyInfo.title || ''} onChange={e => update({ title: e.target.value })} placeholder="Nhập tên truyện..." /></div><div><label className={label}>Tác giả</label><input className={field} value={props.storyInfo.author || ''} onChange={e => update({ author: e.target.value })} placeholder="Tên tác giả..." /></div></div>
                        <div><div className="flex items-center justify-between"><label className={label}>Tóm tắt / Review</label><button onClick={props.handleRefineSummary} className="mb-1 text-[10px] font-bold text-emerald-600"><Sparkles className="mr-1 inline h-3 w-3" />Tinh chỉnh {props.storyInfo.contextNotes && <Check className="inline h-3 w-3" />}</button></div><textarea className={`${field} h-[72px] resize-none`} value={props.storyInfo.summary || ''} onChange={e => update({ summary: e.target.value })} placeholder="Nội dung tóm tắt hoặc giới thiệu Ebook..." /></div>
                        <div><label className={label}>Nhập nhanh thẻ / nguồn tham khảo</label><div className="flex gap-2"><input className={field} value={props.quickInput} onChange={e => props.setQuickInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && props.handleQuickParse()} placeholder="VD: Tiên Hiệp, Hệ Thống, Hài Hước..." /><button onClick={props.handleQuickParse} className="rounded-lg border border-emerald-200 px-3 text-emerald-600"><Wand2 className="h-4 w-4" /></button></div></div>
                        <button onClick={props.handleAutoAnalyze} disabled={props.isAutoAnalyzing} className="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-bold text-white shadow-sm hover:bg-emerald-500 disabled:opacity-50"><Sparkles className="mr-1.5 inline h-3.5 w-3.5" />{props.isAutoAnalyzing ? (props.autoAnalyzeStatus || 'Đang phân tích...') : 'Auto phân tích'}</button>
                    </div>
                </div>
            </Panel>
            <Panel title="2. Phân loại chi tiết" icon={<Tags className="h-4 w-4" />}><div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
                <TagInput icon={<Tags className="h-3 w-3" />} label="Ngôn ngữ truyện" options={AVAILABLE_LANGUAGES} selected={props.storyInfo.languages} onChange={v => update({ languages: v })} placeholder="Chọn ngôn ngữ" />
                <TagInput icon={<Tags className="h-3 w-3" />} label="Thể loại" options={AVAILABLE_GENRES} selected={props.storyInfo.genres} onChange={v => update({ genres: v })} placeholder="Chọn thể loại" />
                <TagInput icon={<Tags className="h-3 w-3" />} label="Tính cách nhân vật chính" options={AVAILABLE_PERSONALITIES} selected={props.storyInfo.mcPersonality} onChange={v => update({ mcPersonality: v })} placeholder="Chọn tính cách" />
                <TagInput icon={<Tags className="h-3 w-3" />} label="Bối cảnh" options={AVAILABLE_SETTINGS} selected={props.storyInfo.worldSetting} onChange={v => update({ worldSetting: v })} placeholder="Chọn bối cảnh" />
                <TagInput icon={<Tags className="h-3 w-3" />} label="Lưu phái" options={AVAILABLE_FLOWS} selected={props.storyInfo.sectFlow} onChange={v => update({ sectFlow: v })} placeholder="Chọn lưu phái" />
            </div></Panel>
            <Panel title="3. Cài đặt biên tập & format" icon={<Wand2 className="h-4 w-4" />}><div className="grid gap-1 sm:grid-cols-2">
                <Toggle checked={props.storyInfo.enableTitleFormatting !== false} onChange={v => update({ enableTitleFormatting: v })} title="Chuẩn hóa tiêu đề" note="Viết hoa chữ đầu và làm sạch tiêu đề chương." />
                <Toggle checked={props.storyInfo.enableAutoFormat !== false} onChange={v => update({ enableAutoFormat: v })} title="Định dạng và lọc rác" note="Dọn khoảng trắng, dấu câu và dòng thừa." />
                <Toggle checked={props.storyInfo.enableParagraphSpacing !== false} onChange={v => update({ enableParagraphSpacing: v })} title="Dòng trống giữa đoạn" note="Giúp bản xuất dễ đọc hơn." />
                <Toggle checked={props.storyInfo.enableGarbageCleanOnImport !== false} onChange={v => update({ enableGarbageCleanOnImport: v })} title="Lọc rác khi nhập" note="Loại ký tự rác và từ vô nghĩa." />
            </div></Panel>
            <Panel title="4. Hệ thống & dữ liệu" icon={<Archive className="h-4 w-4" />}><div className="grid grid-cols-2 gap-3">
                <button onClick={props.handleBackup} className="rounded-xl border border-slate-200 p-3 text-left hover:border-emerald-300 dark:border-slate-700"><Archive className="mb-2 h-5 w-5 text-emerald-600" /><b className="block text-xs">Backup ngay</b><span className="text-[10px] text-slate-500">Sao lưu toàn bộ dự án</span></button>
                <label className="cursor-pointer rounded-xl border border-slate-200 p-3 text-left hover:border-emerald-300 dark:border-slate-700"><ArchiveRestore className="mb-2 h-5 w-5 text-emerald-600" /><b className="block text-xs">Restore data</b><span className="text-[10px] text-slate-500">Khôi phục từ file sao lưu</span><input type="file" accept=".json" className="hidden" onChange={props.handleRestore} /></label>
                <button onClick={props.handleResetQuota} className="rounded-xl border border-amber-200 p-3 text-left hover:bg-amber-50 dark:border-amber-900"><RefreshCw className="mb-2 h-5 w-5 text-amber-500" /><b className="block text-xs">Reset quota</b><span className="text-[10px] text-slate-500">Đặt lại số lượt API</span></button>
                <button onClick={props.requestResetApp} className="rounded-xl border border-rose-200 p-3 text-left hover:bg-rose-50 dark:border-rose-900"><Trash2 className="mb-2 h-5 w-5 text-rose-500" /><b className="block text-xs">Reset toàn bộ app</b><span className="text-[10px] text-slate-500">Xóa dữ liệu và cài đặt</span></button>
            </div></Panel>
        </div>
    </div>;
};
