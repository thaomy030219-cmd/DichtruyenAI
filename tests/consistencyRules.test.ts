import { describe, expect, it } from 'vitest';
import { ConsistencyRule, StoryInfo } from '../src/types';
import { buildConsistencyContract, extractConsistencyRules, mergeConsistencyRules, parseConsistencyRules } from '../src/services/workflows/translate/consistencyRules';

const pair = (fromChapter: number, toChapter: number, target: string): ConsistencyRule => ({
  kind: 'pronoun', source: 'Lâm Mặc', interlocutor: 'Tiểu Vũ', self: 'anh', target,
  fromChapter, toChapter, confidence: 'confirmed', origin: 'analysis', evidence: 'Quan hệ thay đổi tại mốc chương.',
});
const story = (rules: ConsistencyRule[]): StoryInfo => ({ title: 'Truyện', author: '', genres: [], languages: ['Tiếng Trung'], mcPersonality: [], worldSetting: [], sectFlow: [], consistencyRules: rules });

describe('story consistency rules', () => {
  it('retrieves directional rules using raw names and the correct chapter period', () => {
    const rules = [pair(1, 50, 'cô'), pair(51, 100, 'em'), { ...pair(1, 50, 'anh'), source: 'Tiểu Vũ', interlocutor: 'Lâm Mặc', self: 'tôi' }];
    const dictionary = '林墨=Lâm Mặc\n小雨=Tiểu Vũ';
    const early = buildConsistencyContract(dictionary, story(rules), [{ content: '林墨和小雨', chapterIndex: 30 }]);
    expect(early).toContain('Lâm Mặc → Tiểu Vũ: tự xưng anh, gọi cô');
    expect(early).toContain('Tiểu Vũ → Lâm Mặc: tự xưng tôi, gọi anh');
    expect(early).not.toContain('gọi em');
    const late = buildConsistencyContract(dictionary, story(rules), [{ content: '林墨和小雨', chapterIndex: 80 }]);
    expect(late).toContain('gọi em');
    expect(late).not.toContain('gọi cô');
  });

  it('does not apply scoped or unrelated relationships to unknown chapters', () => {
    const contract = buildConsistencyContract('林墨=Lâm Mặc', story([pair(1, 50, 'cô')]), [{ content: '林墨' }]);
    expect(contract).not.toContain('gọi cô');
  });

  it('keeps review proposals advisory and preserves authoritative analysis', () => {
    const old = pair(1, 50, 'cô');
    const incoming = parseConsistencyRules([{ ...old, target: 'em', confidence: 'confirmed' }], 'review');
    expect(incoming[0].confidence).toBe('uncertain');
    expect(mergeConsistencyRules([old], incoming)[0].confidence).toBe('confirmed');
    expect(old.target).toBe('cô');
  });

  it('downgrades conflicting analysis without mutating saved rules', () => {
    const old = pair(1, 50, 'cô');
    expect(mergeConsistencyRules([old], [pair(1, 50, 'em')]).every(r => r.confidence === 'uncertain')).toBe(true);
    expect(old.confidence).toBe('confirmed');
  });

  it('requires evidence and real scope before confirming a pronoun rule', () => {
    expect(parseConsistencyRules([{ ...pair(1, 5, 'em'), evidence: '' }], 'analysis')).toEqual([]);
    expect(parseConsistencyRules([{ ...pair(1, 5, 'em'), fromChapter: undefined }], 'analysis')[0].confidence).toBe('uncertain');
    expect(parseConsistencyRules([pair(5, 1, 'em')], 'analysis')).toEqual([]);
    expect(extractConsistencyRules('<consistency_rules>broken json</consistency_rules>')).toEqual([]);
  });

  it('lets the user dictionary override built-in duplicates', () => {
    const contract = buildConsistencyContract('林墨=Lâm Mạc\n林墨=Lâm Mặc mới', story([]), [{ content: '林墨' }]);
    expect(contract.match(/TỪ ĐIỂN:/g)).toHaveLength(1);
    expect(contract).toContain('林墨 → Lâm Mặc mới');
  });
  it('does not lock conflicting overlapping stages', () => {
    const contract = buildConsistencyContract('林墨=Lâm Mặc\n小雨=Tiểu Vũ', story([pair(1, 60, 'cô'), pair(50, 100, 'em')]), [{ content: '林墨和小雨', chapterIndex: 55 }]);
    expect(contract).toContain('THAM KHẢO, KHÔNG KHÓA: Lâm Mặc');
    expect(contract).not.toContain('XÁC NHẬN: Lâm Mặc');
  });
  it('retrieves relationships through every raw alias for a canonical name', () => {
    const contract = buildConsistencyContract('林墨=Lâm Mặc\n墨哥=Lâm Mặc\n小雨=Tiểu Vũ', story([pair(1, 50, 'cô')]), [{ content: '林墨对小雨说', chapterIndex: 5 }]);
    expect(contract).toContain('Lâm Mặc → Tiểu Vũ');
  });
  it('does not evict confirmed locks when tentative proposals fill the notebook', () => {
    const existing = pair(1, 50, 'cô');
    const proposals: ConsistencyRule[] = Array.from({ length: 1100 }, (_, index) => ({ kind: 'term', source: `raw${index}`, target: `Tên ${index}`, confidence: 'uncertain', origin: 'review', evidence: 'raw' }));
    const merged = mergeConsistencyRules([existing], proposals);
    expect(merged).toHaveLength(1000);
    expect(merged[0]).toEqual(existing);
  });
});
