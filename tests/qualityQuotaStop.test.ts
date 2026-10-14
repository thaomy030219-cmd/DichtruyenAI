import { describe, expect, it, vi } from 'vitest';
import { reviewAndRepairBatch, validateBatchWithAI } from '../src/services/workflows/translate/aiValidation';

describe('QA quota circuit breaker', () => {
  it.each([validateBatchWithAI, reviewAndRepairBatch])('does not send subsequent chunks after quota exhaustion', async review => {
    const files = Array.from({ length: 20 }, (_, i) => ({ id: String(i), content: '原文' }));
    const results = new Map(files.map(f => [f.id, 'Bản dịch giữ nguyên']));
    const request = vi.fn().mockRejectedValue(new Error('429 RESOURCE_EXHAUSTED quota'));
    const onQuotaExhausted = vi.fn();
    const reports = await review(files, results, [], undefined, undefined, undefined, '', { request, onQuotaExhausted });
    expect(request).toHaveBeenCalledTimes(1);
    expect(onQuotaExhausted).toHaveBeenCalled();
    expect(reports.size).toBe(20);
    expect([...reports.values()].every(r => r.status === 'QA_DEFERRED')).toBe(true);
    expect([...results.values()].every(text => text === 'Bản dịch giữ nguyên')).toBe(true);
  });
});
