import { describe, expect, it } from 'vitest';
import {
    DEEP_ANALYSIS_CHUNK_MODELS,
    DEEP_ANALYSIS_SYNTHESIS_MODELS,
    selectAnalysisModels,
} from '../src/services/workflows/analyze/modelRouting';

describe('deep analysis model routing', () => {
    it('prefers Hydrogen for chunk analysis and synthesis', () => {
        expect(DEEP_ANALYSIS_CHUNK_MODELS[0]).toBe('gemini-4-hydrogen');
        expect(DEEP_ANALYSIS_SYNTHESIS_MODELS[0]).toBe('gemini-4-hydrogen');
    });

    it('keeps 3.1 Pro as the final difficult-case fallback', () => {
        expect(DEEP_ANALYSIS_SYNTHESIS_MODELS.at(-1)).toBe('gemini-3.1-pro-preview');
    });

    it('preserves priority while respecting enabled models', () => {
        expect(selectAnalysisModels(DEEP_ANALYSIS_SYNTHESIS_MODELS, [
            'gemini-3.8-flash',
            'gemini-3.1-pro-preview',
        ])).toEqual(['gemini-3.8-flash', 'gemini-3.1-pro-preview']);
    });
});
