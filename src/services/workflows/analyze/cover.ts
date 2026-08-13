// Nhóm hàm ẢNH BÌA: tạo prompt vẽ bìa, tạo ảnh bìa bằng AI, chèn chữ tiêu đề/tác giả lên ảnh.
import { getAiClient, smartExecution } from '../../api/gemini';
import { StoryInfo } from '../../../types';

export const generateCoverImage = async (prompt: string, enabledModels?: string[]): Promise<File | null> => {
    const ai = getAiClient();
    const imageModels = ['gemini-3.1-flash-lite-image'].filter(id => enabledModels?.includes(id) ?? true);
    if (imageModels.length === 0) imageModels.push('gemini-3.1-flash-lite-image');

    try {
        return await smartExecution(imageModels, async (modelId) => {
            const configOptions: any = {
                imageConfig: {
                    aspectRatio: '3:4'
                }
            };
            if (modelId === 'gemini-3.1-flash-image' || modelId === 'gemini-3-pro-image') {
                configOptions.imageConfig.imageSize = '1K';
            }

            const response = await ai.models.generateContent({
                model: modelId,
                contents: {
                    parts: [
                        { text: prompt }
                    ]
                },
                config: configOptions
            });
            
            let base64Image = null;
            for (const part of response.candidates?.[0]?.content?.parts || []) {
                if (part.inlineData) {
                    base64Image = part.inlineData.data;
                    break;
                }
            }

            if (!base64Image) throw new Error("Không nhận được ảnh từ API.");
            
            const byteString = atob(base64Image);
            const ab = new ArrayBuffer(byteString.length);
            const ia = new Uint8Array(ab);
            for (let i = 0; i < byteString.length; i++) {
                ia[i] = byteString.charCodeAt(i);
            }
            const blob = new Blob([ab], { type: 'image/jpeg' });
            return new File([blob], "cover.jpg", { type: 'image/jpeg' });
        }, "Tạo Ảnh Bìa");
    } catch (e) {
        console.error("Lỗi khi tạo ảnh bìa:", e);
        return null;
    }
};

export const addTextToCover = async (imageFile: File, title: string, author: string): Promise<File> => {
    return new Promise((resolve) => {
        const img = new Image();
        const url = URL.createObjectURL(imageFile);
        img.onload = () => {
            URL.revokeObjectURL(url);
            const canvas = document.createElement('canvas');
            canvas.width = img.width;
            canvas.height = img.height;
            const ctx = canvas.getContext('2d');
            if (!ctx) return resolve(imageFile);

            // Draw base image
            ctx.drawImage(img, 0, 0);

            // Add gradient overlays for text readability
            const gradTop = ctx.createLinearGradient(0, 0, 0, canvas.height * 0.4);
            gradTop.addColorStop(0, 'rgba(0,0,0,0.8)');
            gradTop.addColorStop(1, 'rgba(0,0,0,0)');
            ctx.fillStyle = gradTop;
            ctx.fillRect(0, 0, canvas.width, canvas.height * 0.4);

            const gradBot = ctx.createLinearGradient(0, canvas.height * 0.7, 0, canvas.height);
            gradBot.addColorStop(0, 'rgba(0,0,0,0)');
            gradBot.addColorStop(1, 'rgba(0,0,0,0.9)');
            ctx.fillStyle = gradBot;
            ctx.fillRect(0, canvas.height * 0.7, canvas.width, canvas.height);

            // Helper to wrap text
            const wrapText = (context: CanvasRenderingContext2D, text: string, x: number, y: number, maxWidth: number, lineHeight: number) => {
                const words = text.split(' ');
                let line = '';
                let currentY = y;
                for(let n = 0; n < words.length; n++) {
                    const testLine = line + words[n] + ' ';
                    const metrics = context.measureText(testLine);
                    if (metrics.width > maxWidth && n > 0) {
                        context.strokeText(line.trim(), x, currentY);
                        context.fillText(line.trim(), x, currentY);
                        line = words[n] + ' ';
                        currentY += lineHeight;
                    } else {
                        line = testLine;
                    }
                }
                context.strokeText(line.trim(), x, currentY);
                context.fillText(line.trim(), x, currentY);
                return currentY + lineHeight;
            };

            ctx.textAlign = 'center';
            ctx.textBaseline = 'top';

            // Draw Title
            const titleFontSize = Math.floor(canvas.width * 0.08);
            ctx.font = `900 ${titleFontSize}px "Times New Roman", Georgia, serif`;
            ctx.fillStyle = '#ffffff';
            ctx.strokeStyle = '#000000';
            ctx.lineWidth = Math.floor(titleFontSize * 0.15);
            ctx.shadowColor = 'rgba(0,0,0,0.8)';
            ctx.shadowBlur = 20;
            ctx.shadowOffsetX = 0;
            ctx.shadowOffsetY = 5;

            const titleY = canvas.height * 0.08;
            wrapText(ctx, title ? title.toUpperCase() : "TRUYỆN CHƯA TÊN", canvas.width / 2, titleY, canvas.width * 0.85, titleFontSize * 1.3);

            // Draw Author
            const authorFontSize = Math.floor(canvas.width * 0.04);
            ctx.font = `italic bold ${authorFontSize}px "Times New Roman", Georgia, serif`;
            ctx.fillStyle = '#fbbf24'; // amber-400
            ctx.lineWidth = Math.floor(authorFontSize * 0.15);
            ctx.shadowBlur = 10;
            
            const authorY = canvas.height * 0.85;
            wrapText(ctx, author ? `Tác giả: ${author}` : "", canvas.width / 2, authorY, canvas.width * 0.85, authorFontSize * 1.3);

            canvas.toBlob((blob) => {
                if (blob) {
                    resolve(new File([blob], "cover_with_text.jpg", { type: 'image/jpeg' }));
                } else {
                    resolve(imageFile);
                }
            }, 'image/jpeg', 0.95);
        };
        img.onerror = () => resolve(imageFile);
        img.src = url;
    });
};

export const createCoverPrompt = async (storyInfo: StoryInfo, summary: string, enabledModels?: string[]): Promise<string> => {
    const candidates = ['gemini-3.1-pro-preview', 'gemini-3.6-flash', 'gemini-3-flash-preview', 'gemini-3.5-flash'].filter(id => enabledModels?.includes(id) ?? true);
    if (candidates.length === 0) candidates.push('gemini-3.1-pro-preview', 'gemini-3.6-flash', 'gemini-3-flash-preview', 'gemini-3.5-flash');
    
    const instruct = `Bạn là Prompt Engineer xuất sắc chuyên viết prompt cho hệ thống AI tạo ảnh. Bằng tiếng Anh (bắt buộc), hãy phân tích tóm tắt truyện dưới đây và viết 1 PROMPT DUY NHẤT (dưới 500 ký tự) để AI vẽ bìa sách.
yêu cầu trong prompt tiếng anh đó: Aspect ratio 3:4, no text, clean art, masterpiece, epic scale, high contrast, cinematic lighting, phù hợp thể loại: ${storyInfo.genres.join(', ')}.

Nội dung rút ra từ:
${summary}

TRẢ VỀ DUY NHẤT PROMPT, KHÔNG THÊM BẤT KỲ VĂN BẢN NÀO KHÁC.`;

    try {
        return await smartExecution(candidates, async (modelId) => {
            const res = await getAiClient().models.generateContent({ model: modelId, contents: instruct, config: { temperature: 0.7 }});
            return res.text?.trim() || "A beautiful fantasy novel cover, masterpiece, no text";
        }, "Thiết Kế Prompt Ảnh");
    } catch {
        return "A beautiful fantasy novel cover, epic scale, highly detailed, masterpiece, no text, 8k resolution.";
    }
};
