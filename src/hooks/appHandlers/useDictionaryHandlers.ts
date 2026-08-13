// Dictionary-driven find/replace across translated files: applying the
// glossary as literal substitutions, plus the generic find/replace engine
// it's built on. Split out of the old monolithic `useAppHandlers.ts`.
import { FileItem, FileStatus } from '../../types';
import { countForeignChars } from '../../utils/text';

export const useDictionaryHandlers = (core: any, ui: any) => {
    const handleDictionaryEnforce = () => {
        if (!core.additionalDictionary) {
             ui.addToast("Từ điển trống", 'warning');
             return;
        }
        
        const lines = core.additionalDictionary.split('\n');
        const pairs = lines.map((line: string) => {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('//') || !trimmed.includes('=')) return null;
            const parts = line.split('=');
            const key = parts[0].trim().replace(/^\[|\]$/g, '');
            const value = parts.slice(1).join('=').trim();
            if (!key) return null;
            return {
                find: key,
                replace: value,
                useRegex: false
            };
        }).filter((p: any): p is {find: string, replace: string, useRegex: boolean} => p !== null);
        
        if (pairs.length === 0) {
             ui.addToast("Không tìm thấy từ vựng hợp lệ để áp dụng", 'warning');
             return;
        }
        
        const scope = ui.selectedFiles.size > 0 ? 'selected' : 'all';
        handleFindReplace(pairs, scope);
    };

    const handleFindReplace = (pairs: {find: string, replace: string, useRegex?: boolean, exactMatch?: boolean}[], scope: 'all' | 'selected') => {
        let count = 0;
        const targetIds = scope === 'selected' ? ui.selectedFiles : new Set(core.files.map((f: FileItem) => f.id));
        
        // Pre-compile regexes to avoid recompiling for every file and catch errors early
        const compiledPairs = pairs.map(p => {
            if (p.useRegex && p.find) {
                try {
                    return { ...p, regex: new RegExp(p.find, 'g') };
                } catch (e: any) {
                    ui.addToast(`Regex không hợp lệ: ${p.find} (${e.message})`, 'error');
                    return null;
                }
            } else if (p.find) {
                // If it's a fixed string match, build a robust regex
                const escaped = p.find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                const robustSpaceEscaped = escaped.replace(/\s+/g, '\\s+');
                let patternRegex;
                if (p.exactMatch !== false) {
                     // Exact word boundary matching for Vietnamese/Unicode
                     patternRegex = new RegExp(`(^|[^\\p{L}\\p{N}_])(${robustSpaceEscaped})(?=[^\\p{L}\\p{N}_]|$)`, 'gu');
                } else {
                     patternRegex = new RegExp(robustSpaceEscaped, 'g');
                }
                return { ...p, regex: patternRegex, isStringExact: p.exactMatch !== false };
            }
            return p;
        }).filter((p: any): p is (typeof pairs[0] & { regex?: RegExp, isStringExact?: boolean }) => p !== null);

        if (compiledPairs.length === 0 && pairs.length > 0) return; // All regexes failed

        const newFiles = core.files.map((f: FileItem) => {
            if (!targetIds.has(f.id)) return f;
            // Target translated content only
            if (f.translatedContent) {
                let newText = f.translatedContent;
                let changed = false;
                compiledPairs.forEach(p => {
                    if (p.regex && p.useRegex) {
                        const nextText = newText.replace(p.regex, p.replace);
                        if (nextText !== newText) {
                            newText = nextText;
                            changed = true;
                        }
                    } else if (p.regex) {
                        const nextText = p.isStringExact
                            ? newText.replace(p.regex, (match: string, p1: string) => p1 + p.replace)
                            : newText.replace(p.regex, p.replace);
                        if (nextText !== newText) {
                            newText = nextText;
                            changed = true;
                        }
                    }
                });
                
                if (changed) {
                    count++;
                    const newRawCount = countForeignChars(newText);
                    return { ...f, translatedContent: newText, remainingRawCharCount: newRawCount, status: FileStatus.COMPLETED };
                }
            }
            return f;
        });
        
        if (count > 0) {
            core.setFiles(newFiles);
            ui.addToast(`Đã thay thế nội dung trong ${count} file`, 'success');
        } else {
            ui.addToast("Không tìm thấy nội dung cần thay thế", 'info');
        }
    };

    const handleFindReplaceInFile = (fileId: string, find: string, replace: string, exactMatch: boolean = true) => {
        if (!find) return;
        core.setFiles((prev: FileItem[]) => prev.map(f => {
            if (f.id === fileId && f.translatedContent) {
                const escaped = find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                const robustSpaceEscaped = escaped.replace(/\s+/g, '\\s+');
                let regex;
                if (exactMatch) {
                    regex = new RegExp(`(^|[^\\p{L}\\p{N}_])(${robustSpaceEscaped})(?=[^\\p{L}\\p{N}_]|$)`, 'gu');
                } else {
                    regex = new RegExp(robustSpaceEscaped, 'g');
                }
                
                const newContent = exactMatch
                    ? f.translatedContent.replace(regex, (match: string, p1: string) => p1 + replace)
                    : f.translatedContent.replace(regex, replace);
                if (newContent !== f.translatedContent) {
                    const newRawCount = countForeignChars(newContent);
                    ui.addToast("Đã thay thế tất cả", "success");
                    return { ...f, translatedContent: newContent, remainingRawCharCount: newRawCount, status: FileStatus.COMPLETED };
                }
            }
            return f;
        }));
    };

    return { handleDictionaryEnforce, handleFindReplace, handleFindReplaceInFile };
};
