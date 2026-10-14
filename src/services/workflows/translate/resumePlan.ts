import { FileItem, FileStatus } from '../../../types';

export const hasResumableProgress = (files: FileItem[]): boolean => files.some(file =>
  file.status !== FileStatus.IDLE || !!file.translatedContent || !!file.qaStatus);

/** Restore task ownership from saved data, never discard a pending QA translation. */
export const prepareResumeFiles = (files: FileItem[]): FileItem[] => files.map(file => {
  if (!file.translatedContent?.trim() || file.forceRetranslate || file.hasStaleTranslation || file.qaStatus === 'CONFIRMED_FAILURE') return file;
  if (file.status === FileStatus.REPAIRING || (file.status === FileStatus.COMPLETED && !file.qaStatus)) {
    return { ...file, status: FileStatus.COMPLETED, qaStatus: 'QA_DEFERRED', qaFingerprint: undefined,
      qaReason: 'Bản dịch đã có; tiếp tục hậu kiểm, không dịch lại.' };
  }
  return file;
});

export const planTranslationResume = (files: FileItem[], selected?: Set<string>, fallbackToAll = false) => {
  const pending = files.filter(file => file.forceRetranslate || file.hasStaleTranslation || file.qaStatus === 'CONFIRMED_FAILURE'
    || !file.translatedContent?.trim() || file.status === FileStatus.IDLE
    || file.status === FileStatus.ERROR || file.status === FileStatus.PROCESSING || file.status === FileStatus.REPAIRING);
  const scoped = selected?.size ? pending.filter(file => selected.has(file.id)) : pending;
  const queue = fallbackToAll && !scoped.length ? pending : scoped;
  return { queue: queue.map(file => file.id), resetIds: new Set(queue.filter(file => file.status !== FileStatus.IDLE
    || file.forceRetranslate || file.hasStaleTranslation).map(file => file.id)) };
};
