import { describe, expect, it } from 'vitest';
import { FileItem, FileStatus } from '../src/types';
import { hasResumableProgress, planTranslationResume, prepareResumeFiles } from '../src/services/workflows/translate/resumePlan';

const file = (id: string, patch: Partial<FileItem> = {}): FileItem => ({ id, name: id, content: '原文',
  status: FileStatus.IDLE, translatedContent: null, originalCharCount: 2, remainingRawCharCount: 0, retryCount: 0, ...patch });
const translated = (id: string, patch: Partial<FileItem> = {}) => file(id, { status: FileStatus.COMPLETED, translatedContent: 'Bản dịch', qaStatus: 'QA_DEFERRED', ...patch });

describe('one-button resume planning', () => {
  it('keeps initial setup for a new book and detects restored progress', () => {
    expect(hasResumableProgress([file('a')])).toBe(false);
    expect(hasResumableProgress([file('a', { status: FileStatus.PROCESSING })])).toBe(true);
    expect(hasResumableProgress([translated('a')])).toBe(true);
  });
  it('only translates unfinished chapters, never pending QA even with raw remaining', () => {
    const plan = planTranslationResume(prepareResumeFiles([translated('a', { remainingRawCharCount: 200 }),
      translated('b', { qaStatus: 'PASS' }), file('c'), file('d', { status: FileStatus.ERROR })]));
    expect(plan.queue).toEqual(['c', 'd']);
    expect([...plan.resetIds]).toEqual(['d']);
  });
  it('preserves interrupted QA and legacy translations for review', () => {
    const files = prepareResumeFiles([translated('a', { status: FileStatus.REPAIRING }), translated('b', { qaStatus: undefined })]);
    expect(files.every(f => f.status === FileStatus.COMPLETED && f.qaStatus === 'QA_DEFERRED' && f.translatedContent === 'Bản dịch')).toBe(true);
    expect(planTranslationResume(files).queue).toEqual([]);
  });
  it('retranslates confirmed failures and explicitly stale outputs', () => {
    const files = prepareResumeFiles([translated('a', { qaStatus: 'CONFIRMED_FAILURE', status: FileStatus.ERROR }),
      translated('b', { hasStaleTranslation: true }), translated('c', { forceRetranslate: true })]);
    expect(planTranslationResume(files).queue).toEqual(['a', 'b', 'c']);
  });
  it('uses selected unfinished chapters, but resumes elsewhere if old selection is already done', () => {
    const files = [translated('a'), file('b'), file('c')];
    expect(planTranslationResume(files, new Set(['b']), true).queue).toEqual(['b']);
    expect(planTranslationResume(files, new Set(['a']), true).queue).toEqual(['b', 'c']);
    expect(planTranslationResume(files, new Set(['a']), false).queue).toEqual([]);
  });
});
