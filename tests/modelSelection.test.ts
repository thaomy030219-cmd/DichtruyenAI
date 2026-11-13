import { describe, expect, it } from 'vitest';
import { DEFAULT_ENABLED_MODEL_IDS, MODEL_CONFIGS, SUPPORT_MODEL_IDS, TRANSLATION_MODEL_IDS } from '../src/constants';
import { getEffectiveModelsForTier } from '../src/services/workflows/translate/modelSelection';

const enabled = [...TRANSLATION_MODEL_IDS, ...SUPPORT_MODEL_IDS];

describe('model role routing', () => {
    it('excludes models without Free Tier quota from default translation', () => {
        expect(DEFAULT_ENABLED_MODEL_IDS).not.toContain('gemini-3.1-pro-preview');
        expect(getEffectiveModelsForTier('pro', 'translate')).not.toContain('gemini-3.1-pro-preview');
        expect(MODEL_CONFIGS.find(model => model.id === 'gemini-3.1-pro-preview')?.rpdLimit).toBe(0);
    });
    it.each(['normal', 'flash'] as const)(
        'keeps %s translation inside the dedicated translation pool',
        tier => {
            const models = getEffectiveModelsForTier(tier, 'translate', enabled);
            expect(models).toEqual([...TRANSLATION_MODEL_IDS]);
            expect(models.every(model => TRANSLATION_MODEL_IDS.includes(model as typeof TRANSLATION_MODEL_IDS[number]))).toBe(true);
        }
    );

    it('prioritizes 3.1 Pro for the pro translation tier', () => {
        expect(getEffectiveModelsForTier('pro', 'translate', enabled)).toEqual([
            'gemini-3.1-pro-preview',
            'gemini-4-hydrogen',
            'gemini-3.8-flash',
            'gemini-3-flash-preview',
        ]);
    });

    it.each(['auto_fix', 'smart_fix'] as const)(
        'routes %s to support models only',
        taskType => {
            const models = getEffectiveModelsForTier('normal', taskType, enabled);
            expect(models).toEqual([...SUPPORT_MODEL_IDS]);
            expect(models.some(model => TRANSLATION_MODEL_IDS.includes(model as typeof TRANSLATION_MODEL_IDS[number]))).toBe(false);
        }
    );

    it('uses the retained 3 Flash model in Lite mode', () => {
        expect(getEffectiveModelsForTier('lite', 'translate', enabled)).toEqual(['gemini-3-flash-preview']);
    });

    it('never falls back to a support model for direct translation', () => {
        const models = getEffectiveModelsForTier('normal', 'translate', [...SUPPORT_MODEL_IDS]);
        expect(models).toEqual([...TRANSLATION_MODEL_IDS]);
    });
});
