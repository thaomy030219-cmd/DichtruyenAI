// Picks which Gemini/OpenRouter models to use for a given tier + task type
// (translate / auto_fix / smart_fix), respecting the user's enabled-models
// list. Split out of the old monolithic `translator.ts` — logic unchanged.
import { MODEL_CONFIGS } from '../../../constants';
import { TranslationTier } from '../../../types';

export const getEffectiveModelsForTier = (
    tier: TranslationTier, 
    taskType: 'translate' | 'auto_fix' | 'smart_fix',
    enabledModels: string[] = MODEL_CONFIGS.map(m => m.id)
): string[] => {
    // Utility to strictly filter enabled models to prevent calling disabled ones.
    const filterModels = (models: string[]) => models.filter(id => enabledModels.includes(id) || enabledModels.length === 0);
    
    const getFallback = (defaultModels: string[]) => {
        const matchingModels = filterModels(defaultModels);
        if (matchingModels.length > 0) return matchingModels;
        
        // If no requested models matched, but enabledModels has openrouter models, fallback to them
        const openRouterModels = enabledModels.filter(m => m.startsWith('openrouter:'));
        if (openRouterModels.length > 0) return openRouterModels;
        
        return defaultModels;
    };

    // RULE 1: Smart Fix Button always uses Pro Models (Explicit user request, except Lite and OpenRouter tiers)
    if (taskType === 'smart_fix') {
        if (tier === 'lite') {
            return getFallback(['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite']);
        }
        if (tier === 'openrouter') {
            const openRouterModels = enabledModels.filter(m => m.startsWith('openrouter:'));
            if (openRouterModels.length > 0) return openRouterModels;
            return ['openrouter:google/gemma-4-26b-a4b-it:free'];
        }
        return getFallback(['gemini-3.1-pro-preview']);
    }

    // RULE 2: Pro Tier
    // - Translate: 3.1 Pro
    // - Auto Fix: 3.7 Flash > 3.0 Flash Preview > 3.5 Flash
    if (tier === 'pro') {
        if (taskType === 'translate') {
            return getFallback(['gemini-3.1-pro-preview']);
        } else {
            return getFallback(['gemini-3.7-flash', 'gemini-3-flash-preview', 'gemini-3.5-flash']);
        }
    }

    // RULE 3: Normal Tier
    // - Translate: 3.1 Pro > 3.7 Flash > 3.5 Flash
    // - Auto Fix: 3.0 Flash > 3.5 Flash Lite > 3.1 Flash Lite
    if (tier === 'normal') {
        if (taskType === 'translate') {
            return getFallback(['gemini-3.1-pro-preview', 'gemini-3.7-flash', 'gemini-3.5-flash']);
        } else {
            return getFallback(['gemini-3-flash-preview', 'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite']);
        }
    }

    // RULE 4: Full Tier
    // - Translate: 3.1 Pro > 3.7 Flash > 3.0 Flash > 3.5 Flash
    // - Auto Fix: 3.5 Flash Lite > 3.1 Flash Lite
    if (tier === 'full') {
        if (taskType === 'translate') {
            return getFallback(['gemini-3.1-pro-preview', 'gemini-3.7-flash', 'gemini-3-flash-preview', 'gemini-3.5-flash']);
        } else {
            return getFallback(['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite']);
        }
    }

    // RULE 5: Flash Tier
    // - Translate: 3.7 Flash > 3.0 Flash > 3.5 Flash
    // - Auto Fix: 3.5 Flash Lite > 3.1 Flash Lite
    if (tier === 'flash') {
        if (taskType === 'translate') {
            return getFallback(['gemini-3.7-flash', 'gemini-3-flash-preview', 'gemini-3.5-flash']);
        } else {
            return getFallback(['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite']);
        }
    }

    // RULE 6: Lite Tier
    // - Translate: 3.5 Flash Lite > 3.1 Flash Lite
    // - Auto Fix: 3.5 Flash Lite > 3.1 Flash Lite
    if (tier === 'lite') {
        return getFallback(['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite']);
    }
    
    // RULE 7: OpenRouter Tier
    if (tier === 'openrouter') {
        const openRouterModels = enabledModels.filter(m => m.startsWith('openrouter:'));
        if (openRouterModels.length > 0) return openRouterModels;
        return ['openrouter:google/gemma-4-26b-a4b-it:free'];
    }

    return ['gemini-3.7-flash', 'gemini-3.5-flash'];
};
