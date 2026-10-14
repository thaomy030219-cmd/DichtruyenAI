import { describe, expect, it, vi } from 'vitest';
import { FileItem, FileStatus, QualityReview, StoryInfo } from '../src/types';
import { createQualityReviewHandlers } from '../src/hooks/smartFix/qualityReview';
import { reviewAndRepairBatch } from '../src/services/workflows/translate/aiValidation';

vi.mock('../src/services/workflows/translate/aiValidation', () => ({ reviewAndRepairBatch: vi.fn(), hasReadyQualityModel: () => true }));
vi.mock('../src/utils/text', () => ({
  countForeignChars: () => 0,
  proofreadVietnamese: async (text: string) => ({ text, correctedCount: 0, suspiciousCount: 0 }),
  buildRollingChapterContext: () => '',
}));

const pass: QualityReview = { status: 'PASS', decision: 'PASS', contentAlignment: 'PASS', findings: [], reason: 'Đạt' };
const file = (id: string): FileItem => ({ id, name: id, content: 'Nguyên văn ' + id, translatedContent: 'Bản dịch ' + id,
  status: FileStatus.COMPLETED, retryCount: 2, originalCharCount: 12, remainingRawCharCount: 0 });
const harness = (files: FileItem[], selectedFiles = new Set<string>()) => {
  const storyInfo: StoryInfo = { title: '', author: '', genres: [], languages: [], mcPersonality: [], worldSetting: [], sectFlow: [] };
  const state = { files, storyInfo, enabledModels: [], openRouterKey: '', additionalDictionary: '' };
  const core = { stateRef: { current: state }, saveSession: vi.fn(),
    setFiles: (update: (prev: FileItem[]) => FileItem[]) => { state.files = update(state.files); },
    setStoryInfo: (update: (prev: StoryInfo) => StoryInfo) => { state.storyInfo = update(state.storyInfo); } };
  const ui = { selectedFiles, addToast: vi.fn(), addLog: vi.fn() };
  const shared = { qaPausedRef: { current: false }, isRepairRunningRef: { current: false }, activeBatches: 0, effectiveDictionary: '', runIdRef: { current: 1 },
    isProcessingRef: { current: true }, isFixPhaseRef: { current: false }, setProcessingQueue: vi.fn(), setEndTime: vi.fn(),
    setIsProcessing: vi.fn(), setIsSmartAutoMode: vi.fn(), setAutoFixEnabled: vi.fn() };
  return { core, ui, shared, state, handler: createQualityReviewHandlers(core, ui, shared).handleQualityReview };
};

describe('manual and deferred quality review', () => {
  it('Start resumes blocked QA but skips chapters that already passed', async () => {
    const h = harness([file('a'), file('b')]);
    const batches: string[][] = [];
    vi.mocked(reviewAndRepairBatch).mockImplementation(async files => {
      batches.push(files.map(f => f.id));
      return new Map(files.map(f => [f.id, pass]));
    });
    h.handler(true);
    await vi.waitFor(() => expect(h.shared.isRepairRunningRef.current).toBe(false));
    h.state.files[1] = { ...h.state.files[1], qaStatus: 'QA_DEFERRED', qaAutoBlocked: true, qaRetryCount: 4, qaNextRetryAt: Date.now() + 3600000 };
    h.shared.qaPausedRef.current = true;
    expect(h.handler(false, undefined, true)).toBe(true);
    await vi.waitFor(() => expect(h.shared.isRepairRunningRef.current).toBe(false));
    expect(batches).toEqual([['a', 'b'], ['b']]);
    expect(h.handler(false, undefined, true)).toBe(false);
  });
  it('waits for the whole restored project, not just the selected translation queue', () => {
    const h = harness([{ ...file('a'), qaStatus: 'QA_DEFERRED' }, { ...file('b'), status: FileStatus.IDLE, translatedContent: undefined }]);
    expect(h.handler(false, ['a'])).toBe(false);
    expect(h.shared.setProcessingQueue).not.toHaveBeenCalled();
    h.state.files[1] = file('b');
    h.shared.qaPausedRef.current = true;
    expect(h.handler(false)).toBe(false);
  });
  it('stops on quota after one wave and does not automatically restart', async () => {
    const h = harness(Array.from({ length: 20 }, (_, i) => ({ ...file(String(i)), qaStatus: 'QA_DEFERRED' as const })));
    let calls = 0;
    vi.mocked(reviewAndRepairBatch).mockImplementation(async (files, _results, _models, _log, _key, _model, _context, options) => {
      calls++;
      options?.onQuotaExhausted?.();
      return new Map(files.map(f => [f.id, { ...pass, status: 'QA_DEFERRED', reason: '429 quota' }]));
    });
    expect(h.handler(false)).toBe(true);
    await vi.waitFor(() => expect(h.shared.isRepairRunningRef.current).toBe(false));
    expect(calls).toBe(1);
    expect(h.shared.qaPausedRef.current).toBe(true);
    expect(h.shared.isProcessingRef.current).toBe(false);
    expect(h.handler(false)).toBe(false);
    expect(h.state.files.every(f => f.translatedContent && f.status === FileStatus.COMPLETED)).toBe(true);
    vi.mocked(reviewAndRepairBatch).mockImplementation(async files => new Map(files.map(f => [f.id, pass])));
    expect(h.handler(true)).toBe(true);
    await vi.waitFor(() => expect(h.shared.isRepairRunningRef.current).toBe(false));
    expect(h.state.files.every(f => f.qaStatus === 'PASS')).toBe(true);
  });
  it('actually rechecks the selected chapter and releases the processing lock', async () => {
    vi.mocked(reviewAndRepairBatch).mockResolvedValue(new Map([['b', pass]]));
    const h = harness([file('a'), file('b')], new Set(['b']));
    expect(h.handler(true)).toBe(true);
    await vi.waitFor(() => expect(h.shared.isRepairRunningRef.current).toBe(false));
    expect(h.state.files[0].qaStatus).toBeUndefined();
    expect(h.state.files[1].qaStatus).toBe('PASS');
    expect(h.ui.addToast).toHaveBeenLastCalledWith(expect.stringContaining('Không còn gì'), 'success');
    expect(h.shared.isRepairRunningRef.current).toBe(false);
  });
  it('retains content and retries when reviewer is unavailable', async () => {
    vi.mocked(reviewAndRepairBatch).mockResolvedValue(new Map([['a', { ...pass, status: 'QA_DEFERRED', decision: 'UNCERTAIN', reason: 'Hết quota' }]]));
    const h = harness([{ ...file('a'), qaStatus: 'QA_DEFERRED' }]);
    h.handler(false, ['a']);
    await vi.waitFor(() => expect(h.core.saveSession).toHaveBeenCalled());
    expect(h.state.files[0]).toMatchObject({ translatedContent: 'Bản dịch a', retryCount: 2, status: FileStatus.COMPLETED, qaStatus: 'QA_DEFERRED' });
    expect(h.ui.addToast).toHaveBeenLastCalledWith(expect.stringContaining('chờ kiểm'), 'warning');
  });
  it('does not overwrite an edit made during the API request', async () => {
    let resolve!: (value: Map<string, QualityReview>) => void;
    vi.mocked(reviewAndRepairBatch).mockImplementation(() => new Promise(r => { resolve = r; }));
    const h = harness([file('a')]);
    h.handler(true);
    await vi.waitFor(() => expect(resolve).toBeDefined());
    h.state.files = h.state.files.map(f => ({ ...f, translatedContent: 'Người dùng vừa sửa' }));
    resolve(new Map([['a', pass]]));
    await vi.waitFor(() => expect(h.core.saveSession).toHaveBeenCalled());
    expect(h.state.files[0].translatedContent).toBe('Người dùng vừa sửa');
    expect(h.state.files[0].qaStatus).toBe('QA_DEFERRED');
  });
  it('blocks overlapping review sessions', () => {
    const h = harness([file('a')]);
    h.shared.isRepairRunningRef.current = true;
    expect(h.handler(true)).toBe(false);
    expect(h.shared.setProcessingQueue).not.toHaveBeenCalled();
  });
  it('invalidates the in-flight review if the user edits the dictionary before it returns', async () => {
    let resolve!: (value: Map<string, QualityReview>) => void;
    vi.mocked(reviewAndRepairBatch).mockImplementation(() => new Promise(r => { resolve = r; }));
    const h = harness([file('a')]);
    h.handler(true);
    await vi.waitFor(() => expect(resolve).toBeDefined());
    h.state.additionalDictionary = 'Nguyên văn=Tên chuẩn mới';
    resolve(new Map([['a', pass]]));
    await vi.waitFor(() => expect(h.shared.isRepairRunningRef.current).toBe(false));
    expect(h.state.files[0].translatedContent).toBe('Bản dịch a');
    expect(h.state.files[0].qaStatus).toBe('QA_DEFERRED');
  });
  it('drains more than 12 pending chapters across multiple waves', async () => {
    vi.mocked(reviewAndRepairBatch).mockImplementation(async files => new Map(files.map(f => [f.id, pass])));
    const files = Array.from({ length: 35 }, (_, index) => ({ ...file(String(index)), qaStatus: 'QA_DEFERRED' as const }));
    const h = harness(files);
    expect(h.handler(false)).toBe(true);
    await vi.waitFor(() => expect(h.shared.isRepairRunningRef.current).toBe(false));
    expect(h.state.files.every(f => f.qaStatus === 'PASS')).toBe(true);
    expect(h.ui.addLog.mock.calls.some(([message]) => message.includes('đợt 6'))).toBe(true);
    expect(h.core.saveSession.mock.calls.length).toBeGreaterThanOrEqual(6);
  });
  it('stops after the active wave and preserves the rest of the saved queue', async () => {
    const h = harness(Array.from({ length: 20 }, (_, index) => ({ ...file(String(index)), qaStatus: 'QA_DEFERRED' as const })));
    vi.mocked(reviewAndRepairBatch).mockImplementation(async files => {
      h.shared.isProcessingRef.current = false;
      return new Map(files.map(f => [f.id, pass]));
    });
    h.handler(false);
    await vi.waitFor(() => expect(h.shared.isRepairRunningRef.current).toBe(false));
    expect(h.state.files.filter(f => f.qaStatus === 'PASS')).toHaveLength(6);
    expect(h.state.files.filter(f => f.qaStatus === 'QA_DEFERRED')).toHaveLength(14);
    expect(h.state.files.every(f => f.status === FileStatus.COMPLETED)).toBe(true);
    expect(h.ui.addToast).toHaveBeenLastCalledWith(expect.stringContaining('14'), 'warning');
  });
});
