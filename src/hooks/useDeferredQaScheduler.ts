import { useEffect } from 'react';
import { nextDeferredQaWake } from '../services/workflows/translate/deferredQaScheduler';
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
    let timer: ReturnType<typeof setTimeout>;
    const resume = () => {
      if (shared.isProcessingRef.current || shared.qaPausedRef.current || shared.isRepairRunningRef.current) return;
      const live = core.stateRef.current;
      const ready = hasReadyQualityModel(live.enabledModels)
        || live.files.some((file: FileItem) => file.qaStatus && file.qaStatus !== 'PASS'
          && hasReadyQualityModel(live.enabledModels, live.openRouterKey, file.usedModel));
      if (ready) handleReview(false);
      // No model ready: revisit the queue later without making any API request.
      else timer = setTimeout(resume, 60_000);
    };
    timer = setTimeout(resume, Math.max(1000, Math.min(30 * 60_000, next - now)));
    return () => clearTimeout(timer);
  }, [core, shared, handleReview, busy]);
};
