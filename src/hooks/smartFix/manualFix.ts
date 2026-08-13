// Sửa lỗi thủ công cho 1 file đơn lẻ (bấm nút sửa trên từng dòng file trong danh sách).
import { FileItem, FileStatus } from '../../types';
import { repairTranslations } from '../../geminiService';
import { findLinesWithForeignChars, mergeFixedLines, formatBookStyle, countForeignChars } from '../../utils/text';

export const useManualFix = (core: any, ui: any, sharedState: any) => {
    const { setProcessingQueue, setStartTime, isFixPhaseRef, scheduledBatchesRef, setIsProcessing, effectiveDictionary, translationTier } = sharedState;

    const handleManualFixSingle = async (e: React.MouseEvent, fileId: string) => {
        e.stopPropagation();
        const file = core.files.find((f: FileItem) => f.id === fileId);
        if (!file) return;
        const translatedLen = file.translatedContent?.length || 1;
        const ratio = file.remainingRawCharCount / translatedLen;
        
        if (file.remainingRawCharCount > 100 || ratio > 0.15) {
            scheduledBatchesRef.current.delete(fileId);
            core.setFiles((prev: FileItem[]) => prev.map((f: FileItem) => f.id === fileId ? { ...f, status: FileStatus.IDLE, retryCount: 0, translatedContent: null, remainingRawCharCount: 0 } : f));
            setProcessingQueue((prev: string[]) => [...prev, fileId]);
            setIsProcessing(true);
            isFixPhaseRef.current = true;
            if (!sharedState.startTime) setStartTime(Date.now());
            ui.addToast(`Phát hiện lỗi nặng: Đã thêm vào hàng đợi dịch lại (Pro Mode).`, 'info');
        } else {
            if (file.status === FileStatus.REPAIRING || file.status === FileStatus.PROCESSING) return;
            core.setFiles((prev: FileItem[]) => prev.map((f: FileItem) => f.id === fileId ? { ...f, status: FileStatus.REPAIRING } : f));
            ui.addToast("Đang sửa lỗi nhỏ bằng Model Pro (Assistant Mode)...", "info");
            try {
                if (file.translatedContent) {
                    const badLines = findLinesWithForeignChars(file.translatedContent);
                    if (badLines.length > 0) {
                        const fixes = await repairTranslations(badLines, effectiveDictionary, translationTier, core.storyInfo.contextNotes, core.storyInfo, core.promptTemplate, (msg) => ui.addLog(msg, 'info'), core.enabledModels);
                        if (fixes.length > 0) {
                            const fixedContent = mergeFixedLines(file.translatedContent, fixes);
                            const cleanContent = formatBookStyle(fixedContent, file.content, core.storyInfo?.enableTitleFormatting !== false, core.storyInfo?.titleFormat, core.storyInfo?.enableAutoFormat !== false);
                            const remainingRaw = countForeignChars(cleanContent);
                            core.setFiles((prev: FileItem[]) => prev.map((f: FileItem) => f.id === file.id ? { ...f, status: FileStatus.COMPLETED, translatedContent: cleanContent, remainingRawCharCount: remainingRaw } : f));
                            ui.addToast("Đã sửa xong!", "success");
                        } else {
                            ui.addToast("Không thể sửa tự động.", "error");
                            core.setFiles((prev: FileItem[]) => prev.map((f: FileItem) => f.id === file.id ? { ...f, status: FileStatus.COMPLETED } : f));
                        }
                    } else {
                        core.setFiles((prev: FileItem[]) => prev.map((f: FileItem) => f.id === file.id ? { ...f, status: FileStatus.COMPLETED, remainingRawCharCount: 0 } : f));
                        ui.addToast("File đã sạch, không cần sửa.", "success");
                    }
                }
            } catch (err: any) {
                ui.addToast(`Lỗi sửa: ${err.message}`, "error");
                core.setFiles((prev: FileItem[]) => prev.map((f: FileItem) => f.id === file.id ? { ...f, status: FileStatus.COMPLETED } : f));
            }
        }
    };

    return { handleManualFixSingle };
};
