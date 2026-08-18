// Nhóm hàm: NHẬP file (parse zip/docx/pdf/epub, dán nội dung, ghép thêm vào danh sách hiện có).
import { FileItem, FileStatus } from '../../types';
import { unzipFiles, parseEpub, parseDocx, parsePdf, readFileAsText, parseFilenameMetadata, renumberFiles, sortFiles } from '../../utils/fileHelpers';
import { countForeignChars, detectFragmentationMultiplier, removeJunkContent } from '../../utils/text';
import { cleanGarbageText } from '../../utils/text/garbageCleaner';

export const useFileImport = (core: any, ui: any, onFilesAdded?: () => void) => {
    const processFiles = async (fileList: File[], isTranslatedImport: boolean = false) => {
        if (fileList.length === 0) return;
        ui.setImportProgress({ current: 0, total: fileList.length, message: 'Đang chuẩn bị...' });
        const processedNewFiles: FileItem[] = [];
        const updatedStoryInfo = { ...core.storyInfo };
        let infoFound = false;
        let needsExplicitSplit = false;
        // UPDATED v1.0.2: cờ riêng cho trường hợp EPUB tách sẵn thành NHIỀU file nhỏ theo
        // tiết/trang (không phải chương chuẩn có tiêu đề/số thứ tự) — các file này thường KHÔNG
        // đủ "lớn" (dưới ngưỡng hasLargeFile) nên trước đây bị bỏ qua, tự động nhập luôn theo
        // đúng cấu trúc gốc của EPUB mà không hỏi, dẫn tới chương bị vụn/sai tên. Giờ EPUB nhiều
        // file luôn được hỏi rõ, không phụ thuộc kích thước.
        let hasMultiFileEpub = false;

        try {
            for (let i = 0; i < fileList.length; i++) {
                const file = fileList[i];
                ui.setImportProgress({ current: i, total: fileList.length, message: `Đang đọc ${file.name}...` });
                await new Promise(r => setTimeout(r, 20));

                const createNewFileItem = (name: string, content: string): FileItem => {
                    // Pre-clean raw content to remove junk tags (like unbalanced <i>) to prevent translation hallucinations
                    const cleanedContent = removeJunkContent(content);
                    const fragMultiplier = detectFragmentationMultiplier(cleanedContent);
                    const isFragmentedSource = fragMultiplier > 1.05;
                    
                    return {
                        id: crypto.randomUUID(),
                        name: name,
                        content: cleanedContent,
                        translatedContent: isTranslatedImport ? cleanedContent : null,
                        status: isTranslatedImport ? FileStatus.COMPLETED : FileStatus.IDLE,
                        retryCount: 0,
                        originalCharCount: cleanedContent.length,
                        remainingRawCharCount: isTranslatedImport ? countForeignChars(cleanedContent) : cleanedContent.length,
                        isFragmentedSource
                    };
                };

                if (file.name.endsWith('.zip')) {
                    try {
                        const { title, author } = parseFilenameMetadata(file.name);
                        if (title && !updatedStoryInfo.title) { updatedStoryInfo.title = title; if (author) updatedStoryInfo.author = author; infoFound = true; }
                        const extractedFiles = await unzipFiles(file, (current, total, percent) => {
                            ui.setImportProgress({ current: percent, total: 100, message: `Đang mở chương ${current} / ${total}` });
                        });
                        // ... existing extractedFiles logic ...
                        if (isTranslatedImport) {
                            extractedFiles.forEach(f => {
                                f.translatedContent = f.content;
                                f.status = FileStatus.COMPLETED;
                                f.remainingRawCharCount = countForeignChars(f.content);
                            });
                        }
                        processedNewFiles.push(...extractedFiles);
                    } catch { ui.addToast(`Lỗi ZIP: ${file.name}`, 'error'); }
                } else if (file.name.endsWith('.epub')) {
                    try {
                        const result = await parseEpub(file, (current, total, percent) => {
                            ui.setImportProgress({ current: percent, total: 100, message: `Đang đọc chương ${current} / ${total}` });
                        });
                        if (result.info.title && !updatedStoryInfo.title) { updatedStoryInfo.title = result.info.title; if (result.info.author && !updatedStoryInfo.author) { updatedStoryInfo.author = result.info.author; } infoFound = true; }
                        if (result.coverBlob) { core.setCoverImage(new File([result.coverBlob], "cover.jpg", { type: result.coverBlob.type })); }
                        
                        let epubFiles = result.files;
                        if (isTranslatedImport) {
                            epubFiles = epubFiles.map(f => ({
                                ...f,
                                translatedContent: f.content,
                                status: FileStatus.COMPLETED,
                                remainingRawCharCount: countForeignChars(f.content)
                            }));
                        }

                        if (result.needsSplit && epubFiles.length === 1) { needsExplicitSplit = true; processedNewFiles.push(epubFiles[0]); } else { if (epubFiles.length > 1) hasMultiFileEpub = true; processedNewFiles.push(...epubFiles); }
                    } catch (e: any) { ui.addToast(`Lỗi EPUB: ${e.message}`, 'error'); }
                } else if (file.name.endsWith('.docx') || file.name.endsWith('.doc')) {
                    try {
                        const { content, title, author } = await parseDocx(file);
                        if (title && !updatedStoryInfo.title) { updatedStoryInfo.title = title; infoFound = true; }
                        if (author && !updatedStoryInfo.author) { updatedStoryInfo.author = author; infoFound = true; }
                        if (!infoFound) { const meta = parseFilenameMetadata(file.name); if(meta.title) updatedStoryInfo.title = meta.title; if(meta.author) updatedStoryInfo.author = meta.author; infoFound = true; }
                        processedNewFiles.push(createNewFileItem(file.name, content));
                    } catch(e: any) { ui.addToast(`Lỗi DOCX: ${e.message}`, 'error'); }
                } else if (file.name.endsWith('.pdf')) {
                    try {
                        const { content, files, title, author } = await parsePdf(file, (percent, msg) => ui.setImportProgress({current: percent, total: 100, message: msg}));
                        if (title && !updatedStoryInfo.title) { updatedStoryInfo.title = title; infoFound = true; }
                        if (author && !updatedStoryInfo.author) { updatedStoryInfo.author = author; infoFound = true; }
                        if (!infoFound) { const meta = parseFilenameMetadata(file.name); if(meta.title) updatedStoryInfo.title = meta.title; if(meta.author) updatedStoryInfo.author = meta.author; infoFound = true; }
                        if (files.length > 0) { 
                            if (isTranslatedImport) {
                                files.forEach(f => {
                                    f.translatedContent = f.content;
                                    f.status = FileStatus.COMPLETED;
                                    f.remainingRawCharCount = countForeignChars(f.content);
                                });
                            }
                            processedNewFiles.push(...files); 
                        } else { 
                            processedNewFiles.push(createNewFileItem(file.name, content)); 
                        }
                    } catch (e: any) { ui.addToast(`Lỗi PDF: ${e.message}`, 'error'); }
                } else if (file.name.endsWith('.txt')) {
                    const content = await readFileAsText(file);
                    processedNewFiles.push(createNewFileItem(file.name, content));
                }
            }

            if (processedNewFiles.length === 0) { ui.setImportProgress(null); return; }
            
            // Clean all contents globally right after import to prevent hallucination errors
            const shouldCleanGarbage = core.storyInfo?.enableGarbageCleanOnImport !== false;
            for (let i = 0; i < processedNewFiles.length; i++) {
                let cleaned = removeJunkContent(processedNewFiles[i].content);
                // Lọc rác sơ bộ (Layer 2: thẻ HTML rác, ký tự *#= trơ trọi, chuỗi _/- lặp, chuẩn hóa .../!!!)
                // áp dụng ngay khi thêm file, cho MỌI định dạng (zip/epub/docx/txt/pdf) — không chỉ riêng
                // luồng qua Bộ Tách Chương (SplitterModal). File PDF có mục lục/dạng dọc đã được lọc từ lúc
                // parse (parsers.ts) nên bước này chỉ là an toàn kép, không đổi kết quả.
                if (shouldCleanGarbage) cleaned = cleanGarbageText(cleaned);
                processedNewFiles[i].content = cleaned;
                if (isTranslatedImport) {
                    processedNewFiles[i].translatedContent = cleaned;
                    processedNewFiles[i].remainingRawCharCount = countForeignChars(cleaned);
                } else {
                    processedNewFiles[i].originalCharCount = cleaned.length;
                    processedNewFiles[i].remainingRawCharCount = cleaned.length;
                }
            }
            
            const hasLargeFile = processedNewFiles.some(f => f.content.length > 10000);
            
            if (processedNewFiles.length > 1 && (hasLargeFile || hasMultiFileEpub) && !needsExplicitSplit) {
                ui.setImportModal({ isOpen: false, pendingFiles: processedNewFiles, tempInfo: infoFound ? updatedStoryInfo : null });
                ui.setZipActionModal(true);
                ui.setImportProgress(null);
                return;
            }

            if (needsExplicitSplit || hasLargeFile) {
                ui.setImportProgress({ current: 100, total: 100, message: 'Phát hiện chương gộp. Đang hợp nhất để tách lại...' });
                await new Promise(r => setTimeout(r, 100));
                const sortedForMerge = sortFiles(processedNewFiles);
                const hugeContent = sortedForMerge.map(f => f.content).join('\n\n');
                const mergedTitle = infoFound ? updatedStoryInfo.title : sortedForMerge[0].name;
                if (infoFound) core.setStoryInfo(updatedStoryInfo);
                ui.setSplitterModal({ isOpen: true, content: hugeContent, name: mergedTitle, isTranslatedImport });
                ui.setImportProgress(null);
                return;
            }

            if (core.files.length > 0) {
                ui.setImportModal({ isOpen: true, pendingFiles: processedNewFiles, tempInfo: infoFound ? updatedStoryInfo : null });
            } else {
                const sorted = sortFiles(processedNewFiles);
                core.setFiles(sorted);
                if (infoFound) core.setStoryInfo(updatedStoryInfo);
                ui.setFilterStatuses(new Set()); // Clear filters
                ui.setFilterModels(new Set()); // Clear filters
                ui.addToast(`Đã thêm ${processedNewFiles.length} file`, 'success');
                onFilesAdded?.();
            }
        } catch (e: any) {
            ui.addToast(`Lỗi nhập file: ${e.message}`, 'error');
        } finally {
            ui.setImportProgress(null);
        }
    };


    const handleImportAppend = () => {
        let nextIndex = 1;
        if (core.files.length > 0) {
            const lastFile = core.files[core.files.length - 1];
            const match = lastFile.name.match(/^(\d{5})\s/);
            if (match) { nextIndex = parseInt(match[1], 10) + 1; } else { nextIndex = core.files.length + 1; }
        }
        const renumberedFiles = renumberFiles(ui.importModal.pendingFiles, nextIndex);
        const merged = [...core.files, ...renumberedFiles];
        core.setFiles(sortFiles(merged));
        ui.setImportModal({ isOpen: false, pendingFiles: [] });
        ui.setFilterStatuses(new Set()); // Clear filters
        ui.setFilterModels(new Set()); // Clear filters
        ui.addToast(`Đã thêm nối tiếp ${ui.importModal.pendingFiles.length} file`, 'success');
        onFilesAdded?.();
    };


    const handleImportOverwrite = () => {
        core.setFiles(sortFiles(ui.importModal.pendingFiles));
        if (ui.importModal.tempInfo) {
            core.setStoryInfo({ ...ui.importModal.tempInfo, languages: ['Tiếng Trung'], genres: ['Tiên Hiệp'], mcPersonality: [], worldSetting: [], sectFlow: [], contextNotes: '', summary: '' });
            core.setAdditionalDictionary('');
            core.setCoverImage(null);
        }
        ui.setImportModal({ isOpen: false, pendingFiles: [] });
        ui.setFilterStatuses(new Set()); // Clear filters
        ui.setFilterModels(new Set()); // Clear filters
        ui.addToast(`Đã tạo truyện mới với ${ui.importModal.pendingFiles.length} file`, 'success');
        onFilesAdded?.();
    };


    const handlePasteConfirm = (title: string, content: string, isTranslated?: boolean) => {
        let cleanedContent = removeJunkContent(content);
        const contentLen = cleanedContent.length;
        // Nội dung dán ngắn (không đủ để bật SplitterModal) vẫn cần qua lọc rác sơ bộ nếu bật tùy chọn.
        if (contentLen <= 10000 && core.storyInfo?.enableGarbageCleanOnImport !== false) {
            cleanedContent = cleanGarbageText(cleanedContent);
        }
        if (contentLen > 10000) {
            ui.setSplitterModal({ isOpen: true, content: cleanedContent, name: title || "Truyện dán" });
            return;
        }
        
        const newFile: FileItem = { 
            id: crypto.randomUUID(), 
            name: title || `Chương ${core.files.length + 1}`, 
            content: cleanedContent, 
            translatedContent: isTranslated ? cleanedContent : null, 
            status: isTranslated ? FileStatus.COMPLETED : FileStatus.IDLE, 
            retryCount: 0, 
            originalCharCount: cleanedContent.length, 
            remainingRawCharCount: isTranslated ? countForeignChars(cleanedContent) : 0 
        };
        
        if (core.files.length > 0) {
            ui.setImportModal({ isOpen: true, pendingFiles: [newFile], tempInfo: null });
        } else {
            core.setFiles([newFile]);
            ui.setFilterStatuses(new Set()); // Clear filters
            ui.setFilterModels(new Set()); // Clear filters
            ui.addToast("Đã thêm nội dung", "success");
            onFilesAdded?.();
        }
    };

    // --- DOWNLOAD LOGIC ---

    return { processFiles, handleImportAppend, handleImportOverwrite, handlePasteConfirm };
};
