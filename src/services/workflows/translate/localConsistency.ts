import { ConsistencyRule, QualityFinding, QualityReview, StoryInfo } from '../../../types';

export interface RuntimeTerm {
  source: string;
  canonical: string;
  variants: string[];
  forbidden: string[];
  lock: boolean;
  conditional: boolean;
}
export interface LocalFinding extends QualityFinding { severity: 'WARNING' | 'ERROR'; code: string }
export interface ConsistencyPreflight { terms: RuntimeTerm[]; rules: ConsistencyRule[]; conflicts: string[]; warnings: string[] }

export const normalizeTerm = (value: string): string => value.normalize('NFKC').toLocaleLowerCase('vi')
  .replace(/[\p{P}\p{S}]+/gu, ' ').replace(/\s+/g, ' ').trim();
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const wordChar = (char: string) => /[\p{L}\p{N}_]/u.test(char);
/** Latin names use whole-word boundaries; Chinese names can be embedded in text. */
export const findSurface = (text: string, surface: string): { quote: string; index: number } | undefined => {
  const words = surface.normalize('NFKC').trim().split(/[\s\p{P}\p{S}]+/u).filter(Boolean);
  if (!words.length) return undefined;
  const pattern = new RegExp(words.map(escape).join('[\\s\\p{P}\\p{S}]*'), 'giu');
  const latin = /[\p{Script=Latin}]/u.test(surface);
  // Preserve exact original quotations even when Vietnamese accents are decomposed.
  let corpus = text;
  const starts: number[] = [], ends: number[] = [];
  if (text !== text.normalize('NFKC')) {
    corpus = '';
    for (const cluster of text.matchAll(/\P{M}\p{M}*|\p{M}+/gu)) {
      const normalized = cluster[0].normalize('NFKC');
      corpus += normalized;
      for (let i = 0; i < normalized.length; i++) { starts.push(cluster.index!); ends.push(cluster.index! + cluster[0].length); }
    }
  }
  for (const match of corpus.matchAll(pattern)) {
    const index = match.index!;
    if (latin && (wordChar(corpus[index - 1] || '') || wordChar(corpus[index + match[0].length] || ''))) continue;
    const start = starts.length ? starts[index] : index;
    const end = ends.length ? ends[index + match[0].length - 1] : index + match[0].length;
    return { quote: text.slice(start, end), index: start };
  }
};

export const dictionaryMetadata = (value: string) => {
  const segments = value.split('||');
  const list = (label: string) => segments.slice(1).flatMap(segment => {
    const match = segment.trim().match(new RegExp(`^${label}\\s*:\\s*(.*)$`, 'i'));
    return match ? match[1].split(';').map(s => s.trim()).filter(Boolean) : [];
  });
  return { canonical: segments[0].replace(/\*\*/g, '').trim(),
    variants: list('(?:aliases|variants|biến thể)'), forbidden: list('(?:forbidden|cấm)'),
    lock: segments.slice(1).some(s => /^(?:lock|khóa)$/i.test(s.trim())),
    conditional: segments.slice(1).some(s => /^(?:condition|điều kiện)\s*:/i.test(s.trim())) };
};
export const updateDictionaryMetadata = (value: string, field: 'aliases' | 'forbidden' | 'lock', next: string | boolean): string => {
  const marker = field === 'aliases' ? /^(aliases|variants|biến thể)\s*:/i : field === 'forbidden' ? /^(forbidden|cấm)\s*:/i : /^(lock|khóa)$/i;
  const segments = value.split('||').map(s => s.trim()).filter(s => !marker.test(s));
  if (field !== 'lock' && typeof next === 'string' && next.trim()) segments.push(`${field}: ${next.trim()}`);
  if (field === 'lock' && next === true) segments.push('lock');
  return segments.join(' || ');
};
const ignored = new Set(['我', '你', '他', '她', '它', '我们', '你们', '他们', '自己', '这些', '那些', '什么', '怎么', '谁', '大家', '本人']);
const parseTerms = (dictionary: string): RuntimeTerm[] => dictionary.split(/\r?\n/).flatMap(line => {
  if (/^\s*(?:#|\/\/)/.test(line)) return [];
  const eq = line.indexOf('=');
  if (eq < 1) return [];
  const source = line.slice(0, eq).replace(/[\[\]*]/g, '').trim();
  const data = dictionaryMetadata(line.slice(eq + 1));
  if (source.length < 2 || ignored.has(source) || !data.canonical) return [];
  return [{ source, ...data }];
});
const sameScope = (a: ConsistencyRule, b: ConsistencyRule) => a.kind === b.kind && a.source === b.source
  && a.interlocutor === b.interlocutor && a.condition === b.condition;
const active = (rule: ConsistencyRule, chapterIndex?: number) => !(rule.fromChapter || rule.toChapter)
  || (chapterIndex !== undefined && chapterIndex >= (rule.fromChapter || 1) && chapterIndex <= (rule.toChapter || Infinity));

export const prepareLocalConsistency = (
  dictionary: string, story: StoryInfo | undefined, source: string, chapterIndex?: number, customDictionary?: string,
): ConsistencyPreflight => {
  const conflicts: string[] = [], warnings: string[] = [];
  const custom = customDictionary === undefined ? dictionary : customDictionary;
  const base = customDictionary !== undefined && dictionary.endsWith(customDictionary)
    ? dictionary.slice(0, dictionary.length - customDictionary.length) : '';
  const terms = new Map<string, RuntimeTerm>();
  for (const layer of [parseTerms(base), parseTerms(custom)]) {
    const layerTerms = new Map<string, RuntimeTerm>();
    for (const term of layer) {
      if (source && !findSurface(source, term.source)) continue;
      const k = normalizeTerm(term.source), prior = layerTerms.get(k);
      if (prior && normalizeTerm(prior.canonical) !== normalizeTerm(term.canonical)) {
        const acceptedA = [prior.canonical, ...prior.variants].map(normalizeTerm);
        const acceptedB = [term.canonical, ...term.variants].map(normalizeTerm);
        if (!acceptedA.includes(normalizeTerm(term.canonical)) && !acceptedB.includes(normalizeTerm(prior.canonical))) {
          const message = `“${term.source}” có hai nghĩa chuẩn: “${prior.canonical}” / “${term.canonical}”.`;
          if (!prior.conditional && !term.conditional) conflicts.push(message);
          else warnings.push(message + ' Cần đối chiếu điều kiện.');
        }
        term.variants = [...new Set([...prior.variants, ...term.variants, ...(acceptedA.includes(normalizeTerm(term.canonical)) || acceptedB.includes(normalizeTerm(prior.canonical)) ? [prior.canonical] : [])])];
      }
      layerTerms.set(k, term);
    }
    for (const [k, term] of layerTerms) terms.set(k, term);
  }
  const appears = (name: string, aliases: string[] = []) => [name, ...aliases].some(n => !!findSurface(source, n))
    || [...terms.values()].some(term => normalizeTerm(term.canonical) === normalizeTerm(name) && !!findSurface(source, term.source));
  const rules = (story?.consistencyRules || []).filter(rule => active(rule, chapterIndex) && appears(rule.source, rule.sourceAliases)
    && (!rule.interlocutor || appears(rule.interlocutor)));
  for (const rule of rules) {
    if (rule.kind === 'term' && rule.confidence === 'confirmed') {
      const k = normalizeTerm(rule.source);
      if (!terms.has(k)) terms.set(k, { source: rule.source, canonical: rule.target, variants: rule.acceptedVariants || [], forbidden: rule.forbiddenForms || [], lock: false, conditional: !!rule.condition });
    }
    if (rules.some(other => other !== rule && sameScope(rule, other) && (other.target !== rule.target || other.self !== rule.self)
      && other.confidence === 'confirmed' && rule.confidence === 'confirmed')) {
      const message = `Quy tắc ${rule.source} → ${rule.interlocutor || 'thuật ngữ'} mâu thuẫn trong chương này; không tự ép thay.`;
      (rule.condition ? warnings : conflicts).push(message);
    }
  }
  return { terms: [...terms.values()], rules, conflicts: [...new Set(conflicts)], warnings: [...new Set(warnings)] };
};

export const checkLocalConsistency = (source: string, target: string, plan: ConsistencyPreflight, story?: StoryInfo): LocalFinding[] => {
  const findings: LocalFinding[] = [];
  for (const term of plan.terms) {
    const raw = findSurface(source, term.source);
    if (!raw) continue;
    const accepted = [term.canonical, ...term.variants];
    for (const bad of term.forbidden) {
      const hit = findSurface(target, bad);
      if (hit && !accepted.some(variant => !!findSurface(hit.quote, variant))) findings.push({ category: 'terminology', code: 'FORBIDDEN_TERM', severity: term.lock && !term.conditional ? 'ERROR' : 'WARNING', sourceQuote: raw.quote, targetQuote: hit.quote, detail: `${term.source}: gặp dạng bị cấm “${hit.quote}”; dạng hợp lệ: ${accepted.join(' / ')}.` });
    }
    if (!accepted.some(variant => !!findSurface(target, variant))) findings.push({ category: 'terminology', code: 'MISSING_CANONICAL', severity: 'WARNING', sourceQuote: raw.quote, targetQuote: '', detail: `${term.source}: chưa thấy ${accepted.join(' / ')}; có thể dùng đại từ hoặc nghĩa theo ngữ cảnh, cần đối chiếu nguồn.` });
  }
  const lines = target.split('\n');
  const namesFor = (name: string, aliases: string[] = []) => [...new Set([name, ...aliases, ...plan.terms
    .filter(t => normalizeTerm(t.source) === normalizeTerm(name) || normalizeTerm(t.canonical) === normalizeTerm(name))
    .flatMap(t => [t.canonical, ...t.variants])].filter(Boolean))].map(escape).join('|');
  for (const line of lines) {
    const quote = line.match(/[“"「](.+?)[”"」]/u);
    if (!quote) continue;
    const before = line.slice(0, quote.index);
    const dialogue = quote[1];
    for (const rule of plan.rules.filter(r => r.kind === 'pronoun' && r.confidence === 'confirmed')) {
      if (!rule.interlocutor) continue;
      const attributed = new RegExp(`(?:${namesFor(rule.source, rule.sourceAliases)})\\s+(?:nói|hỏi|bảo|quát|đáp|thì thầm)(?:\\s+với)?\\s+(?:${namesFor(rule.interlocutor || '')})\\s*[:：]\\s*$`, 'iu').test(before);
      if (!attributed || rule.condition) continue;
      for (const forbidden of rule.forbiddenForms || []) {
        const hit = findSurface(dialogue, forbidden);
        if (hit && ![rule.target, rule.self || '', ...(rule.acceptedVariants || [])].some(form => normalizeTerm(form) === normalizeTerm(hit.quote))) findings.push({ category: 'pronoun', code: 'PAIR_FORBIDDEN_FORM', severity: 'ERROR', sourceQuote: findSurface(source, rule.source)?.quote || '', targetQuote: quote[0], detail: `${rule.source} → ${rule.interlocutor}: gặp “${hit.quote}” bị cấm trong lời thoại đã xác định người nói/người nghe.` });
      }
    }
    // Family checks are advisory: a genre/preset cannot identify speakers or override
    // explicit custom instructions. Narrative prose is never globally replaced.
    if (story?.pronounMode === 'modern' && !story.additionalRules?.trim()) {
      for (const form of ['ngươi', 'bổn tọa', 'lão phu', 'bần đạo']) {
        const hit = findSurface(dialogue, form);
        if (hit) findings.push({ category: 'pronoun', code: 'MODE_FAMILY', severity: 'WARNING', sourceQuote: '', targetQuote: quote[0], detail: `Lời thoại có “${hit.quote}” trong chế độ hiện đại; cần kiểm tra nhân vật và tình huống.` });
      }
    }
  }
  return findings;
};

export const formatLocalFindings = (findings: LocalFinding[], plan: ConsistencyPreflight): string => [
  '[KIỂM TRA TẠI MÁY — GỢI Ý ĐỂ AI ĐỐI CHIẾU, KHÔNG SUY RA LỆCH CHƯƠNG]',
  ...plan.warnings,
  ...plan.terms.filter(term => term.variants.length).map(term => `${term.source}: chấp nhận ${[term.canonical, ...term.variants].join(' / ')}`),
  ...findings.slice(0, 30).map(f => `${f.severity}: ${f.detail}${f.targetQuote ? ` Trích dịch: ${f.targetQuote}` : ''}`),
].join('\n');
export const enforceLocalLocks = (review: QualityReview, findings: LocalFinding[]): QualityReview => review.status === 'PASS' && findings.some(f => f.severity === 'ERROR')
  ? { ...review, status: 'SUSPECT', decision: 'UNCERTAIN', reason: 'Còn vi phạm quy tắc được khóa tại máy; giữ bản dịch để hậu kiểm lại.', findings: findings.filter(f => f.severity === 'ERROR') }
  : review;
