import { useState, useRef, useEffect } from 'react';
import { getAiClient, smartExecution, SAFETY_SETTINGS } from '../../services/api/gemini';
import { CreativeState, CreativeChapter, Character } from '../../types';
import { parseEpub } from '../../utils/fileHelpers';

export interface UseCreativePageProps {
    addToast: (msg: string, type?: 'success' | 'error' | 'info' | 'warning') => void;
    state: CreativeState;
    setState: React.Dispatch<React.SetStateAction<CreativeState>>;
    setStoryInfoSafe?: (info: any) => void;
    storyInfo?: any;
    files?: any[];
    setFilesSafe?: (action: React.SetStateAction<any[]>) => void;
    setCoverImage?: (file: File | null) => void;
    setStartTime?: (v: number | null) => void;
    setEndTime?: (v: number | null) => void;
    addLog?: (msg: string, type?: 'success' | 'error' | 'info') => void;
}

// Extracted from CreativePage.tsx (step 4 refactor): holds all state + AI/handler
// logic for the Creative writing wizard. The component itself now only renders,
// using the values/handlers returned here. Logic kept 100% identical to original.
export const useCreativePage = ({
    addToast, state, setState, setStoryInfoSafe, storyInfo, files, setFilesSafe, setCoverImage, setStartTime, setEndTime, addLog
}: UseCreativePageProps) => {
    const [currentStep, setCurrentStep] = useState(1);
    const [mode, setMode] = useState<'new' | 'continue'>('new');
    const [isAnalyzing, setIsAnalyzing] = useState(false);
    const [userPrompt, setUserPrompt] = useState('');
    const fileInputRef = useRef<HTMLInputElement>(null);
    const chaptersEndRef = useRef<HTMLDivElement>(null);
    
    const [isGenerating, setIsGenerating] = useState(false);

    const [editingCharId, setEditingCharId] = useState<string | null>(null);
    const [charForm, setCharForm] = useState<Partial<Character>>({});

    const handleSaveChar = () => {
        if (!charForm.name) {
            addToast('Tên nhân vật không được để trống!', 'warning');
            return;
        }
        setState(prev => {
            const characters = prev.characters || [];
            if (editingCharId) {
                return { ...prev, characters: characters.map(c => c.id === editingCharId ? { ...c, ...charForm } as Character : c) };
            } else {
                return { ...prev, characters: [...characters, { ...charForm, id: 'char_' + Date.now() } as Character] };
            }
        });
        setEditingCharId(null);
        setCharForm({});
    };

    const handleEditChar = (c: Character) => {
        setEditingCharId(c.id);
        setCharForm(c);
    };

    const handleDeleteChar = (id: string) => {
        if (confirm('Bạn có chắc muốn xóa nhân vật này?')) {
            setState(prev => ({ ...prev, characters: (prev.characters || []).filter(c => c.id !== id) }));
        }
    };

    const setup = state?.setup || {};
    const setSetup = (patch: any) => setState(prev => ({ ...prev, setup: { ...(prev?.setup || {}), ...patch } }));

    const seedTitle = setup.seedTitle || '';
    const premise = setup.premise || '';
    const worldNotes = setup.worldNotes || '';
    const charNotes = setup.charNotes || '';
    const outline = setup.outline || '';
    const genre = setup.genre || 'Tiên Hiệp';

    useEffect(() => {
        if (state?.chapters?.length > 0 && currentStep === 5) {
            chaptersEndRef.current?.scrollIntoView({ behavior: 'smooth' });
        }
    }, [state?.chapters, currentStep]);

    const handleAnalyzeNew = async () => {
        if (!userPrompt.trim()) {
            addToast('Vui lòng nhập ý tưởng của bạn!', 'error');
            return;
        }
        setIsAnalyzing(true);
        addLog?.('Bắt đầu phân tích ý tưởng (3.5 Flash)...', 'info');
        try {
            const ai = getAiClient();
            const res = await smartExecution(
                ['gemini-3.5-flash', 'gemini-3-flash-preview', 'gemini-3.0-flash'],
                async (modelId) => {
                    const r = await ai.models.generateContent({
                        model: modelId,
                        contents: `Bạn là chuyên gia thiết kế cốt truyện tiên hiệp/đô thị/khoa huyễn. 
Dựa vào ý tưởng sau của người dùng: "${userPrompt}"
Hãy phát triển và điền vào các mục sau. Trả về đúng định dạng JSON, không có code block markdown:
{
  "title": "Tên truyện đề xuất",
  "genre": "Thể loại chính (Tiên Hiệp, Huyền Huyễn, Đô Thị...)",
  "premise": "Tóm tắt ý tưởng cốt truyện (Premise)",
  "worldNotes": "Bối cảnh thế giới/Hệ thống tu luyện",
  "charNotes": "Ghi chú nhân vật chung",
  "characters": [
    { "name": "Tên", "gender": "Nam/Nữ", "age": "Tuổi", "role": "Vai trò", "appearance": "Ngoại hình", "personality": "Tính cách" }
  ],
  "outline": "Dàn ý cơ bản (Từ khởi đầu đến đỉnh cao)"
}`,
                        config: { safetySettings: SAFETY_SETTINGS, temperature: 0.7 }
                    });
                    return r.text || '';
                },
                'Phân tích ý tưởng mới', addLog
            );

            const jsonStr = res.replace(/```json/g, '').replace(/```/g, '').trim();
            const data = JSON.parse(jsonStr);

            setSetup({
                seedTitle: data.title || '',
                genre: data.genre || genre,
                premise: data.premise || '',
                worldNotes: data.worldNotes || '',
                charNotes: data.charNotes || '',
                outline: data.outline || ''
            });

            if (data.characters && Array.isArray(data.characters)) {
                setState(prev => ({
                    ...prev,
                    characters: data.characters.map((c: any) => ({ ...c, id: 'char_' + Date.now() + '_' + Math.random() }))
                }));
            }

            if (setStoryInfoSafe && storyInfo) {
                setStoryInfoSafe({ ...storyInfo, title: data.title || storyInfo.title });
            }

            addToast('Phân tích thành công! Đã tự động điền các trang thiết lập.', 'success');
            setCurrentStep(2); // Auto advance to next step
        } catch (e: any) {
            addToast('Lỗi phân tích: ' + e.message, 'error');
        } finally {
            setIsAnalyzing(false);
        }
    };

    const handleEpubUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        setIsAnalyzing(true);
        addLog?.('Bắt đầu đọc và phân tích EPUB (3.5 Flash)...', 'info');
        try {
            const parsed = await parseEpub(file);
            if (setFilesSafe && parsed.files.length > 0) {
                const mappedFiles = parsed.files.map(f => ({ ...f, translatedContent: f.content, status: 'completed' as any }));
                setFilesSafe(mappedFiles);
            }
            if (setCoverImage && parsed.coverBlob) {
                const ext = parsed.coverBlob.type.split('/')[1] || 'jpg';
                setCoverImage(new File([parsed.coverBlob], `cover.${ext}`, { type: parsed.coverBlob.type }));
            }
            if (setStoryInfoSafe && storyInfo) {
                setStoryInfoSafe({ ...storyInfo, title: parsed.info.title || storyInfo.title, author: parsed.info.author || storyInfo.author });
            }

            const textContent = parsed.files.map(f => f.content).join('\n\n').substring(0, 100000);

            const ai = getAiClient();
            const response = await smartExecution(
                ['gemini-3.5-flash', 'gemini-3-flash-preview', 'gemini-3.0-flash'],
                async (modelId) => {
                    const r = await ai.models.generateContent({
                        model: modelId,
                        contents: `Bạn là biên tập văn học. Đọc nội dung truyện sau. Hãy tóm tắt và trích xuất thông tin để chuẩn bị viết tiếp.
Trả về định dạng JSON (không có markdown):
{
  "genre": "Thể loại theo đánh giá của bạn (Tiên hiệp, kỳ ảo, hiện đại...)",
  "premise": "Tóm tắt mạch truyện tới thời điểm hiện tại.",
  "worldNotes": "Hệ thống tu luyện, bối cảnh thế giới hiện có.",
  "charNotes": "Ghi chú nhân vật chung",
  "characters": [
    { "name": "Tên", "gender": "Nam/Nữ", "age": "Tuổi", "role": "Vai trò", "appearance": "Ngoại hình", "personality": "Tính cách" }
  ],
  "outline": "Dàn ý dự kiến cho các chương tiếp theo để viết tiếp."
}

Nội dung:
${textContent}`,
                        config: { safetySettings: SAFETY_SETTINGS, temperature: 0.5 }
                    });
                    return r.text || '';
                },
                'Phân tích EPUB', addLog
            );

            const jsonStr = response.replace(/```json/g, '').replace(/```/g, '').trim();
            const data = JSON.parse(jsonStr);

            setSetup({
                seedTitle: parsed.info.title || '',
                genre: data.genre || genre,
                premise: data.premise || '',
                worldNotes: data.worldNotes || '',
                charNotes: data.charNotes || '',
                outline: data.outline || ''
            });

            if (data.characters && Array.isArray(data.characters)) {
                setState(prev => ({
                    ...prev,
                    characters: data.characters.map((c: any) => ({ ...c, id: 'char_' + Date.now() + '_' + Math.random() }))
                }));
            }

            addToast('Nhập dữ liệu và phân tích thành công!', 'success');
            setCurrentStep(2);
        } catch (error: any) {
            addToast('Lỗi xử lý file EPUB: ' + error.message, 'error');
            addLog?.('Lỗi EPUB: ' + error.message, 'error');
        } finally {
            setIsAnalyzing(false);
            if (e.target) e.target.value = '';
        }
    };

    const handleGenerateCreativeChapters = async () => {
        setIsGenerating(true);
        if (setStartTime) setStartTime(Date.now());
        addLog?.('Bắt đầu sáng tác liên hoàn với Gemini 3.1 Pro (Max 65536 tokens)...', 'info');
        
        try {
            const ai = getAiClient();
            const systemInst = `Bạn là đại tác giả viết truyện chuyên nghiệp.
Hãy viết THẬT DÀI, BỨT PHÁ GIỚI HẠN. Lần này bạn được yêu cầu viết liên tiếp ${state.targetChapters || 10} chương (tận dụng tối đa 65536 tokens output).

[CẤU TRÚC PHÂN CHƯƠNG - CRITICAL]
Bạn PHẢI BẮT BUỘC tách mỗi chương ra một thẻ <CHAPTER> riêng biệt. TUYỆT ĐỐI KHÔNG ĐƯỢC gộp chung nội dung nhiều chương vào cùng một thẻ <CHAPTER>.
Cấu trúc output NGHIÊM NGẶT mỗi chương phải bọc trong thẻ XML sau:

<CHAPTER title="Chương (số): (Tên chương)">
Nội dung chi tiết của duy nhất chương này ở đây...
</CHAPTER>

Lặp lại cấu trúc trên cho TỪNG CHƯƠNG.

[NHÂN VẬT MỚI]
Nếu trong quá trình viết có sự xuất hiện của nhân vật mới (chưa có trong danh sách Nhân vật đã biết), bạn hãy CHỦ ĐỘNG liệt kê nhân vật đó ở cuối response (sau khi đóng tất cả thẻ CHAPTER) bằng thẻ sau:
<NEW_CHARACTER name="..." gender="..." age="..." role="..." appearance="..." personality="..." />`;

            let pastContent = '';
            if (state.chapters && state.chapters.length > 0) {
                const recent = state.chapters.slice(-20);
                pastContent = recent.map(c => `[${c.title}]\n${c.content}`).join('\n\n');
            } else if (mode === 'continue' && files && files.length > 0) {
                const recentFiles = files.slice(-10);
                pastContent = recentFiles.map(f => `[${f.name}]\n${f.translatedContent || f.content}`).join('\n\n');
            }

            const prompt = `[THÔNG TIN TRUYỆN]
Tên truyện: ${seedTitle || storyInfo?.title}
Bối cảnh: ${worldNotes}
Nhân vật đã biết (Cấu trúc mới): ${JSON.stringify(state.characters || [])}
Ghi chú nhân vật (Khác): ${charNotes}
Dàn ý/Định hướng (CRITICAL: PHẢI BÁM SÁT DÀN Ý, TIẾN TRIỂN CỐT TRUYỆN THEO ĐÚNG DÀN Ý): 
${outline}

Tóm tắt hiện tại: ${premise}
Thể loại chính: ${genre}
Tổng số chương dự kiến: ${state.totalTargetChapters || 200} chương

[NỘI DUNG ĐÃ CÓ (Tham khảo)]
${pastContent || '(Chưa có nội dung, hãy viết bắt đầu từ Chương 1)'}

[YÊU CẦU]
Hãy viết TIẾP TỤC từ điểm dừng cuối cùng (nếu đã có), hoặc bắt đầu từ Chương 1.
Viết liên tục đúng ${state.targetChapters || 10} chương với chất lượng cao nhất.
Văn phong mượt mà, cuốn hút. Không tóm tắt nội dung để qua loa. Thiết lập các chi tiết, thoại, hành động đầy đủ. Hãy bám sát Dàn ý đã cho.`;

            const res = await smartExecution(
                ['gemini-3.1-pro-preview'],
                async (modelId) => {
                    const r = await ai.models.generateContent({
                        model: modelId,
                        contents: prompt,
                        config: { systemInstruction: systemInst, safetySettings: SAFETY_SETTINGS, temperature: 0.8, maxOutputTokens: 65536 }
                    });
                    return r.text || '';
                },
                'Sáng tác nhiều chương', addLog
            );

            // Parse chapters
            const chapterRegex = /<CHAPTER[^>]*title=["']?([^"'>]+)["']?[^>]*>([\s\S]*?)<\/CHAPTER>/gi;
            let match;
            const newChapters: CreativeChapter[] = [];
            
            while ((match = chapterRegex.exec(res)) !== null) {
                const title = match[1].trim();
                const content = match[2].trim();
                if (content) {
                    newChapters.push({
                        id: 'chap_' + Date.now() + '_' + Math.random(),
                        title,
                        content,
                        status: 'completed',
                        retryCount: 0
                    });
                }
            }

            // Parse new characters
            const charRegex = /<NEW_CHARACTER\s+([^>]+)\/?>/gi;
            let charMatch;
            const newChars: Character[] = [];
            while ((charMatch = charRegex.exec(res)) !== null) {
                const attrs = charMatch[1];
                const extractAttr = (name: string) => {
                    const m = new RegExp(`${name}=["']([^"']+)["']`, 'i').exec(attrs);
                    return m ? m[1] : '';
                };
                
                const name = extractAttr('name');
                if (name) {
                    newChars.push({
                        id: 'char_' + Date.now() + '_' + Math.random(),
                        name,
                        gender: extractAttr('gender'),
                        age: extractAttr('age'),
                        role: extractAttr('role'),
                        appearance: extractAttr('appearance'),
                        personality: extractAttr('personality')
                    });
                }
            }

            if (newChars.length > 0) {
                addLog?.(`Đã phát hiện và tự động ghi nhớ ${newChars.length} nhân vật mới.`, 'success');
            }

            if (newChapters.length > 0) {
                addToast(`Đã viết thành công ${newChapters.length} chương mới!`, 'success');
                setState(prev => ({
                    ...prev,
                    chapters: [...(prev.chapters || []), ...newChapters],
                    characters: [...(prev.characters || []), ...newChars]
                }));
            } else {
                addToast('Không tìm thấy thẻ <CHAPTER> hợp lệ, đang lưu toàn bộ text vào 1 chương bù.', 'warning');
                setState(prev => ({
                    ...prev,
                    chapters: [...(prev.chapters || []), {
                        id: 'chap_' + Date.now(),
                        title: `Chương mới (Auto parse)`,
                        content: res.trim(),
                        status: 'completed',
                        retryCount: 0
                    }],
                    characters: [...(prev.characters || []), ...newChars]
                }));
            }
        } catch (e: any) {
            addToast(`Lỗi sáng tác: ${e.message}`, 'error');
        } finally {
            setIsGenerating(false);
            if (setEndTime) setEndTime(Date.now());
        }
    };


    return {
        currentStep, setCurrentStep,
        mode, setMode,
        isAnalyzing, setIsAnalyzing,
        userPrompt, setUserPrompt,
        fileInputRef, chaptersEndRef,
        isGenerating, setIsGenerating,
        editingCharId, setEditingCharId,
        charForm, setCharForm,
        handleSaveChar, handleEditChar, handleDeleteChar,
        setup, setSetup,
        seedTitle, premise, worldNotes, charNotes, outline, genre,
        handleAnalyzeNew, handleEpubUpload, handleGenerateCreativeChapters,
    };
};
