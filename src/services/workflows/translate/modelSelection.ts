// Central model routing for translation and support tasks.
import { MODEL_CONFIGS, SUPPORT_MODEL_IDS, TRANSLATION_MODEL_IDS } from '../../../constants';
import { TranslationTier } from '../../../types';

export const getTranslationPriorities = (tier: TranslationTier): Record<string, number> | undefined =>
    tier === 'pro' || tier === 'full' ? { 'gemini-3.1-pro-preview': 0 } : undefined;

export const getEffectiveModelsForTier = (
    tier: TranslationTier,
    taskType: 'translate' | 'auto_fix' | 'smart_fix',
    enabledModels: string[] = MODEL_CONFIGS.map(model => model.id)
): string[] => {
    const filterEnabled = (models: readonly string[]) =>
        models.filter(id => enabledModels.includes(id) || enabledModels.length === 0);

    if (taskType === 'translate') {
        const preferred = tier === 'lite'
            ? ['gemini-3-flash-preview']
            : tier === 'pro' || tier === 'full'
                ? ['gemini-3.1-pro-preview', ...TRANSLATION_MODEL_IDS.filter(id => id !== 'gemini-3.1-pro-preview')]
                : [...TRANSLATION_MODEL_IDS];
        const enabled = filterEnabled(preferred);

        // Không hạ cấp sang model hỗ trợ khi người dùng tắt toàn bộ model dịch.
        // Trả về pool chuẩn để smartExecution báo rõ model đang bị tắt/hết quota.
        return enabled.length > 0 ? enabled : preferred;
    }

    const supportModels = filterEnabled(SUPPORT_MODEL_IDS);
    return supportModels.length > 0 ? supportModels : [...SUPPORT_MODEL_IDS];
};
