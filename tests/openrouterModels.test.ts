import { describe, expect, it } from 'vitest';
import {
    DEFAULT_OPENROUTER_MODEL,
    OPENROUTER_MODEL_IDS,
    sanitizeOpenRouterModels,
} from '../src/constants/openrouterModels';

describe('OpenRouter model configuration', () => {
    it('includes Ox Alpha and only the supported catalogue', () => {
        expect(OPENROUTER_MODEL_IDS.has('stealth/ox-alpha')).toBe(true);
        expect(OPENROUTER_MODEL_IDS.has('openai/gpt-oss-20b:free')).toBe(false);
        expect(OPENROUTER_MODEL_IDS.has('meta-llama/llama-3.3-70b-instruct:free')).toBe(false);
    });

    it('removes deprecated saved models without dropping valid choices', () => {
        expect(sanitizeOpenRouterModels([
            'openai/gpt-oss-120b:free',
            'stealth/ox-alpha',
            'google/gemma-4-31b-it:free',
        ].join(','))).toEqual([
            'stealth/ox-alpha',
            'google/gemma-4-31b-it:free',
        ]);
    });

    it('falls back to a known free model when every saved model expired', () => {
        expect(sanitizeOpenRouterModels('openrouter/free')).toEqual([DEFAULT_OPENROUTER_MODEL]);
    });
});
