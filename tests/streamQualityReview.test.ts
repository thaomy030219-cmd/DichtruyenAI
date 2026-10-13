import { beforeEach, describe, expect, it, vi } from 'vitest';
import { translateBatchStream } from '../src/services/workflows/translate/streamTranslate';
import { reviewAndRepairBatch } from '../src/services/workflows/translate/aiValidation';
import { registerCompletedChapterFingerprint } from '../src/utils/text';
import { QualityReview, StoryInfo } from '../src/types';
import { TranslationMemoryDriver, TranslationMemoryEntry } from '../src/utils/text/translationMemory';

const { stream } = vi.hoisted(() => ({ stream: vi.fn() }));
vi.mock('../src/services/api/gemini', () => ({
  SAFETY_SETTINGS: [], getAiClient: () => ({ models: { generateContentStream: stream } }),
  smartExecution: async (_models: string[], task: (id: string) => Promise<unknown>) => task('gemini-3.8-flash'),
}));
vi.mock('../src/services/workflows/translate/aiValidation', () => ({ reviewAndRepairBatch: vi.fn() }));
vi.mock('../src/utils/text', async importOriginal => ({
  ...await importOriginal<typeof import('../src/utils/text')>(),
  proofreadVietnamese: async (text: string) => ({ text, correctedCount: 0, suspiciousCount: 0 }),
  registerCompletedChapterFingerprint: vi.fn(),
}));

const target = 'Lâm Mặc lặng lẽ bước vào phòng. '.repeat(35);
const files = ['a', 'b', 'c'].map((id, index) => ({ id, name: id, content: '林墨走进房间。'.repeat(50), chapterIndex: index + 1 }));
const story: StoryInfo = { title: 'Truyện', author: '', genres: [], languages: ['Tiếng Trung'], mcPersonality: [], worldSetting: [], sectFlow: [], enableAutoFormat: false, enableTitleFormatting: false };
const verdict = (status: QualityReview['status']): QualityReview => ({ status, decision: status === 'PASS' ? 'PASS' : status === 'CONFIRMED_FAILURE' ? 'CONTENT_MISMATCH' : 'UNCERTAIN', contentAlignment: status === 'CONFIRMED_FAILURE' ? 'FAIL' : 'PASS', findings: [], reason: 'Kết quả kiểm tra' });
const run = () => translateBatchStream(files, 'Dịch', '林墨=Lâm Mặc', '', ['gemini-3.8-flash'], '', vi.fn(), undefined, 'normal', ['gemini-3.8-flash'], story);

describe('translation stream QA integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stream.mockImplementation(async () => (async function* () {
      yield { text: files.map((_, index) => `[[[part_${index + 1}]]]\n${target}\n[[[/part_${index + 1}]]]`).join('\n') };
    })());
  });
  it('keeps deferred and suspect chapters out of translation retry and verified memory', async () => {
    vi.mocked(reviewAndRepairBatch).mockResolvedValue(new Map([['a', verdict('PASS')], ['b', verdict('QA_DEFERRED')], ['c', verdict('SUSPECT')]]));
    const result = await run();
    expect(result.results.size).toBe(3);
    expect((result as any).flaggedStaleIds.size).toBe(0);
    expect(registerCompletedChapterFingerprint).toHaveBeenCalledTimes(1);
    expect(result.reviews?.get('b')?.status).toBe('QA_DEFERRED');
    expect(stream.mock.calls[0][0].contents).toContain('[part_2 — mốc chương 2]');
  });
  it('isolates only confirmed content failures while retaining their output', async () => {
    vi.mocked(reviewAndRepairBatch).mockResolvedValue(new Map([['a', verdict('PASS')], ['b', verdict('CONFIRMED_FAILURE')], ['c', verdict('QA_DEFERRED')]]));
    const result = await run();
    expect(result.results.get('b')).toContain('Lâm Mặc');
    expect([...(result as any).flaggedStaleIds]).toEqual(['b']);
    expect((result as any).errors.has('b')).toBe(true);
    expect(registerCompletedChapterFingerprint).toHaveBeenCalledTimes(1);
  });
  it('reuses only verified identical chapters without another translation or QA request', async () => {
    const rows = new Map<string, TranslationMemoryEntry>();
    const driver: TranslationMemoryDriver = { get: async keys => keys.flatMap(key => rows.has(key) ? [rows.get(key)!] : []),
      put: async entries => { entries.forEach(entry => rows.set(entry.key, entry)); },
      delete: async keys => { keys.forEach(key => rows.delete(key)); }, clear: async () => { rows.clear(); } };
    const cachedRun = () => translateBatchStream(files, 'Dịch', '林墨=Lâm Mặc', '', ['gemini-3.8-flash'], '', vi.fn(),
      undefined, 'normal', ['gemini-3.8-flash'], story, undefined, undefined, undefined, undefined, undefined, undefined, { memoryDriver: driver });
    vi.mocked(reviewAndRepairBatch).mockResolvedValue(new Map(files.map(f => [f.id, verdict('PASS')])));
    const first = await cachedRun();
    expect(first.memoryKeys?.size).toBe(3);
    const second = await cachedRun();
    expect(second.memoryHitIds?.size).toBe(3);
    expect(second.results).toEqual(first.results);
    expect(stream).toHaveBeenCalledTimes(1);
    expect(reviewAndRepairBatch).toHaveBeenCalledTimes(1);
  });
  it('blocks terminology conflicts before spending any translation or QA request', async () => {
    const result = await translateBatchStream(files, 'Dịch', '林墨=Lâm Mặc\n林墨=Lâm Mỗ', '', ['gemini-3.8-flash'], '', vi.fn());
    expect(result.results.size).toBe(0);
    expect(result.blockedConsistencyIds?.size).toBe(3);
    expect(stream).not.toHaveBeenCalled();
    expect(reviewAndRepairBatch).not.toHaveBeenCalled();
  });
  it('keeps a cached good chapter when the uncached part of the batch fails', async () => {
    const rows = new Map<string, TranslationMemoryEntry>();
    const driver: TranslationMemoryDriver = { get: async keys => keys.flatMap(key => rows.has(key) ? [rows.get(key)!] : []),
      put: async entries => { entries.forEach(entry => rows.set(entry.key, entry)); },
      delete: async keys => { keys.forEach(key => rows.delete(key)); }, clear: async () => { rows.clear(); } };
    const cachedRun = () => translateBatchStream(files, 'Dịch', '林墨=Lâm Mặc', '', ['gemini-3.8-flash'], '', vi.fn(),
      undefined, 'normal', ['gemini-3.8-flash'], story, undefined, undefined, undefined, undefined, undefined, undefined, { memoryDriver: driver });
    vi.mocked(reviewAndRepairBatch).mockResolvedValue(new Map([['a', verdict('PASS')], ['b', verdict('QA_DEFERRED')], ['c', verdict('SUSPECT')]]));
    const first = await cachedRun();
    expect(first.memoryKeys?.size).toBe(1);
    stream.mockRejectedValueOnce(new Error('429 quota'));
    const second = await cachedRun();
    expect(second.results.get('a')).toEqual(first.results.get('a'));
    expect(second.reviews?.get('a')?.status).toBe('PASS');
    expect(second.memoryHitIds?.has('a')).toBe(true);
    expect([...second.errors!.keys()]).toEqual(['b', 'c']);
    expect(second.errors?.has('a')).toBe(false);
  });
});
