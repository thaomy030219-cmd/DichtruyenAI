import { useState, useRef } from 'react';
import { FileItem } from '../../types';
import { getAiClient, SAFETY_SETTINGS, smartExecution } from '../../services/api/gemini';

export interface UseSinoVietnameseFixerPageProps {
    files: FileItem[];
    setFilesSafe: (files: FileItem[] | ((prev: FileItem[]) => FileItem[])) => void;
    handleTranslatedFileUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
    addToast: (msg: string, type: 'success' | 'error' | 'info') => void;
    state: any;
    setState: any;
    storyInfo?: any;
    promptTemplate?: string;
    dictionary?: string;
    setAdditionalDictionary?: (v: string) => void;
    setStartTime?: (v: number | null) => void;
    setEndTime?: (v: number | null) => void;
    addLog?: (msg: string, type?: 'success' | 'error' | 'info') => void;
}

// Extracted from SinoVietnameseFixerPage.tsx (step 4 refactor): all state + AI
// handler logic for the Han-Viet fixer tool. Logic kept 100% identical to original.
// NOTE: handleTranslatedFileUpload is part of the props contract (also used directly
// by the SinoVietnameseFixerPage component itself) but this hook doesn't need it,
// so it's intentionally not destructured here.
export const useSinoVietnameseFixerPage = ({
    files, setFilesSafe, addToast, state, setState,
    storyInfo, promptTemplate, dictionary, setAdditionalDictionary,
    setStartTime, setEndTime, addLog
}: UseSinoVietnameseFixerPageProps) => {
    const [isAnalyzingRules, setIsAnalyzingRules] = useState(false);
    const [isScanning, setIsScanning] = useState(false);
    const [isFixing, setIsFixing] = useState(false);
    const [scanProgress, setScanProgress] = useState({ current: 0, total: 0 });
    const imageInputRef = useRef<HTMLInputElement>(null);

    const setUnfixedList = (val: string) => setState((prev: any) => ({ ...(prev || {}), unfixedList: val }));
    const setFixedList = (val: string) => setState((prev: any) => ({ ...(prev || {}), fixedList: val }));
    const setCustomRules = (val: string) => setState((prev: any) => ({ ...(prev || {}), customRules: val }));
    const setRuleImages = (val: string[]) => setState((prev: any) => ({ ...(prev || {}), sinoRuleImages: val }));

    const unfixedList = state?.unfixedList || '';
    const fixedList = state?.fixedList || '';
    const customRules = state?.customRules || '';
    const ruleImages: string[] = state?.sinoRuleImages || [];

    const CHUNK_SIZE = 800000;

    const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const uploadedFiles = e.target.files;
        if (!uploadedFiles || uploadedFiles.length === 0) return;
        const newImages = [...ruleImages];
        Array.from(uploadedFiles).forEach(file => {
            const reader = new FileReader();
            reader.onloadend = () => {
                newImages.push(reader.result as string);
                setRuleImages([...newImages]);
            };
            reader.readAsDataURL(file);
        });
        e.target.value = '';
    };

    const removeImage = (index: number) => {
        const updated = [...ruleImages];
        updated.splice(index, 1);
        setRuleImages(updated);
    };

    const handleAnalyzeRules = async () => {
        if (!customRules.trim() && ruleImages.length === 0) {
            addToast('Vui lòng nhập quy tắc hoặc tải ảnh minh họa lỗi!', 'error');
            return;
        }
        setIsAnalyzingRules(true);
        try {
            const ai = getAiClient();
            const contentParts: any[] = [];
            if (ruleImages.length > 0) {
                ruleImages.forEach(img => {
                    const mimeType = img.match(/data:([a-zA-Z0-9]+\/[a-zA-Z0-9-.+]+).*,.*/)?.[1] || 'image/jpeg';
                    contentParts.push({ inlineData: { data: img.split(',')[1], mimeType } });
                });
            }
            contentParts.push({
                text: `Bạn là chuyên gia biên tập bản dịch truyện tiên hiệp/huyền huyễn tiếng Việt.
${customRules.trim() ? `Yêu cầu/quy tắc người dùng nhập:\n${customRules.trim()}\n\n` : ''}${ruleImages.length > 0 ? 'Dựa trên ảnh lỗi đính kèm và ' : 'Dựa trên '}yêu cầu trên, hãy phân tích và đề xuất bộ quy tắc tìm kiếm và quét lỗi cụ thể, rõ ràng, có thể áp dụng ngay.

Trả về dạng văn bản quy tắc gọn gàng, mỗi dòng 1 quy tắc, ví dụ:
- Tìm và sửa lỗi xưng hô "Ta" thành "Ngươi" bị lẫn lộn trong đối thoại
- Tìm các cụm Hán Việt đảo ngược như "trung niên nam tử" → "nam tử trung niên"
- v.v.

CHỈ TRẢ VỀ CÁC DÒNG QUY TẮC, KHÔNG GIẢI THÍCH DÀI DÒNG.`
            });

            const res = await smartExecution(
                ['gemini-3.5-flash', 'gemini-3-flash-preview', 'gemini-3.1-flash-lite'],
                async (modelId) => {
                    const r = await ai.models.generateContent({
                        model: modelId,
                        contents: contentParts,
                        config: { safetySettings: SAFETY_SETTINGS, temperature: 0.2, maxOutputTokens: 4096 }
                    });
                    return r.text || '';
                },
                'Phân tích quy tắc Hán Việt',
                addLog
            );
            if (res.trim()) {
                setCustomRules(res.trim());
                addToast('Đã phân tích và cập nhật quy tắc! Bạn có thể chỉnh sửa trước khi quét.', 'success');
            }
        } catch (e: any) {
            addToast(`Lỗi phân tích quy tắc: ${e.message}`, 'error');
        } finally {
            setIsAnalyzingRules(false);
        }
    };

    const handleScan = async () => {
        setIsScanning(true);
        setFixedList('');
        setStartTime?.(Date.now());
        setEndTime?.(null);
        addLog?.('Bắt đầu quét Hán Việt...', 'info');

        try {
            const allText = files
                .filter(f => f.translatedContent)
                .map(f => f.translatedContent)
                .join('\n\n');

            if (!allText.trim()) {
                addToast('Không có nội dung bản dịch nào để quét.', 'error');
                setIsScanning(false);
                return;
            }

            const chunks: string[] = [];
            let i = 0;
            while (i < allText.length) {
                let end = i + CHUNK_SIZE;
                if (end < allText.length) {
                    let safeEnd = allText.lastIndexOf('\n', end);
                    if (safeEnd <= i) safeEnd = allText.lastIndexOf(' ', end);
                    if (safeEnd > i) end = safeEnd;
                }
                chunks.push(allText.slice(i, end));
                i = end;
            }

            const batches: string[][] = [];
            for (let j = 0; j < chunks.length; j += 2) batches.push(chunks.slice(j, j + 2));

            setScanProgress({ current: 0, total: batches.length });
            let combinedList = '';
            addLog?.(`Chia thành ${chunks.length} phần, ${batches.length} batch song song.`, 'info');

            for (let b = 0; b < batches.length; b++) {
                addLog?.(`Đang quét Batch ${b + 1}/${batches.length}...`, 'info');
                const customRulesPrompt = customRules ? `\nQuy tắc bổ sung:\n${customRules}\n` : '';

                const batchPromises = batches[b].map(async (chunk, idx) => {
                    const prompt = `Tìm và liệt kê các lỗi Hán Việt, cụm Hán Việt khó hiểu, lỗi đảo ngược từ, từ ngữ sai ngữ cảnh, và lỗi chèn ngoại ngữ.
KHÔNG bắt lỗi thuật ngữ/cảnh giới/pháp bảo tiên hiệp đặc thù.${customRulesPrompt}
Định dạng kết quả: "- [từ_lỗi] → [gợi_ý_sửa]" hoặc "- [từ_lỗi]". KHÔNG giải thích.

Văn bản:\n${chunk}`;
                    try {
                        return await smartExecution(
                            ['gemini-3.5-flash', 'gemini-3-flash-preview', 'gemini-3.1-flash-lite'],
                            async (modelId) => {
                                const ai = getAiClient();
                                const r = await ai.models.generateContent({
                                    model: modelId, contents: prompt,
                                    config: { safetySettings: SAFETY_SETTINGS }
                                });
                                return r.text || '';
                            },
                            `Quét Hán Việt batch ${b + 1} phần ${idx + 1}`,
                            addLog
                        );
                    } catch (e: any) {
                        addLog?.(`Lỗi quét batch ${b + 1} phần ${idx + 1}: ${e.message}`, 'error');
                        return '';
                    }
                });

                const results = await Promise.all(batchPromises);
                combinedList += results.filter(Boolean).join('\n') + '\n';
                setScanProgress({ current: b + 1, total: batches.length });
                await new Promise(r => setTimeout(r, 800));
            }

            const rawLines = [unfixedList, combinedList].join('\n').split('\n').map(l => l.trim()).filter(Boolean);
            const dedupMap = new Map<string, string>();
            rawLines.forEach(line => {
                const clean = line.replace(/^[-*•\d.]*\s*/, '').trim();
                if (clean && !clean.toLowerCase().includes('không tìm thấy')) {
                    const key = clean.toLowerCase().replace(/[^\w\s\u00C0-\u024F\u1E00-\u1EFF]/g, '');
                    if (!dedupMap.has(key)) dedupMap.set(key, clean);
                }
            });
            const deduped = Array.from(dedupMap.values()).map(e => `- ${e}`).join('\n');
            setUnfixedList(deduped || 'Không tìm thấy lỗi nào.');
            addToast('Quét xong!', 'success');
            addLog?.('Quét Hán Việt hoàn tất!', 'success');
        } catch (error: any) {
            addToast(`Lỗi quét: ${error.message}`, 'error');
        } finally {
            setIsScanning(false);
            setEndTime?.(Date.now());
        }
    };

    const handleFix = async () => {
        if (!unfixedList) return;
        setIsFixing(true);
        setStartTime?.(Date.now());
        setEndTime?.(null);

        const lines = unfixedList.split('\n').map(l => l.trim());
        const dedupMap = new Map<string, string>();
        for (const line of lines) {
            const clean = line.replace(/^[-*•\d.]*\s*/, '').trim();
            if (clean && !clean.toLowerCase().includes('không tìm thấy')) {
                const key = clean.toLowerCase().replace(/[^\w\s\u00C0-\u024F\u1E00-\u1EFF]/g, '');
                if (!dedupMap.has(key)) dedupMap.set(key, clean);
            }
        }
        const errorArray = Array.from(dedupMap.values());
        setUnfixedList(errorArray.map(e => `- ${e}`).join('\n'));

        if (errorArray.length === 0) {
            addToast('Danh sách lỗi trống.', 'info');
            setIsFixing(false);
            return;
        }

        const CHUNK_ITEMS = 500;
        const errorChunks: string[][] = [];
        for (let i = 0; i < errorArray.length; i += CHUNK_ITEMS) errorChunks.push(errorArray.slice(i, i + CHUNK_ITEMS));

        let contextInfo = '';
        if (storyInfo) {
            const tags = [...(storyInfo.genres || []), ...(storyInfo.worldSetting || []), ...(storyInfo.mcPersonality || [])].join(', ');
            if (tags) contextInfo += `\nThể loại/Tags: ${tags}`;
            if (storyInfo.contextNotes || storyInfo.summary) contextInfo += `\nNgữ cảnh: ${storyInfo.contextNotes || storyInfo.summary}`;
        }
        if (promptTemplate) contextInfo += `\nPrompt dịch gốc:\n${promptTemplate}`;
        if (dictionary) contextInfo += `\nTừ điển riêng:\n${dictionary}`;
        const customRulesPrompt = customRules ? `\nYêu cầu bổ sung:\n${customRules}\n` : '';

        try {
            addLog?.(`Bắt đầu Đề xuất Pro - ${errorChunks.length} phần, song song 2 luồng...`, 'info');
            let finalOut = '';

            // Process in parallel batches of 2
            for (let i = 0; i < errorChunks.length; i += 2) {
                const batchChunks = errorChunks.slice(i, i + 2);
                const batchPromises = batchChunks.map(async (chunk, bIdx) => {
                    const chunkList = chunk.map(e => `- ${e}`).join('\n');
                    const prompt = `Phân tích danh sách cụm từ nghi ngờ lỗi Hán Việt sau. Xác định cái nào thực sự cần sửa, gộp các biến thể trùng lặp.

BẢO TỒN: Thuật ngữ tiên hiệp, cảnh giới, tên riêng, địa danh, chiêu thức, thành ngữ Hán Việt quen thuộc.
${contextInfo}${customRulesPrompt}

YÊU CẦU ĐỊNH DẠNG (MÁY ĐỌC - NGHIÊM NGẶT):
Chỉ trả về danh sách quy tắc dạng: cụm lỗi -> cụm đã sửa. Mỗi quy tắc nằm trên một dòng riêng biệt. Không chứa dấu gạch đầu dòng, không ghi số thứ tự, và TUYỆT ĐỐI KHÔNG GIẢI THÍCH LÝ DO hay ghi thêm thông tin thừa nào khác.

Danh sách (Phần ${i + bIdx + 1}/${errorChunks.length}):\n${chunkList}`;

                    return await smartExecution(
                        ['gemini-3.1-pro-preview', 'gemini-3.5-flash'],
                        async (modelId) => {
                            const ai = getAiClient();
                            const r = await ai.models.generateContent({
                                model: modelId, contents: prompt,
                                config: { safetySettings: SAFETY_SETTINGS }
                            });
                            return r.text || '';
                        },
                        `Đề xuất Pro Hán Việt phần ${i + bIdx + 1}`,
                        addLog
                    );
                });

                const results = await Promise.all(batchPromises);
                finalOut += results.filter(Boolean).join('\n\n') + '\n\n';
                if (i + 2 < errorChunks.length) await new Promise(r => setTimeout(r, 800));
            }

            // Deduplicate output
            const mergedLines = finalOut.split('\n').filter(l => l.trim());
            const dedupFixes = new Map<string, string>();
            mergedLines.forEach(line => {
                const trimmed = line.trim();
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

                    if (wrong && wrong !== right) {
                        const key = wrong.toLowerCase();
                        if (!dedupFixes.has(key)) {
                            dedupFixes.set(key, `${wrong} -> ${right}`);
                        }
                    }
                } else if (trimmed.length > 2 && !trimmed.includes('```') && !trimmed.includes('---')) {
                    dedupFixes.set(trimmed.toLowerCase(), trimmed);
                }
            });

            setFixedList(Array.from(dedupFixes.values()).join('\n'));
            addToast('Đề xuất chỉnh sửa xong!', 'success');
            addLog?.(`Hoàn tất Đề xuất Pro - ${errorChunks.length} phần!`, 'success');
        } catch (e: any) {
            addToast(`Lỗi đề xuất sửa: ${e.message}`, 'error');
        } finally {
            setIsFixing(false);
            setEndTime?.(Date.now());
        }
    };

    const applyFixesToFiles = async (rulesText: string) => {
        if (!rulesText.trim()) {
            addToast('Không có quy tắc để áp dụng.', 'error');
            return;
        }

        setIsFixing(true);
        addLog?.('Đang chuẩn bị áp dụng quy tắc...', 'info');

        // Allow UI thread to breathe
        await new Promise(resolve => setTimeout(resolve, 50));

        try {
            const rules: { wrong: string; right: string }[] = [];
            rulesText.split('\n').forEach(line => {
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

            // Sort by length DESC to avoid partial replacements — longest rules matched first!
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
            addLog?.(`Lỗi sửa: ${e.message}`, 'error');
        } finally {
            setIsFixing(false);
        }
    };

    const handleSaveToDictionary = () => {
        if (!fixedList || !setAdditionalDictionary) return;
        let newDict = dictionary || '';
        let addCount = 0;
        fixedList.split('\n').forEach(line => {
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

                if (wrong && right) {
                    const ruleStr = `${wrong}=${right}`;
                    if (!newDict.includes(ruleStr)) {
                        newDict += (newDict ? '\n' : '') + ruleStr;
                        addCount++;
                    }
                }
            }
        });
        if (addCount > 0 && setAdditionalDictionary) {
            setAdditionalDictionary(newDict);
            addToast(`Đã lưu thêm ${addCount} từ vào Từ Điển.`, 'success');
        } else {
            addToast('Các từ này đã có sẵn trong Từ Điển.', 'info');
        }
    };

    const handleCopy = async (text: string) => {
        try { await navigator.clipboard.writeText(text); addToast('Đã copy!', 'success'); }
        catch { addToast('Copy thất bại', 'error'); }
    };

    const handleUploadTxt = (e: React.ChangeEvent<HTMLInputElement>, setter: (v: string) => void) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = ev => { if (ev.target?.result) { setter(ev.target.result as string); addToast('Đã tải dữ liệu!', 'success'); } };
        reader.readAsText(file);
        e.target.value = '';
    };


    return {
        isAnalyzingRules, isScanning, isFixing, scanProgress,
        imageInputRef,
        setUnfixedList, setFixedList, setCustomRules,
        unfixedList, fixedList, customRules, ruleImages,
        handleImageUpload, removeImage,
        handleAnalyzeRules, handleScan, handleFix, applyFixesToFiles,
        handleSaveToDictionary, handleCopy, handleUploadTxt,
    };
};
