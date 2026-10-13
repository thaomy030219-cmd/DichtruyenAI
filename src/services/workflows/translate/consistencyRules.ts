import { ConsistencyRule, StoryInfo } from '../../../types';

export const CONSISTENCY_EXTRACTION_INSTRUCTION = `
[SỔ QUY TẮC NHẤT QUÁN]
Cuối kết quả, bổ sung <consistency_rules>JSON array</consistency_rules> (tối đa 80 mục), không thay thế phần Series Bible.
Mỗi mục: {"kind":"term|pronoun","source":"từ gốc hoặc tên người nói","target":"tên chuẩn hoặc cách gọi người nghe","interlocutor":"tên người nghe (chỉ pronoun)","self":"tự xưng","fromChapter":1,"toChapter":20,"condition":"điều kiện áp dụng","confidence":"confirmed|uncertain","evidence":"trích nguyên văn nguồn, không dịch bằng chứng"}.
Xưng hô A→B và B→A là HAI mục riêng. Chỉ ghi mốc chương khi dữ liệu có mốc thật; không suy ra từ thứ tự mẫu. Không biết phạm vi/giai đoạn hoặc không có bằng chứng thì uncertain, tuyệt đối không dùng quy tắc cuối truyện cho chương đầu.
Hợp nhất phải giữ phạm vi, điều kiện và bằng chứng của mỗi mục; các mục mâu thuẫn cùng phạm vi phải uncertain. Quy tắc người dùng và từ điển đã chốt có ưu tiên cao hơn suy luận AI.`;

const clean = (value: unknown, max = 160): string => typeof value === 'string' ? value.trim().slice(0, max) : '';
const chapterNumber = (value: unknown): number | undefined => Number.isInteger(value) && Number(value) > 0 ? Number(value) : undefined;
const strings = (value: unknown): string[] => Array.isArray(value) ? [...new Set(value.slice(0, 20).map(v => clean(v)).filter(Boolean))] : [];
const key = (rule: ConsistencyRule): string => [rule.kind, rule.source, rule.interlocutor, rule.fromChapter, rule.toChapter, rule.condition].join('|');

export const parseConsistencyRules = (value: unknown, origin: ConsistencyRule['origin']): ConsistencyRule[] => {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 80).flatMap(item => {
    if (!item || typeof item !== 'object' || !['term', 'pronoun'].includes(item.kind)) return [];
    const source = clean(item.source), target = clean(item.target), interlocutor = clean(item.interlocutor);
    const evidence = clean(item.evidence, 500);
    if (!source || !target || !evidence || (item.kind === 'pronoun' && (!interlocutor || source === interlocutor))) return [];
    const fromChapter = chapterNumber(item.fromChapter), toChapter = chapterNumber(item.toChapter);
    if (fromChapter && toChapter && fromChapter > toChapter) return [];
    // Reviews propose information; they never silently replace authoritative locks.
    const confidence = origin === 'analysis' && item.confidence === 'confirmed'
      && (item.kind === 'term' || !!fromChapter) ? 'confirmed' : 'uncertain';
    return [{ kind: item.kind, source, target, interlocutor: interlocutor || undefined,
      self: clean(item.self) || undefined, fromChapter, toChapter,
      condition: clean(item.condition, 300) || undefined, confidence, origin, evidence,
      acceptedVariants: strings(item.acceptedVariants), sourceAliases: strings(item.sourceAliases), forbiddenForms: strings(item.forbiddenForms) }];
  });
};

export const extractConsistencyRules = (text: string): ConsistencyRule[] => {
  const rules: ConsistencyRule[] = [];
  for (const match of text.matchAll(/<consistency_rules>\s*([\s\S]*?)\s*<\/consistency_rules>/g)) {
    try { rules.push(...parseConsistencyRules(JSON.parse(match[1].replace(/```(?:json)?|```/g, '')), 'analysis')); } catch { /* Optional block; keep the original context. */ }
  }
  return mergeConsistencyRules([], rules);
};

export const mergeConsistencyRules = (existing: ConsistencyRule[], incoming: ConsistencyRule[]): ConsistencyRule[] => {
  const merged = existing.map(rule => ({ ...rule }));
  for (const rule of incoming) {
    const same = merged.find(r => key(r) === key(rule) && r.target === rule.target && r.self === rule.self);
    if (same) {
      if (rule.origin === 'analysis' && rule.confidence === 'confirmed' && same.confidence !== 'confirmed') Object.assign(same, rule);
      else if (rule.origin === 'analysis' && rule.confidence === 'confirmed') {
        same.acceptedVariants = [...new Set([...(same.acceptedVariants || []), ...(rule.acceptedVariants || [])])];
        same.sourceAliases = [...new Set([...(same.sourceAliases || []), ...(rule.sourceAliases || [])])];
        same.forbiddenForms = [...new Set([...(same.forbiddenForms || []), ...(rule.forbiddenForms || [])])];
      }
      continue;
    }
    // Contradictory proposals remain advisory; they must not change a lock.
    const conflict = merged.some(r => key(r) === key(rule) && (r.target !== rule.target || r.self !== rule.self));
    if (conflict && rule.origin === 'analysis') {
      for (let i = 0; i < merged.length; i++) if (key(merged[i]) === key(rule)) merged[i] = { ...merged[i], confidence: 'uncertain' };
    }
    merged.push(conflict ? { ...rule, confidence: 'uncertain' } : rule);
  }
  const confirmed = merged.filter(rule => rule.confidence === 'confirmed');
  // A flood of tentative discoveries must not evict established relationships.
  const uncertainBudget = Math.max(0, 1000 - confirmed.length);
  return [...confirmed, ...(uncertainBudget ? merged.filter(rule => rule.confidence !== 'confirmed').slice(-uncertainBudget) : [])];
};

export const stripConsistencyBlocks = (text: string): string => text.replace(/<consistency_rules>[\s\S]*?<\/consistency_rules>/g, '').trim();

export interface ConsistencyChapter { content: string; chapterIndex?: number }

export const resolveDictionaryOverrides = (dictionary: string): string => {
  const lines = dictionary.split(/\r?\n/);
  const normalizedKey = (line: string) => {
    const eq = line.indexOf('=');
    return eq > 0 ? line.slice(0, eq).replace(/[\[\]*]/g, '').trim().toLocaleLowerCase('vi') : '';
  };
  const lastIndexes = new Map<string, number>();
  lines.forEach((line, index) => { const k = normalizedKey(line); if (k) lastIndexes.set(k, index); });
  return lines.filter((line, index) => !normalizedKey(line) || lastIndexes.get(normalizedKey(line)) === index).join('\n');
};

/** Local selection only: no new analysis request per chapter. */
export const buildConsistencyContract = (dictionary: string, story: StoryInfo | undefined, chapters: ConsistencyChapter[]): string => {
  const termsWithDuplicates = dictionary.split(/\r?\n/).flatMap(line => {
    const match = line.match(/^\s*(?:\*\*)?\[?([^=\]\n]+)\]?\s*=\s*([^|\n]+)/);
    if (!match) return [];
    const source = match[1].trim(), target = match[2].replace(/\*\*/g, '').trim();
    return source && target && chapters.some(c => c.content.toLocaleLowerCase('vi').includes(source.toLocaleLowerCase('vi'))) ? [{ source, target }] : [];
  });
  // The user's custom dictionary comes after the built-in dictionary.
  const terms = [...new Map(termsWithDuplicates.map(term => [term.source, term])).values()];
  const aliases = new Map<string, string[]>();
  for (const term of terms) {
    const k = term.target.toLocaleLowerCase('vi');
    aliases.set(k, [...(aliases.get(k) || []), term.source.toLocaleLowerCase('vi')]);
  }
  const appears = (name: string, chapter: ConsistencyChapter) => {
    const lower = name.toLocaleLowerCase('vi'), corpus = chapter.content.toLocaleLowerCase('vi');
    return corpus.includes(lower) || !!aliases.get(lower)?.some(alias => corpus.includes(alias));
  };
  const stored = story?.consistencyRules || extractConsistencyRules(story?.contextNotes || '');
  const relevant = stored.filter(rule => chapters.some(chapter => {
    const i = chapter.chapterIndex;
    if ((rule.fromChapter || rule.toChapter) && i === undefined) return false;
    if (i !== undefined && ((rule.fromChapter && i < rule.fromChapter) || (rule.toChapter && i > rule.toChapter))) return false;
    return [rule.source, ...(rule.sourceAliases || [])].some(name => appears(name, chapter)) && (!rule.interlocutor || appears(rule.interlocutor, chapter));
  }));
  const lines = [
    '[QUY TẮC NHẤT QUÁN CHO CÁC CHƯƠNG NÀY]',
    'Ưu tiên quy tắc người dùng > từ điển đã chốt > quy tắc xác nhận đúng giai đoạn > bộ nhớ chương trước. A→B chỉ áp dụng khi A đang nói với B; không thay đại từ trần thuật theo cặp thoại. Chưa rõ người nói/người nghe thì không đoán. Không coi thiếu tên do dùng đại từ hợp lý là lỗi. Quy tắc có điều kiện chỉ áp dụng khi nguyên văn chứng minh điều kiện; mâu thuẫn/chưa xác định thì giữ trung tính và báo nghi vấn, không tự ép xưng hô.',
    ...terms.slice(0, 100).map(t => `TỪ ĐIỂN: ${t.source} → ${t.target}`),
    ...relevant.slice(0, 60).map(r => {
      const overlaps = relevant.some(other => other !== r && other.kind === r.kind && other.source === r.source
        && other.interlocutor === r.interlocutor && other.condition === r.condition
        && (other.target !== r.target || other.self !== r.self)
        && Math.max(other.fromChapter || 1, r.fromChapter || 1) <= Math.min(other.toChapter || Infinity, r.toChapter || Infinity));
      return `${r.confidence === 'confirmed' && !overlaps ? 'XÁC NHẬN' : 'THAM KHẢO, KHÔNG KHÓA'}: ${r.source}${r.interlocutor ? ` → ${r.interlocutor}: tự xưng ${r.self || 'chưa rõ'}, gọi` : ' ='} ${r.target}; chương ${r.fromChapter || '?'}–${r.toChapter || '?'}${r.condition ? `; khi ${r.condition}` : ''}${r.acceptedVariants?.length ? `; biến thể hợp lệ: ${r.acceptedVariants.join(' / ')}` : ''}${r.forbiddenForms?.length ? `; không dùng: ${r.forbiddenForms.join(' / ')}` : ''}; bằng chứng: ${r.evidence}`;
    }),
    '[HẾT QUY TẮC NHẤT QUÁN]',
  ];
  return lines.join('\n');
};

export const qualityFingerprint = (source: string, target: string, rules: string): string => {
  let hash = 2166136261;
  for (const text of [source, target, rules]) {
    for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
    hash = Math.imul(hash ^ 0xff, 16777619);
  }
  return `qa-v1-${(hash >>> 0).toString(16)}`;
};
