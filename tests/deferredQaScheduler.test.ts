import { describe, expect, it } from 'vitest';
import { FileItem, FileStatus, StoryInfo } from '../src/types';
import { nextDeferredQaWake, qaTaskFingerprint, recoverInterruptedQaFiles, scheduleQaOutcome, selectDeferredQaWave } from '../src/services/workflows/translate/deferredQaScheduler';
import { deferredReview } from '../src/services/workflows/translate/qualityReview';
const story: StoryInfo = { title: '', author: '', languages: [], genres: [], worldSetting: [], mcPersonality: [], sectFlow: [] };
const file = (id: string): FileItem => ({ id, name: id, content: 'source ' + id, translatedContent: 'target ' + id, status: FileStatus.COMPLETED,
  originalCharCount: 8, remainingRawCharCount: 0, retryCount: 2, qaStatus: 'QA_DEFERRED' });
describe('persisted deferred QA scheduling', () => {
  it('does not schedule a restored unfinished project', () => {
    for (const status of [FileStatus.IDLE, FileStatus.ERROR, FileStatus.PROCESSING]) {
      expect(nextDeferredQaWake([file('a'), { ...file('b'), status }], '', story)).toBeUndefined();
    }
    expect(nextDeferredQaWake([file('a'), { ...file('b'), translatedContent: '' }], '', story)).toBeUndefined();
    expect(nextDeferredQaWake([file('a'), file('b')], '', story, 1000)).toBe(1000);
  });
  it('visits the entire backlog fairly without a 12-chapter cap', () => {
    const files = Array.from({ length: 1001 }, (_, index) => file(String(index)));
    const visited = new Set<string>();
    while (true) {
      const wave = selectDeferredQaWave(files, '', story, visited, 1000);
      if (!wave.length) break;
      expect(wave.length).toBeLessThanOrEqual(6);
      wave.forEach(f => visited.add(f.id));
    }
    expect(visited.size).toBe(1001);
  });
  it('persists retry delay independently of translation retries and survives JSON backup', () => {
    const original = file('a'), fingerprint = qaTaskFingerprint(original, '', story, 1);
    const delayed = scheduleQaOutcome(original, deferredReview('AI chưa đủ bằng chứng'), fingerprint, 1000);
    const restored: FileItem[] = JSON.parse(JSON.stringify([delayed]));
    expect(restored[0].retryCount).toBe(2);
    expect(selectDeferredQaWave(restored, '', story, new Set(), 2000)).toEqual([]);
    expect(nextDeferredQaWake(restored, '', story, 2000)).toBe(61000);
    expect(selectDeferredQaWave(restored, '', story, new Set(), 61000)).toHaveLength(1);
  });
  it('does not automatically spend repeated requests for a permanent API/config error', () => {
    const f = file('a');
    const blocked = scheduleQaOutcome(f, deferredReview('Không tìm thấy API Key'), qaTaskFingerprint(f, '', story, 1), 1000);
    expect(nextDeferredQaWake([blocked], '', story, 5000)).toBeUndefined();
    expect(selectDeferredQaWave([blocked], '', story, new Set(), 5000, true)).toHaveLength(1);
  });
  it('resets a stalled task when the source or rules actually change', () => {
    const f = file('a');
    const blocked = scheduleQaOutcome(f, { ...deferredReview('uncertain'), retryable: false }, qaTaskFingerprint(f, '', story, 1), 1000);
    expect(selectDeferredQaWave([blocked], '', { ...story, additionalRules: 'New rule' }, new Set(), 5000)).toHaveLength(1);
    expect(selectDeferredQaWave([{ ...blocked, content: 'new source' }], '', story, new Set(), 5000)).toHaveLength(1);
  });
  it('does not permanently exhaust QA retries merely because the model is out of quota', () => {
    let f = file('a');
    const fingerprint = qaTaskFingerprint(f, '', story, 1);
    for (let attempt = 0; attempt < 10; attempt++) f = scheduleQaOutcome(f, deferredReview('429 quota'), fingerprint, 1000);
    expect(f.qaRetryCount).toBe(0);
    expect(f.qaAutoBlocked).toBe(false);
    expect(selectDeferredQaWave([f], '', story, new Set(), 301000)).toHaveLength(1);
  });
  it('recovers a closed-tab QA wave without losing output or scheduling retranslation', () => {
    const pending = { ...file('a'), status: FileStatus.REPAIRING };
    const restored = recoverInterruptedQaFiles(JSON.parse(JSON.stringify([pending])));
    expect(restored[0]).toMatchObject({ status: FileStatus.COMPLETED, translatedContent: 'target a', retryCount: 2, qaStatus: 'QA_DEFERRED' });
    expect(selectDeferredQaWave(restored, '', story, new Set())).toHaveLength(1);
    const translating = { ...file('b'), status: FileStatus.PROCESSING, qaStatus: undefined };
    expect(recoverInterruptedQaFiles([translating])[0]).toBe(translating);
  });
});
