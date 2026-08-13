// File-list CRUD and selection: save/merge selected files, select/range-select,
// delete (single/selected/all), and the destructive full-app reset — all the
// confirm-modal-gated list operations. Split out of the old monolithic
// `useAppHandlers.ts` — logic unchanged.
import { FileItem, FileStatus } from '../../types';
import { countForeignChars } from '../../utils/text';

export const useFileListHandlers = (core: any, ui: any) => {
    const handleSaveSelected = async () => {
        if (ui.selectedFiles.size === 0) {
            ui.addToast("Vui lòng chọn ít nhất 1 file để lưu.", "warning");
            return;
        }
        
        // Mark selected files as COMPLETED so they don't get re-translated (only if they have content)
        core.setFiles((prev: FileItem[]) => prev.map((f: FileItem) => {
            if (ui.selectedFiles.has(f.id)) {
                if (f.translatedContent && f.translatedContent.trim() !== '') {
                    return { ...f, status: FileStatus.COMPLETED, errorMessage: undefined, retryCount: 0 };
                } else {
                    return { ...f, status: FileStatus.IDLE, errorMessage: undefined, retryCount: 0 };
                }
            }
            return f;
        }));

        // Wait a tick for state to update before saving
        setTimeout(async () => {
            const success = await core.saveSession(true);
            if (success) {
                ui.addToast(`Đã lưu và cập nhật trạng thái ${ui.selectedFiles.size} file.`, "success");
                ui.setSelectedFiles(new Set()); // Clear selection after save
            } else {
                ui.addToast("Lỗi khi lưu dữ liệu.", "error");
            }
        }, 0);
    };

    const handleMergeSelected = () => {
        if (ui.selectedFiles.size < 2) {
            ui.addToast("Chọn ít nhất 2 file để gộp", 'warning');
            return;
        }
        
        const selected = core.files.filter((f: FileItem) => ui.selectedFiles.has(f.id));
        // Sort by name naturally
        selected.sort((a: FileItem, b: FileItem) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
        
        const firstFile = selected[0];
        const extension = firstFile.name.split('.').pop();
        const baseName = firstFile.name.replace(/\.[^/.]+$/, "");
        const newName = `${baseName}_Merged.${extension || 'txt'}`;
        
        const mergedContent = selected.map((f: FileItem) => f.content).join('\n\n' + '='.repeat(20) + '\n\n');
        // Only merge translated content if ALL selected files have it
        const allTranslated = selected.every((f: FileItem) => f.translatedContent);
        const mergedTranslated = allTranslated ? selected.map((f: FileItem) => f.translatedContent).join('\n\n' + '='.repeat(20) + '\n\n') : undefined;
        
        const newFile: FileItem = {
            id: crypto.randomUUID(),
            name: newName,
            content: mergedContent,
            originalCharCount: mergedContent.length,
            translatedContent: mergedTranslated,
            status: allTranslated ? FileStatus.COMPLETED : FileStatus.IDLE,
            remainingRawCharCount: allTranslated ? countForeignChars(mergedTranslated!) : countForeignChars(mergedContent),
            errorMessage: null,
            usedModel: null,
            retryCount: 0,
            processingDuration: 0
        };
        
        core.setFiles((prev: FileItem[]) => [...prev, newFile]);
        ui.addToast(`Đã gộp ${selected.length} file thành "${newName}"`, 'success');
        
        // Optional: Select the new file
        ui.setSelectedFiles(new Set([newFile.id]));
    };

    const handleRemoveFile = (id: string) => { 
        ui.setConfirmModal({
            isOpen: true,
            title: "Xóa File?",
            message: "Bạn có chắc chắn muốn xóa file này không?",
            isDanger: true,
            confirmText: "Xóa Ngay",
            onConfirm: () => {
                core.setFiles((prev: FileItem[]) => prev.filter(f => f.id !== id)); 
                ui.setSelectedFiles((prev: Set<string>) => { const n = new Set(prev); n.delete(id); return n; }); 
                ui.setConfirmModal((prev: any) => ({...prev, isOpen: false}));
                ui.addToast("Đã xóa file", "success");
            },
            onCancel: () => ui.setConfirmModal((prev: any) => ({...prev, isOpen: false}))
        });
    };

    const handleSmartDelete = () => {
        if (ui.selectedFiles.size === 0) return;
        ui.setConfirmModal({
            isOpen: true,
            title: `Xóa ${ui.selectedFiles.size} File?`,
            message: "Hành động này sẽ xóa các file đang chọn khỏi danh sách. Bạn có chắc không?",
            isDanger: true,
            confirmText: "Xóa Tất Cả Chọn",
            onConfirm: () => {
                core.setFiles((prev: FileItem[]) => prev.filter(f => !ui.selectedFiles.has(f.id)));
                ui.setSelectedFiles(new Set());
                ui.setConfirmModal((prev: any) => ({...prev, isOpen: false}));
                ui.addToast("Đã xóa các file đã chọn", "success");
            },
            onCancel: () => ui.setConfirmModal((prev: any) => ({...prev, isOpen: false}))
        });
    };

    const requestDeleteAll = () => {
        if (core.files.length === 0) return;
        ui.setConfirmModal({
            isOpen: true,
            title: "Xóa Toàn Bộ?",
            message: "CẢNH BÁO: Hành động này sẽ xóa sạch tất cả các file hiện có. Dữ liệu chưa lưu sẽ bị mất.",
            isDanger: true,
            confirmText: "XÓA HẾT",
            onConfirm: () => {
                core.setFiles([]);
                ui.setSelectedFiles(new Set());
                ui.setConfirmModal((prev: any) => ({...prev, isOpen: false}));
                ui.addToast("Đã dọn sạch danh sách file", "success");
            },
            onCancel: () => ui.setConfirmModal((prev: any) => ({...prev, isOpen: false}))
        });
    };

    const requestResetApp = () => {
        ui.setConfirmModal({
            isOpen: true,
            title: "Reset Toàn Bộ App?",
            message: "CẢNH BÁO NGUY HIỂM: Hành động này sẽ xóa sạch toàn bộ dữ liệu, file và cài đặt. Ứng dụng sẽ trở về trạng thái như mới cài đặt. Bạn có chắc chắn muốn tiếp tục?",
            isDanger: true,
            confirmText: "RESET TOÀN BỘ",
            onConfirm: () => {
                core.performSoftReset();
                ui.setConfirmModal((prev: any) => ({...prev, isOpen: false}));
                ui.addToast("Đã reset toàn bộ ứng dụng", "success");
            },
            onCancel: () => ui.setConfirmModal((prev: any) => ({...prev, isOpen: false}))
        });
    };

    const handleSelectFile = (id: string, shiftKey: boolean) => {
        const newSelected = new Set(ui.selectedFiles);
        if (shiftKey && ui.lastSelectedId) {
            const idx1 = core.files.findIndex((f: FileItem) => f.id === ui.lastSelectedId);
            const idx2 = core.files.findIndex((f: FileItem) => f.id === id);
            const start = Math.min(idx1, idx2);
            const end = Math.max(idx1, idx2);
            for (let i = start; i < end + 1; i++) newSelected.add(core.files[i].id);
        } else {
            if (newSelected.has(id)) newSelected.delete(id); else newSelected.add(id);
            ui.setLastSelectedId(id);
        }
        ui.setSelectedFiles(newSelected);
    };

    const selectAll = () => { if (ui.selectedFiles.size === core.files.length) ui.setSelectedFiles(new Set()); else ui.setSelectedFiles(new Set(core.files.map((f: FileItem) => f.id))); };

    const handleRangeSelect = () => {
        const start = parseInt(ui.rangeStart);
        const end = parseInt(ui.rangeEnd);
        
        if (isNaN(start) || isNaN(end) || start > end || start < 1) {
            ui.addToast("Vui lòng nhập khoảng hợp lệ (Start <= End)", "warning");
            return;
        }

        // Note: core.files are NOT guaranteed to be sorted by index unless we sort them.
        // But usually they are displayed in list order. We'll select based on Array Index (1-based for user).
        const newSelected = new Set(ui.selectedFiles);
        const maxIndex = core.files.length;
        const actualStart = Math.max(0, start - 1);
        const actualEnd = Math.min(maxIndex, end);

        for (let i = actualStart; i < actualEnd; i++) {
            newSelected.add(core.files[i].id);
        }
        
        ui.setSelectedFiles(newSelected);
        ui.addToast(`Đã chọn ${newSelected.size} file (Từ ${start} đến ${actualEnd})`, "success");
    };

    const handleQuickParse = () => {
        if (!ui.quickInput.trim()) return;
        // Simple parse for demo
        ui.setQuickInput('');
        ui.addToast("Đã cập nhật thẻ thông tin", "success");
    };

    return {
        handleSaveSelected,
        handleMergeSelected,
        handleRemoveFile,
        handleSmartDelete,
        requestDeleteAll,
        requestResetApp,
        handleSelectFile,
        selectAll,
        handleRangeSelect,
        handleQuickParse,
    };
};
