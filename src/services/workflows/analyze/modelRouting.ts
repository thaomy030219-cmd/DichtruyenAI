export const DEEP_ANALYSIS_CHUNK_MODELS = [
    'gemini-3.7-flash',
    'gemini-3.8-flash',
    'gemini-3.5-flash',
    'gemini-3-flash-preview',
] as const;

export const DEEP_ANALYSIS_SYNTHESIS_MODELS = [
    'gemini-3.8-flash',
    'gemini-3.7-flash',
    'gemini-3.1-pro-preview',
] as const;

export const selectAnalysisModels = (
    preferred: readonly string[],
    enabledModels?: string[],
): string[] => {
    const candidates = [...preferred];
    if (!enabledModels) return candidates;
    const enabled = candidates.filter(id => enabledModels.includes(id));
    return enabled.length > 0 ? enabled : candidates;
};