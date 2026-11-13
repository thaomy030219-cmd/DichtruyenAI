import { useEffect, useRef, useState } from 'react';
import { KeyRound, Loader2, Trash2, X } from 'lucide-react';
import { MODEL_CONFIGS } from '../../constants';
import { getGeminiProjectSettings, listCompatibleGeminiModels, setGeminiProjectSettings } from '../../services/api/geminiProjects';

interface Props {
    onClose: () => void;
    onSave: () => void;
}

export const GeminiApiSettingsModal = ({ onClose, onSave }: Props) => {
    const [originalProjects] = useState(getGeminiProjectSettings);
    const [projects, setProjects] = useState(originalProjects);
    const [projectId, setProjectId] = useState('');
    const [key, setKey] = useState('');
    const [checking, setChecking] = useState(false);
    const [message, setMessage] = useState('');
    const checkRef = useRef<AbortController | null>(null);
    const dialogRef = useRef<HTMLDialogElement>(null);

    useEffect(() => {
        dialogRef.current?.showModal();
        return () => checkRef.current?.abort();
    }, []);

    const checkKey = async (event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        if (checking) return;
        const id = projectId.trim().toLowerCase();
        const apiKey = key.trim();
        if (!/^[a-z0-9][a-z0-9-]{2,62}$/.test(id) || /\s/.test(apiKey) || !apiKey) {
            setMessage('Nhập Project ID và một Gemini API key hợp lệ.');
            return;
        }
        if (projects.some(project => project.key === apiKey && project.id !== id)) {
            setMessage('Key này đã được thêm cho một project khác.');
            return;
        }

        const controller = new AbortController();
        checkRef.current = controller;
        const timeout = setTimeout(() => controller.abort(), 15_000);
        setChecking(true);
        setMessage('');
        try {
            const modelIds = await listCompatibleGeminiModels(apiKey, controller.signal);
            if (controller.signal.aborted) return;
            if (!modelIds.length) {
                setMessage('Google chưa liệt kê model Free Tier nào của app cho key này.');
                return;
            }
            setProjects(previous => {
                const project = { id, key: apiKey, modelIds };
                return previous.some(item => item.id === id)
                    ? previous.map(item => item.id === id ? project : item)
                    : [...previous, project];
            });
            setKey('');
            setProjectId('');
            setMessage(`Google liệt kê ${modelIds.length} model tương thích cho project này.`);
        } catch {
            setMessage(controller.signal.aborted
                ? 'Kiểm tra quá thời gian. Vui lòng thử lại.'
                : 'Không thể kiểm tra key. Kiểm tra key và quyền truy cập Gemini API của project.');
        } finally {
            clearTimeout(timeout);
            setChecking(false);
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
                <p>Thêm một key Free Tier cho mỗi project. App thử các project theo thứ tự bên dưới và chuyển sang project còn lượt. Thêm key mới cho cùng Project ID sẽ thay key cũ.</p>
                <p className="text-xs text-slate-500 dark:text-slate-400">Trình duyệt giữ key đến khi bạn xóa key ở đây hoặc xóa dữ liệu trang. Google trả danh sách model khi kiểm tra key và áp dụng quota thực tế khi app gọi API.</p>
                <a href="https://aistudio.google.com/api-keys" target="_blank" rel="noreferrer" className="inline-block text-primary-600 dark:text-primary-400 underline">Xem API key và Project ID trong AI Studio</a>
                <form onSubmit={checkKey} className="space-y-3">
                    <label className="block">
                        <span className="mb-1 block font-medium">Google Cloud Project ID</span>
                        <input value={projectId} onChange={event => setProjectId(event.target.value)} required spellCheck={false} autoComplete="off"
                            className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-transparent px-3 py-2" placeholder="gen-lang-client-…" />
                    </label>
                    <label className="block">
                        <span className="mb-1 block font-medium">Gemini API key</span>
                        <input type="password" value={key} onChange={event => setKey(event.target.value)} required autoComplete="off"
                            className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-transparent px-3 py-2" />
                    </label>
                    <button type="submit" disabled={checking} className="inline-flex items-center gap-2 rounded-lg border border-primary-500 px-3 py-2 font-medium text-primary-600 dark:text-primary-400 disabled:opacity-50">
                        {checking && <Loader2 className="w-4 h-4 animate-spin" />} Kiểm tra và thêm key
                    </button>
                </form>
                {message && <p role="status" className="text-xs text-slate-600 dark:text-slate-300">{message}</p>}
                {projects.length === 0 ? <p className="text-slate-500 dark:text-slate-400">App sẽ dùng key mặc định nếu bản triển khai đã cấu hình.</p> : (
                    <ul className="space-y-2">
                        {projects.map(project => (
                            <li key={project.id} className="flex items-start justify-between gap-3 rounded-lg border border-slate-200 dark:border-slate-700 p-3">
                                <div className="min-w-0">
                                    <p className="break-all font-medium">{project.id}</p>
                                    <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{MODEL_CONFIGS.filter(model => project.modelIds.includes(model.id)).map(model => model.name).join(', ')}</p>
                                </div>
                                <button type="button" aria-label={`Xóa key của ${project.id}`} onClick={() => setProjects(previous => previous.filter(item => item.id !== project.id))}
                                    className="rounded p-1 text-slate-500 hover:text-red-600"><Trash2 className="w-4 h-4" /></button>
                            </li>
                        ))}
                    </ul>
                )}
            </div>
            <div className="flex justify-end gap-2 border-t border-slate-200 dark:border-slate-700 px-5 py-4">
                <button type="button" onClick={onClose} className="rounded-lg px-3 py-2 text-sm hover:bg-slate-100 dark:hover:bg-slate-800">Hủy</button>
                <button type="button" disabled={checking || !!key.trim()} onClick={() => {
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
