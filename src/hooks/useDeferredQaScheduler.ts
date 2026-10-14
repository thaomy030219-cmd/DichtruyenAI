import { useEffect } from 'react';
import { isTranslationComplete, nextDeferredQaWake } from '../services/workflows/translate/deferredQaScheduler';
import { hasReadyQualityModel } from '../services/workflows/translate/aiValidation';
import { FileItem } from '../types';

/** Resume the saved QA queue while the app is open, without competing with translation. */
export const useDeferredQaScheduler = (core: any, shared: any, handleReview: (force: boolean) => boolean, busy = false) => {
  useEffect(() => {
    if (busy || !core.isLoaded || core.isResetting || core.loadError || shared.isProcessing
      || shared.activeBatches > 0 || shared.qaPausedRef.current || shared.isRepairRunningRef.current) return;
    const state = core.stateRef.current;
    const now = Date.now();
    const next = nextDeferredQaWake(state.files, shared.effectiveDictionary, state.storyInfo, now);
    if (next === undefined) return;
    const resume = () => {
      if (shared.isProcessingRef.current || shared.qaPausedRef.current || shared.isRepairRunningRef.current) return;
      const live = core.stateRef.current;
      if (!isTranslationComplete(live.files)) return;
      const ready = hasReadyQualityModel(live.enabledModels)
        || live.files.some((file: FileItem) => file.qaStatus && file.qaStatus !== 'PASS'
          && hasReadyQualityModel(live.enabledModels, live.openRouterKey, file.usedModel));
      if (ready) handleReview(false);
      else shared.qaPausedRef.current = true;
    };
    const timer = setTimeout(resume, Math.max(1000, Math.min(30 * 60_000, next - now)));
    return () => clearTimeout(timer);
  }, [core, shared, handleReview, busy]);
};
