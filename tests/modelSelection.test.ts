import { describe, expect, it } from 'vitest';
import { SUPPORT_MODEL_IDS, TRANSLATION_MODEL_IDS } from '../src/constants';
import { getEffectiveModelsForTier } from '../src/services/workflows/translate/modelSelection';

const enabled = [...TRANSLATION_MODEL_IDS, ...SUPPORT_MODEL_IDS];

describe('model role routing', () => {
    it.each(['normal', 'full', 'flash', 'lite'] as const)(
        'keeps %s translation inside the three-model translation pool',
        tier => {
            const models = getEffectiveModelsForTier(tier, 'translate', enabled);
            expect(models).toEqual([...TRANSLATION_MODEL_IDS]);
            expect(models.every(model => TRANSLATION_MODEL_IDS.includes(model as typeof TRANSLATION_MODEL_IDS[number]))).toBe(true);
        }
    );

    it('prioritizes 3.1 Pro for the pro translation tier', () => {
        expect(getEffectiveModelsForTier('pro', 'translate', enabled)).toEqual([
            'gemini-3.1-pro-preview',
            'gemini-3.8-flash',
            'gemini-3.7-flash',
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

    it('never falls back to a support model for direct translation', () => {
        const models = getEffectiveModelsForTier('normal', 'translate', [...SUPPORT_MODEL_IDS]);
        expect(models).toEqual([...TRANSLATION_MODEL_IDS]);
    });
});