// Xuất/tải file: merge nội dung, xuất zip (raw/translated), docx, epub, txt, json.
import JSZip from 'jszip';
import { FileItem, StoryInfo } from '../../types';
import { cleanContentArtifacts, sanitizeFilename } from './shared';
import { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType } from 'docx';

export const createMergedFile = (files: FileItem[], enableTitleFormatting: boolean = true, enableAutoFormat: boolean = true, enableParagraphSpacing: boolean = true): string => {
  const sortedFiles = [...files].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
  return sortedFiles.filter((f) => !!f.translatedContent)
    .map((f) => cleanContentArtifacts(f.translatedContent || "", enableTitleFormatting, enableAutoFormat, enableParagraphSpacing).trim())
    .join('\n\n'); 
};

export const downloadRawAsZip = async (files: FileItem[], filename: string, splitCount: number = 1, onProgress?: (percent: number, msg: string) => void, enableTitleFormatting: boolean = true, enableAutoFormat: boolean = true, enableParagraphSpacing: boolean = true) => {
    const sortedFiles = [...files].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
    if (onProgress) onProgress(0, "Đang chuẩn bị dữ liệu...");
    
    if (splitCount <= 1) {
        const zip = new JSZip();
        sortedFiles.forEach((f, index) => {
            let safeName = sanitizeFilename(f.name);
            if (!safeName.toLowerCase().endsWith('.txt')) safeName += '.txt';
            zip.file(safeName, cleanContentArtifacts(f.content, enableTitleFormatting, enableAutoFormat, enableParagraphSpacing));
            if (onProgress && index % 10 === 0) onProgress(Math.round((index / sortedFiles.length) * 20), `Đang thêm file: ${safeName}`);
        });
        if (onProgress) onProgress(20, "Đang nén file Zip...");
        const blob = await zip.generateAsync({ type: "blob" }, (metadata) => { if (onProgress) onProgress(20 + Math.round(metadata.percent * 0.8), `Đang nén: ${Math.round(metadata.percent)}%`); });
        if (onProgress) onProgress(100, "Tải xuống...");
        const element = document.createElement('a');
        const url = URL.createObjectURL(blob);
        element.href = url;
        element.target = '_blank';
        element.rel = 'noopener';
        element.download = filename.endsWith('.zip') ? filename : `${filename}.zip`;
        document.body.appendChild(element);
        element.click();
        document.body.removeChild(element);
        URL.revokeObjectURL(url);
    } else {
        const masterZip = new JSZip();
        const filesPerPart = Math.ceil(sortedFiles.length / splitCount);
        
        for (let i = 0; i < splitCount; i++) {
            const startIdx = i * filesPerPart;
            const endIdx = Math.min((i + 1) * filesPerPart, sortedFiles.length);
            if (startIdx >= sortedFiles.length) break;
            
            const partFiles = sortedFiles.slice(startIdx, endIdx);
            const partZip = new JSZip();
            
            partFiles.forEach(f => {
                let safeName = sanitizeFilename(f.name);
                if (!safeName.toLowerCase().endsWith('.txt')) safeName += '.txt';
                partZip.file(safeName, cleanContentArtifacts(f.content, enableTitleFormatting, enableAutoFormat, enableParagraphSpacing));
            });
            
            if (onProgress) onProgress(Math.round(((i + 1) / splitCount) * 40), `Đang nén phần ${i + 1}/${splitCount}`);
            
            const partBlob = await partZip.generateAsync({ type: "blob" });
            const partName = filename.endsWith('.zip') ? `${filename.slice(0, -4)}_Part${i + 1}.zip` : `${filename}_Part${i + 1}.zip`;
            masterZip.file(partName, partBlob);
        }
        
        if (onProgress) onProgress(50, "Đang nén file tổng...");
        const masterBlob = await masterZip.generateAsync({ type: "blob" }, (metadata) => { if (onProgress) onProgress(50 + Math.round(metadata.percent * 0.5), `Đang nén tổng: ${Math.round(metadata.percent)}%`); });
        
        if (onProgress) onProgress(100, "Tải xuống...");
        const element = document.createElement('a');
        const url = URL.createObjectURL(masterBlob);
        element.href = url;
        element.target = '_blank';
        element.rel = 'noopener';
        element.download = filename.endsWith('.zip') ? filename : `${filename}.zip`;
        document.body.appendChild(element);
        element.click();
        document.body.removeChild(element);
        URL.revokeObjectURL(url);
    }
};

export const downloadTranslatedAsZip = async (files: FileItem[], filename: string, onProgress?: (percent: number, msg: string) => void, enableTitleFormatting: boolean = true, enableAutoFormat: boolean = true, enableParagraphSpacing: boolean = true) => {
    const zip = new JSZip();
    const sortedFiles = [...files].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
    if (onProgress) onProgress(0, "Đang chuẩn bị...");
    const readyFiles = sortedFiles.filter(f => !!f.translatedContent);
    if (readyFiles.length === 0) throw new Error("Chưa có chương nào được dịch để tải.");
    for (let i = 0; i < readyFiles.length; i++) {
        const f = readyFiles[i];
        let safeName = sanitizeFilename(f.name);
        if (!safeName.toLowerCase().endsWith('.txt')) safeName += '.txt';
        zip.file(safeName, cleanContentArtifacts(f.translatedContent!, enableTitleFormatting, enableAutoFormat, enableParagraphSpacing));
        if (onProgress && i % 100 === 0) {
            onProgress(Math.round((i / readyFiles.length) * 20), `Đang thêm: ${safeName}`);
            await new Promise(r => setTimeout(r, 0));
        }
    }
    if (onProgress) onProgress(20, "Đang nén file Zip...");
    const blob = await zip.generateAsync({ type: "blob" }, (metadata) => { if (onProgress) onProgress(20 + Math.round(metadata.percent * 0.8), `Đang nén: ${Math.round(metadata.percent)}%`); });
    if (onProgress) onProgress(100, "Tải xuống...");
    const element = document.createElement('a');
    const url = URL.createObjectURL(blob);
    element.href = url;
    element.target = '_blank';
    element.rel = 'noopener';
    element.download = filename.endsWith('.zip') ? filename : `${filename}.zip`;
    document.body.appendChild(element);
    element.click();
    document.body.removeChild(element);
    URL.revokeObjectURL(url);
};

export const createMergedRawFile = (files: FileItem[], enableTitleFormatting: boolean = true, enableAutoFormat: boolean = true, enableParagraphSpacing: boolean = true): string => {
  const sortedFiles = [...files].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
  return sortedFiles.map((f) => cleanContentArtifacts(f.content, enableTitleFormatting, enableAutoFormat, enableParagraphSpacing).trim()).join('\n\n'); 
};

export const downloadTextFile = (filename: string, content: string) => {
  const element = document.createElement('a');
  const file = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(file);
  element.href = url;
  element.target = '_blank';
  element.rel = 'noopener';
  element.download = filename;
  document.body.appendChild(element);
  element.click();
  document.body.removeChild(element);
  URL.revokeObjectURL(url);
};

export const downloadJsonFile = (filename: string, data: any) => {
  const element = document.createElement('a');
  const file = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(file);
  element.href = url;
  element.target = '_blank';
  element.rel = 'noopener';
  element.download = filename;
  document.body.appendChild(element);
  element.click();
  document.body.removeChild(element);
  URL.revokeObjectURL(url);
};

export const downloadDocxFile = async (filename: string, files: FileItem[], storyInfo: StoryInfo, onProgress?: (percent: number) => void) => {
  const sortedFiles = [...files].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
  if (sortedFiles.length === 0) throw new Error("Không có chương nào để xuất DOCX");

  const children = [
    new Paragraph({
      text: storyInfo.title || "Unknown Title",
      heading: HeadingLevel.TITLE,
      alignment: AlignmentType.CENTER,
    }),
    new Paragraph({
      text: `Tác giả: ${storyInfo.author || "Unknown Author"}`,
      alignment: AlignmentType.CENTER,
    }),
    new Paragraph({ text: "" }), // Empty line
  ];

  const CHUNK_SIZE = 100;
  for (let i = 0; i < sortedFiles.length; i++) {
    const file = sortedFiles[i];
    if (onProgress && i % CHUNK_SIZE === 0) {
      onProgress(Math.round((i / sortedFiles.length) * 100));
      await new Promise(r => setTimeout(r, 0));
    }
    const content = cleanContentArtifacts(file.translatedContent || file.content, storyInfo.enableTitleFormatting !== false, storyInfo.enableAutoFormat !== false, storyInfo.enableParagraphSpacing !== false);
    const paragraphs = content.split('\n').filter(l => l.trim() !== '').map(line => new Paragraph({
      children: [new TextRun(line.trim())],
      spacing: { line: 360, lineRule: "auto", after: 480 },
    }));
    children.push(
      new Paragraph({
        text: file.name,
        heading: HeadingLevel.HEADING_1,
        pageBreakBefore: i > 0,
      }),
      ...paragraphs
    );
  }

  const doc = new Document({
    creator: storyInfo.author || "Unknown Author",
    title: storyInfo.title || "Unknown Title",
    description: storyInfo.summary || "",
    sections: [{
      properties: {},
      children: children,
    }],
  });

  const blob = await Packer.toBlob(doc);
  const element = document.createElement('a');
  const url = URL.createObjectURL(blob);
  element.href = url;
  element.target = '_blank';
  element.rel = 'noopener';
  element.download = filename;
  document.body.appendChild(element);
  element.click();
  document.body.removeChild(element);
  URL.revokeObjectURL(url);
};

export const downloadEpubFile = (filename: string, blob: Blob) => {
  const element = document.createElement('a');
  const url = URL.createObjectURL(blob);
  element.href = url;
  element.target = '_blank';
  element.rel = 'noopener';
  element.download = filename;
  document.body.appendChild(element);
  element.click();
  document.body.removeChild(element);
  URL.revokeObjectURL(url);
};

// Cụm số dùng để nhận diện tiêu đề chương trong EPUB: Ả Rập | La Mã (có ranh giới từ) | số đếm
// bằng chữ (có ranh giới từ) — để không sót các chương ghi "Chương IV", "Chương Năm".
const CHAPTER_ALPHA = "a-zA-ZàáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđĐ";
const CHAPTER_NUM_GROUP =
  `(?:thứ\\s+)?\\d+|` +
  `(?<![${CHAPTER_ALPHA}])[ivxlcdm]+(?![${CHAPTER_ALPHA}])|` +
  `(?<![${CHAPTER_ALPHA}])(?:thứ\\s+)?(?:nhất|một|hai|ba|bốn|năm|sáu|bảy|tám|chín|mười|mươi|lăm|linh|lẻ)(?![${CHAPTER_ALPHA}])`;

const escapeXml = (unsafe: string) => {
  if (!unsafe) return "";
  // Strip invalid XML control characters that cause Google Play Books to reject the EPUB
  // eslint-disable-next-line no-control-regex
  const cleaned = unsafe.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
  return cleaned.replace(/[<>&'"]/g, (c) => {
    switch (c) { case '<': return '&lt;'; case '>': return '&gt;'; case '&': return '&amp;'; case '\'': return '&apos;'; case '"': return '&quot;'; default: return c; }
  });
};

// Hậu kiểm XML: parse thử bằng DOMParser trước khi nhét vào zip. Một ký tự "&"/"<" quên escape
// (hoặc control-char lọt lưới) sẽ làm parser XML của trình đọc (vbook, Calibre, Play Books...)
// abort TOÀN BỘ file, mà lỗi đó chỉ lộ ra khi người dùng mở app đọc — quá muộn. Validate ngay khi
// tạo để báo lỗi rõ ràng, chỉ đúng chương nào hỏng, thay vì xuất ra 1 file epub âm thầm hỏng.
const assertWellFormedXml = (xml: string, label: string): string => {
  if (typeof DOMParser === 'undefined') return xml;
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const err = doc.getElementsByTagName('parsererror')[0];
  if (err) {
    const detail = (err.textContent || '').trim().slice(0, 300);
    throw new Error(`Lỗi tạo EPUB: file "${label}" không phải XML hợp lệ (có thể do ký tự đặc biệt chưa escape hết). ${detail}`);
  }
  return xml;
};

// Nhận diện phần mở rộng font để khai báo đúng media-type + format() hint trong @font-face.
// Trước đây chỉ phân biệt ttf/otf, thiếu woff/woff2 khiến 1 số trình đọc (đặc biệt Calibre)
// không nhận diện đúng font -> âm thầm fallback về font hệ thống dù người dùng đã nhúng font riêng.
const resolveFontMeta = (name: string): { ext: string; mediaType: string; format: string } => {
  const lower = (name || '').toLowerCase();
  if (lower.endsWith('.otf')) return { ext: 'otf', mediaType: 'font/otf', format: 'opentype' };
  if (lower.endsWith('.woff2')) return { ext: 'woff2', mediaType: 'font/woff2', format: 'woff2' };
  if (lower.endsWith('.woff')) return { ext: 'woff', mediaType: 'font/woff', format: 'woff' };
  return { ext: 'ttf', mediaType: 'font/ttf', format: 'truetype' };
};

// Nén/resize ảnh bìa về JPEG chất lượng 0.8, chiều rộng tối đa 1200px trước khi nhúng vào EPUB.
// Ảnh bìa gốc tải từ raw thường 2-5MB (đôi khi hơn), làm file EPUB nặng không cần thiết và một số
// máy đọc sách cấu hình yếu load bìa full-res rất chậm. Có fallback về ảnh gốc nếu nén lỗi.
const compressCoverImage = (file: File, maxWidth = 1200, quality = 0.8): Promise<{ blob: Blob; extension: string; type: string }> =>
  new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      let width = img.width;
      let height = img.height;
      if (width > maxWidth) {
        height = Math.round(height * (maxWidth / width));
        width = maxWidth;
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) { reject(new Error('Không lấy được canvas context')); return; }
      ctx.drawImage(img, 0, 0, width, height);
      canvas.toBlob(
        (blob) => { if (blob) resolve({ blob, extension: 'jpg', type: 'image/jpeg' }); else reject(new Error('Nén ảnh bìa thất bại')); },
        'image/jpeg',
        quality
      );
    };
    img.onerror = (err) => { URL.revokeObjectURL(url); reject(err); };
    img.src = url;
  });

export const generateEpub = async (files: FileItem[], storyInfo: StoryInfo, coverImage: File | null, epubDescription: string = "", onProgress?: (percent: number) => void, customFont: File | null = null): Promise<Blob> => {
  const zip = new JSZip();
  const sortedFiles = [...files].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
  if (sortedFiles.length === 0) throw new Error("Không có chương nào để tạo EPUB");
  zip.file("mimetype", "application/epub+zip", { compression: "STORE" });
  const title = storyInfo.title || "Unknown Title";
  const author = storyInfo.author || "Unknown Author";
  const uuidVal = crypto.randomUUID();
  const date = new Date().toISOString().split('T')[0];
  // Google Play Books requires EXACTLY CCYY-MM-DDThh:mm:ssZ (no fractional seconds)
  const timestamp = new Date().toISOString().replace(/\.\d+Z$/, 'Z'); 
  const oebps = zip.folder("OEBPS");
  if (!oebps) throw new Error("Lỗi tạo thư mục OEBPS");
  const metaInf = zip.folder("META-INF");
  metaInf?.file("container.xml", `<?xml version="1.0" encoding="UTF-8"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`);
  let coverManifest = "";
  let coverMeta = "";
  let coverImgFilename = "";
  let fontManifest = "";

  if (coverImage) {
      try {
          const { blob: compressedCover, extension, type: mimeType } = await compressCoverImage(coverImage, 1200, 0.8);
          coverImgFilename = `Images/cover.${extension}`;
          coverManifest = `<item id="cover-image" href="${coverImgFilename}" media-type="${mimeType}" properties="cover-image"/>`;
          coverMeta = `<meta name="cover" content="cover-image" />`;
          oebps.file(coverImgFilename, await compressedCover.arrayBuffer());
      } catch (e) {
          console.warn("Could not compress cover image, falling back to original file", e);
          const ext = coverImage.name ? coverImage.name.split('.').pop() || 'jpg' : 'jpg';
          const mimeType = coverImage.type || (ext.toLowerCase() === 'png' ? 'image/png' : 'image/jpeg');
          coverImgFilename = `Images/cover.${ext}`;
          coverManifest = `<item id="cover-image" href="${coverImgFilename}" media-type="${mimeType}" properties="cover-image"/>`;
          coverMeta = `<meta name="cover" content="cover-image" />`;
          try {
              const arrayBuffer = await coverImage.arrayBuffer();
              oebps.file(coverImgFilename, arrayBuffer);
          } catch (e2) {
              console.warn("Could not read cover image as arrayBuffer, falling back to blob", e2);
              oebps.file(coverImgFilename, coverImage);
          }
      }
  }

  let cssContent = `body{font-family:"Georgia","Times New Roman",serif;line-height:1.5;margin:0;padding:2%;text-align:justify;font-size:1.2em;color:#111}h1,h2{font-family:"Palatino Linotype","Book Antiqua",Palatino,serif;font-weight:bold;font-style:italic;text-align:center;margin:1.5em 0 1em;font-size:1.6em;color:#000;page-break-after:avoid;page-break-before:always}p{text-indent:1.5em;margin:0;margin-bottom:2em}img{max-width:100%;height:auto;display:block;margin:1em auto}em{font-style:italic;color:inherit}.intro-container{text-align:center;margin-top:3em}.intro-title{font-size:2.2em;font-weight:bold;font-style:normal;margin-bottom:0.5em}.intro-author{font-size:1.4em;font-style:italic;color:#555;margin-bottom:1em}.intro-genres{font-size:1.1em;font-style:italic;color:#444;margin-bottom:2em}`;

  if (customFont) {
      const { ext, mediaType: fontMimeType, format: fontFormat } = resolveFontMeta(customFont.name);
      const fontFilename = `fonts/custom-font.${ext}`;
      try {
          const fontBuffer = await customFont.arrayBuffer();
          oebps.file(fontFilename, fontBuffer);
          fontManifest = `<item id="custom-font" href="${fontFilename}" media-type="${fontMimeType}" />`;
          // format() hint bắt buộc để 1 số trình đọc (Calibre...) nhận diện đúng định dạng font,
          // thiếu nó có thể âm thầm fallback về font hệ thống dù đã nhúng font riêng.
          cssContent = `@font-face { font-family: 'CustomEpubFont'; src: url('../${fontFilename}') format('${fontFormat}'); font-weight: normal; font-style: normal; }\n` + cssContent.replace(/font-family:[^;]+;/g, "font-family: 'CustomEpubFont', serif;");
      } catch (e) {
          console.warn("Could not read custom font", e);
      }
  }

  oebps.file("Styles/style.css", cssContent);
  const manifestItems: string[] = [];
  const spineItems: string[] = [];
  const navPoints: string[] = []; 
  const navLinks: string[] = [];
  const introFilename = "Text/intro.xhtml";
  const coverHtml = coverImgFilename ? `<div style="text-align:center"><img src="../${coverImgFilename}" alt="Cover" style="max-height:50vh" /></div>` : "";
  const tagsHtml = storyInfo.genres.map(g => escapeXml(g)).join(' - ');
  const formattedDescription = epubDescription.split('\n').map(l => l.trim()).filter(l => l).map(l => `<p>${escapeXml(l)}</p>`).join('');
  const introXhtml = `<?xml version="1.0" encoding="utf-8"?><!DOCTYPE html><html xmlns="http://www.w3.org/1999/xhtml" lang="vi"><head><title>Giới Thiệu</title><link href="../Styles/style.css" rel="stylesheet" type="text/css"/></head><body><section class="intro-container">${coverHtml}<h1 class="intro-title">${escapeXml(title)}</h1><div class="intro-author">${escapeXml(author)}</div><div class="intro-genres">${tagsHtml}</div><hr/><h3>Giới Thiệu</h3><div style="text-align: justify; margin-top: 1.5em;">${formattedDescription}</div></section></body></html>`;
  oebps.file(introFilename, assertWellFormedXml(introXhtml, "intro.xhtml"));
  manifestItems.push(`<item id="intro" href="${introFilename}" media-type="application/xhtml+xml"/>`);
  spineItems.push(`<itemref idref="intro"/>`);
  navPoints.push(`<navPoint id="nav-intro" playOrder="1"><navLabel><text>Giới Thiệu</text></navLabel><content src="${introFilename}"/></navPoint>`);
  navPoints.push(`<navPoint id="nav-toc" playOrder="2"><navLabel><text>Mục Lục</text></navLabel><content src="Text/nav.xhtml"/></navPoint>`);
  navLinks.push(`<li><a href="intro.xhtml">Giới Thiệu</a></li>`);
  const totalFiles = sortedFiles.length;
  const updateStep = 100;
  for (let i = 0; i < totalFiles; i++) {
      if (i % updateStep === 0) { if (onProgress) onProgress(Math.round((i / totalFiles) * 80)); await new Promise(resolve => setTimeout(resolve, 0)); }
      const file = sortedFiles[i];
      const rawContent = file.translatedContent || file.content || "";
      const content = cleanContentArtifacts(rawContent, storyInfo.enableTitleFormatting !== false, storyInfo.enableAutoFormat !== false, storyInfo.enableParagraphSpacing !== false);
      if (!content.trim()) continue;
      const chapterId = `ch${i + 1}`;
      const filename = `Text/${chapterId}.xhtml`;
      let displayTitle = `Chương ${i + 1}`;
      const lines = content.split('\n').map(l => l.trim()).filter(l => l);
      let bodyLines = lines;
      
      // Strictly check if the first line is actually a title pattern (do not just arbitrarily pull short lines)
      // LƯU Ý: trước đây dùng "[Tập|Quyển]?" (character class chứa "|") — đây là lỗi cú pháp regex,
      // vô tình khớp 1 KÝ TỰ bất kỳ trong "Tập|Quyển" (T,ậ,p,|,Q,u,y,ể,n) thay vì khớp cả cụm từ.
      // Đã sửa thành "(?:Tập|Quyển)?" và mở rộng CHAPTER_NUM_GROUP để nhận cả số La Mã / số đếm
      // bằng chữ (giống parser tách chương), tránh sót chương có tiêu đề dạng "Chương Năm", "Chương IV".
      const isChapterTitle = lines.length > 0 && new RegExp(
        `^(?:(?:Tập|Quyển)\\s*\\d+\\s*[-:]?\\s*)?(?:Chương|Ngoại\\s*chương|Phụ\\s*chương|Phiên\\s*ngoại|Tiết|Hồi|Phần|Quyển|Tập)\\s+${CHAPTER_NUM_GROUP}`,
        'i'
      ).test(lines[0]);
      
      if (isChapterTitle) { 
          displayTitle = lines[0]; 
          bodyLines = lines.slice(1); 
      }
      
      // Process lines into HTML
      const htmlBody = bodyLines.map(l => {
          let safe = escapeXml(l);
          // Highlight dialogue/quotes (matches "..." or “...”)
          safe = safe.replace(/((?:&quot;|“|”).*?(?:&quot;|“|”))/g, '<em>$1</em>');
          return `<p>${safe}</p>`;
      }).join('');

      const xhtml = `<?xml version="1.0" encoding="utf-8"?><!DOCTYPE html><html xmlns="http://www.w3.org/1999/xhtml" lang="vi"><head><title>${escapeXml(displayTitle)}</title><link href="../Styles/style.css" rel="stylesheet" type="text/css"/></head><body><h2>${escapeXml(displayTitle)}</h2>${htmlBody}</body></html>`;
      oebps.file(filename, assertWellFormedXml(xhtml, filename));
      manifestItems.push(`<item id="${chapterId}" href="${filename}" media-type="application/xhtml+xml"/>`);
      spineItems.push(`<itemref idref="${chapterId}"/>`);
      const order = i + 3; 
      const navPointId = `nav-point-${i+1}`; 
      navPoints.push(`<navPoint id="${navPointId}" playOrder="${order}"><navLabel><text>${escapeXml(displayTitle)}</text></navLabel><content src="${filename}"/></navPoint>`);
      const relativePath = `${chapterId}.xhtml`;
      navLinks.push(`<li><a href="${relativePath}">${escapeXml(displayTitle)}</a></li>`);
  }
  const navFilename = "Text/nav.xhtml";
  const navXhtml = `<?xml version="1.0" encoding="utf-8"?><!DOCTYPE html><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="vi"><head><title>Mục Lục</title><link href="../Styles/style.css" rel="stylesheet" type="text/css"/></head><body><nav epub:type="toc" id="toc"><h1>Mục Lục</h1><ol>${navLinks.join('')}</ol></nav></body></html>`;
  oebps.file(navFilename, assertWellFormedXml(navXhtml, "nav.xhtml"));
  manifestItems.push(`<item id="nav" href="${navFilename}" media-type="application/xhtml+xml" properties="nav"/>`);
  spineItems.splice(1, 0, `<itemref idref="nav"/>`);
  const ncxFilename = "toc.ncx";
  const tocNcx = `<?xml version="1.0" encoding="UTF-8"?><ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1"><head><meta name="dtb:uid" content="urn:uuid:${uuidVal}"/><meta name="dtb:depth" content="1"/><meta name="dtb:totalPageCount" content="0"/><meta name="dtb:maxPageNumber" content="0"/></head><docTitle><text>${escapeXml(title)}</text></docTitle><navMap>${navPoints.join('')}</navMap></ncx>`;
  oebps.file(ncxFilename, assertWellFormedXml(tocNcx, "toc.ncx"));
  manifestItems.push(`<item id="ncx" href="${ncxFilename}" media-type="application/x-dtbncx+xml"/>`);
  const contentOpf = `<?xml version="1.0" encoding="UTF-8"?><package xmlns="http://www.idpf.org/2007/opf" unique-identifier="BookId" version="3.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/"><dc:title>${escapeXml(title)}</dc:title><dc:creator>${escapeXml(author)}</dc:creator><dc:language>vi</dc:language><dc:identifier id="BookId">urn:uuid:${uuidVal}</dc:identifier><meta property="dcterms:modified">${timestamp}</meta><dc:date>${date}</dc:date>${coverMeta}</metadata><manifest><item id="style" href="Styles/style.css" media-type="text/css"/>${fontManifest}${coverManifest}${manifestItems.join('')}</manifest><spine toc="ncx">${spineItems.join('')}</spine></package>`;
  oebps.file("content.opf", assertWellFormedXml(contentOpf, "content.opf"));
  return await zip.generateAsync({ type: "blob", compression: "DEFLATE", compressionOptions: { level: 2 } }, (metadata) => { if (onProgress) { const finalPercent = 80 + Math.round(metadata.percent * 0.2); onProgress(Math.min(99, finalPercent)); } });
};
