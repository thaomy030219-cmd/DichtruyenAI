import { FileItem, FileStatus, QualityReview, StoryInfo } from '../../../types';
import { qualityFingerprint } from './consistencyRules';
import { buildChapterReviewContext } from './reviewContext';
import { currentQaStatus } from './qaState';

export const QA_WAVE_SIZE = 6;
export const MAX_AUTO_QA_ATTEMPTS = 4;
const taskCache = new WeakMap<FileItem, { dictionary: string; story: StoryInfo; index: number; fingerprint: string }>();
export const qaTaskFingerprint = (file: FileItem, dictionary: string, story: StoryInfo, index: number): string => {
  const cached = taskCache.get(file);
  if (cached && cached.dictionary === dictionary && cached.story === story && cached.index === index) return cached.fingerprint;
  const fingerprint = qualityFingerprint(file.content, file.translatedContent || '', buildChapterReviewContext(dictionary, story, file.content, index));
  taskCache.set(file, { dictionary, story, index, fingerprint });
  return fingerprint;
};
export const isDeferredQaCandidate = (file: FileItem, dictionary: string, story: StoryInfo, index: number): boolean =>
  !!file.translatedContent && file.status === FileStatus.COMPLETED && !!file.qaStatus
  && currentQaStatus(file, dictionary, story, index) !== 'PASS' && file.qaStatus !== 'CONFIRMED_FAILURE';
export const selectDeferredQaWave = (
  files: FileItem[], dictionary: string, story: StoryInfo, visited: Set<string>, now = Date.now(), force = false, scope?: Set<string>,
): FileItem[] => files.map((file, index) => ({ file, index: index + 1 })).filter(({ file, index }) => {
  if (visited.has(file.id) || (scope && !scope.has(file.id)) || !file.translatedContent) return false;
  if (force) return file.status === FileStatus.COMPLETED || !!file.hasStaleTranslation;
  if (!isDeferredQaCandidate(file, dictionary, story, index)) return false;
  const changed = file.qaAttemptFingerprint !== qaTaskFingerprint(file, dictionary, story, index);
  return changed || (!file.qaAutoBlocked && (file.qaRetryCount || 0) < MAX_AUTO_QA_ATTEMPTS && (file.qaNextRetryAt || 0) <= now);
}).sort((a, b) => (a.file.qaRetryCount || 0) - (b.file.qaRetryCount || 0) || a.index - b.index)
  .slice(0, QA_WAVE_SIZE).map(({ file }) => file);

export const scheduleQaOutcome = (file: FileItem, review: QualityReview, taskFingerprint: string, now = Date.now()): FileItem => {
  if (review.status === 'PASS') return { ...file, qaRetryCount: 0, qaNextRetryAt: undefined, qaAutoBlocked: false, qaAttemptFingerprint: taskFingerprint };
  if (review.status === 'CONFIRMED_FAILURE') return { ...file, qaNextRetryAt: undefined, qaAutoBlocked: true, qaAttemptFingerprint: taskFingerprint };
  const count = (file.qaAttemptFingerprint === taskFingerprint ? file.qaRetryCount || 0 : 0) + 1;
  if (review.retryClass === 'availability' && review.retryable !== false) return { ...file,
    qaRetryCount: count - 1, qaNextRetryAt: now + 5 * 60_000, qaAutoBlocked: count - 1 >= MAX_AUTO_QA_ATTEMPTS,
    qaAttemptFingerprint: taskFingerprint };
  return { ...file, qaRetryCount: count, qaNextRetryAt: now + Math.min(30 * 60_000, 60_000 * 2 ** (count - 1)),
    qaAutoBlocked: review.retryable === false || count >= MAX_AUTO_QA_ATTEMPTS, qaAttemptFingerprint: taskFingerprint };
};

/** A closed tab has no live repair task: preserve output and resume QA, not translation. */
export const recoverInterruptedQaFiles = (files: FileItem[]): FileItem[] => files.map(file =>
  file.status === FileStatus.REPAIRING && file.translatedContent && file.qaStatus
    ? { ...file, status: FileStatus.COMPLETED, qaStatus: 'QA_DEFERRED', qaFingerprint: undefined,
      qaReason: 'Phiên hậu kiểm trước bị gián đoạn; đã giữ bản dịch và đưa lại vào hàng đợi.' }
    : file);
export const nextDeferredQaWake = (files: FileItem[], dictionary: string, story: StoryInfo, now = Date.now()): number | undefined => {
  let next: number | undefined;
  files.forEach((file, index) => {
    if (!isDeferredQaCandidate(file, dictionary, story, index + 1)) return;
    const changed = file.qaAttemptFingerprint !== qaTaskFingerprint(file, dictionary, story, index + 1);
    if (!changed && (file.qaAutoBlocked || (file.qaRetryCount || 0) >= MAX_AUTO_QA_ATTEMPTS)) return;
    const time = changed ? now : Math.max(now, file.qaNextRetryAt || now);
    next = next === undefined ? time : Math.min(next, time);
  });
  return next;
};
