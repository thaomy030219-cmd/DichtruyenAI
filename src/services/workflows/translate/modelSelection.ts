// Central model routing for translation and support tasks.
import { MODEL_CONFIGS, SUPPORT_MODEL_IDS, TRANSLATION_MODEL_IDS } from '../../../constants';
import { TranslationTier } from '../../../types';

export const getEffectiveModelsForTier = (
    tier: TranslationTier,
    taskType: 'translate' | 'auto_fix' | 'smart_fix',
    enabledModels: string[] = MODEL_CONFIGS.map(model => model.id)
): string[] => {
    const filterEnabled = (models: readonly string[]) =>
        models.filter(id => enabledModels.includes(id) || enabledModels.length === 0);

    const openRouterModels = enabledModels.filter(id => id.startsWith('openrouter:'));
    if (tier === 'openrouter') {
        return openRouterModels.length > 0
            ? openRouterModels
            : ['openrouter:google/gemma-4-26b-a4b-it:free'];
    }

    if (taskType === 'translate') {
        const preferred = tier === 'pro'
            ? ['gemini-3.1-pro-preview', 'gemini-3.8-flash', 'gemini-3.7-flash']
            : [...TRANSLATION_MODEL_IDS];
        const enabled = filterEnabled(preferred);

        // Không hạ cấp sang model hỗ trợ khi người dùng tắt cả ba model dịch.
        // Trả về pool chuẩn để smartExecution báo rõ model đang bị tắt/hết quota.
        return enabled.length > 0 ? enabled : preferred;
    }

    const supportModels = filterEnabled(SUPPORT_MODEL_IDS);
    if (supportModels.length > 0) return supportModels;

    // OpenRouter chỉ làm dự phòng cho tác vụ hỗ trợ khi không còn model hỗ trợ Gemini được bật.
    if (openRouterModels.length > 0) return openRouterModels;
    return [...SUPPORT_MODEL_IDS];
};
