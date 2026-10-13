import { describe, expect, it } from 'vitest';
import { applyQualityEdits, parseQualityReview } from '../src/services/workflows/translate/qualityReview';
import { applyQualityOutcome, currentQaStatus } from '../src/services/workflows/translate/qaState';
import { buildChapterReviewContext } from '../src/services/workflows/translate/reviewContext';
import { FileItem, FileStatus, StoryInfo } from '../src/types';

const source = '林墨说：“你走吧。”';
const target = 'Lâm Mặc nói: “Mày đi đi.”';
const finding = { category: 'pronoun' as const, sourceQuote: '你走吧', targetQuote: 'Mày đi đi.', detail: 'Cách gọi không đúng quan hệ.' };
const checks = { pronoun: 'PASS', terminology: 'PASS', foreign: 'PASS', format: 'PASS' };
const pass = { decision: 'PASS', contentAlignment: 'PASS', checks, findings: [], reason: 'Đạt' };

describe('structured quality gate', () => {
  it('does not grant PASS to partial or contradictory responses', () => {
    for (const verdict of [undefined, { isValid: true }, { ...pass, checks: {} }, { ...pass, findings: [{}] }, { ...pass, contentAlignment: 'UNCERTAIN' }]) {
      expect(parseQualityReview(verdict, source, target).status).toBe('QA_DEFERRED');
    }
    expect(parseQualityReview(pass, source, target).status).toBe('PASS');
  });
  it('requires content failure and real quotes before retranslation', () => {
    const mismatch = { decision: 'CONTENT_MISMATCH', contentAlignment: 'FAIL', findings: [{ ...finding, category: 'content' }] };
    expect(parseQualityReview(mismatch, source, target).status).toBe('CONFIRMED_FAILURE');
    expect(parseQualityReview({ ...mismatch, contentAlignment: 'PASS' }, source, target).status).toBe('QA_DEFERRED');
    expect(parseQualityReview({ ...mismatch, findings: [{ ...finding, category: 'content', sourceQuote: 'invented' }] }, source, target).status).toBe('QA_DEFERRED');
  });
  it('routes cited local errors to repair rather than retranslating', () => {
    expect(parseQualityReview({ decision: 'REPAIRABLE', contentAlignment: 'PASS', findings: [finding] }, source, target).status).toBe('SUSPECT');
  });
  it('rejects ambiguous/global replacements and broad deletions', () => {
    expect(applyQualityEdits(target, [{ original: finding.targetQuote, replacement: 'Em đi đi.' }], [finding])).toBe('Lâm Mặc nói: “Em đi đi.”');
    expect(applyQualityEdits(`${target} ${target}`, [{ original: finding.targetQuote, replacement: 'Em đi đi.' }], [finding])).toBeNull();
    expect(applyQualityEdits(target, [{ original: target, replacement: 'Đã sửa.' }], [{ ...finding, targetQuote: target }])).toBeNull();
    expect(applyQualityEdits(target, [{ original: 'Lâm Mặc', replacement: 'Vương Lâm' }], [finding])).toBeNull();
  });
  it('preserves output and retry count on deferred QA and invalidates stale PASS', () => {
    const file: FileItem = { id: 'a', name: '1', content: source, translatedContent: target, status: FileStatus.COMPLETED, retryCount: 2, originalCharCount: source.length, remainingRawCharCount: 0 };
    const story: StoryInfo = { title: 'Truyện', author: '', genres: [], languages: [], mcPersonality: [], worldSetting: [], sectFlow: [] };
    const rules = buildChapterReviewContext('', story, source, 1);
    const saved = applyQualityOutcome(file, target, parseQualityReview(pass, source, target), rules);
    expect(currentQaStatus(saved, '', story, 1)).toBe('PASS');
    expect(currentQaStatus({ ...saved, translatedContent: target + ' thêm' }, '', story, 1)).toBe('QA_DEFERRED');
    expect(currentQaStatus(saved, '', { ...story, additionalRules: 'Quy tắc mới' }, 1)).toBe('QA_DEFERRED');
    const deferred = applyQualityOutcome(file, target, parseQualityReview(undefined, source, target), rules);
    expect(deferred.status).toBe(FileStatus.COMPLETED);
    expect(deferred.retryCount).toBe(2);
    expect(deferred.translatedContent).toBe(target);
  });
});
