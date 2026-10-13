import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QualityReview, StoryInfo } from '../src/types';
import { buildMemoryContextFingerprint, buildMemoryKey, clearTranslationMemory, idbTranslationMemory,
  invalidateTranslationMemory, lookupTranslationMemory, saveVerifiedTranslationMemory, TranslationMemoryDriver, TranslationMemoryEntry } from '../src/utils/text/translationMemory';

const story: StoryInfo = { title: 'Truyện A', author: '', genres: [], languages: ['Tiếng Trung'], worldSetting: ['Hiện đại'], mcPersonality: [], sectFlow: [] };
const files = [{ id: 'a', content: '林墨走进房间。', chapterIndex: 1 }, { id: 'b', content: '小雨站起来。', chapterIndex: 2 }];
const targets = new Map([['a', 'Lâm Mặc bước vào phòng.'], ['b', 'Tiểu Vũ đứng dậy.']]);
const pass: QualityReview = { status: 'PASS', decision: 'PASS', contentAlignment: 'PASS', reason: 'Đạt', findings: [] };
const reviews = new Map([['a', pass], ['b', pass]]);
const context = () => buildMemoryContextFingerprint('林墨=Lâm Mặc', story, 'Dịch tiếng Việt', '');
const memoryDriver = () => {
  const rows = new Map<string, TranslationMemoryEntry>();
  const driver: TranslationMemoryDriver = { get: async keys => keys.flatMap(key => rows.has(key) ? [rows.get(key)!] : []),
    put: async entries => { entries.forEach(entry => rows.set(entry.key, entry)); },
    delete: async keys => { keys.forEach(key => rows.delete(key)); }, clear: async () => { rows.clear(); } };
  return { rows, driver };
};

describe('persistent verified translation memory', () => {
  beforeEach(async () => { await clearTranslationMemory(); });
  it('persists verified translations beyond a module reload and session file IDs', async () => {
    const hash = await context();
    await saveVerifiedTranslationMemory(files, targets, reviews, hash, 'gemini-test');
    vi.resetModules();
    const reloaded = await import('../src/utils/text/translationMemory');
    const hits = await reloaded.lookupTranslationMemory([{ ...files[0], id: 'new-import-id' }], hash);
    expect(hits.get('new-import-id')).toMatchObject({ source: files[0].content, target: targets.get('a'), model: 'gemini-test', qaStatus: 'PASS' });
  });
  it('does not save pending, suspect or confirmed failed outputs', async () => {
    const hash = await context();
    for (const status of ['QA_DEFERRED', 'SUSPECT', 'CONFIRMED_FAILURE'] as const) {
      const keys = await saveVerifiedTranslationMemory(files, targets, new Map([['a', pass], ['b', { ...pass, status }]]), hash, 'model');
      expect([...keys.keys()]).toEqual(['a']);
      expect((await lookupTranslationMemory(files, hash)).has('b')).toBe(false);
    }
  });
  it('requires exact raw source, chapter position, context and an intact target digest', async () => {
    const hash = await context();
    await saveVerifiedTranslationMemory(files, targets, reviews, hash, 'model');
    expect((await lookupTranslationMemory([{ ...files[0], content: files[0].content + ' ' }], hash)).size).toBe(0);
    expect((await lookupTranslationMemory([{ ...files[0], chapterIndex: 2 }], hash)).size).toBe(0);
    expect((await lookupTranslationMemory(files, hash + 'changed')).size).toBe(0);
    const key = await buildMemoryKey(files[0].content, hash, 1);
    const [entry] = await idbTranslationMemory.get([key]);
    await idbTranslationMemory.put([{ ...entry, target: 'Nội dung bị thay thế' }]);
    expect((await lookupTranslationMemory([files[0]], hash)).size).toBe(0);
  });
  it('invalidates context for changed pronouns, aliases, world, prompt or preceding chapters', async () => {
    const hash = await context();
    const variants = await Promise.all([
      buildMemoryContextFingerprint('林墨=Lâm Mặc || aliases: Mặc ca', story, 'Dịch tiếng Việt', ''),
      buildMemoryContextFingerprint('林墨=Lâm Mặc', { ...story, pronounMode: 'ancient' }, 'Dịch tiếng Việt', ''),
      buildMemoryContextFingerprint('林墨=Lâm Mặc', { ...story, worldSetting: ['Cổ đại'] }, 'Dịch tiếng Việt', ''),
      buildMemoryContextFingerprint('林墨=Lâm Mặc', { ...story, title: 'Truyện B' }, 'Dịch tiếng Việt', ''),
      buildMemoryContextFingerprint('林墨=Lâm Mặc', story, 'Prompt mới', ''),
      buildMemoryContextFingerprint('林墨=Lâm Mặc', story, 'Dịch tiếng Việt', 'Chương trước đã sửa'),
      buildMemoryContextFingerprint('林墨=Lâm Mặc', story, 'Dịch tiếng Việt', '', undefined, 'Bối cảnh mới'),
    ]);
    expect(variants.every(value => value !== hash)).toBe(true);
  });
  it('honors explicit retranslation even when a verified cache entry exists', async () => {
    const hash = await context();
    await saveVerifiedTranslationMemory(files, targets, reviews, hash, 'model');
    expect((await lookupTranslationMemory([{ ...files[0], forceRetranslate: true }], hash)).size).toBe(0);
  });
  it('finishes invalidation before lookups, including a delayed write', async () => {
    const { driver } = memoryDriver(), hash = await context();
    const key = await buildMemoryKey(files[0].content, hash, 1);
    let release!: () => void;
    const ordinaryPut = driver.put;
    driver.put = async entries => { await new Promise<void>(resolve => { release = resolve; }); await ordinaryPut(entries); };
    const saving = saveVerifiedTranslationMemory([files[0]], targets, reviews, hash, 'model', driver);
    await vi.waitFor(() => expect(release).toBeDefined());
    const deleting = invalidateTranslationMemory([key], driver);
    const reading = lookupTranslationMemory([files[0]], hash, driver);
    release();
    await Promise.all([saving, deleting]);
    expect((await reading).size).toBe(0);
  });
  it('falls back to normal translation when browser storage is unavailable', async () => {
    const { driver } = memoryDriver();
    driver.get = async () => { throw new Error('Storage quota'); };
    driver.put = async () => { throw new Error('Storage quota'); };
    const hash = await context();
    expect((await lookupTranslationMemory(files, hash, driver)).size).toBe(0);
    expect((await saveVerifiedTranslationMemory(files, targets, reviews, hash, 'model', driver)).size).toBe(0);
  });
  it('evicts the oldest entry rather than growing beyond 5,000 chapters', async () => {
    const entry: TranslationMemoryEntry = { key: '', source: 'source', target: 'target', targetDigest: '', contextFingerprint: 'context',
      verifiedAt: 0, schema: 1, qaStatus: 'PASS', model: 'model' };
    await idbTranslationMemory.put(Array.from({ length: 5001 }, (_, index) => ({ ...entry, key: String(index), verifiedAt: index })));
    expect(await idbTranslationMemory.get(['0'])).toEqual([]);
    expect(await idbTranslationMemory.get(['1', '5000'])).toHaveLength(2);
  });
});
