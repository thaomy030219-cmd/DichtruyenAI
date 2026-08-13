import { useState, useRef } from 'react';
import { FileItem } from '../../types';
import { getAiClient, SAFETY_SETTINGS, smartExecution } from '../../services/api/gemini';
import { cleanRepetitiveContent } from '../../utils/text/optimization';

export interface UsePromptFixPageProps {
    files: FileItem[];
    setFilesSafe: (files: FileItem[] | ((prev: FileItem[]) => FileItem[])) => void;
    handleTranslatedFileUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
    addToast: (msg: string, type: 'success' | 'error' | 'info') => void;
    state: any;
    setState: any;
    storyInfo?: any;
    addLog?: (msg: string, type?: 'success' | 'error' | 'info') => void;
    promptTemplate?: string;
    dictionary?: string;
}

// Extracted from PromptFixPage.tsx (step 4 refactor): all state + AI handler logic
// for the prompt-error-fix tool. Logic kept 100% identical to original.
// NOTE: handleTranslatedFileUpload/promptTemplate/dictionary are part of the props
// contract (also used directly by the PromptFixPage component itself) but this hook
// doesn't need them, so they're intentionally not destructured here.
export const usePromptFixPage = ({
    files, setFilesSafe, addToast, state, setState, storyInfo, addLog
}: UsePromptFixPageProps) => {
    const [isAnalyzingReq, setIsAnalyzingReq] = useState(false);
    const [isScanning, setIsScanning] = useState(false);
    const [isProposing, setIsProposing] = useState(false);
    const [isFixing, setIsFixing] = useState(false);
    const [scanProgress, setScanProgress] = useState({ current: 0, total: 0 });
    const imageInputRef = useRef<HTMLInputElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const setRawErrors = (val: string) => setState((prev: any) => ({ ...(prev || {}), rawErrors: val }));
    const setProcessedFixes = (val: string) => setState((prev: any) => ({ ...(prev || {}), processedFixes: val }));
    const setPrompt = (val: string) => setState((prev: any) => ({ ...(prev || {}), prompt: val }));
    const setImages = (val: string[]) => setState((prev: any) => ({ ...(prev || {}), fixImages: val }));

    const rawErrors = state?.rawErrors || '';
    const processedFixes = state?.processedFixes || '';
    const fixPrompt = state?.prompt || '';
    const fixImages: string[] = state?.fixImages || [];

    const CHUNK_SIZE = 800000;

    const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const uploadedFiles = e.target.files;
        if (!uploadedFiles || uploadedFiles.length === 0) return;
        const newImages = [...fixImages];
        Array.from(uploadedFiles).forEach(file => {
            const reader = new FileReader();
            reader.onloadend = () => { newImages.push(reader.result as string); setImages([...newImages]); };
            reader.readAsDataURL(file);
        });
        e.target.value = '';
    };

    const handleUploadTxt = (e: React.ChangeEvent<HTMLInputElement>, setter: (v: string) => void) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = ev => { if (ev.target?.result) { setter(ev.target.result as string); addToast('Đã tải dữ liệu!', 'success'); } };
        reader.readAsText(file);
        e.target.value = '';
    };

    const removeImage = (index: number) => {
        const updated = [...fixImages];
        updated.splice(index, 1);
        setImages(updated);
    };

    // Analyze user requirements with Flash model, output refined scan rules
    const handleAnalyzeRequirements = async () => {
        if (!fixPrompt.trim() && fixImages.length === 0) {
            addToast('Vui lòng nhập yêu cầu hoặc tải ảnh lỗi minh họa!', 'error');
            return;
        }
        setIsAnalyzingReq(true);
        try {
            const ai = getAiClient();
            const parts: any[] = [];
            fixImages.forEach(img => {
                const mimeType = img.match(/data:([a-zA-Z0-9]+\/[a-zA-Z0-9-.+]+).*,.*/)?.[1] || 'image/jpeg';
                parts.push({ inlineData: { data: img.split(',')[1], mimeType } });
            });
            parts.push({
                text: `Bạn là chuyên gia biên tập bản dịch truyện tiên hiệp tiếng Việt.
${fixPrompt.trim() ? `Yêu cầu người dùng:\n${fixPrompt.trim()}\n\n` : ''}${fixImages.length > 0 ? 'Dựa trên ảnh lỗi đính kèm và ' : 'Dựa trên '}yêu cầu trên, hãy đề xuất bộ quy tắc tìm kiếm lỗi cụ thể và hướng xử lý rõ ràng.

Ví dụ đầu ra:
- Tìm các đoạn lỗi xưng hô "Ta" bị đổi thành "Ngươi" trong lời thoại nhân vật chính
- Tìm tên nhân vật "Lâm Phong" bị sai thành "Lâm Phàm" hoặc biến thể
- Tìm ký tự rác như "0" thay cho chữ "Linh" (vd: "0 tỷ" → "Linh tỷ")

CHỈ TRẢ VỀ CÁC DÒNG QUY TẮC GỌN GÀNG, KHÔNG GIẢI THÍCH DÀI DÒNG.`
            });

            const res = await smartExecution(
                ['gemini-3.5-flash', 'gemini-3-flash-preview', 'gemini-3.1-flash-lite'],
                async (modelId) => {
                    const r = await ai.models.generateContent({
                        model: modelId,
                        contents: parts,
                        config: { safetySettings: SAFETY_SETTINGS, temperature: 0.2, maxOutputTokens: 4096 }
                    });
                    return r.text || '';
                },
                'Phân tích yêu cầu sửa lỗi',
                addLog
            );

            if (res.trim()) {
                setPrompt(res.trim());
                addToast('Đã phân tích và cập nhật yêu cầu! Bạn có thể chỉnh sửa trước khi quét.', 'success');
            }
        } catch (e: any) {
            addToast(`Lỗi phân tích: ${e.message}`, 'error');
        } finally {
            setIsAnalyzingReq(false);
        }
    };

    const handleScan = async () => {
        if (!fixPrompt.trim() && fixImages.length === 0) {
            addToast('Vui lòng nhập yêu cầu sửa lỗi hoặc tải ảnh minh họa!', 'error');
            return;
        }

        setIsScanning(true);
        setProcessedFixes('');
        addLog?.('Bắt đầu quét lỗi...', 'info');

        try {
            const allText = files
                .filter(f => f.translatedContent || f.content)
                .map(f => f.translatedContent || f.content)
                .join('\n\n');

            if (!allText.trim()) {
                addToast('Không có văn bản để quét. Hãy tải file trước.', 'error');
                return;
            }

            const chunks: string[] = [];
            let idx = 0;
            while (idx < allText.length) {
                chunks.push(allText.substring(idx, idx + CHUNK_SIZE));
                idx += CHUNK_SIZE;
            }

            setScanProgress({ current: 0, total: chunks.length });

            const baseImageParts: any[] = fixImages.map(img => ({
                inlineData: {
                    data: img.split(',')[1],
                    mimeType: img.match(/data:([a-zA-Z0-9]+\/[a-zA-Z0-9-.+]+).*,.*/)?.[1] || 'image/jpeg'
                }
            }));

            let collectedRaw = rawErrors ? rawErrors + '\n' : '';
            setRawErrors(collectedRaw);
            const ai = getAiClient();

            for (let i = 0; i < chunks.length; i += 2) {
                const batch = chunks.slice(i, i + 2);
                const promises = batch.map(chunk => {
                    const parts: any[] = [
                        {
                            text: `[Tên truyện: ${storyInfo?.title || 'Unknown'}]
[YÊU CẦU SỬA LỖI]
${fixPrompt}

[NHIỆM VỤ]
Dựa vào yêu cầu (và ảnh nếu có), quét đoạn text sau và trích xuất các đoạn bị lỗi tương tự.
Chỉ liệt kê lỗi tìm thấy, dạng gạch đầu dòng, KHÔNG giải thích.

[TEXT CẦN QUÉT]
`
                        },
                        ...baseImageParts,
                        { text: chunk }
                    ];

                    return smartExecution(
                        ['gemini-3.5-flash', 'gemini-3-flash-preview'],
                        async (modelId) => {
                            const res = await ai.models.generateContent({
                                model: modelId,
                                contents: parts,
                                config: { safetySettings: SAFETY_SETTINGS, temperature: 0.1, maxOutputTokens: 8192 }
                            });
                            return res.text || '';
                        },
                        'Quét Lỗi Flash',
                        undefined
                    );
                });

                const results = await Promise.all(promises);
                for (const txt of results) {
                    if (txt.trim()) {
                        collectedRaw += '\n' + txt.trim();
                        setRawErrors(cleanRepetitiveContent(collectedRaw));
                    }
                }
                setScanProgress({ current: Math.min(i + 2, chunks.length), total: chunks.length });
            }

            addLog?.('Quét xong. Sẵn sàng đề xuất Pro.', 'success');
            addToast('Quét xong! Nhấn "Đề xuất Pro" để tạo quy tắc sửa.', 'success');

        } catch (e: any) {
            addToast(`Lỗi quét: ${e.message}`, 'error');
        } finally {
            setIsScanning(false);
            setScanProgress({ current: 0, total: 0 });
        }
    };

    const handlePropose = async () => {
        if (!rawErrors.trim()) {
            addToast('Chưa có lỗi thô để đề xuất. Hãy quét trước.', 'error');
            return;
        }

        const errorLines = rawErrors.split('\n').map(l => l.trim()).filter(Boolean);
        const CHUNK_ITEMS = 500;
        const errorChunks: string[][] = [];
        for (let i = 0; i < errorLines.length; i += CHUNK_ITEMS) errorChunks.push(errorLines.slice(i, i + CHUNK_ITEMS));

        setIsProposing(true);
        addLog?.(`Bắt đầu Đề xuất Pro - ${errorChunks.length} phần...`, 'info');

        try {
            const baseImageParts: any[] = fixImages.map(img => ({
                inlineData: {
                    data: img.split(',')[1],
                    mimeType: img.match(/data:([a-zA-Z0-9]+\/[a-zA-Z0-9-.+]+).*,.*/)?.[1] || 'image/jpeg'
                }
            }));

            const ai = getAiClient();
            let finalOut = '';

            // Process in parallel batches of 2
            for (let i = 0; i < errorChunks.length; i += 2) {
                const batchChunks = errorChunks.slice(i, i + 2);
                const batchPromises = batchChunks.map(async (chunk, bIdx) => {
                    const chunkText = chunk.join('\n');
                    const parts: any[] = [
                        {
                            text: `[Tên truyện: ${storyInfo?.title || ''}]
[YÊU CẦU GỐC]
${fixPrompt}

[LỖI THÔ TÌM THẤY]
${chunkText}

[NHIỆM VỤ]
Phân tích lỗi thô, kết hợp yêu cầu (và ảnh nếu có). Đề xuất quy tắc CHỈNH SỬA TOÀN BỘ.

BẢO TỒN: Thuật ngữ tiên hiệp, cảnh giới, tên riêng, địa danh, thành ngữ Hán Việt.

YÊU CẦU ĐỊNH DẠNG (MÁY ĐỌC - NGHIÊM NGẶT):
Mỗi quy tắc trên 1 dòng theo kiểu: cụm từ / từ cần sửa -> đã chuẩn hóa
Chỉ 1 phương án đúng nhất - KHÔNG dùng "/" hoặc thêm giải thích dông dài ở vế sau. TUYỆT ĐỐI không viết bất kỳ lý giải nào khác.

Ví dụ:
Lâm Phong -> Lâm Phàm
hoàn toàn 0 -> hoàn toàn không

Phần ${i + bIdx + 1}/${errorChunks.length}:`
                        },
                        ...baseImageParts
                    ];

                    return smartExecution(
                        ['gemini-3.1-pro-preview'],
                        async (modelId) => {
                            const r = await ai.models.generateContent({
                                model: modelId,
                                contents: parts,
                                config: { safetySettings: SAFETY_SETTINGS, temperature: 0.1 }
                            });
                            return r.text || '';
                        },
                        `Đề xuất Pro phần ${i + bIdx + 1}`,
                        addLog
                    );
                });

                const results = await Promise.all(batchPromises);
                finalOut += results.filter(Boolean).join('\n') + '\n';
                if (i + 2 < errorChunks.length) await new Promise(r => setTimeout(r, 800));
            }

            setProcessedFixes(cleanRepetitiveContent(finalOut));
            addToast('Đã tạo đề xuất quy tắc!', 'success');
            addLog?.('Đề xuất Pro hoàn tất.', 'success');
        } catch (e: any) {
            addToast(`Lỗi đề xuất: ${e.message}`, 'error');
        } finally {
            setIsProposing(false);
        }
    };

    const applyFixesToTranslation = async () => {
        if (!processedFixes.trim()) {
            addToast('Không có quy tắc để áp dụng.', 'error');
            return;
        }

        setIsFixing(true);
        addLog?.('Đang chuẩn bị áp dụng quy tắc sửa lỗi...', 'info');

        // Allow UI to breathe
        await new Promise(resolve => setTimeout(resolve, 50));

        try {
            const rules: { wrong: string; right: string }[] = [];
            processedFixes.split('\n').forEach(line => {
                const trimmed = line.trim();
                if (!trimmed) return;
                const cleanedLine = trimmed.replace(/^[-*\s\d.]+\s*/, '');
                if (!cleanedLine) return;

                let delimiter = '';
                let index = -1;
                const delimiters = ['->', '→', '=>', '='];
                for (const delim of delimiters) {
                    const idx = cleanedLine.indexOf(delim);
                    if (idx !== -1) {
                        delimiter = delim;
                        index = idx;
                        break;
                    }
                }

                if (index !== -1) {
                    let wrong = cleanedLine.slice(0, index).trim();
                    let right = cleanedLine.slice(index + delimiter.length).trim();
                    right = right.replace(/\s*[\(\[].*$/, '').trim();

                    wrong = wrong.replace(/^["'`\[\<\{\(*_]+/g, '').replace(/["'`\]\>\}\)\*_]+$/g, '').trim();
                    right = right.replace(/^["'`\[\<\{\(*_]+/g, '').replace(/["'`\]\>\}\)\*_]+$/g, '').trim();

                    wrong = wrong.replace(/\\n/g, '\n');
                    right = right.replace(/\\n/g, '\n');

                    if (wrong && wrong !== right) {
                        rules.push({ wrong, right });
                    }
                }
            });

            if (rules.length === 0) {
                addToast('Không tìm thấy quy tắc hợp lệ (cấu trúc Sai -> Đúng hoặc Sai = Đúng).', 'error');
                setIsFixing(false);
                return;
            }

            // Sort by length DESC — fix longest patterns first to avoid partial match issues
            rules.sort((a, b) => b.wrong.length - a.wrong.length);

            // Safe rules limit to prevent browser memory bloat or crash
            const MAX_RULES = 500;
            const originalLength = rules.length;
            
            if (originalLength > MAX_RULES) {
                const msg = `Có ${originalLength} quy tắc. Sẽ chia làm nhiều lô, mỗi lô ${MAX_RULES} quy tắc để bảo vệ trình duyệt.`;
                addToast(msg, 'info');
                addLog?.(msg, 'info');
            }

            const totalFilesAffected = new Set<number>();
            let totalOccurrences = 0;
            const newFiles = [...files];

            // Perform edits asynchronously with file pacing (batch size 15) to avoid locking render frame
            const BATCH_SIZE = 15;
            
            for (let r = 0; r < rules.length; r += MAX_RULES) {
                const activeRules = rules.slice(r, r + MAX_RULES);
                const ruleBatchNum = Math.floor(r / MAX_RULES) + 1;
                const totalRuleBatches = Math.ceil(rules.length / MAX_RULES);
                
                if (totalRuleBatches > 1) {
                    addLog?.(`Đang áp dụng lô quy tắc ${ruleBatchNum}/${totalRuleBatches} (${activeRules.length} quy tắc)...`, 'info');
                }

                for (let i = 0; i < newFiles.length; i += BATCH_SIZE) {
                    const chunk = newFiles.slice(i, i + BATCH_SIZE);
                    
                    if (totalRuleBatches === 1) {
                        addLog?.(`Đang xử lý lô chương ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(newFiles.length / BATCH_SIZE)} (Chương ${i + 1} - ${Math.min(i + BATCH_SIZE, newFiles.length)})...`, 'info');
                    } else if (i % (BATCH_SIZE * 4) === 0) { // Log less frequently when multiple rule batches
                        addLog?.(`[Lô QT ${ruleBatchNum}/${totalRuleBatches}] Quét từ chương ${i + 1}/${newFiles.length}...`, 'info');
                    }

                    chunk.forEach((file, relativeIndex) => {
                        const idx = i + relativeIndex;
                        if (!file.translatedContent && !file.content) return;
                        let text = (file.translatedContent || file.content) as string;
                        let fileChanged = false;

                        activeRules.forEach(rule => {
                            const escaped = rule.wrong.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                            const robustSpaceEscaped = escaped.replace(/\s+/g, '\\s+');
                            
                            const firstChar = rule.wrong[0];
                            const lastChar = rule.wrong[rule.wrong.length - 1];
                            const isFirstLetter = /\p{L}/u.test(firstChar);
                            const isLastLetter = /\p{L}/u.test(lastChar);

                            const leftBoundary = isFirstLetter ? `(^|[^\\p{L}\\p{N}_])` : `()`;
                            const rightBoundary = isLastLetter ? `(?=[^\\p{L}\\p{N}_]|$)` : ``;
                            const regex = new RegExp(`${leftBoundary}(${robustSpaceEscaped})${rightBoundary}`, 'gu');
                            
                            let changed = false;
                            const nextText = text.replace(regex, (match, prefix) => {
                                changed = true;
                                return prefix + rule.right;
                            });
                            if (changed) {
                                const tempOccurrences = nextText !== text ? text.split(new RegExp(regex.source, 'u')).length - 1 : 0;
                                totalOccurrences += tempOccurrences > 0 ? tempOccurrences : 1; 
                                text = nextText;
                                fileChanged = true;
                            }
                        });

                        if (fileChanged) {
                            totalFilesAffected.add(idx);
                            newFiles[idx] = { ...file };
                            if (newFiles[idx].translatedContent) newFiles[idx].translatedContent = text;
                            else newFiles[idx].content = text;
                        }
                    });

                    // Yield control back to browser to prevent UI freeze
                    await new Promise(resolve => setTimeout(resolve, 0));
                }
            }

            setFilesSafe(newFiles);
            const msg = `Đã áp dụng ${originalLength} quy tắc, thay thế ${totalOccurrences} vị trí trong ${totalFilesAffected.size} file!`;
            addToast(msg, 'success');
            addLog?.(msg, 'success');
        } catch (e: any) {
            addToast(`Lỗi sửa dịch: ${e.message}`, 'error');
        } finally {
            setIsFixing(false);
        }
    };

    const isWorking = isScanning || isFixing || isProposing || isAnalyzingReq;

    return {
        isAnalyzingReq, isScanning, isProposing, isFixing, scanProgress,
        imageInputRef, fileInputRef,
        setRawErrors, setProcessedFixes, setPrompt,
        rawErrors, processedFixes, fixPrompt, fixImages,
        handleImageUpload, handleUploadTxt, removeImage,
        handleAnalyzeRequirements, handleScan, handlePropose, applyFixesToTranslation,
        isWorking,
    };
};
