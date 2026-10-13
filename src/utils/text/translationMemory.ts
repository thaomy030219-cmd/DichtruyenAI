import { QualityReview, RatioLimits, StoryInfo } from '../../types';

const SCHEMA = 1;
const DB_NAME = 'TranslationMemoryDB';
const STORE = 'verified_chapters';
const MAX_ENTRIES = 5000;
export interface TranslationMemoryEntry {
  key: string; source: string; target: string; contextFingerprint: string;
  targetDigest: string; model: string; verifiedAt: number; schema: number;
  qaStatus: 'PASS';
}
export interface TranslationMemoryDriver {
  get(keys: string[]): Promise<TranslationMemoryEntry[]>;
  put(entries: TranslationMemoryEntry[]): Promise<void>;
  delete(keys: string[]): Promise<void>;
  clear(): Promise<void>;
}
let dbPromise: Promise<IDBDatabase> | undefined;
const openMemoryDb = (): Promise<IDBDatabase> => {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('IndexedDB không khả dụng')); return; }
    const request = indexedDB.open(DB_NAME, 1);
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; dbPromise = undefined; reject(new Error('Bộ nhớ bản dịch đang bị khóa')); }, 4000);
    request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE, { keyPath: 'key' }).createIndex('verifiedAt', 'verifiedAt'); };
    request.onerror = () => { clearTimeout(timer); dbPromise = undefined; reject(request.error); };
    request.onsuccess = () => {
      clearTimeout(timer);
      if (timedOut) { request.result.close(); return; }
      request.result.onversionchange = () => { request.result.close(); dbPromise = undefined; };
      request.result.onclose = () => { dbPromise = undefined; };
      resolve(request.result);
    };
  });
  void dbPromise.catch(() => { dbPromise = undefined; });
  return dbPromise;
};
const transact = async <T>(mode: IDBTransactionMode, operation: (store: IDBObjectStore, complete: (value: T) => void) => void): Promise<T> => {
  const db = await openMemoryDb();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    let result: T;
    tx.oncomplete = () => resolve(result);
    tx.onabort = tx.onerror = () => reject(tx.error || new Error('Giao dịch bộ nhớ bản dịch thất bại'));
    try { operation(tx.objectStore(STORE), value => { result = value; }); }
    catch (error) { tx.abort(); reject(error); }
  });
};
export const idbTranslationMemory: TranslationMemoryDriver = {
  get: keys => transact('readonly', (store, complete) => {
    const entries: TranslationMemoryEntry[] = [];
    for (const key of keys) { const req = store.get(key); req.onsuccess = () => { if (req.result) entries.push(req.result); }; }
    complete(entries);
  }),
  put: entries => transact('readwrite', (store, complete) => {
    for (const entry of entries) store.put(entry);
    // Evict oldest verified chapters inside the same transaction, keeping storage bounded.
    const count = store.count();
    count.onsuccess = () => {
      let remaining = count.result - MAX_ENTRIES;
      if (remaining <= 0) return;
      const cursor = store.index('verifiedAt').openCursor();
      cursor.onsuccess = () => { if (cursor.result && remaining-- > 0) { cursor.result.delete(); cursor.result.continue(); } };
    };
    complete(undefined);
  }),
  delete: keys => transact('readwrite', (store, complete) => { for (const key of keys) store.delete(key); complete(undefined); }),
  clear: () => transact('readwrite', (store, complete) => { store.clear(); complete(undefined); }),
};
let mutationQueue: Promise<unknown> = Promise.resolve();
const mutate = <T>(operation: () => Promise<T>): Promise<T> => {
  const next = mutationQueue.catch(() => undefined).then(operation);
  mutationQueue = next.catch(() => undefined);
  return next;
};
export const memoryDigest = async (text: string): Promise<string> => {
  if (!globalThis.crypto?.subtle) throw new Error('Trình duyệt không hỗ trợ kiểm tra SHA-256');
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(bytes)].map(value => value.toString(16).padStart(2, '0')).join('');
};

export const buildMemoryContextFingerprint = async (
  dictionary: string, story: StoryInfo | undefined, prompt: string, previousContext: string, ratioLimits?: RatioLimits,
  globalContext = story?.contextNotes || '',
): Promise<string> => memoryDigest(JSON.stringify({ pipeline: 'verified-local-quality-v2', dictionary, prompt, previousContext, ratioLimits, globalContext,
  story: story ? { title: story.title, author: story.author, languages: story.languages, genres: story.genres,
    worldSetting: story.worldSetting, mcPersonality: story.mcPersonality, sectFlow: story.sectFlow,
    summary: story.summary, contextNotes: story.contextNotes, additionalRules: story.additionalRules,
    pronounMode: story.pronounMode, consistencyRules: story.consistencyRules,
    enableTitleFormatting: story.enableTitleFormatting, enableAutoFormat: story.enableAutoFormat,
    enableParagraphSpacing: story.enableParagraphSpacing, titleFormat: story.titleFormat } : undefined }));
export const buildMemoryKey = (source: string, contextFingerprint: string, chapterIndex?: number): Promise<string> =>
  memoryDigest(JSON.stringify([SCHEMA, source, contextFingerprint, chapterIndex ?? null]));

export interface MemoryChapter { id: string; content: string; chapterIndex?: number; forceRetranslate?: boolean; usedModel?: string }
export const lookupTranslationMemory = async (
  files: MemoryChapter[], contextFingerprint: string, driver: TranslationMemoryDriver = idbTranslationMemory,
): Promise<Map<string, TranslationMemoryEntry>> => {
  const hits = new Map<string, TranslationMemoryEntry>();
  if (!contextFingerprint) return hits;
  try {
    // A just-requested invalidation must finish before an older result can be read.
    await mutationQueue;
    const eligible = files.filter(file => !file.forceRetranslate);
    const keys = await Promise.all(eligible.map(file => buildMemoryKey(file.content, contextFingerprint, file.chapterIndex)));
    const rows = new Map((await driver.get(keys)).map(row => [row.key, row]));
    for (let index = 0; index < eligible.length; index++) {
      const file = eligible[index], row = rows.get(keys[index]);
      if (row?.schema === SCHEMA && row.qaStatus === 'PASS' && Number.isFinite(row.verifiedAt) && row.contextFingerprint === contextFingerprint && row.source === file.content
        && typeof row.target === 'string' && row.target.trim() && row.targetDigest === await memoryDigest(row.target)) hits.set(file.id, row);
    }
  } catch { /* Cache failure must not stop normal translation. */ }
  return hits;
};
export const saveVerifiedTranslationMemory = async (
  files: MemoryChapter[], results: Map<string, string>, reviews: Map<string, QualityReview>, contextFingerprint: string,
  model: string, driver: TranslationMemoryDriver = idbTranslationMemory,
): Promise<Map<string, string>> => {
  const keys = new Map<string, string>();
  if (!contextFingerprint) return keys;
  try {
    const entries: TranslationMemoryEntry[] = [];
    for (const file of files) {
      const target = results.get(file.id);
      if (!target?.trim() || reviews.get(file.id)?.status !== 'PASS') continue;
      const key = await buildMemoryKey(file.content, contextFingerprint, file.chapterIndex);
      entries.push({ key, source: file.content, target, contextFingerprint, targetDigest: await memoryDigest(target), model: file.usedModel || model, verifiedAt: Date.now(), schema: SCHEMA, qaStatus: 'PASS' });
      keys.set(file.id, key);
    }
    if (entries.length) await mutate(() => driver.put(entries));
  } catch { keys.clear(); }
  return keys;
};
export const invalidateTranslationMemory = async (keys: string[], driver: TranslationMemoryDriver = idbTranslationMemory): Promise<void> => {
  try { if (keys.length) await mutate(() => driver.delete([...new Set(keys)])); } catch { /* Optional cache. */ }
};
export const clearTranslationMemory = (driver: TranslationMemoryDriver = idbTranslationMemory): Promise<void> => mutate(() => driver.clear());
