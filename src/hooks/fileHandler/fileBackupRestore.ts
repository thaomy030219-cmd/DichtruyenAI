// Nhóm hàm: BACKUP/KHÔI PHỤC toàn bộ dữ liệu app ra/from 1 file JSON.
import { FileItem } from '../../types';
import { downloadJsonFile, fileToBase64, base64ToFile } from '../../utils/fileHelpers';
import { clearDatabase } from '../../utils/storage';
import { readFileAsText } from '../../utils/fileHelpers';

export const useFileBackupRestore = (core: any, ui: any) => {
    const handleBackup = async () => {
        let coverBase64 = null;
        if (core.coverImage) {
            try { coverBase64 = await fileToBase64(core.coverImage); } catch(e) { console.warn("Lỗi mã hóa ảnh bìa:", e); }
        }
        const dataToSave = { ...core.stateRef.current, coverImageBase64: coverBase64, lastSaved: new Date().toISOString(), batchLimits: core.batchLimits, ratioLimits: core.ratioLimits };
        const safeData = { ...dataToSave };
        delete safeData.coverImage;
        delete safeData.openRouterKey; // Do not backup API key
        downloadJsonFile(`Backup_${core.storyInfo.title || 'Data'}_${new Date().toISOString().split('T')[0]}.json`, safeData);
        ui.addToast("Đã xuất file Backup (.json) kèm Ảnh bìa", "success");
    };


    const handleRestore = async (e: React.ChangeEvent<HTMLInputElement>): Promise<boolean> => {
        const file = e.target.files?.[0];
        if (!file) return false;
        try {
            const text = await readFileAsText(file);
            const data = JSON.parse(text);
            if (data.files && Array.isArray(data.files)) {
                // Clear storage first to prevent quota or corruption issues when overwriting
                try {
                    await clearDatabase();
                } catch (clearErr) {
                    console.warn("Could not clear storage before restore, proceeding anyway...", clearErr);
                }
                
                // Phiên làm việc mới: reset cờ "bản dịch nghi vấn do hậu kiểm" (hasStaleTranslation) -
                // trạng thái cách ly tạm thời đó không nên tồn tại xuyên suốt qua các phiên khác nhau.
                const restoredFiles = (data.files as FileItem[]).map(f => f.hasStaleTranslation ? { ...f, hasStaleTranslation: false } : f);
                core.setFiles(restoredFiles);
                if (data.storyInfo) core.setStoryInfo({ ...core.storyInfo, ...data.storyInfo });
                if (data.creativeState) core.setCreativeState(data.creativeState);
                if (data.sinoVietnameseState) core.setSinoVietnameseState(data.sinoVietnameseState);
                if (data.fixErrorState) core.setFixErrorState(data.fixErrorState);
                if (data.promptTemplate) core.setPromptTemplate(data.promptTemplate);
                if (data.additionalDictionary) core.setAdditionalDictionary(data.additionalDictionary);
                
                // Restore Limits with Forced Updates
                if (data.batchLimits) {
                    const bl = { ...data.batchLimits };
                    if (bl.latin) {
                        if (bl.latin.v31 === undefined) bl.latin.v31 = 12;
                        if (bl.latin.v36 === undefined) bl.latin.v36 = 6;
                        if (bl.latin.v35 === undefined || bl.latin.v35 === 5 || bl.latin.v35 === 10) bl.latin.v35 = 6;
                    }
                    if (bl.complex) {
                        if (bl.complex.v31 === undefined) bl.complex.v31 = 12;
                        if (bl.complex.v36 === undefined) bl.complex.v36 = 6;
                        if (bl.complex.v35 === undefined || bl.complex.v35 === 5 || bl.complex.v35 === 10) bl.complex.v35 = 6;
                    }
                    
                    core.setBatchLimits(bl);
                }
                if (data.ratioLimits) {
                    const rl = { ...data.ratioLimits };
                    // Force update VN min ratio if it's the old default (0.3) or missing
                    if (rl.vn) {
                        if (rl.vn.min === 0.3 || rl.vn.min === undefined) rl.vn.min = 0.6;
                    }
                    core.setRatioLimits(rl);
                }

                if (data.enabledModels) {
                    // Filter valid models and explicitly ensure 3.1 flash lite is enabled
                    const validModels = data.enabledModels.filter((id: string) => core.modelConfigs?.some((m: any) => m.id === id));
                    if (!validModels.includes('gemini-3.7-flash')) {
                        validModels.push('gemini-3.7-flash');
                    }
                    if (!validModels.includes('gemini-3.5-flash-lite')) {
                        validModels.push('gemini-3.5-flash-lite');
                    }
                    if (!validModels.includes('gemini-3.1-flash-lite')) {
                        validModels.push('gemini-3.1-flash-lite');
                    }
                    if (!validModels.includes('gemini-3.5-flash')) {
                        validModels.push('gemini-3.5-flash');
                    }
                    if (!validModels.includes('gemini-3-flash-preview')) {
                        validModels.push('gemini-3-flash-preview');
                    }
                    if (!validModels.includes('gemini-3.1-flash-lite-image')) {
                        validModels.push('gemini-3.1-flash-lite-image');
                    }
                    if (!validModels.includes('gemma-4-26b-a4b-it')) {
                        validModels.push('gemma-4-26b-a4b-it');
                    }
                    if (!validModels.includes('gemma-4-31b-it')) {
                        validModels.push('gemma-4-31b-it');
                    }
                    core.setEnabledModels(validModels);
                } else {
                    // If no enabledModels in backup, enable all by default
                    if (core.modelConfigs) {
                        core.setEnabledModels(core.modelConfigs.map((m: any) => m.id));
                    }
                }

                if (data.coverImageBase64) {
                    try { core.setCoverImage(base64ToFile(data.coverImageBase64, "restored_cover.png")); } catch { /* ignore */ }
                }
                ui.setActiveTab('workspace'); // Select 'Biên tập' tab
                ui.setCurrentPage(1); // Show page 1
                ui.setFilterStatuses(new Set()); // Clear filters
                ui.setFilterModels(new Set()); // Clear filters
                
                // Force an immediate save to IndexedDB to prevent silent failures, overriding stale checks
                const saveSuccess = await core.saveSession(true, true);
                
                if (saveSuccess) {
                    ui.addToast("Khôi phục dữ liệu thành công!", "success");
                } else {
                    ui.addToast("Khôi phục thành công trên giao diện, nhưng lỗi khi lưu vào bộ nhớ. Vui lòng Reset Data App và thử lại.", "error");
                }
                
                e.target.value = '';
                return saveSuccess;
            } else { 
                ui.addToast("File Backup không hợp lệ", "error"); 
                e.target.value = '';
                return false;
            }
        } catch (err: any) { 
            ui.addToast(`Lỗi khôi phục: ${err.message}`, "error"); 
            e.target.value = '';
            return false;
        }
    };

    return { handleBackup, handleRestore };
};
