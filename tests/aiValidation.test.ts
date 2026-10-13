import { describe, expect, it, vi } from 'vitest';
import { reviewAndRepairBatch, validateBatchWithAI, requestQualityJson } from '../src/services/workflows/translate/aiValidation';
import { quotaManager } from '../src/utils/quotaManager';

const files = [{ id: 'a', content: '林墨说：“你走吧。”', name: 'Chương 1' }];
const target = 'Lâm Mặc nói: “Mày đi đi.”';
const pass = { decision: 'PASS', contentAlignment: 'PASS', checks: { pronoun: 'PASS', terminology: 'PASS', foreign: 'PASS', format: 'PASS' }, findings: [], reason: 'Đạt' };
const repairable = { decision: 'REPAIRABLE', contentAlignment: 'PASS', findings: [{ category: 'pronoun', sourceQuote: '你走吧', targetQuote: 'Mày đi đi.', detail: 'Cách gọi sai' }], reason: 'Sai cách gọi' };
const response = (verdict: unknown) => JSON.stringify({ reviews: { a: verdict } });

describe('QA request and repair workflow', () => {
  it('isolates missing IDs in a mixed batch without rejecting the good chapter', async () => {
    const report = await validateBatchWithAI([...files, { id: 'b', content: 'Nguồn b' }], new Map([['a', target], ['b', 'Dịch b']]), [], undefined, undefined, undefined, '', {
      request: async () => response(pass),
    });
    expect(report.get('a')?.status).toBe('PASS');
    expect(report.get('b')?.status).toBe('QA_DEFERRED');
  });
  it('preserves output on malformed JSON and network failures', async () => {
    for (const request of [async () => 'bad json', async () => { throw new Error('429 quota'); }]) {
      const results = new Map([['a', target]]);
      const report = await reviewAndRepairBatch(files, results, [], undefined, undefined, undefined, '', { request });
      expect(report.get('a')?.status).toBe('QA_DEFERRED');
      expect(results.get('a')).toBe(target);
    }
  });
  it('sends the full middle of long chapters and defers oversized files without truncation', async () => {
    const source = 'đầu '.repeat(1800) + 'SỰ KIỆN Ở GIỮA' + 'cuối '.repeat(1800);
    const request = vi.fn(async (_instruction: string, prompt: string) => {
      expect(JSON.parse(prompt)[0].source).toBe(source);
      return response(pass);
    });
    await validateBatchWithAI([{ id: 'a', content: source }], new Map([['a', target]]), [], undefined, undefined, undefined, '', { request });
    expect(request).toHaveBeenCalledTimes(1);
    const report = await validateBatchWithAI([{ id: 'a', content: 'a'.repeat(120_001) }], new Map([['a', target]]), [], undefined, undefined, undefined, '', { request });
    expect(report.get('a')?.status).toBe('QA_DEFERRED');
    expect(request).toHaveBeenCalledTimes(1);
  });
  it('accepts a small repair only after another full review passes', async () => {
    const request = vi.fn().mockResolvedValueOnce(response(repairable))
      .mockResolvedValueOnce(JSON.stringify({ edits: [{ original: 'Mày đi đi.', replacement: 'Em đi đi.' }] }))
      .mockResolvedValueOnce(response(pass));
    const results = new Map([['a', target]]);
    const report = await reviewAndRepairBatch(files, results, [], undefined, undefined, undefined, '', { request });
    expect(request).toHaveBeenCalledTimes(3);
    expect(JSON.parse(request.mock.calls[2][1])[0].translation).toContain('Em đi đi.');
    expect(results.get('a')).toBe('Lâm Mặc nói: “Em đi đi.”');
    expect(report.get('a')?.status).toBe('PASS');
  });
  it('rolls back a repair that fails verification without marking the original as a content failure', async () => {
    const request = vi.fn().mockResolvedValueOnce(response(repairable))
      .mockResolvedValueOnce(JSON.stringify({ edits: [{ original: 'Mày đi đi.', replacement: 'Em đi đi.' }] }))
      .mockResolvedValueOnce(response({ decision: 'CONTENT_MISMATCH', contentAlignment: 'FAIL', findings: [{ category: 'content', sourceQuote: '你走吧', targetQuote: 'Em đi đi.', detail: 'Sai' }] }));
    const results = new Map([['a', target]]);
    const report = await reviewAndRepairBatch(files, results, [], undefined, undefined, undefined, '', { request });
    expect(results.get('a')).toBe(target);
    expect(report.get('a')?.status).toBe('SUSPECT');
  });
  it('does not rewrite the chapter when the model proposes an unsafe broad edit', async () => {
    const request = vi.fn().mockResolvedValueOnce(response(repairable))
      .mockResolvedValueOnce(JSON.stringify({ edits: [{ original: target, replacement: 'Chương khác.' }] }));
    const results = new Map([['a', target]]);
    expect((await reviewAndRepairBatch(files, results, [], undefined, undefined, undefined, '', { request })).get('a')?.status).toBe('SUSPECT');
    expect(results.get('a')).toBe(target);
    expect(request).toHaveBeenCalledTimes(2);
  });
  it('does not borrow the main model quota when all support models are disabled', async () => {
    const ready = vi.spyOn(quotaManager, 'isModelAvailable').mockReturnValue(true);
    const record = vi.spyOn(quotaManager, 'recordRequest');
    await expect(requestQualityJson('instruction', 'prompt', ['gemini-3.1-pro-preview'], undefined, 'gemini-3.1-pro-preview')).rejects.toThrow('hậu kiểm');
    expect(ready).not.toHaveBeenCalled();
    expect(record).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });
  it('requires a second agreement before confirming a content failure', async () => {
    const mismatch = { decision: 'CONTENT_MISMATCH', contentAlignment: 'FAIL', findings: [{ category: 'content', sourceQuote: '你走吧', targetQuote: 'Mày đi đi.', detail: 'Nội dung khác' }], reason: 'Lệch nội dung' };
    const agreed = vi.fn().mockResolvedValue(response(mismatch));
    const results = new Map([['a', target]]);
    expect((await reviewAndRepairBatch(files, results, [], undefined, undefined, undefined, '', { request: agreed })).get('a')?.status).toBe('CONFIRMED_FAILURE');
    expect(agreed).toHaveBeenCalledTimes(2);
    expect(results.get('a')).toBe(target);
    const disagreed = vi.fn().mockResolvedValueOnce(response(mismatch)).mockResolvedValueOnce(response(pass));
    expect((await reviewAndRepairBatch(files, results, [], undefined, undefined, undefined, '', { request: disagreed })).get('a')?.status).toBe('PASS');
  });
  it('defers a content suspicion if independent confirmation is unavailable', async () => {
    const mismatch = { decision: 'CONTENT_MISMATCH', contentAlignment: 'FAIL', findings: [{ category: 'content', sourceQuote: '你走吧', targetQuote: 'Mày đi đi.', detail: 'Nội dung khác' }] };
    const request = vi.fn().mockResolvedValueOnce(response(mismatch)).mockRejectedValueOnce(new Error('Hết quota model xác nhận'));
    const results = new Map([['a', target]]);
    expect((await reviewAndRepairBatch(files, results, [], undefined, undefined, undefined, '', { request })).get('a')?.status).toBe('QA_DEFERRED');
    expect(results.get('a')).toBe(target);
  });
  it('propagates cancellation rather than converting it into failure/deferred outcomes', async () => {
    await expect(validateBatchWithAI(files, new Map([['a', target]]), [], undefined, undefined, undefined, '', {
      shouldAbort: () => true, request: async () => response(pass),
    })).rejects.toThrow('ABORTED');
  });
});
