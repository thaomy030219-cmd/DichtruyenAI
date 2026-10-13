import { getAiClient, SAFETY_SETTINGS } from '../../api/gemini';
import { fetchOpenRouter } from '../../api/openrouter';
import { quotaManager } from '../../../utils/quotaManager';
import { QualityReview } from '../../../types';
import { applyQualityEdits, deferredReview, parseQualityReview, QUALITY_REVIEW_INSTRUCTION } from './qualityReview';
import { enforceLocalLocks, LocalFinding } from './localConsistency';

export interface ReviewFile { id: string; content: string; name?: string; consistencyContext?: string; localHints?: string; localFindings?: LocalFinding[] }
export interface ReviewOptions {
  shouldAbort?: () => boolean;
  request?: (instruction: string, prompt: string) => Promise<string>;
}
const SUPPORT_REVIEW_MODELS = ['gemini-3.1-flash-lite', 'gemini-3.5-flash-lite', 'gemma-4-31b-it', 'gemma-4-26b-a4b-it'];
export const hasReadyQualityModel = (enabled: string[], openRouterKey?: string, translationModel?: string): boolean =>
  !!(openRouterKey?.trim() && translationModel?.startsWith('openrouter:'))
  || (!!process.env.GEMINI_API_KEY && SUPPORT_REVIEW_MODELS.some(id => (!enabled.length || enabled.includes(id)) && quotaManager.isModelAvailable(id)));
const parseJson = (text: string): any => JSON.parse(text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, ''));

// Bounded support requests defer on quota/cooldown instead of waiting in the
// translation queue or consuming requests from the main translation pool.
export const requestQualityJson = async (
  instruction: string, prompt: string, enabledModels: string[], openRouterKey?: string,
  translationModel?: string, shouldAbort?: () => boolean,
  excludedModels: string[] = [], onModelUsed?: (model: string) => void,
): Promise<string> => {
  const satellites = translationModel?.startsWith('openrouter:') && openRouterKey?.trim() ? [translationModel] : [];
  const candidates = [...satellites, ...SUPPORT_REVIEW_MODELS.filter(id => !enabledModels.length || enabledModels.includes(id))];
  let lastError = 'Model hậu kiểm đang bận hoặc hết quota.';
  let attempts = 0;
  for (const id of candidates) {
    if (excludedModels.includes(id)) continue;
    if (shouldAbort?.()) throw new Error('ABORTED');
    if (!id.startsWith('openrouter:') && !quotaManager.isModelAvailable(id)) continue;
    if (attempts++ >= 2) break;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60_000);
    try {
      onModelUsed?.(id);
      if (id.startsWith('openrouter:')) return await fetchOpenRouter(openRouterKey || '', id.slice('openrouter:'.length), instruction, prompt, true, undefined, controller.signal);
      const client = getAiClient();
      quotaManager.recordRequest(id);
      const response = await client.models.generateContent({ model: id, contents: prompt,
        config: { systemInstruction: instruction, safetySettings: SAFETY_SETTINGS, temperature: 0.1,
          responseMimeType: 'application/json', abortSignal: controller.signal } });
      quotaManager.recordSuccess(id);
      return response.text || '{}';
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      if (!id.startsWith('openrouter:')) {
        if (/429|quota|resource exhausted/i.test(lastError)) quotaManager.recordRateLimit(id);
        else quotaManager.recordError(id);
      }
    } finally { clearTimeout(timeout); }
  }
  throw new Error(lastError);
};

export const validateBatchWithAI = async (
  files: ReviewFile[], results: Map<string, string>, enabledModels: string[],
  onLog?: (msg: string) => void, openRouterKey?: string, translationModel?: string,
  consistencyContext = '', options: ReviewOptions = {},
): Promise<Map<string, QualityReview>> => {
  const report = new Map<string, QualityReview>();
  const request = options.request || ((instruction, prompt) => requestQualityJson(instruction, prompt, enabledModels, openRouterKey, translationModel, options.shouldAbort));
  const chunks: ReviewFile[][] = [];
  let chunk: ReviewFile[] = [], chars = 0;
  for (const file of files) {
    const target = results.get(file.id);
    if (!target) continue;
    const size = file.content.length + target.length + (file.consistencyContext || consistencyContext).length;
    if (size > 120_000) { report.set(file.id, deferredReview('Chương quá dài để hậu kiểm trọn vẹn trong một lượt; cần tách chương.')); continue; }
    if (chunk.length >= 6 || (chunk.length && chars + size > 120_000)) { chunks.push(chunk); chunk = []; chars = 0; }
    chunk.push(file); chars += size;
  }
  if (chunk.length) chunks.push(chunk);
  for (const batch of chunks) {
    if (options.shouldAbort?.()) throw new Error('ABORTED');
    onLog?.(`🔎 Hậu kiểm nội dung, tên, xưng hô và ngoại ngữ: ${batch.length} chương.`);
    try {
      const prompt = JSON.stringify(batch.map(file => ({ file_id: file.id, name: file.name,
        rules: file.consistencyContext || consistencyContext, localChecks: file.localHints || '', source: file.content, translation: results.get(file.id) })));
      const parsed = parseJson(await request(QUALITY_REVIEW_INSTRUCTION, prompt));
      for (const file of batch) report.set(file.id, parseQualityReview(parsed?.reviews?.[file.id], file.content, results.get(file.id)!));
    } catch (error) {
      if (options.shouldAbort?.()) throw new Error('ABORTED');
      const reason = error instanceof Error ? error.message : String(error);
      for (const file of batch) report.set(file.id, deferredReview(`Chưa hậu kiểm được: ${reason}`));
    }
  }
  for (const file of files) {
    const review = report.get(file.id);
    if (review && file.localFindings) report.set(file.id, enforceLocalLocks(review, file.localFindings));
  }
  return report;
};

/** One small repair, then a separate full review; failed verification rolls back. */
export const reviewAndRepairBatch = async (
  files: ReviewFile[], results: Map<string, string>, enabledModels: string[], onLog?: (msg: string) => void,
  openRouterKey?: string, translationModel?: string, consistencyContext = '', options: ReviewOptions = {},
): Promise<Map<string, QualityReview>> => {
  const reviewModels = new Set<string>();
  const request = options.request || ((instruction, prompt) => requestQualityJson(instruction, prompt, enabledModels, openRouterKey, translationModel, options.shouldAbort, [], model => reviewModels.add(model)));
  const report = await validateBatchWithAI(files, results, enabledModels, onLog, openRouterKey, translationModel, consistencyContext, { ...options, request });
  const failures = files.filter(file => report.get(file.id)?.status === 'CONFIRMED_FAILURE');
  if (failures.length) {
    onLog?.(`🔎 Xác nhận chéo ${failures.length} chương nghi lệch nội dung trước khi yêu cầu dịch lại.`);
    const confirmationRequest = options.request || ((instruction: string, prompt: string) => requestQualityJson(
      instruction, prompt, enabledModels, openRouterKey, translationModel, options.shouldAbort, [...reviewModels],
    ));
    const confirmed = await validateBatchWithAI(failures, results, enabledModels, onLog, openRouterKey, translationModel, consistencyContext, { ...options, request: confirmationRequest });
    for (const file of failures) {
      const verdict = confirmed.get(file.id)!;
      report.set(file.id, verdict.status === 'CONFIRMED_FAILURE'
        ? { ...verdict, reason: `Hai lượt hậu kiểm xác nhận lệch nội dung: ${verdict.reason}` }
        : verdict.status === 'PASS' || verdict.decision === 'REPAIRABLE' ? verdict
        : { ...deferredReview('Chưa xác nhận chéo được nghi vấn lệch nội dung; giữ bản dịch để hậu kiểm lại.'), findings: report.get(file.id)!.findings });
    }
  }
  const verifyFiles: ReviewFile[] = [], candidates = new Map<string, string>();
  for (const file of files) {
    const review = report.get(file.id), original = results.get(file.id);
    if (!original || review?.decision !== 'REPAIRABLE') continue;
    if (options.shouldAbort?.()) throw new Error('ABORTED');
    try {
      const parsed = parseJson(await request(
        'Sửa đúng các lỗi có bằng chứng. Chỉ thay những trích đoạn targetQuote được nêu, giữ toàn bộ nội dung và văn phong còn lại. Không sửa quy tắc chưa xác định. Trả JSON {"edits":[{"original":"targetQuote nguyên văn","replacement":"đoạn đã sửa"}]}. Không viết lại chương.',
        JSON.stringify({ source: file.content, translation: original, rules: file.consistencyContext || consistencyContext, findings: review.findings }),
      ));
      const changed = applyQualityEdits(original, parsed?.edits, review.findings);
      if (changed) { candidates.set(file.id, changed); verifyFiles.push(file); }
      else report.set(file.id, { ...review, reason: `${review.reason} — Bản sửa không đủ an toàn; đã giữ nguyên bản dịch.` });
    } catch (error) {
      if (options.shouldAbort?.()) throw new Error('ABORTED');
      report.set(file.id, { ...review, status: 'QA_DEFERRED', reason: `Chưa sửa/kiểm lại được: ${error instanceof Error ? error.message : String(error)}` });
    }
  }
  if (verifyFiles.length) {
    // Old local findings point at the pre-repair text; callers re-run local checks
    // on the accepted output, rather than blocking a correct patch with stale hints.
    const verified = await validateBatchWithAI(verifyFiles.map(file => ({ ...file, localFindings: undefined, localHints: undefined })), candidates, enabledModels, onLog, openRouterKey, translationModel, consistencyContext, options);
    for (const file of verifyFiles) {
      const verdict = verified.get(file.id)!;
      if (verdict.status === 'PASS') {
        results.set(file.id, candidates.get(file.id)!);
        report.set(file.id, { ...verdict, reason: 'Đã sửa cục bộ và hậu kiểm lại: đạt.', ruleProposals: report.get(file.id)?.ruleProposals });
      } else report.set(file.id, { ...report.get(file.id)!, status: verdict.status === 'QA_DEFERRED' ? 'QA_DEFERRED' : 'SUSPECT', reason: 'Bản sửa chưa vượt qua hậu kiểm lại; đã giữ nguyên bản dịch trước sửa.' });
    }
  }
  return report;
};
