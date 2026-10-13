import { describe, expect, it } from 'vitest';
import { ConsistencyRule, StoryInfo } from '../src/types';
import { checkLocalConsistency, dictionaryMetadata, enforceLocalLocks, findSurface, prepareLocalConsistency, updateDictionaryMetadata } from '../src/services/workflows/translate/localConsistency';

const story = (rules: ConsistencyRule[] = []): StoryInfo => ({ title: '', author: '', languages: [], genres: [], worldSetting: [], mcPersonality: [], sectFlow: [], consistencyRules: rules });
describe('local terminology and pronoun checks', () => {
  it('accepts declared aliases, Unicode composition, punctuation and case variants', () => {
    const plan = prepareLocalConsistency('林墨=Lâm Mặc || aliases: Lâm-Mặc; Mặc ca', story(), '林墨走了');
    for (const target of ['LÂM MẶC đi rồi', 'Lâm-Mặc đi rồi', 'Mặc ca đi rồi', 'Lâm Mặc'.normalize('NFD')]) {
      expect(checkLocalConsistency('林墨走了', target, plan)).toHaveLength(0);
    }
  });
  it('uses word boundaries rather than matching Ann inside Anna', () => {
    expect(findSurface('Anna bước vào', 'Ann')).toBeUndefined();
    expect(findSurface('Ann bước vào', 'Ann')?.quote).toBe('Ann');
    const decomposed = 'Lâm Mặc'.normalize('NFD');
    expect(findSurface('Nói: ' + decomposed, 'Lâm Mặc')).toEqual({ quote: decomposed, index: 5 });
  });
  it('blocks conflicting live entries before calling AI but allows declared variants', () => {
    expect(prepareLocalConsistency('林墨=Lâm Mặc\n林墨=Lâm Mỗ', story(), '林墨').conflicts).toHaveLength(1);
    expect(prepareLocalConsistency('林墨=Lâm Mặc || aliases: Mặc ca\n林墨=Mặc ca', story(), '林墨').conflicts).toHaveLength(0);
    expect(prepareLocalConsistency('王朝=Vương triều\n王朝=Triều Vương', story(), '林墨').conflicts).toHaveLength(0);
  });
  it('lets the custom dictionary override the built-in layer without inventing a conflict', () => {
    const custom = '林墨=Lâm Mặc';
    const plan = prepareLocalConsistency('林墨=Lâm Mỗ\n' + custom, story(), '林墨', 1, custom);
    expect(plan.conflicts).toEqual([]);
    expect(plan.terms[0].canonical).toBe('Lâm Mặc');
  });
  it('treats a missing name as advisory, since a pronoun may be a correct translation', () => {
    const findings = checkLocalConsistency('林墨走了', 'Hắn đi rồi', prepareLocalConsistency('林墨=Lâm Mặc || lock', story(), '林墨'));
    expect(findings[0].severity).toBe('WARNING');
    expect(prepareLocalConsistency('我们=Chúng ta', story(), '我们').terms).toEqual([]);
  });
  it('checks an explicit forbidden form only in the attributed directional dialogue', () => {
    const rule: ConsistencyRule = { kind: 'pronoun', source: 'Lâm Mặc', interlocutor: 'Tiểu Vũ', self: 'anh', target: 'em', fromChapter: 50,
      forbiddenForms: ['ngươi'], confidence: 'confirmed', origin: 'analysis', evidence: '林墨' };
    const s = story([rule]), source = '林墨对小雨说';
    const plan = prepareLocalConsistency('林墨=Lâm Mặc\n小雨=Tiểu Vũ', s, source, 60);
    expect(checkLocalConsistency(source, 'Lâm Mặc nói với Tiểu Vũ: “Ngươi đi đi.”', plan).some(f => f.code === 'PAIR_FORBIDDEN_FORM')).toBe(true);
    expect(checkLocalConsistency(source, 'Ngươi là đại từ cổ. Tiểu Vũ nói với Lâm Mặc: “Ngươi đi đi.”', plan).some(f => f.code === 'PAIR_FORBIDDEN_FORM')).toBe(false);
    expect(checkLocalConsistency(source, 'Lâm Mặc nói với Tiểu Vũ: “Ngươi đi đi.”', prepareLocalConsistency('林墨=Lâm Mặc\n小雨=Tiểu Vũ', s, source, 10))).toHaveLength(0);
    expect(checkLocalConsistency(source, 'Ngươi là đại từ cổ.', plan).some(f => f.category === 'pronoun')).toBe(false);
    const rawNames = prepareLocalConsistency('林墨=Lâm Mặc\n小雨=Tiểu Vũ', story([{ ...rule, source: '林墨', interlocutor: '小雨' }]), source, 60);
    expect(checkLocalConsistency(source, 'Lâm Mặc nói với Tiểu Vũ: “Ngươi đi đi.”', rawNames).some(f => f.code === 'PAIR_FORBIDDEN_FORM')).toBe(true);
  });
  it('preserves dictionary role metadata while editing aliases and lock settings', () => {
    const value = updateDictionaryMetadata('Lâm Mặc || (nhân vật chính)', 'aliases', 'Mặc ca; Tiểu Mặc');
    const locked = updateDictionaryMetadata(value, 'lock', true);
    expect(locked).toContain('(nhân vật chính)');
    expect(dictionaryMetadata(locked)).toMatchObject({ canonical: 'Lâm Mặc', variants: ['Mặc ca', 'Tiểu Mặc'], lock: true });
  });
  it('blocks contradictory confirmed pair rules only during their overlapping stage', () => {
    const first: ConsistencyRule = { kind: 'pronoun', source: 'Lâm Mặc', interlocutor: 'Tiểu Vũ', self: 'anh', target: 'em',
      fromChapter: 1, toChapter: 100, confidence: 'confirmed', origin: 'analysis', evidence: '林墨对小雨说' };
    const second = { ...first, target: 'cô', fromChapter: 50, toChapter: 200 };
    const s = story([first, second]), dict = '林墨=Lâm Mặc\n小雨=Tiểu Vũ';
    expect(prepareLocalConsistency(dict, s, '林墨对小雨说', 60).conflicts).toHaveLength(1);
    expect(prepareLocalConsistency(dict, s, '林墨对小雨说', 10).conflicts).toHaveLength(0);
  });
  it('does not accept AI PASS over an explicit forbidden locked term', () => {
    const findings = checkLocalConsistency('林墨', 'Lâm Mỗ', prepareLocalConsistency('林墨=Lâm Mặc || forbidden: Lâm Mỗ || lock', story(), '林墨'));
    expect(enforceLocalLocks({ status: 'PASS', decision: 'PASS', contentAlignment: 'PASS', findings: [], reason: '' }, findings).status).toBe('SUSPECT');
  });
});
