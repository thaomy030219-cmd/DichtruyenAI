import { isUnassignedGeminiKey } from '../../utils/quotaManager';
import { listCompatibleGeminiModels, type GeminiProjectSettings } from './geminiProjects';

interface ImportRow {
    line: number;
    column: number;
    input: string;
}

type ImportResult = ImportRow & ({ project: GeminiProjectSettings } | { error: string });

export const importGeminiProjects = async (
    input: string,
    existing: GeminiProjectSettings[],
    signal: AbortSignal
) => {
    const projects = new Map(existing.map(project => [project.id, project]));
    const keys = new Map(existing.map(project => [project.key, project.id]));
    const seenProjects = new Set<string>();
    const seenKeys = new Set<string>();
    const rows = input.split(/\r?\n/).flatMap((line, index) => line.split(/[,;]/).flatMap((value, column) => {
        const input = value.trim();
        return input ? [{ line: index + 1, column: column + 1, input }] : [];
    }));

    const checkRow = async (row: ImportRow): Promise<ImportResult> => {
        const [first, second, extra] = row.input.split(/\s+/);
        const projectId = second ? first.toLowerCase() : undefined;
        const key = second ?? first;
        if (extra || (projectId && !/^[a-z0-9][a-z0-9-]{2,62}$/.test(projectId))) {
            return { ...row, error: 'Nhập một API key hoặc Project ID và API key cách nhau bằng dấu cách.' };
        }
        const previousId = keys.get(key);
        const targetId = projectId ?? previousId;
        if (projectId && previousId && !isUnassignedGeminiKey(previousId) && previousId !== projectId) {
            return { ...row, error: 'Key này đã được khai báo cho project khác.' };
        }
        if (seenKeys.has(key)) {
            return { ...row, error: 'API key bị trùng trong danh sách dán.' };
        }
        if (targetId && seenProjects.has(targetId)) {
            return { ...row, error: 'Project ID bị trùng trong danh sách dán.' };
        }
        seenKeys.add(key);
        if (targetId) seenProjects.add(targetId);

        const timeout = AbortSignal.timeout(15_000);
        try {
            const modelIds = await listCompatibleGeminiModels(key, AbortSignal.any([signal, timeout]));
            if (modelIds.length) {
                const id = targetId ?? 'key:' + crypto.getRandomValues(new Uint32Array(4)).join('-');
                return { ...row, project: { id, key, modelIds } };
            }
            return { ...row, error: 'Google chưa liệt kê model Free Tier nào của app cho key này.' };
        } catch {
            return { ...row, error: timeout.aborted
                ? 'Kiểm tra quá thời gian. Vui lòng thử lại.'
                : 'Kiểm tra lại key và quyền truy cập Gemini API của project.' };
        }
    };

    const errors: (ImportRow & { error: string })[] = [];
    let accepted = 0;
    // Bound the number of simultaneous catalog requests for large pastes.
    const concurrency = 4;
    for (let index = 0; index < rows.length; index += concurrency) {
        signal.throwIfAborted();
        const results = await Promise.all(rows.slice(index, index + concurrency).map(checkRow));
        signal.throwIfAborted();
        for (const result of results) {
            if ('error' in result) errors.push(result);
            else {
                const previousId = keys.get(result.project.key);
                if (previousId && previousId !== result.project.id) projects.delete(previousId);
                projects.set(result.project.id, result.project);
                accepted++;
            }
        }
    }
    return { projects: [...projects.values()], accepted, errors };
};
