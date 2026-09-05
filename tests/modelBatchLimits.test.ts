import { describe, expect, it } from 'vitest';
import { assertModelBatchCapacity, getModelBatchFileLimit, MODEL_BATCH_LIMIT_MISMATCH } from '../src/utils/modelBatchLimits';

const limits = {
    latin: { v36: 6, v35: 4, v31: 12, v3: 6, v25: 6, maxTotalChars: 90000 },
    complex: { v36: 5, v35: 3, v31: 10, v3: 5, v25: 5, maxTotalChars: 45000 },
};

describe('model batch capacity', () => {
    it('uses the actual fallback model family limit', () => {
        expect(getModelBatchFileLimit('gemini-3.1-pro-preview', limits, ['Convert'])).toBe(12);
        expect(getModelBatchFileLimit('gemini-3.8-flash', limits, ['Convert'])).toBe(6);
        expect(getModelBatchFileLimit('gemini-3.1-flash-lite', limits, ['Chinese'])).toBe(3);
    });

    it('rejects a Pro-sized batch before a Flash request is sent', () => {
        expect(() => assertModelBatchCapacity('gemini-3.8-flash', 12, limits, ['Convert']))
            .toThrow(MODEL_BATCH_LIMIT_MISMATCH);
    });
});