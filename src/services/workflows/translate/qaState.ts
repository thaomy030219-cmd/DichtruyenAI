import { FileItem, FileStatus, QualityReview, StoryInfo } from '../../../types';
import { buildChapterReviewContext } from './reviewContext';
import { qualityFingerprint } from './consistencyRules';

const statusCache = new WeakMap<FileItem, { dictionary: string; story: StoryInfo; chapterIndex: number; status: FileItem['qaStatus'] }>();
export const currentQaStatus = (file: FileItem, dictionary: string, story: StoryInfo, chapterIndex: number): FileItem['qaStatus'] => {
  if (!file.translatedContent || !file.qaStatus) return undefined;
  const cached = statusCache.get(file);
  if (cached && cached.dictionary === dictionary && cached.story === story && cached.chapterIndex === chapterIndex) return cached.status;
  const rules = buildChapterReviewContext(dictionary, story, file.content, chapterIndex);
  const status = file.qaFingerprint === qualityFingerprint(file.content, file.translatedContent, rules) ? file.qaStatus : 'QA_DEFERRED';
  statusCache.set(file, { dictionary, story, chapterIndex, status });
  return status;
};

export const applyQualityOutcome = (file: FileItem, target: string, review: QualityReview, rules: string): FileItem => ({
  ...file, translatedContent: target,
  status: review.status === 'CONFIRMED_FAILURE' ? FileStatus.ERROR : FileStatus.COMPLETED,
  hasStaleTranslation: review.status === 'CONFIRMED_FAILURE',
  qaStatus: review.status, qaReason: review.reason, qaFindings: review.findings,
  qaFingerprint: qualityFingerprint(file.content, target, rules),
  errorMessage: review.status === 'CONFIRMED_FAILURE' ? `Nghi vấn lỗi nội dung — AI xác nhận: ${review.reason}` : undefined,
});
