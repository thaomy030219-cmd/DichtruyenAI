import { FileItem, FileStatus, StoryInfo } from '../../types';
import { hasReadyQualityModel, reviewAndRepairBatch } from '../../services/workflows/translate/aiValidation';
import { deferredReview } from '../../services/workflows/translate/qualityReview';
import { buildChapterReviewContext } from '../../services/workflows/translate/reviewContext';
import { applyQualityOutcome, currentQaStatus } from '../../services/workflows/translate/qaState';
import { mergeConsistencyRules } from '../../services/workflows/translate/consistencyRules';
import { isDeferredQaCandidate, qaTaskFingerprint, scheduleQaOutcome, selectDeferredQaWave } from '../../services/workflows/translate/deferredQaScheduler';
import { checkLocalConsistency, enforceLocalLocks, formatLocalFindings, prepareLocalConsistency } from '../../services/workflows/translate/localConsistency';
import { countForeignChars, proofreadVietnamese, buildRollingChapterContext } from '../../utils/text';
import { buildMemoryContextFingerprint, invalidateTranslationMemory, saveVerifiedTranslationMemory } from '../../utils/text/translationMemory';

export const createQualityReviewHandlers = (core: any, ui: any, shared: any) => {
  const handleQualityReview = (force = true, automaticIds?: string[], ignoreBackoff = false): boolean => {
    if (shared.isRepairRunningRef.current || shared.activeBatches > 0) return false;
    const state = core.stateRef.current;
    const initialCustom = state.additionalDictionary || '';
    const baseDictionary = shared.effectiveDictionary.endsWith(initialCustom)
      ? shared.effectiveDictionary.slice(0, shared.effectiveDictionary.length - initialCustom.length).trimEnd() : shared.effectiveDictionary;
    const getDictionary = (): string => {
      const custom = core.stateRef.current.additionalDictionary || '';
      return custom === initialCustom ? shared.effectiveDictionary : [baseDictionary, custom].filter(Boolean).join('\n');
    };
    const snapshot: FileItem[] = state.files;
    const scope = force && ui.selectedFiles?.size ? new Set<string>(ui.selectedFiles)
      : automaticIds ? new Set(automaticIds) : undefined;
    if (ignoreBackoff) core.setFiles((prev: FileItem[]) => prev.map(file => (!scope || scope.has(file.id)) && file.qaStatus !== 'PASS'
      ? { ...file, qaRetryCount: 0, qaNextRetryAt: undefined, qaAutoBlocked: false, qaAttemptFingerprint: undefined } : file));
    const first = selectDeferredQaWave(core.stateRef.current.files, shared.effectiveDictionary, state.storyInfo, new Set(), Date.now(), force, scope);
    if (!first.length) {
      if (force) ui.addToast('Không có bản dịch để hậu kiểm.', 'info');
      return false;
    }
    if (shared.qaPausedRef) shared.qaPausedRef.current = false;
    const run = shared.runIdRef.current;
    shared.isRepairRunningRef.current = true;
    shared.setProcessingQueue([]);
    shared.isProcessingRef.current = true;
    shared.setIsProcessing(true);
    shared.setEndTime(null);
    const targetIds = new Set(snapshot.filter((file, index) => (!scope || scope.has(file.id)) && file.translatedContent
      && (force ? file.status === FileStatus.COMPLETED || file.hasStaleTranslation
        : isDeferredQaCandidate(file, shared.effectiveDictionary, state.storyInfo, index + 1))).map(file => file.id));
    ui.addToast('Đang hậu kiểm theo từng đợt; chương chưa kiểm xong sẽ được giữ trong hàng đợi.', 'info');

    void (async () => {
      const visited = new Set<string>(), activeIds = new Set<string>();
      let waves = 0;
      const abort = () => run !== shared.runIdRef.current;
      try {
        while (!abort()) {
          if (visited.size && (shared.qaPausedRef?.current || !shared.isProcessingRef.current)) break;
          const live = core.stateRef.current;
          const story: StoryInfo = live.storyInfo;
          const files: FileItem[] = live.files;
          const dictionary = getDictionary();
          const wave = selectDeferredQaWave(files, dictionary, story, visited, Date.now(), force, scope);
          if (!wave.length) break;
          const model = wave[0].usedModel?.startsWith('openrouter:') ? wave[0].usedModel : '';
          const batch = wave.filter(file => (file.usedModel?.startsWith('openrouter:') ? file.usedModel : '') === model);
          if (waves && !hasReadyQualityModel(live.enabledModels, live.openRouterKey, model)) break;
          waves++;
          batch.forEach(file => { visited.add(file.id); activeIds.add(file.id); });
          ui.addLog(`🔎 Hậu kiểm đợt ${waves}: ${batch.length} chương; đã xét ${visited.size} chương trong lượt này.`, 'info');
          core.setFiles((prev: FileItem[]) => prev.map(file => activeIds.has(file.id)
            ? { ...file, status: FileStatus.REPAIRING, qaStatus: file.qaStatus || 'QA_DEFERRED' } : file));
          const results = new Map<string, string>();
          const reviewFiles = [];
          for (const file of batch) {
            const checked = await proofreadVietnamese(file.translatedContent!, [dictionary, story.contextNotes || '']);
            results.set(file.id, checked.text);
            const chapterIndex = files.findIndex(f => f.id === file.id) + 1;
            const plan = prepareLocalConsistency(dictionary, story, file.content, chapterIndex, live.additionalDictionary || '');
            const localFindings = checkLocalConsistency(file.content, checked.text, plan, story);
            reviewFiles.push({ ...file, chapterIndex, plan, localFindings,
              localHints: formatLocalFindings(localFindings, plan),
              consistencyContext: buildChapterReviewContext(dictionary, story, file.content, chapterIndex) });
          }
          const reviewable = reviewFiles.filter(file => !file.plan.conflicts.length);
          const reports = await reviewAndRepairBatch(reviewable, results, live.enabledModels,
            (message) => ui.addLog(message, 'info'), live.openRouterKey, model, '', { shouldAbort: abort });
          for (const file of reviewFiles) {
            if (file.plan.conflicts.length) reports.set(file.id, { ...deferredReview('Xung đột thuật ngữ: ' + file.plan.conflicts.join(' ')), retryable: false });
            const report = reports.get(file.id);
            if (report) reports.set(file.id, enforceLocalLocks(report, checkLocalConsistency(file.content, results.get(file.id)!, file.plan, story)));
          }
          if (abort()) return;
          const invalidKeys: string[] = [];
          core.setFiles((prev: FileItem[]) => prev.map(file => {
            const original = reviewFiles.find(f => f.id === file.id);
            if (!original) return file;
            const report = reports.get(file.id) || deferredReview('Hậu kiểm chưa trả kết quả chương này.');
            const currentIndex = prev.findIndex(f => f.id === file.id) + 1;
            const liveRules = buildChapterReviewContext(getDictionary(), core.stateRef.current.storyInfo, file.content, currentIndex);
            if (file.content !== original.content || file.translatedContent !== original.translatedContent || liveRules !== original.consistencyContext) {
              if (file.translationMemoryKey) invalidKeys.push(file.translationMemoryKey);
              return { ...file, status: FileStatus.COMPLETED, qaStatus: 'QA_DEFERRED', qaFingerprint: undefined,
                translationMemoryKey: undefined, translationMemoryHit: false,
                qaReason: 'Chương hoặc quy tắc đã thay đổi trong lúc hậu kiểm; cần kiểm lại.' };
            }
            const target = results.get(file.id)!;
            if (report.status !== 'PASS' || target !== original.translatedContent) {
              if (file.translationMemoryKey) invalidKeys.push(file.translationMemoryKey);
            }
            const updated = { ...applyQualityOutcome(file, target, report, original.consistencyContext),
              remainingRawCharCount: countForeignChars(target), translationMemoryHit: false, translationMemoryKey: undefined };
            return scheduleQaOutcome(updated, report, qaTaskFingerprint(updated, dictionary, story, currentIndex));
          }));
          await invalidateTranslationMemory(invalidKeys);
          for (const file of reviewFiles) {
            const current: FileItem | undefined = core.stateRef.current.files.find((f: FileItem) => f.id === file.id);
            if (!current || currentQaStatus(current, getDictionary(), core.stateRef.current.storyInfo, file.chapterIndex) !== 'PASS') continue;
            const positions = new Map(files.map((f, index) => [f.id, index + 1]));
            const previous = buildRollingChapterContext(files, [file.id], 3, 1800,
              f => !f.qaStatus || currentQaStatus(f, dictionary, story, positions.get(f.id)!) === 'PASS');
            const context = await buildMemoryContextFingerprint(dictionary, story, live.promptTemplate || '', previous, live.ratioLimits).catch(() => '');
            const keys = await saveVerifiedTranslationMemory([file], new Map([[file.id, current.translatedContent!]]), reports, context, current.usedModel || 'Hậu kiểm');
            if (keys.has(file.id)) core.setFiles((prev: FileItem[]) => prev.map(f => f.id === file.id && f.content === file.content
              && f.translatedContent === current.translatedContent && f.qaFingerprint === current.qaFingerprint
              ? { ...f, translationMemoryKey: keys.get(file.id) } : f));
          }
          const proposals = [...reports.values()].flatMap(report => report.ruleProposals || []);
          if (proposals.length) core.setStoryInfo((prev: StoryInfo) => ({ ...prev, consistencyRules: mergeConsistencyRules(prev.consistencyRules || [], proposals) }));
          activeIds.clear();
          // Yield to UI between waves; never rescan the same chapter in a tight loop.
          await new Promise(resolve => setTimeout(resolve, 0));
          await core.saveSession(true);
        }
        const remaining = core.stateRef.current.files.filter((file: FileItem, index: number) => targetIds.has(file.id)
          && currentQaStatus(file, getDictionary(), core.stateRef.current.storyInfo, index + 1) !== 'PASS').length;
        ui.addToast(remaining === 0
          ? 'Không còn gì để hậu kiểm — các chương vừa quét đã đạt kiểm tra.'
          : `Hậu kiểm qua ${waves} đợt: còn ${remaining} chương chờ kiểm/sửa. Đã lưu hàng đợi để tiếp tục khi model sẵn sàng.`,
          remaining === 0 ? 'success' : 'warning');
      } catch (error) {
        if (!abort()) ui.addToast(`Hậu kiểm chưa hoàn tất: ${error instanceof Error ? error.message : String(error)}`, 'warning');
      } finally {
        if (!abort()) {
          core.setFiles((prev: FileItem[]) => prev.map(file => activeIds.has(file.id) && file.status === FileStatus.REPAIRING
            ? { ...file, status: FileStatus.COMPLETED, qaStatus: 'QA_DEFERRED', qaReason: 'Chưa hoàn tất hậu kiểm; bản dịch được giữ lại.' } : file));
          shared.isProcessingRef.current = false;
          shared.setIsProcessing(false);
          shared.setIsSmartAutoMode(false);
          shared.setAutoFixEnabled(false);
          shared.setEndTime(Date.now());
          shared.isFixPhaseRef.current = false;
          shared.isRepairRunningRef.current = false;
          core.saveSession(true);
        }
      }
    })();
    return true;
  };
  return { handleQualityReview };
};
