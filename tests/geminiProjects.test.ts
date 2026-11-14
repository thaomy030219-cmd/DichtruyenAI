import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { smartExecution } from '../src/services/api/gemini';
import { importGeminiProjects } from '../src/services/api/geminiProjectImport';
import { getGeminiProjects, getGeminiProjectSettings, isGeminiDailyQuota, listCompatibleGeminiModels, setGeminiProjectSettings } from '../src/services/api/geminiProjects';
import { quotaManager } from '../src/utils/quotaManager';

const modelId = 'gemini-4-hydrogen';
const flashId = 'gemini-3.8-flash';
const storageKey = 'gemini_free_projects_v1';
const { list } = vi.hoisted(() => ({ list: vi.fn() }));
vi.mock('@google/genai', async importOriginal => ({
    ...await importOriginal<typeof import('@google/genai')>(),
    GoogleGenAI: class {
        models = { list };
        constructor(readonly options: { apiKey: string }) {}
    }
}));

describe('Gemini Free Tier projects', () => {
    beforeEach(() => {
        const makeStorage = () => {
            const values = new Map<string, string>();
            return {
                getItem: (id: string) => values.get(id) ?? null,
                setItem: (id: string, value: string) => { values.set(id, value); },
                removeItem: (id: string) => { values.delete(id); }
            };
        };
        vi.stubGlobal('localStorage', makeStorage());
        vi.stubGlobal('sessionStorage', makeStorage());
        vi.useFakeTimers();
    });

    afterEach(() => {
        setGeminiProjectSettings([]);
        vi.useRealTimers();
        vi.unstubAllGlobals();
    });

    it('keeps one key per project and preserves usage when the key changes', () => {
        setGeminiProjectSettings([{ id: 'first-project', key: 'first', modelIds: [modelId] }]);
        getGeminiProjects()[0].quota.recordRequest(modelId);
        setGeminiProjectSettings([
            { id: 'first-project', key: 'replacement', modelIds: [modelId] },
            { id: 'first-project', key: 'duplicate', modelIds: [modelId] },
            { id: 'another-project', key: 'replacement', modelIds: [modelId] }
        ]);
        expect(getGeminiProjectSettings()).toHaveLength(1);
        expect(quotaManager.getUsageSnapshot()[modelId].requestsToday).toBe(1);
        expect(quotaManager.getConfigs().find(model => model.id === modelId)?.rpdLimit).toBe(20);
        expect(localStorage.getItem('gemini_quota_usage_v1:first-project')).not.toContain('replacement');
    });

    it('loads saved keys in a new tab and keeps deleted keys from returning', async () => {
        const projects = [{ id: 'first-project', key: 'first', modelIds: [modelId] }];
        expect(setGeminiProjectSettings(projects)).toBe(true);
        expect(sessionStorage.getItem(storageKey)).toBeNull();

        vi.resetModules();
        const newTab = await import('../src/services/api/geminiProjects');
        expect(newTab.getGeminiProjectSettings()).toEqual(projects);
        expect(newTab.setGeminiProjectSettings([])).toBe(true);
        sessionStorage.setItem(storageKey, JSON.stringify(projects));

        vi.resetModules();
        const reopenedTab = await import('../src/services/api/geminiProjects');
        expect(reopenedTab.getGeminiProjectSettings()).toEqual([]);
        expect(sessionStorage.getItem(storageKey)).toBeNull();
    });

    it('migrates keys from the existing tab into persistent storage', async () => {
        const projects = [{ id: 'first-project', key: 'first', modelIds: [modelId] }];
        sessionStorage.setItem(storageKey, JSON.stringify(projects));

        vi.resetModules();
        const migratedTab = await import('../src/services/api/geminiProjects');
        expect(migratedTab.getGeminiProjectSettings()).toEqual(projects);
        expect(JSON.parse(localStorage.getItem(storageKey)!)).toEqual(projects);
        expect(sessionStorage.getItem(storageKey)).toBeNull();
    });

    it('uses a compatible second project when the first hits its daily quota', async () => {
        setGeminiProjectSettings([
            { id: 'first-project', key: 'first', modelIds: [modelId, flashId] },
            { id: 'flash-project', key: 'flash', modelIds: [flashId] },
            { id: 'second-project', key: 'second', modelIds: [modelId] }
        ]);
        const [first, , second] = getGeminiProjects();
        const operation = vi.fn().mockRejectedValueOnce(new Error('429 quota exceeded per day')).mockResolvedValueOnce('translated');
        const result = smartExecution([modelId, flashId], operation);
        await vi.runAllTimersAsync();
        await expect(result).resolves.toBe('translated');
        expect(operation.mock.calls).toEqual([[modelId, first.client], [modelId, second.client]]);
        expect(first.quota.isModelDepleted(modelId)).toBe(true);
        expect(second.quota.isModelDepleted(modelId)).toBe(false);
        expect(quotaManager.getConfigs().find(model => model.id === modelId)?.rpdLimit).toBe(40);
    });

    it('uses the Gemini model catalog to filter the app’s Free Tier models', async () => {
        list.mockResolvedValue([
            { name: 'models/' + modelId, supportedActions: ['generateContent'] },
            { name: 'models/' + flashId, supportedActions: ['countTokens'] },
            { name: 'models/gemini-3.1-pro-preview', supportedActions: ['generateContent'] }
        ]);
        await expect(listCompatibleGeminiModels('key')).resolves.toEqual([modelId]);
    });

    it('accepts multiple bare keys and optional project IDs, retaining valid entries when one fails', async () => {
        const catalog = [{ name: 'models/' + modelId, supportedActions: ['generateContent'] }];
        list.mockReset().mockResolvedValueOnce(catalog).mockRejectedValueOnce(new Error('API_KEY_INVALID'))
            .mockResolvedValue(catalog);
        const signal = new AbortController().signal;
        const result = await importGeminiProjects('first,broken\r\n\r\nmy-project second\nthird;first', [], signal);

        expect(result.accepted).toBe(3);
        expect(result.projects.map(({ key }) => key)).toEqual(['first', 'second', 'third']);
        expect(result.projects.map(({ id }) => id)).toEqual([expect.stringMatching(/^key:/), 'my-project', expect.stringMatching(/^key:/)]);
        expect(result.errors.map(({ line, column }) => [line, column])).toEqual([[1, 2], [4, 2]]);
        setGeminiProjectSettings(result.projects);
        expect(quotaManager.getConfigs().find(model => model.id === modelId)).toMatchObject({ rpdLimit: 20, quotaUnverified: true });
        const repeated = await importGeminiProjects('first\nsecond\nmy-project replacement', result.projects, signal);
        expect(repeated.projects.map(({ id }) => id)).toEqual(result.projects.map(({ id }) => id));
        expect(repeated.errors).toHaveLength(1);
    });

    it('associates an existing bare key with a project without storing a duplicate', async () => {
        list.mockReset().mockResolvedValue([{ name: 'models/' + modelId, supportedActions: ['generateContent'] }]);
        const result = await importGeminiProjects('my-project first', [
            { id: 'key:existing', key: 'first', modelIds: [modelId] }
        ], new AbortController().signal);

        expect(result.projects).toEqual([{ id: 'my-project', key: 'first', modelIds: [modelId] }]);
    });

    it('distinguishes daily exhaustion from temporary minute limits', () => {
        expect(isGeminiDailyQuota(new Error('429 quota per minute'))).toBe(false);
        expect(isGeminiDailyQuota(new Error('429 quota {"quotaId":"GenerateRequestsPerDayPerProjectPerModel-FreeTier"}'))).toBe(true);
        expect(isGeminiDailyQuota(new Error('429 quota {"quotaId":"GenerateRequestsPerMinutePerProjectPerModel-FreeTier"}'))).toBe(false);
    });
});
