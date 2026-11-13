import { GoogleGenAI } from '@google/genai';
import { DEFAULT_ENABLED_MODEL_IDS } from '../../constants';
import { GeminiQuotaProject, QuotaManager, quotaManager } from '../../utils/quotaManager';

export const GEMINI_PROJECT_SETTINGS_KEY = 'gemini_free_projects_v1';

export interface GeminiProjectSettings {
    id: string;
    key: string;
    modelIds: string[];
}

export interface GeminiProject extends GeminiQuotaProject {
    client: GoogleGenAI;
}

const readSettings = (storage: 'localStorage' | 'sessionStorage'): GeminiProjectSettings[] | undefined => {
    try {
        const value = globalThis[storage]?.getItem(GEMINI_PROJECT_SETTINGS_KEY);
        if (value == null) return undefined;
        const saved = JSON.parse(value);
        if (Array.isArray(saved)) return saved.filter(project => project
            && typeof project.id === 'string' && typeof project.key === 'string'
            && Array.isArray(project.modelIds));
    } catch { /* Browser storage may be unavailable. */ }
    return undefined;
};

const defaultKey = process.env.GEMINI_API_KEY;
const defaultProject: GeminiProject | undefined = defaultKey ? {
    id: '',
    client: new GoogleGenAI({ apiKey: defaultKey }),
    modelIds: DEFAULT_ENABLED_MODEL_IDS,
    quota: quotaManager.getDefaultQuota()
} : undefined;

let settings: GeminiProjectSettings[] = [];
let personalProjects: GeminiProject[] = [];

export const getGeminiProjectSettings = () => settings;
export const getGeminiProjects = (): GeminiProject[] =>
    personalProjects.length ? personalProjects : defaultProject ? [defaultProject] : [];

export const getGeminiModelRoutes = (models: string[]) =>
    getGeminiProjects().flatMap(project => models.filter(id => project.modelIds.includes(id)).map(id => ({ project, id })));

const applySettings = (next: GeminiProjectSettings[]) => {
    const seenKeys = new Set<string>();
    const seenIds = new Set<string>();
    settings = next.filter(({ id, key }) => {
        if (!id || !key || seenIds.has(id) || seenKeys.has(key)) return false;
        seenIds.add(id);
        seenKeys.add(key);
        return true;
    });
    personalProjects = settings.map(({ id, key, modelIds }) => ({
        id,
        client: new GoogleGenAI({ apiKey: key }),
        modelIds: DEFAULT_ENABLED_MODEL_IDS.filter(model => modelIds.includes(model)),
        quota: personalProjects.find(project => project.id === id)?.quota
            ?? new QuotaManager('gemini_quota_usage_v1:' + id)
    }));
    quotaManager.setProjects(personalProjects);
};

export const setGeminiProjectSettings = (next: GeminiProjectSettings[]): boolean => {
    try {
        // Keep an empty list after deletion so another tab cannot migrate old keys back.
        localStorage.setItem(GEMINI_PROJECT_SETTINGS_KEY, JSON.stringify(next));
    } catch {
        return false;
    }
    try { sessionStorage.removeItem(GEMINI_PROJECT_SETTINGS_KEY); } catch { /* The local copy takes precedence. */ }
    applySettings(next);
    return true;
};

const savedSettings = readSettings('localStorage');
if (savedSettings) {
    applySettings(savedSettings);
    try { sessionStorage.removeItem(GEMINI_PROJECT_SETTINGS_KEY); } catch { /* The local copy takes precedence. */ }
} else {
    const sessionSettings = readSettings('sessionStorage');
    if (sessionSettings && !setGeminiProjectSettings(sessionSettings)) applySettings(sessionSettings);
}

if (typeof window !== 'undefined') {
    window.addEventListener('storage', event => {
        if (event.storageArea === localStorage && (event.key === GEMINI_PROJECT_SETTINGS_KEY || event.key === null)) {
            applySettings(readSettings('localStorage') ?? []);
        }
    });
}

export const listCompatibleGeminiModels = async (key: string, abortSignal?: AbortSignal): Promise<string[]> => {
    const client = new GoogleGenAI({ apiKey: key });
    const models = await client.models.list({ config: { pageSize: 100, abortSignal } });
    const compatible: string[] = [];
    for await (const model of models) {
        const id = model.name?.replace(/^models\//, '');
        if (id && DEFAULT_ENABLED_MODEL_IDS.includes(id) && model.supportedActions?.includes('generateContent')) {
            compatible.push(id);
        }
    }
    return compatible;
};

export const isGeminiRateLimit = (error: unknown): boolean =>
    /\b429\b|quota|resource[ _-]exhausted/i.test(error instanceof Error ? error.message : String(error));

export const isGeminiDailyQuota = (error: unknown): boolean => {
    const message = error instanceof Error ? error.message : String(error);
    if (!isGeminiRateLimit(error)) return false;
    const daily = /per[ _-]?day|daily|requests?\/day|\brpd\b/i;
    const quotaIds = [...message.matchAll(/"quotaId"\s*:\s*"([^"]+)"/g)];
    if (quotaIds.length) return quotaIds.some(([, id]) => daily.test(id));
    return daily.test(message) && !/per[ _-]?minute|requests?\/min|\brpm\b|\btpm\b/i.test(message);
};

export const recordGeminiRateLimit = (project: GeminiProject, model: string, error: unknown, cooldown = 60_000) => {
    if (isGeminiDailyQuota(error)) project.quota.markAsDepleted(model);
    else project.quota.recordRateLimit(model, cooldown);
};
