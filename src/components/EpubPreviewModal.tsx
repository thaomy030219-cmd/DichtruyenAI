
import React, { useState, useEffect } from 'react';
import { X, Book, User, FileText, Upload } from 'lucide-react';
import { StoryInfo } from '../types';

interface EpubPreviewModalProps {
    isOpen: boolean;
    onClose: () => void;
    onConfirm: (info: StoryInfo, cover: File | null, font: File | null) => void;
    storyInfo: StoryInfo;
    coverImage: File | null;
    totalFiles: number;
}

export const EpubPreviewModal: React.FC<EpubPreviewModalProps> = ({ 
    isOpen, onClose, onConfirm, storyInfo, coverImage, totalFiles
}) => {
    const [localInfo, setLocalInfo] = useState<StoryInfo>(storyInfo);
    const [localCover, setLocalCover] = useState<File | null>(coverImage);
    const [coverPreview, setCoverPreview] = useState<string | null>(null);
    const [localFont, setLocalFont] = useState<File | null>(null);

    useEffect(() => {
        let url: string | null = null;
        if (localCover) {
            url = URL.createObjectURL(localCover);
            // Use timeout to avoid synchronous setState in effect
            const timer = setTimeout(() => setCoverPreview(url), 0);
            return () => {
                clearTimeout(timer);
                if (url) URL.revokeObjectURL(url);
            };
        } else {
            // Use timeout to avoid synchronous setState in effect
            const timer = setTimeout(() => setCoverPreview(null), 0);
            return () => clearTimeout(timer);
        }
    }, [localCover]);

    const handleCoverChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            setLocalCover(e.target.files[0]);
        }
    };


    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[160] flex items-center justify-center bg-slate-900/80 backdrop-blur-md p-4 animate-in fade-in duration-300">
            {/* Reduced max-h to 85vh to ensure footer visibility on smaller screens */}
            <div className="bg-white dark:bg-slate-900 rounded-3xl shadow-2xl w-full max-w-4xl overflow-y-auto md:overflow-hidden animate-in zoom-in-95 duration-300 border border-white/20 dark:border-slate-700 flex flex-col md:flex-row max-h-[90vh] md:max-h-[85vh]">
                
                {/* Left Side: Cover Preview */}
                <div className="w-full md:w-1/3 bg-slate-100 dark:bg-slate-950 p-6 flex flex-col items-center justify-center border-b md:border-b-0 md:border-r border-slate-200 dark:border-slate-800 relative shrink-0">
                    <div className="aspect-[2/3] w-full max-w-[200px] bg-white dark:bg-slate-800 rounded-lg shadow-lg overflow-hidden border-4 border-white dark:border-slate-700 relative group">
                        {coverPreview ? (
                            <img src={coverPreview} alt="Cover" className="w-full h-full object-cover" />
                        ) : (
                            <div className="w-full h-full flex flex-col items-center justify-center text-slate-400">
                                <Book className="w-12 h-12 mb-2 opacity-50" />
                                <span className="text-xs font-bold uppercase">Chưa có bìa</span>
                            </div>
                        )}
                        
                        <label className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center cursor-pointer text-white">
                            <Upload className="w-8 h-8 mb-2" />
                            <span className="text-xs font-bold uppercase">Đổi Ảnh Bìa</span>
                            <input type="file" accept="image/*" className="hidden" onChange={handleCoverChange} />
                        </label>
                    </div>
                    <p className="mt-4 text-xs text-slate-500 text-center px-4">
                        Ảnh bìa sẽ được nhúng vào file EPUB. Tỉ lệ khuyến nghị 2:3.<br/>
                        <span className="text-emerald-600 dark:text-emerald-400 mt-1 block">Bạn có thể tải ảnh khác bằng cách bấm trực tiếp vào khung bìa.</span>
                    </p>
                </div>

                {/* Right Side: Metadata Form - Added min-h-0 to allow proper scrolling */}
                <div className="flex-none md:flex-1 flex flex-col min-h-0 bg-white dark:bg-slate-900">
                    <div className="p-6 border-b border-slate-100 dark:border-slate-800 flex justify-between items-center bg-rose-50/50 dark:bg-rose-900/10 shrink-0">
                        <div>
                            <h3 className="text-xl font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
                                <Book className="w-6 h-6 text-rose-500" /> Xuất Bản Ebook (EPUB)
                            </h3>
                            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                                Chuẩn Google Play Books & Kindle. Tự động làm sạch & tạo mục lục.
                            </p>
                        </div>
                        <button onClick={onClose} className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full text-slate-400"><X className="w-5 h-5" /></button>
                    </div>

                    <div className="p-6 flex-none md:flex-1 overflow-visible md:overflow-y-auto custom-scrollbar space-y-5">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                            <div className="space-y-2">
                                <label className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase flex items-center gap-1">
                                    <FileText className="w-3.5 h-3.5" /> Tên Truyện
                                </label>
                                <input 
                                    className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl font-bold text-slate-700 dark:text-slate-200 outline-none focus:ring-2 focus:ring-rose-200 dark:focus:ring-rose-800 transition-all"
                                    value={localInfo.title}
                                    onChange={e => setLocalInfo({...localInfo, title: e.target.value})}
                                    placeholder="Nhập tên truyện..."
                                />
                            </div>
                            <div className="space-y-2">
                                <label className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase flex items-center gap-1">
                                    <User className="w-3.5 h-3.5" /> Tác Giả
                                </label>
                                <input 
                                    className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl font-medium text-slate-700 dark:text-slate-200 outline-none focus:ring-2 focus:ring-rose-200 dark:focus:ring-rose-800 transition-all"
                                    value={localInfo.author}
                                    onChange={e => setLocalInfo({...localInfo, author: e.target.value})}
                                    placeholder="Tên tác giả..."
                                />
                            </div>
                        </div>

                        <div className="space-y-2">
                            <label className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase flex items-center gap-1">
                                <FileText className="w-3.5 h-3.5" /> Giới Thiệu / Tóm Tắt (Summary)
                            </label>
                            <textarea 
                                className="w-full h-32 px-4 py-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-sm text-slate-600 dark:text-slate-300 outline-none focus:ring-2 focus:ring-rose-200 dark:focus:ring-rose-800 transition-all resize-none custom-scrollbar"
                                value={localInfo.summary || ''}
                                onChange={e => setLocalInfo({...localInfo, summary: e.target.value})}
                                placeholder="Nội dung giới thiệu truyện sẽ hiển thị ở trang đầu của Ebook..."
                            />
                        </div>

                        <div className="space-y-2">
                            <label className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase flex items-center gap-1">
                                <Upload className="w-3.5 h-3.5" /> Font Chữ Mặc Định (Tùy chọn)
                            </label>
                            <div className="flex items-center gap-3">
                                <label className="flex items-center justify-center gap-2 px-4 py-2.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-xl cursor-pointer transition-colors text-sm font-medium border border-slate-200 dark:border-slate-700">
                                    <Upload className="w-4 h-4" />
                                    Tải file Font (.ttf, .otf)
                                    <input 
                                        type="file" 
                                        accept=".ttf,.otf" 
                                        className="hidden" 
                                        onChange={(e) => {
                                            if (e.target.files && e.target.files[0]) {
                                                setLocalFont(e.target.files[0]);
                                            }
                                        }} 
                                    />
                                </label>
                                {localFont && (
                                    <div className="flex items-center gap-2 text-sm text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/20 px-3 py-2 rounded-lg border border-emerald-100 dark:border-emerald-800">
                                        <span className="truncate max-w-[150px]" title={localFont.name}>{localFont.name}</span>
                                        <button onClick={() => setLocalFont(null)} className="hover:text-emerald-700 dark:hover:text-emerald-300"><X className="w-4 h-4" /></button>
                                    </div>
                                )}
                            </div>
                        </div>

                        <div className="bg-primary-50 dark:bg-primary-900/20 p-4 rounded-xl border border-primary-100 dark:border-primary-800/50">
                            <h4 className="text-xs font-bold text-primary-700 dark:text-primary-400 uppercase mb-2">Trợ Lý Local sẽ tự động:</h4>
                            <ul className="text-xs text-primary-800 dark:text-primary-300 space-y-1 list-disc pl-4">
                                <li>Lọc sạch ký tự rác (*, #, =, ---).</li>
                                <li>Đưa tiêu đề về đầu dòng để tạo Mục Lục (TOC) chuẩn.</li>
                                <li>Thụt đầu dòng đoạn văn và giãn dòng đôi.</li>
                                <li>Đóng gói <b>{totalFiles}</b> chương thành 1 file EPUB duy nhất.</li>
                            </ul>
                        </div>
                    </div>

                    <div className="p-6 border-t border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50 flex justify-end gap-3 shrink-0">
                        <button onClick={onClose} className="px-6 py-3 text-slate-500 dark:text-slate-400 font-bold hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition-colors text-sm">
                            Hủy Bỏ
                        </button>
                        <button 
                            onClick={() => onConfirm(localInfo, localCover, localFont)}
                            className="px-8 py-3 bg-gradient-to-r from-primary-500 to-emerald-500 hover:from-primary-400 hover:to-emerald-400 text-white rounded-xl font-bold shadow-lg shadow-primary-200/50 dark:shadow-none transition-all flex items-center gap-2 text-sm"
                        >
                            <Book className="w-4 h-4" /> Xuất Bản Ngay
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};
