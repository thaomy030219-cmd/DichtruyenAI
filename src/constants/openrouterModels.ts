export interface OpenRouterModelOption {
    id: string;
    name: string;
    free: boolean;
}

export const DEFAULT_OPENROUTER_MODEL = 'google/gemma-4-26b-a4b-it:free';

// Keep this list deliberately small. OpenRouter's free catalogue changes often;
// these are the models intentionally exposed by the app as of August 2026.
export const OPENROUTER_MODELS: OpenRouterModelOption[] = [
    { id: 'stealth/ox-alpha', name: 'OpenRouter: Ox Alpha (Preview)', free: true },
    { id: 'google/gemma-4-26b-a4b-it:free', name: 'Google: Gemma 4 26B (Free)', free: true },
    { id: 'google/gemma-4-31b-it:free', name: 'Google: Gemma 4 31B (Free)', free: true },
];

export const OPENROUTER_MODEL_IDS = new Set(OPENROUTER_MODELS.map(model => model.id));

export const DEPRECATED_OPENROUTER_MODELS = new Set([
    'openrouter/free',
    'openai/gpt-oss-20b:free',
    'openai/gpt-oss-120b:free',
    'meta-llama/llama-3.3-70b-instruct:free',
    'nvidia/nemotron-3-nano-30b-a3b:free',
    'deepseek/deepseek-chat-v3.1:free',
]);

export const sanitizeOpenRouterModels = (value?: string): string[] => {
    const selected = (value || '')
        .split(',')
        .map(model => model.trim())
        .filter(Boolean)
        .filter(model => !DEPRECATED_OPENROUTER_MODELS.has(model));

    return selected.length > 0 ? Array.from(new Set(selected)) : [DEFAULT_OPENROUTER_MODEL];
};
