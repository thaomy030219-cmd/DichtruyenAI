import { BatchLimits } from '../types';

export const MODEL_BATCH_LIMIT_MISMATCH = 'MODEL_BATCH_LIMIT_MISMATCH';

const DEFAULT_LATIN_LIMITS = { v36: 6, v35: 6, v3: 6, v31: 12, v25: 6, maxTotalChars: 90000 };
const DEFAULT_COMPLEX_LIMITS = { v36: 6, v35: 6, v3: 6, v31: 12, v25: 6, maxTotalChars: 45000 };

export const usesLatinBatchTable = (languages: string[] = []): boolean => {
    const language = languages.join(' ').toLowerCase();
    return language.includes('việt') || language.includes('convert') || language.includes('english') || language.includes('tiếng anh');
};

export const getModelBatchFileLimit = (
    modelId: string,
    batchLimits?: BatchLimits,
    languages: string[] = [],
): number => {
    if (modelId.startsWith('openrouter:')) return 1;
    const limits = usesLatinBatchTable(languages)
        ? (batchLimits?.latin || DEFAULT_LATIN_LIMITS)
        : (batchLimits?.complex || DEFAULT_COMPLEX_LIMITS);
    const configured = modelId.includes('3.1-pro')
        ? limits.v31
        : modelId.includes('flash-lite') || modelId.includes('gemma')
            ? limits.v35
            : limits.v36;
    const parsed = Number.parseInt(String(configured), 10);
    return Math.max(1, Number.isFinite(parsed) ? parsed : 6);
};

export const assertModelBatchCapacity = (
    modelId: string,
    actualFiles: number,
    batchLimits?: BatchLimits,
    languages: string[] = [],
): void => {
    const allowedFiles = getModelBatchFileLimit(modelId, batchLimits, languages);
    if (actualFiles <= allowedFiles) return;
    const error = new Error(`${MODEL_BATCH_LIMIT_MISMATCH}: ${modelId} chỉ được nhận tối đa ${allowedFiles} tệp nhưng batch hiện có ${actualFiles} tệp.`) as Error & { code?: string };
    error.code = MODEL_BATCH_LIMIT_MISMATCH;
    throw error;
};