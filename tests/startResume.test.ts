import { describe, expect, it, vi } from 'vitest';
import { useTranslator } from '../src/hooks/useTranslator';
import { FileItem, FileStatus } from '../src/types';

vi.mock('react', () => ({ useEffect: () => {}, useCallback: (fn: unknown) => fn, useRef: (current: unknown) => ({ current }) }));
vi.mock('../src/utils/text/translationMemory', () => ({ invalidateTranslationMemory: vi.fn().mockResolvedValue(undefined) }));

const file = (id: string, patch: Partial<FileItem> = {}): FileItem => ({ id, name: id, content: '原文',
  status: FileStatus.IDLE, translatedContent: null, originalCharCount: 2, remainingRawCharCount: 0, retryCount: 0, ...patch });
const harness = (files: FileItem[]) => {
  const state = { files };
  const core = { files, stateRef: { current: state }, setFiles: (value: FileItem[] | ((prev: FileItem[]) => FileItem[])) => {
    state.files = typeof value === 'function' ? value(state.files) : value;
  } };
  const shared = { isProcessing: false, activeBatches: 0, isProcessingRef: { current: false },
    qaPausedRef: { current: true }, isRepairRunningRef: { current: false }, isFixPhaseRef: { current: false },
    filesRef: { current: files }, runIdRef: { current: 0 }, scheduledBatchesRef: { current: new Set() },
    setProcessingQueue: vi.fn(), setIsSmartAutoMode: vi.fn(), setAutoFixEnabled: vi.fn(), setStartTime: vi.fn(),
    setEndTime: vi.fn(), setIsProcessing: vi.fn(), translationTier: 'normal' };
  const review = vi.fn().mockReturnValue(true);
  const ui = { selectedFiles: new Set<string>(), addToast: vi.fn(), addLog: vi.fn() };
  // React hooks are mocked above: this harness exercises the command, not rendering.
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const start = useTranslator(core, ui, shared, { handleQualityReview: review }).executeProcessing;
  return { start, state, shared, review, ui };
};

describe('Start resumes the correct task', () => {
  it('resumes translation before QA without deleting existing pending output', () => {
    const h = harness([file('a'), file('b', { status: FileStatus.COMPLETED, translatedContent: 'Đã dịch', qaStatus: 'QA_DEFERRED' })]);
    expect(h.start(false, undefined, true)).toBe(true);
    expect(h.shared.setProcessingQueue).toHaveBeenCalledWith(['a']);
    expect(h.review).not.toHaveBeenCalled();
    expect(h.state.files[1].translatedContent).toBe('Đã dịch');
  });
  it('resumes interrupted QA directly and clears quota pause', () => {
    const h = harness([file('a', { status: FileStatus.REPAIRING, translatedContent: 'Giữ nguyên', qaStatus: 'QA_DEFERRED' })]);
    expect(h.start(false, undefined, true)).toBe(true);
    expect(h.review).toHaveBeenCalledWith(false, undefined, true);
    expect(h.shared.qaPausedRef.current).toBe(false);
    expect(h.shared.setProcessingQueue).not.toHaveBeenCalled();
    expect(h.state.files[0].translatedContent).toBe('Giữ nguyên');
  });
  it('rejects a second click while work is still running', () => {
    const h = harness([file('a')]);
    h.start(false, undefined, true);
    const run = h.shared.runIdRef.current;
    expect(h.start(false, undefined, true)).toBe(false);
    expect(h.shared.runIdRef.current).toBe(run);
  });
});
