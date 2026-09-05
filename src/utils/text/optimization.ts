import { REGEX_PATTERNS } from '../../utils/regexPatterns';

const AUTHOR_NOTE_HEADING_RE = /^\s*(?:\[?\s*)?(?:lời\s+(?:của\s+)?tác\s+giả|tác\s+giả\s+(?:có\s+lời|tâm\s+sự|bộc\s+bạch)|đôi\s+lời\s+(?:của\s+)?tác\s+giả|ghi\s+chú\s+(?:của\s+)?tác\s+giả|author(?:'s)?\s+note|a\s*\/\s*n|作者(?:有话说|的?话)|作家说|后记|後記|あとがき)\s*(?:\]?\s*)?(?:[:：\-—]|$)/iu;
const AUTHOR_SOLICITATION_RE = /(?:xin|cầu|mong)\s+(?:mọi\s+người|các\s+bạn|độc\s+giả)?\s*(?:ủng\s+hộ|bình\s+chọn|bỏ\s+phiếu|vote|theo\s+dõi|đánh\s+giá|đề\s+cử|nguyệt\s+phiếu|hoa|kẹo)|(?:求|请).{0,12}(?:月票|推荐票|收藏|订阅|支持)|(?:please\s+)?(?:vote|subscribe|follow|support)\s+(?:the\s+)?(?:book|story|author|series)/iu;
const AUTHOR_THANKS_RE = /(?:cảm\s+ơn|cảm\s+tạ|tri\s+ân).{0,40}(?:độc\s+giả|các\s+bạn|mọi\s+người|ủng\s+hộ|theo\s+dõi|đề\s+cử|bình\s+chọn)|(?:感谢|谢谢).{0,24}(?:大家|读者|支持|订阅|收藏|推荐票|月票)|thanks?.{0,30}(?:readers?|everyone|support|reading|following)/iu;
const AUTHOR_STATUS_RE = /(?:tác\s+giả|mình|tôi).{0,35}(?:xin\s+nghỉ|nghỉ\s+viết|ra\s+chương|đăng\s+chương|lịch\s+đăng|ốm|bận\s+việc)|(?:作者|我).{0,24}(?:请假|停更|更新|生病|有事)|(?:author|i).{0,30}(?:hiatus|update\s+schedule|next\s+chapter|sick|taking\s+a\s+break)/iu;
const QUOTED_OR_DIALOGUE_START_RE = /^\s*(?:[-–—]|[“”"'「『])/u;
const IN_STORY_DOCUMENT_RE = /^\s*(?:nhật\s+ký|thư\s+(?:gửi|của|từ)|tin\s+nhắn|ghi\s+chép|trích\s+lục|di\s+thư|diary|letter|message|日记|日記|书信|書信|手记|手記)(?=\s|[:：\-—]|$)/iu;

const isExplicitAuthorNote = (block: string): boolean =>
    block.length <= 1600 && AUTHOR_NOTE_HEADING_RE.test(block);

const isStrongStandaloneAuthorNote = (block: string): boolean => {
    const trimmed = block.trim();
    if (!trimmed || trimmed.length > 600 || QUOTED_OR_DIALOGUE_START_RE.test(trimmed) || IN_STORY_DOCUMENT_RE.test(trimmed)) return false;
    if (REGEX_PATTERNS.UNIVERSAL_CHAPTER_MATCH.test(trimmed)) return false;
    return AUTHOR_SOLICITATION_RE.test(trimmed)
        || AUTHOR_THANKS_RE.test(trimmed)
        || AUTHOR_STATUS_RE.test(trimmed);
};

/**
 * Chỉ lọc lời ngoài truyện ở rìa chương. Không quét/xóa đoạn giữa chương.
 * Khối có nhãn tác giả rõ ràng ở cuối được coi là một section và bỏ tới hết;
 * khối không có nhãn chỉ bị bỏ khi khớp tín hiệu mạnh, ngắn và không giống hội thoại.
 */
export const removeAuthorNotesAtEdges = (text: string): string => {
    if (!text) return text;

    const blocks = text.replace(/\r\n?/g, '\n').split(/\n\s*\n/u).map(block => block.trim()).filter(Boolean);
    if (blocks.length < 2) return text.trim();

    const hasEnoughStoryBefore = (endExclusive: number): boolean =>
        blocks.slice(0, endExclusive).join('\n\n').length >= 100;

    // Lời tác giả có nhãn rõ ràng ở cuối: xóa trọn section, kể cả phần bộc bạch nhiều đoạn.
    const tailStart = Math.max(1, blocks.length - 5);
    for (let index = tailStart; index < blocks.length; index++) {
        if (isExplicitAuthorNote(blocks[index]) && hasEnoughStoryBefore(index)) {
            blocks.splice(index);
            break;
        }
    }

    // Không có nhãn: chỉ bóc từng khối cuối có tín hiệu mạnh, dừng ngay ở khối truyện đầu tiên.
    while (blocks.length > 1 && isStrongStandaloneAuthorNote(blocks[blocks.length - 1]) && hasEnoughStoryBefore(blocks.length - 1)) {
        blocks.pop();
    }

    // Ở đầu chương chỉ xóa section khi tìm thấy tiêu đề chương ngay sau nó; nếu không, chỉ
    // xóa đúng khối có nhãn để tránh nuốt nhầm phần mở đầu/nhật ký của nhân vật.
    if (blocks.length > 1 && isExplicitAuthorNote(blocks[0])) {
        const chapterIndex = blocks.slice(1, 5).findIndex(block => REGEX_PATTERNS.UNIVERSAL_CHAPTER_MATCH.test(block));
        if (chapterIndex >= 0) blocks.splice(0, chapterIndex + 1);
        else blocks.shift();
    }

    return blocks.join('\n\n').trim();
};

export const removeJunkContent = (text: string): string => {
    if (!text) return text;
    
    let cleanedText = removeAuthorNotesAtEdges(text);
    
    // Convert common HTML break elements to newlines to preserve structure before stripping tags
    cleanedText = cleanedText.replace(/<\s*(?:br|p|\/p)\s*\/?>/gim, '\n');
    
    for (const pattern of REGEX_PATTERNS.JUNK_PATTERNS) {
        cleanedText = cleanedText.replace(pattern, '');
    }
    
    // Clean up multiple empty lines left by removal
    cleanedText = cleanedText.replace(/\n{3,}/g, '\n\n').trim();
    
    return cleanedText;
};

export const cleanRepetitiveContent = (text: string): string => {
    if (!text) return text;
    
    const lines = text.split('\n');
    const cleanedLines = [];
    let lastLine = '';
    const seenEquations = new Set<string>(); // Use set to track global duplicates of standard Key = Value format
    
    for (const line of lines) {
        const trimmedLine = line.trim();
        
        if (trimmedLine === '') {
            cleanedLines.push(line);
            lastLine = '';
            continue;
        }

        // Standardize standard pairs
        const match = trimmedLine.match(/^(.+?)\s*(?:=|->|=>)\s*(.+)$/);
        if (match) {
            const normalizedPair = `${match[1].trim().toLowerCase()}=${match[2].trim().toLowerCase()}`;
            if (seenEquations.has(normalizedPair)) {
                continue; // Skip global duplicate of the same equation
            }
            seenEquations.add(normalizedPair);
        } else {
            // Un-paired text, just do consecutive duplicate removal
            if (trimmedLine === lastLine) {
                 continue;
            }
        }
        
        cleanedLines.push(line);
        lastLine = trimmedLine;
    }
    
    return cleanedLines.join('\n');
};

export const mergeFixedLines = (originalText: string, fixedLines: {index: number, text: string}[]): string => {
    if (!originalText || !fixedLines || fixedLines.length === 0) return originalText;
    
    const lines = originalText.split('\n');
    
    fixedLines.forEach(item => {
        if (item.index >= 0 && item.index < lines.length) {
            lines[item.index] = item.text;
        }
    });
    
    return lines.join('\n');
};

export const extractGlossaryBlocks = (content: string): string => {
    if (!content) return "";
    
    const lines = content.split('\n');
    const glossary = [];
    
    for (const line of lines) {
        const trimmed = line.trim();
        // Match format: [Key] = Value
        // Or **[Key] = Value**
        // Or **[Key] = Value || (Role)
        const match = trimmed.match(/^(?:(?:\*\*?)?)\[([^\]]+)\](?:(?:\*\*?)?)?\s*=\s*([^|*]+)(?:\|\||\*|$)/);
        
        if (match) {
            const key = match[1].trim();
            const val = match[2].trim();
            
            // Exclude headers or template placeholders
            if (key !== "Tên Gốc" && key !== "Tên Gốc/Raw" && key !== "Key" && 
                val !== "Tên Dịch" && val !== "Tên Chuẩn") {
                glossary.push(`${key}=${val}`);
            }
        }
    }
    
    return deduplicateDictionary(glossary.join('\n'));
};

export const deduplicateDictionary = (dictText: string): string => {
    if (!dictText) return dictText;
    
    const lines = dictText.split('\n');
    const seen = new Set<string>();
    const result = [];
    
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) {
            result.push(line);
            continue;
        }
        
        const parts = trimmed.split('=');
        if (parts.length >= 2) {
            const key = parts[0].trim();
            if (!seen.has(key)) {
                seen.add(key);
                result.push(line);
            }
        } else {
            result.push(line);
        }
    }
    
    return result.join('\n');
};

export const optimizeDictionary = (dictText: string, content: string): string => {
    if (!dictText || !content) return dictText;
    
    const lines = dictText.split('\n');
    const result = [];
    const contentLower = content.toLowerCase();
    
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('#')) {
            result.push(line);
            continue;
        }
        
        const parts = trimmed.split('=');
        if (parts.length >= 2) {
            const key = parts[0].trim();
            if (!key) {
                result.push(line);
                continue;
            }
            
            let isRelevant = false;
            if (/[\u4e00-\u9fa5]/.test(key)) {
                isRelevant = content.includes(key);
            } else {
                isRelevant = contentLower.includes(key.toLowerCase());
            }
            
            if (isRelevant) {
                result.push(line);
            }
        } else {
            result.push(line);
        }
    }
    
    return result.join('\n');
};

export const optimizeContext = (contextText: string, content: string, relevantDictionary: string = ''): string => {
    if (!contextText || !content) return contextText;

    const blocks = contextText.split(/\n\s*\n/);
    // Batch raw thường chứa key gốc (vd 林墨), còn Ma trận xưng hô trong Series Bible lại dùng
    // tên Việt đã chốt (Lâm Mặc). Bổ sung các VALUE tương ứng của những mục [DICT] đã lọc theo
    // batch vào corpus so khớp để khối xưng hô/quan hệ không bị loại oan.
    const dictionaryAliases = relevantDictionary.split('\n').flatMap(line => {
        const eqIdx = line.indexOf('=');
        if (eqIdx <= 0) return [];
        const value = line.slice(eqIdx + 1).replace(/\*\*/g, '').split('||')[0].trim();
        if (!value) return [];
        const withoutRole = value.replace(/\s*\([^)]*\)\s*$/, '').trim();
        return withoutRole && withoutRole !== value ? [value, withoutRole] : [value];
    });
    const relevanceCorpus = [content, ...dictionaryAliases].join('\n');
    const contentLower = relevanceCorpus.toLowerCase();

    // Dòng mục-từ-điển trong ngữ cảnh phải bắt đầu bằng '[' (cho phép markdown bold '**'
    // phía trước). Dòng prose/thông thường (bắt đầu bằng số, '-', '*', '#', '>'...) không
    // bao giờ khớp nên không bị lọc nhầm.
    const glossaryLineRegex = /^\s*(?:\*\*)?\[/;

    interface ScoredBlock { text: string; score: number; index: number }
    const scoredBlocks: ScoredBlock[] = [];

    for (let i = 0; i < blocks.length; i++) {
        const block = blocks[i];
        const trimmed = block.trim();
        if (!trimmed) continue;

        // Always keep the first block as it often contains general instructions
        if (i === 0) {
            scoredBlocks.push({ text: block, score: Number.MAX_SAFE_INTEGER, index: i });
            continue;
        }

        let keywords: string[] = [];

        // 1. Try to find Chinese keywords (2 or more characters)
        const zhMatch = trimmed.match(/[\u4e00-\u9fa5]{2,}/g);
        if (zhMatch) {
            keywords.push(...zhMatch);
        }

        // 2. Try to find words before a colon, dash, or equals sign
        const prefixMatch = trimmed.match(/^([^:\-=]+)[:\-=]/m);
        if (prefixMatch && prefixMatch[1].trim().length > 1 && prefixMatch[1].trim().length < 40) {
            keywords.push(prefixMatch[1].trim());
        }

        // 3. Try to find capitalized words (names/terms)
        const capWords = trimmed.match(/([A-ZĐ][a-zàáãạảăắằẳẵặâấầẩẫậèéẹẻẽêềếểễệđìíĩỉịòóõọỏôốồổỗộơớờởỡợùúũụủưứừửữựỳỵỷỹý]+(?:\s+[A-ZĐ][a-zàáãạảăắằẳẵặâấầẩẫậèéẹẻẽêềếểễệđìíĩỉịòóõọỏôốồổỗộơớờởỡợùúũụủưứừửữựỳỵỷỹý]+)*)/g);
        if (capWords) {
            keywords.push(...capWords.filter(w => w.length > 2));
        }

        // Remove duplicates
        keywords = [...new Set(keywords)];

        // Đếm SỐ keyword khớp (trước đây chỉ cần 1 khớp là giữ toàn khối) — dùng làm điểm
        // liên quan khi cần cắt theo ngân sách ở dưới.
        let matchCount = 0;
        for (const keyword of keywords) {
            if (/[\u4e00-\u9fa5]/.test(keyword)) {
                if (relevanceCorpus.includes(keyword)) matchCount++;
            } else if (contentLower.includes(keyword.toLowerCase())) {
                matchCount++;
            }
        }

        let isRelevant = false;

        if (keywords.length > 0) {
            isRelevant = matchCount > 0;
        } else {
            // If no keywords found at all, it might be a general instruction.
            // Keep it if it's relatively short to prevent huge context leaks.
            if (trimmed.length < 200) {
                isRelevant = true;
            }
        }

        if (!isRelevant) continue;

        // (2) Lọc từng dòng kiểu từ điển: chỉ giữ mục có Key xuất hiện trong batch.
        let finalBlock = block;
        {
            const lines = block.split('\n');
            let changed = false;
            const keptLines = lines.filter(line => {
                const lineTrimmed = line.trim();
                if (!lineTrimmed || !glossaryLineRegex.test(line)) return true;
                const eqIdx = lineTrimmed.indexOf('=');
                if (eqIdx <= 0) return true;
                const head = lineTrimmed.slice(0, eqIdx);
                // Hỗ trợ dòng đa khóa: "[A] = V", "[A]/[B] = V", "[A] / [B] = V"
                const keys = [...head.matchAll(/\[([^\]]+)\]/g)].map(m => m[1].trim()).filter(Boolean);
                if (keys.length === 0) return true;
                const anyHit = keys.some(k =>
                    /[\u4e00-\u9fa5]/.test(k)
                        ? relevanceCorpus.includes(k)
                        : contentLower.includes(k.toLowerCase())
                );
                if (anyHit) return true;
                changed = true;
                return false;
            });
            if (changed) finalBlock = keptLines.join('\n');
        }

        const finalTrimmed = finalBlock.trim();
        if (!finalTrimmed) continue;
        scoredBlocks.push({ text: finalBlock, score: matchCount, index: i });
    }

    // (3) Trần ngân sách ký tự theo độ dài batch.
    const charBudget = Math.max(16000, Math.min(32000, Math.ceil(content.length * 1.5)));
    const totalChars = scoredBlocks.reduce((acc, s) => acc + s.text.length, 0);
    if (totalChars <= charBudget) {
        return scoredBlocks.map(s => s.text).join('\n\n');
    }

    // Vượt ngân sách: chọn khối theo điểm liên quan giảm dần (khối đầu tiên được duyệt trước
    // vì score = MAX), bỏ qua khối nào không vừa rồi thử khối kế tiếp nhỏ hơn.
    const keepSet = new Set<number>();
    let usedChars = 0;
    for (const s of [...scoredBlocks].sort((a, b) => b.score - a.score)) {
        if (keepSet.size === 0 || usedChars + s.text.length <= charBudget) {
            keepSet.add(s.index);
            usedChars += s.text.length;
        }
    }
    return scoredBlocks
        .filter(s => keepSet.has(s.index))
        .map(s => s.text)
        .join('\n\n');
};

export const dedupeContextAgainstDictionary = (contextText: string, dictText: string): string => {
    if (!contextText || !dictText) return contextText;
    
    // Build dictionary map
    const dictLines = dictText.split('\n');
    const dictMap = new Map<string, string>();
    for (const line of dictLines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('#')) continue;
        const parts = trimmed.split('=');
        if (parts.length >= 2) {
            dictMap.set(parts[0].trim().toLowerCase(), parts[1].trim().toLowerCase());
        }
    }

    if (dictMap.size === 0) return contextText;

    // Process context text
    const blocks = contextText.split(/\n\s*\n/);
    const resultBlocks = [];

    for (const block of blocks) {
        const lines = block.split('\n');
        const keepLines = [];

        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) {
                keepLines.push(line);
                continue;
            }

            // Match patterns like:
            // [Key] = Value
            // Key = Value
            // Key: Value
            // **[Key]** = Value
            // [Key] = Value || Role
            const match = trimmed.match(/^(?:(?:\*\*?)?)\[?([^\]:]+)\]?(?:(?:\*\*?)?)?\s*(?:=|:)\s*([^|]+)/);
            
            if (match) {
                const key = match[1].trim().toLowerCase();
                const value = match[2].trim().toLowerCase();
                
                // If it's a simple mapping that exists in dictionary
                if (dictMap.has(key) && dictMap.get(key) === value) {
                    // Check if there is extra info like || (Role)
                    const extraInfoMatch = trimmed.match(/\|\|\s*(.+)$/);
                    if (extraInfoMatch) {
                        const extraInfo = extraInfoMatch[1].trim();
                        if (extraInfo && extraInfo !== '()') {
                            // Keep it but simplify it? Or just keep it as is because it has extra info.
                            // Let's keep it if it has extra role info
                            keepLines.push(line);
                            continue;
                        }
                    }
                    // It's a duplicate and has no extra info, or extra info is empty.
                    continue; 
                }
            }

            keepLines.push(line);
        }

        const newBlock = keepLines.join('\n').trim();
        if (newBlock) {
            resultBlocks.push(newBlock);
        }
    }

    return resultBlocks.join('\n\n');
};
