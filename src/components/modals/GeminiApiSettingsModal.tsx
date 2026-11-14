import { useEffect, useRef, useState } from 'react';
import { KeyRound, Loader2, Trash2, X } from 'lucide-react';
import { MODEL_CONFIGS } from '../../constants';
import { getGeminiProjectSettings, setGeminiProjectSettings } from '../../services/api/geminiProjects';
import { importGeminiProjects } from '../../services/api/geminiProjectImport';
import { isUnassignedGeminiKey } from '../../utils/quotaManager';

interface Props {
    onClose: () => void;
    onSave: () => void;
}

export const GeminiApiSettingsModal = ({ onClose, onSave }: Props) => {
    const [originalProjects] = useState(getGeminiProjectSettings);
    const [projects, setProjects] = useState(originalProjects);
    const [input, setInput] = useState('');
    const [showKeys, setShowKeys] = useState(false);
    const [issues, setIssues] = useState<{ line: number; column: number; error: string }[]>([]);
    const [checking, setChecking] = useState(false);
    const [message, setMessage] = useState('');
    const checkRef = useRef<AbortController | null>(null);
    const dialogRef = useRef<HTMLDialogElement>(null);

    useEffect(() => {
        dialogRef.current?.showModal();
        return () => checkRef.current?.abort();
    }, []);

    const checkKeys = async (event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        if (checking || !input.trim()) return;

        const controller = new AbortController();
        checkRef.current = controller;
        setChecking(true);
        setMessage('');
        setIssues([]);
        try {
            const result = await importGeminiProjects(input, projects, controller.signal);
            setProjects(result.projects);
            setInput(result.errors.map(issue => issue.input).join('\n'));
            setIssues(result.errors);
            const status = `Đã kiểm tra và thêm ${result.accepted} key.`;
            setMessage(result.errors.length ? `${status} Có ${result.errors.length} mục chưa thêm. Vị trí bên dưới tính theo danh sách vừa dán.` : status);
        } catch {
            if (!controller.signal.aborted) setMessage('Không thể kiểm tra danh sách. Vui lòng thử lại.');
        } finally {
            if (!controller.signal.aborted) setChecking(false);
        }
    };

    return (
        <dialog ref={dialogRef} aria-labelledby="gemini-api-title"
            onCancel={event => { event.preventDefault(); onClose(); }}
            className="m-auto w-[calc(100%-2rem)] max-w-lg max-h-[90dvh] rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 p-0 shadow-xl backdrop:bg-slate-950/60">
            <div className="flex items-center justify-between gap-3 border-b border-slate-200 dark:border-slate-700 px-5 py-4">
                <h2 id="gemini-api-title" className="flex items-center gap-2 font-bold"><KeyRound className="w-4 h-4" /> Gemini API</h2>
                <button type="button" aria-label="Đóng" onClick={onClose} className="rounded p-1 hover:bg-slate-100 dark:hover:bg-slate-800"><X className="w-5 h-5" /></button>
            </div>
            <div className="space-y-4 p-5 text-sm">
                <p>Dán nhiều key Free Tier, mỗi dòng một key hoặc ngăn cách bằng dấu phẩy. Có thể ghi Project ID trước key, cách nhau bằng dấu cách.</p>
                <p className="text-xs text-slate-500 dark:text-slate-400">Các key cùng project dùng chung quota. Project ID giúp app gộp các key dùng chung hạn mức. Key được lưu trong trình duyệt sau khi bạn bấm Lưu API.</p>
                <a href="https://aistudio.google.com/api-keys" target="_blank" rel="noreferrer" className="inline-block text-primary-600 dark:text-primary-400 underline">Xem API key và Project ID trong AI Studio</a>
                <form onSubmit={checkKeys} className="space-y-3">
                    <label className="block">
                        <span className="mb-1 block font-medium">Danh sách Gemini API key</span>
                        <textarea value={input} onChange={event => { setInput(event.target.value); setIssues([]); setMessage(''); }}
                            disabled={checking} rows={5} spellCheck={false} autoComplete="off" autoCapitalize="none"
                            className={`w-full resize-y rounded-lg border border-slate-300 dark:border-slate-700 bg-transparent px-3 py-2 font-mono text-xs ${!showKeys && input ? '[-webkit-text-security:disc]' : ''}`}
                            placeholder={'API_KEY_1\nAPI_KEY_2\ngen-lang-client-123 API_KEY_3'} />
                    </label>
                    <button type="submit" disabled={checking || !input.trim()} className="inline-flex items-center gap-2 rounded-lg border border-primary-500 px-3 py-2 font-medium text-primary-600 dark:text-primary-400 disabled:opacity-50">
                        {checking && <Loader2 className="w-4 h-4 animate-spin" />} {checking ? 'Đang kiểm tra…' : 'Kiểm tra và thêm danh sách'}
                    </button>
                    <button type="button" onClick={() => setShowKeys(previous => !previous)} className="ml-2 rounded-lg px-2 py-2 text-xs text-slate-600 dark:text-slate-300">
                        {showKeys ? 'Ẩn key' : 'Hiện key'}
                    </button>
                </form>
                {message && <p role="status" className="text-xs text-slate-600 dark:text-slate-300">{message}</p>}
                {issues.length > 0 && (
                    <ul className="max-h-36 list-disc space-y-1 overflow-y-auto pl-5 text-xs text-rose-700 dark:text-rose-300">
                        {issues.map(issue => (
                            <li key={`${issue.line}-${issue.column}`}>Dòng {issue.line}{issue.column > 1 ? `, mục ${issue.column}` : ''} · {issue.error}</li>
                        ))}
                    </ul>
                )}
                {projects.length === 0 ? <p className="text-slate-500 dark:text-slate-400">App sẽ dùng key mặc định nếu bản triển khai đã cấu hình.</p> : (
                    <ul className="space-y-2">
                        {projects.map((project, index) => {
                            const label = isUnassignedGeminiKey(project.id) ? `Key ${index + 1} · ••••${project.key.slice(-4)}` : project.id;
                            return (
                            <li key={project.id} className="flex items-start justify-between gap-3 rounded-lg border border-slate-200 dark:border-slate-700 p-3">
                                <div className="min-w-0">
                                    <p className="break-all font-medium">{label}</p>
                                    <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{MODEL_CONFIGS.filter(model => project.modelIds.includes(model.id)).map(model => model.name).join(', ')}</p>
                                </div>
                                <button type="button" disabled={checking} aria-label={`Xóa ${label}`} onClick={() => setProjects(previous => previous.filter(item => item.id !== project.id))}
                                    className="rounded p-1 text-slate-500 hover:text-red-600"><Trash2 className="w-4 h-4" /></button>
                            </li>
                            );
                        })}
                    </ul>
                )}
            </div>
            <div className="flex justify-end gap-2 border-t border-slate-200 dark:border-slate-700 px-5 py-4">
                <button type="button" onClick={onClose} className="rounded-lg px-3 py-2 text-sm hover:bg-slate-100 dark:hover:bg-slate-800">Hủy</button>
                <button type="button" disabled={checking || (!!input.trim() && !issues.length)} onClick={() => {
                    if (getGeminiProjectSettings() !== originalProjects) {
                        setMessage("Danh sách key đã thay đổi ở tab khác. Đóng và mở lại mục API để cập nhật.");
                        return;
                    }
                    if (setGeminiProjectSettings(projects)) onSave();
                    else setMessage("Trình duyệt không lưu được API key. Hãy kiểm tra quyền lưu dữ liệu của trang rồi thử lại.");
                }}
                    className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white hover:bg-primary-700 disabled:opacity-50">Lưu API</button>
            </div>
        </dialog>
    );
};
