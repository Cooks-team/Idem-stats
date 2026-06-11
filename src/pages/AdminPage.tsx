import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { Avatar } from '../ui/Avatar';

// ─────────────────────────────────────────────────────────────────────────────
// Page admin /admin — verrouillée par mot de passe, tableau de tâches partagé
// entre les deux admins (Jayson + toi) avec commentaires.
//
// ⚠️ Stockage LOCAL (localStorage) : les tâches persistent dans CE navigateur
// mais ne se synchronisent PAS entre toi et Jayson. Pour un vrai partage + un
// mot de passe vérifié côté serveur, voir la note en bas du chat (prompt Claude
// Code pour le backend).
// ─────────────────────────────────────────────────────────────────────────────

const PASSWORD = 'gigagwer';
const UNLOCK_KEY = 'podium.admin.unlocked';
const STORE_KEY = 'podium.admin.todos.v1';

type Assignee = 'jayson' | 'me';

interface Comment { id: string; author: string; text: string; at: number; }
interface Task {
    id: string;
    title: string;
    assignee: Assignee;
    done: boolean;
    at: number;
    comments: Comment[];
}

function uid(): string {
    return (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`);
}
function loadTasks(): Task[] {
    try { return JSON.parse(localStorage.getItem(STORE_KEY) || '[]') as Task[]; }
    catch { return []; }
}
function saveTasks(tasks: Task[]) {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(tasks)); } catch { /* quota */ }
}

export function AdminPage() {
    const [unlocked, setUnlocked] = useState(() => {
        try { return sessionStorage.getItem(UNLOCK_KEY) === '1'; } catch { return false; }
    });

    return (
        <div className="admin">
            <div className="admin-wrap">
                {unlocked ? <Board onLock={() => { sessionStorage.removeItem(UNLOCK_KEY); setUnlocked(false); }} />
                    : <Lock onUnlock={() => { sessionStorage.setItem(UNLOCK_KEY, '1'); setUnlocked(true); }} />}
            </div>
            <style>{ADMIN_CSS}</style>
        </div>
    );
}

// ── Écran de verrouillage ────────────────────────────────────────────────────
function Lock({ onUnlock }: { onUnlock: () => void }) {
    const nav = useNavigate();
    const [pwd, setPwd] = useState('');
    const [shake, setShake] = useState(false);
    const [error, setError] = useState(false);

    function tryUnlock() {
        if (pwd === PASSWORD) { onUnlock(); return; }
        setError(true);
        setShake(true);
        setTimeout(() => setShake(false), 450);
    }

    return (
        <div className="admin-lock">
            <div className={`panel admin-lock-card${shake ? ' shake' : ''}`}>
                <div className="admin-lock-badge">🔒</div>
                <div className="eyebrow" style={{ justifyContent: 'center' }}><span className="label">Accès restreint</span></div>
                <h1 className="admin-lock-title">Espace admin</h1>
                <p className="admin-lock-sub">Entre le mot de passe pour accéder au tableau.</p>

                <div className="field" style={{ marginTop: 4 }}>
                    <div className="field-label">Mot de passe</div>
                    <input
                        type="password"
                        autoFocus
                        value={pwd}
                        placeholder="••••••••"
                        onChange={(e) => { setPwd(e.target.value); setError(false); }}
                        onKeyDown={(e) => e.key === 'Enter' && tryUnlock()}
                    />
                </div>
                {error && <div className="admin-lock-error">Mot de passe incorrect.</div>}

                <button className="btn btn-accent btn-full" style={{ marginTop: 14 }} onClick={tryUnlock}>
                    Déverrouiller
                </button>
                <button className="btn btn-ghost btn-sm btn-full" style={{ marginTop: 8 }} onClick={() => nav('/')}>
                    ← Retour au site
                </button>
            </div>
        </div>
    );
}

// ── Tableau ──────────────────────────────────────────────────────────────────
function Board({ onLock }: { onLock: () => void }) {
    const nav = useNavigate();
    const { user } = useAuth();
    const myName = user?.pseudo ?? 'Moi';

    const [tasks, setTasks] = useState<Task[]>(() => loadTasks());
    useEffect(() => { saveTasks(tasks); }, [tasks]);

    const [draft, setDraft] = useState('');
    const [draftAssignee, setDraftAssignee] = useState<Assignee>('me');

    function addTask() {
        const title = draft.trim();
        if (!title) return;
        setTasks((t) => [{ id: uid(), title, assignee: draftAssignee, done: false, at: Date.now(), comments: [] }, ...t]);
        setDraft('');
    }
    const update = (id: string, fn: (t: Task) => Task) =>
        setTasks((list) => list.map((t) => (t.id === id ? fn(t) : t)));
    const remove = (id: string) => setTasks((list) => list.filter((t) => t.id !== id));

    const columns: Array<{ key: Assignee; name: string; tone: string; seed: string }> = [
        { key: 'jayson', name: 'Jayson', tone: 'var(--blue)', seed: 'Jayson' },
        { key: 'me', name: myName, tone: 'var(--accent)', seed: myName },
    ];

    return (
        <>
            <div className="admin-top">
                <div>
                    <div className="eyebrow"><span className="label">Admin</span></div>
                    <h1 className="admin-h1">Tableau de bord</h1>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                    <button className="btn btn-line btn-sm" onClick={() => nav('/')}>← Site</button>
                    <button className="btn btn-ghost btn-sm" onClick={onLock}>🔒 Verrouiller</button>
                </div>
            </div>

            {/* Composer */}
            <div className="panel admin-composer">
                <input
                    className="admin-composer-input"
                    value={draft}
                    placeholder="Nouvelle tâche…"
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && addTask()}
                />
                <div className="admin-composer-pick">
                    <button className={`chip ${draftAssignee === 'jayson' ? 'active' : ''}`} onClick={() => setDraftAssignee('jayson')}>Jayson</button>
                    <button className={`chip ${draftAssignee === 'me' ? 'active accent' : ''}`} onClick={() => setDraftAssignee('me')}>{myName}</button>
                </div>
                <button className="btn btn-accent" onClick={addTask} disabled={!draft.trim()}>Ajouter</button>
            </div>

            {/* Colonnes */}
            <div className="admin-cols">
                {columns.map((col) => (
                    <Column
                        key={col.key}
                        col={col}
                        tasks={tasks.filter((t) => t.assignee === col.key)}
                        myName={myName}
                        onToggle={(id) => update(id, (t) => ({ ...t, done: !t.done }))}
                        onDelete={remove}
                        onReassign={(id) => update(id, (t) => ({ ...t, assignee: t.assignee === 'jayson' ? 'me' : 'jayson' }))}
                        onAddComment={(id, text) => update(id, (t) => ({
                            ...t, comments: [...t.comments, { id: uid(), author: myName, text, at: Date.now() }],
                        }))}
                        onDeleteComment={(id, cid) => update(id, (t) => ({
                            ...t, comments: t.comments.filter((c) => c.id !== cid),
                        }))}
                    />
                ))}
            </div>
        </>
    );
}

function Column({ col, tasks, myName, onToggle, onDelete, onReassign, onAddComment, onDeleteComment }: {
    col: { key: Assignee; name: string; tone: string; seed: string };
    tasks: Task[];
    myName: string;
    onToggle: (id: string) => void;
    onDelete: (id: string) => void;
    onReassign: (id: string) => void;
    onAddComment: (id: string, text: string) => void;
    onDeleteComment: (id: string, cid: string) => void;
}) {
    // Tâches non faites d'abord, puis les faites (dimmées), chacune triée récent → vieux.
    const sorted = useMemo(() => {
        return [...tasks].sort((a, b) => Number(a.done) - Number(b.done) || b.at - a.at);
    }, [tasks]);
    const doneCount = tasks.filter((t) => t.done).length;

    return (
        <div className="admin-col" style={{ ['--col-tone' as string]: col.tone }}>
            <div className="admin-col-head">
                <Avatar seed={col.seed} size={32} ring ringColor={col.tone} />
                <div className="admin-col-name">{col.name}</div>
                <div className="admin-col-count">{tasks.length - doneCount} à faire · {doneCount} OK</div>
            </div>

            <div className="admin-col-body">
                {sorted.length === 0 ? (
                    <div className="admin-empty">Aucune tâche ici.</div>
                ) : sorted.map((t) => (
                    <TaskCard
                        key={t.id} task={t} otherName={col.key === 'me' ? 'Jayson' : myName}
                        onToggle={() => onToggle(t.id)}
                        onDelete={() => onDelete(t.id)}
                        onReassign={() => onReassign(t.id)}
                        onAddComment={(text) => onAddComment(t.id, text)}
                        onDeleteComment={(cid) => onDeleteComment(t.id, cid)}
                    />
                ))}
            </div>
        </div>
    );
}

function TaskCard({ task, otherName, onToggle, onDelete, onReassign, onAddComment, onDeleteComment }: {
    task: Task;
    otherName: string;
    onToggle: () => void;
    onDelete: () => void;
    onReassign: () => void;
    onAddComment: (text: string) => void;
    onDeleteComment: (cid: string) => void;
}) {
    const [open, setOpen] = useState(false);
    const [comment, setComment] = useState('');

    function submitComment() {
        const text = comment.trim();
        if (!text) return;
        onAddComment(text.slice(0, 500));
        setComment('');
        setOpen(true);
    }

    return (
        <div className={`admin-task${task.done ? ' done' : ''}`}>
            <div className="admin-task-row">
                <button className={`admin-check${task.done ? ' on' : ''}`} onClick={onToggle} aria-label="Marquer comme faite">
                    {task.done ? '✓' : ''}
                </button>
                <div className="admin-task-title">{task.title}</div>
                <button className="admin-icon" title={`Réassigner à ${otherName}`} onClick={onReassign}>⇄</button>
                <button className="admin-icon danger" title="Supprimer" onClick={onDelete}>×</button>
            </div>

            <div className="admin-task-foot">
                <button className="admin-comments-toggle" onClick={() => setOpen((v) => !v)}>
                    💬 {task.comments.length} commentaire{task.comments.length > 1 ? 's' : ''}
                </button>
                <span className="admin-task-date">{fmt(task.at)}</span>
            </div>

            {open && (
                <div className="admin-comments">
                    {task.comments.map((c) => (
                        <div key={c.id} className="admin-comment">
                            <div className="admin-comment-meta">
                                <strong>{c.author}</strong> · {fmt(c.at)}
                                <button className="admin-comment-del" onClick={() => onDeleteComment(c.id)}>supprimer</button>
                            </div>
                            <div className="admin-comment-text">{c.text}</div>
                        </div>
                    ))}
                    <div className="admin-comment-add">
                        <input
                            value={comment}
                            placeholder="Ajouter un commentaire…"
                            maxLength={500}
                            onChange={(e) => setComment(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && submitComment()}
                        />
                        <button className="btn btn-accent btn-sm" onClick={submitComment} disabled={!comment.trim()}>OK</button>
                    </div>
                </div>
            )}
        </div>
    );
}

function fmt(ts: number): string {
    const d = new Date(ts);
    const today = new Date();
    const sameDay = d.toDateString() === today.toDateString();
    return sameDay
        ? d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
        : d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });
}

const ADMIN_CSS = `
.admin { min-height: 100vh; background: var(--bg); color: var(--text); }
.admin-wrap { max-width: 1080px; margin: 0 auto; padding: 28px 24px 80px; }

/* Lock */
.admin-lock { min-height: 80vh; display: flex; align-items: center; justify-content: center; }
.admin-lock-card { width: 100%; max-width: 380px; padding: 32px 28px; text-align: center; }
.admin-lock-badge {
  width: 56px; height: 56px; margin: 0 auto 14px; border-radius: 16px;
  display: flex; align-items: center; justify-content: center; font-size: 26px;
  background: var(--surface-2); border: 1px solid var(--line);
}
.admin-lock-title { font-family: var(--font-display); font-weight: 700; font-size: 30px; margin: 6px 0 4px; }
.admin-lock-sub { color: var(--muted); font-size: 14px; margin: 0 0 18px; }
.admin-lock-error { color: var(--loss); font-size: 13px; margin-top: 10px; }
.admin-lock-card.shake { animation: admin-shake .45s; }
@keyframes admin-shake {
  10%, 90% { transform: translateX(-1px); } 20%, 80% { transform: translateX(2px); }
  30%, 50%, 70% { transform: translateX(-5px); } 40%, 60% { transform: translateX(5px); }
}

/* Top bar */
.admin-top { display: flex; align-items: flex-end; justify-content: space-between; gap: 16px; margin-bottom: 20px; flex-wrap: wrap; }
.admin-h1 { font-family: var(--font-display); font-weight: 700; font-size: 34px; margin: 2px 0 0; }

/* Composer */
.admin-composer { display: flex; align-items: center; gap: 12px; padding: 12px; margin-bottom: 22px; flex-wrap: wrap; }
.admin-composer-input {
  flex: 1; min-width: 220px; background: var(--surface-2); border: 1px solid var(--line);
  border-radius: 12px; padding: 12px 14px; color: var(--text); font-size: 15px; outline: none;
}
.admin-composer-input:focus { border-color: var(--accent); }
.admin-composer-pick { display: flex; gap: 8px; }

/* Colonnes */
.admin-cols { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; align-items: start; }
.admin-col { border: 1px solid var(--line); border-radius: var(--r); background: color-mix(in srgb, var(--surface) 55%, var(--bg)); overflow: hidden; }
.admin-col-head {
  display: flex; align-items: center; gap: 10px; padding: 14px 16px;
  border-bottom: 1px solid var(--line);
  border-top: 3px solid var(--col-tone);
}
.admin-col-name { font-family: var(--font-display); font-weight: 700; font-size: 18px; }
.admin-col-count { margin-left: auto; font-size: 12px; color: var(--muted); }
.admin-col-body { padding: 12px; display: flex; flex-direction: column; gap: 10px; min-height: 80px; }
.admin-empty { color: var(--muted); font-size: 13.5px; text-align: center; padding: 18px 8px; }

/* Tâche */
.admin-task {
  background: var(--surface); border: 1px solid var(--line); border-radius: 14px; padding: 12px 12px 10px;
  transition: border-color .15s, transform .08s;
}
.admin-task:hover { border-color: color-mix(in srgb, var(--col-tone) 45%, var(--line)); }
.admin-task.done { opacity: .55; }
.admin-task-row { display: flex; align-items: center; gap: 10px; }
.admin-task-title { flex: 1; min-width: 0; font-weight: 600; font-size: 15px; word-break: break-word; }
.admin-task.done .admin-task-title { text-decoration: line-through; }

.admin-check {
  width: 22px; height: 22px; flex-shrink: 0; border-radius: 7px;
  border: 2px solid var(--muted); background: transparent; color: var(--accent-ink);
  font-size: 13px; font-weight: 900; line-height: 1; display: flex; align-items: center; justify-content: center;
  transition: background .12s, border-color .12s;
}
.admin-check.on { background: var(--accent); border-color: var(--accent); }

.admin-icon {
  width: 28px; height: 28px; flex-shrink: 0; border-radius: 8px; border: 1px solid var(--line);
  background: var(--surface-2); color: var(--muted); font-size: 16px; line-height: 1;
  display: flex; align-items: center; justify-content: center; transition: color .12s, border-color .12s;
}
.admin-icon:hover { color: var(--text); border-color: var(--muted); }
.admin-icon.danger:hover { color: var(--loss); border-color: var(--loss); }

.admin-task-foot { display: flex; align-items: center; justify-content: space-between; margin-top: 8px; }
.admin-comments-toggle { background: none; border: none; color: var(--muted); font-size: 12.5px; padding: 2px 0; }
.admin-comments-toggle:hover { color: var(--text); }
.admin-task-date { font-size: 11.5px; color: var(--muted); }

/* Commentaires */
.admin-comments { margin-top: 10px; padding-top: 10px; border-top: 1px solid var(--line); display: flex; flex-direction: column; gap: 8px; }
.admin-comment { background: var(--surface-2); border-radius: 10px; padding: 8px 10px; }
.admin-comment-meta { font-size: 11.5px; color: var(--muted); display: flex; align-items: center; gap: 6px; }
.admin-comment-meta strong { color: var(--text); }
.admin-comment-del { margin-left: auto; background: none; border: none; color: var(--muted); font-size: 11px; text-decoration: underline; }
.admin-comment-del:hover { color: var(--loss); }
.admin-comment-text { font-size: 14px; margin-top: 3px; white-space: pre-wrap; word-break: break-word; }
.admin-comment-add { display: flex; gap: 8px; }
.admin-comment-add input {
  flex: 1; background: var(--surface-2); border: 1px solid var(--line); border-radius: 10px;
  padding: 9px 11px; color: var(--text); font-size: 14px; outline: none;
}
.admin-comment-add input:focus { border-color: var(--accent); }

@media (max-width: 768px) {
  .admin-cols { grid-template-columns: 1fr; }
  .admin-wrap { padding: 22px 16px 60px; }
}
@media (prefers-reduced-motion: reduce) {
  .admin-lock-card.shake { animation: none; }
}
`;