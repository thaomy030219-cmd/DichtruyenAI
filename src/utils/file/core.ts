// Các tiện ích file/tên/sắp xếp cơ bản, không phụ thuộc JSZip/pdfjs (public API).
import { FileItem } from '../../types';
import { padNumber } from './shared';

export const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = error => reject(error);
    });
};

export const base64ToFile = (base64: string, filename: string): File => {
    try {
        const arr = base64.split(',');
        const mimeMatch = arr[0].match(/:(.*?);/);
        const mime = mimeMatch ? mimeMatch[1] : 'image/png';
        const bstr = atob(arr[1]);
        let n = bstr.length;
        const u8arr = new Uint8Array(n);
        while (n--) u8arr[n] = bstr.charCodeAt(n);
        return new File([u8arr], filename, { type: mime });
    } catch (e) {
        console.error("Lỗi chuyển đổi ảnh từ backup:", e);
        return new File([""], "error.png", { type: "image/png" });
    }
};

export const generateExportFileName = (title: string, author: string, extension: string = ""): string => {
    const safeTitle = title ? title.trim() : "Truyen_Moi";
    const safeAuthor = author ? author.trim() : "";
    let baseName = safeAuthor ? `${safeTitle}_${safeAuthor}` : safeTitle;
    baseName = baseName.replace(/[\\/:*?"<>|]/g, "").trim();
    if (!baseName) baseName = "Exported_Story";
    return extension ? `${baseName}${extension}` : baseName;
};

export const renumberFiles = (files: FileItem[], startIndex: number): FileItem[] => {
    return files.map((file, index) => {
        const currentIndex = startIndex + index;
        const paddedIndex = padNumber(currentIndex);
        const cleanName = file.name.replace(/^\d{5}\s+/, '');
        return { ...file, name: `${paddedIndex} ${cleanName}` };
    });
};

export const sortFiles = (list: FileItem[]) => { 
    const re = /(\d+)/; 
    return [...list].sort((a, b) => { 
        const aParts = a.name.split(re); 
        const bParts = b.name.split(re); 
        const len = Math.min(aParts.length, bParts.length); 
        for (let i = 0; i < len; i++) { 
            const aPart = aParts[i]; 
            const bPart = bParts[i]; 
            if (aPart === bPart) continue; 
            const aNum = parseInt(aPart, 10); 
            const bNum = parseInt(bPart, 10); 
            if (!isNaN(aNum) && !isNaN(bNum)) return aNum - bNum; 
            return aPart.localeCompare(bPart); 
        } 
        return aParts.length - bParts.length; 
    }); 
};

export const getSmartSampledFiles = (files: FileItem[], sampling: { start: number, middle: number, end: number }): FileItem[] => {
    const sortedFiles = sortFiles([...files]);
    const totalFiles = sortedFiles.length;
    const requiredTotal = sampling.start + sampling.middle + sampling.end;
    
    if (totalFiles <= requiredTotal) {
        return sortedFiles;
    }

    const startBatch = sortedFiles.slice(0, sampling.start);
    const endBatch = sortedFiles.slice(-sampling.end);
    
    const midIndex = Math.floor(totalFiles / 2);
    const midStart = Math.max(sampling.start, midIndex - Math.floor(sampling.middle / 2));
    const midEnd = Math.min(totalFiles - sampling.end, midStart + sampling.middle);
    const middleBatch = sortedFiles.slice(midStart, midEnd);
    
    const uniqueMap = new Map<string, FileItem>();
    [...startBatch, ...middleBatch, ...endBatch].forEach(f => uniqueMap.set(f.id, f));
    
    return Array.from(uniqueMap.values()).sort((a, b) => {
        // Re-sort to ensure order
        const idxA = sortedFiles.findIndex(f => f.id === a.id);
        const idxB = sortedFiles.findIndex(f => f.id === b.id);
        return idxA - idxB;
    });
};

export const parseFilenameMetadata = (filename: string): { title: string, author: string } => {
    let cleanName = filename.replace(/\.(epub|zip|docx|doc|txt|rar|pdf|xhtml|html|xml)$/i, '');
    cleanName = cleanName.replace(/\s*\(\d+\)$/, '');
    const suffixRegex = /([_\-\s]+(part|tap|tập|quyen|quyển|vol|book|phan|phần|chuong|chương)[_\-\s]*\d+.*$)|([_\-\s]+(full|prc|epub|mobi|azw3|text|convert|vp|vpro).*$)/i;
    cleanName = cleanName.replace(suffixRegex, '');
    cleanName = cleanName.trim();
    let title = cleanName;
    let author = "";
    if (cleanName.includes('_')) {
        const parts = cleanName.split('_');
        if (parts.length >= 2) {
            author = parts.pop()?.trim() || "";
            title = parts.join(' ').trim();
        }
    } else if (cleanName.includes(' - ')) {
        const parts = cleanName.split(' - ');
        if (parts.length >= 2) {
            author = parts.pop()?.trim() || "";
            title = parts.join(' - ').trim();
        }
    }
    title = title.replace(/_/g, ' ').trim();
    author = author.replace(/_/g, ' ').trim();
    return { title, author };
};

export const readFileAsText = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = async (e) => {
      const buffer = e.target?.result as ArrayBuffer;
      if (!buffer) { resolve(""); return; }
      
      try {
        // Mặc định thử giải mã utf-8 trước, bật fatal để ném lỗi nếu không phải utf-8
        const utf8Decoder = new TextDecoder('utf-8', { fatal: true });
        resolve(utf8Decoder.decode(buffer));
        return;
      } catch {
        // Nếu không phải utf-8, thử các bảng mã truyện thông dụng (Trung, Hàn, Nhật...)
        const candidates = ['gb18030', 'big5', 'euc-kr', 'shift_jis', 'windows-1252'];
        for (const enc of candidates) {
          try {
            const decoder = new TextDecoder(enc, { fatal: true });
            resolve(decoder.decode(buffer));
            return;
          } catch { continue; }
        }
        // Fallback cuối nếu tất cả thất bại (thường là gbk/gb18030 cho truyện Trung)
        const fallbackDecoder = new TextDecoder('utf-8');
        resolve(fallbackDecoder.decode(buffer));
      }
    };
    reader.onerror = (e) => reject(e);
    reader.readAsArrayBuffer(file);
  });
};
