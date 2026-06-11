import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { Avatar } from '../ui/Avatar';
import type { AdminTask, User } from '../api/types';

const PASSWORD = 'gigagwer';
const UNLOCK_KEY = 'podium.admin.unlocked';

const CODES: Record<string, number> = { cooks: 100 };

const COL_TONES = ['var(--blue)', 'var(--accent)', 'var(--gold)', 'var(--loss)'];

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

// ── Tableau (données API) ─────────────────────────────────────────────────────
function Board({ onLock }: { onLock: () => void }) {
    const nav = useNavigate();
    const { user, setUser } = useAuth();
    const qc = useQueryClient();

    const { data, isLoading, error } = useQuery({
        queryKey: ['admin', 'tasks'],
        queryFn: () => api.adminListTasks(),
        refetchInterval: 3000,
        refetchOnWindowFocus: true,
        retry: false,
    });
    const refresh = () => qc.invalidateQueries({ queryKey: ['admin', 'tasks'] });

    const admins: User[] = data?.admins ?? [];
    const tasks: AdminTask[] = data?.tasks ?? [];

    const [draft, setDraft] = useState('');
    const [draftAssignee, setDraftAssignee] = useState<string>('');
    // Par défaut, on s'assigne la tâche à soi-même une fois les admins chargés.
    useEffect(() => {
        if (!draftAssignee && admins.length) {
            setDraftAssignee(user?.id && admins.some((a) => a.id === user.id) ? user.id : admins[0].id);
        }
    }, [admins, draftAssignee, user]);

    const createMut = useMutation({
        mutationFn: () => api.adminCreateTask(draft.trim(), draftAssignee),
        onSuccess: () => { setDraft(''); refresh(); },
    });
    const updateMut = useMutation({
        mutationFn: (v: { id: string; patch: Partial<Pick<AdminTask, 'title' | 'done' | 'assigneeId'>> }) => api.adminUpdateTask(v.id, v.patch),
        onSuccess: refresh,
    });
    const deleteMut = useMutation({ mutationFn: (id: string) => api.adminDeleteTask(id), onSuccess: refresh });
    const addCommentMut = useMutation({
        mutationFn: (v: { id: string; text: string }) => api.adminAddComment(v.id, v.text),
        onSuccess: refresh,
    });
    const delCommentMut = useMutation({
        mutationFn: (v: { id: string; cid: string }) => api.adminDeleteComment(v.id, v.cid),
        onSuccess: refresh,
    });

    const notAdmin = error instanceof ApiError && (error.status === 403 || error.message === 'not_admin');

    function addTask() {
        if (!draft.trim() || !draftAssignee) return;
        createMut.mutate();
    }
    function reassign(t: AdminTask) {
        if (admins.length < 2) return;
        const i = admins.findIndex((a) => a.id === t.assigneeId);
        const next = admins[(i + 1) % admins.length];
        updateMut.mutate({ id: t.id, patch: { assigneeId: next.id } });
    }

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

            {notAdmin ? (
                <div className="panel" style={{ textAlign: 'center', color: 'var(--loss)', padding: 28 }}>
                    Ton compte connecté n'est pas dans la liste des admins. Connecte-toi avec un compte admin.
                </div>
            ) : isLoading && !data ? (
                <div className="panel" style={{ textAlign: 'center', color: 'var(--muted)' }}>Chargement…</div>
            ) : (
                <>
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
                            {admins.map((a) => (
                                <button
                                    key={a.id}
                                    className={`chip ${draftAssignee === a.id ? 'active accent' : ''}`}
                                    onClick={() => setDraftAssignee(a.id)}
                                >{a.pseudo}</button>
                            ))}
                        </div>
                        <button className="btn btn-accent" onClick={addTask} disabled={!draft.trim() || createMut.isPending}>
                            {createMut.isPending ? '…' : 'Ajouter'}
                        </button>
                    </div>

                    {/* Colonnes = admins */}
                    <div className="admin-cols" style={{ gridTemplateColumns: `repeat(${Math.max(1, admins.length)}, 1fr)` }}>
                        {admins.map((admin, idx) => (
                            <Column
                                key={admin.id}
                                admin={admin}
                                tone={COL_TONES[idx % COL_TONES.length]}
                                tasks={tasks.filter((t) => t.assigneeId === admin.id)}
                                onToggle={(t) => updateMut.mutate({ id: t.id, patch: { done: !t.done } })}
                                onDelete={(t) => deleteMut.mutate(t.id)}
                                onReassign={reassign}
                                onAddComment={(t, text) => addCommentMut.mutate({ id: t.id, text })}
                                onDeleteComment={(t, cid) => delCommentMut.mutate({ id: t.id, cid })}
                            />
                        ))}
                    </div>
                </>
            )}

            {/* Barre "code" cachée — quasi invisible, s'éclaire au survol/focus */}
            <CodeBar
                currentCoins={user?.coins ?? 0}
                onGranted={(coins) => { if (user) setUser({ ...user, coins }); }}
            />
        </>
    );
}

// ── Barre cachée pour les codes (ex : "cooks" → +100 coins) ───────────────────
function CodeBar({ currentCoins, onGranted }: { currentCoins: number; onGranted: (coins: number) => void }) {
    const [code, setCode] = useState('');
    const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

    const grantMut = useMutation({
        // Crédit via le règlement de manche blackjack : mise 0, gain = amount.
        mutationFn: (amount: number) => api.blackjackRound(0, amount),
        onSuccess: (d, amount) => {
            onGranted(d.coins);
            setMsg({ ok: true, text: `+${amount} 🪙 crédités (solde : ${d.coins})` });
            setCode('');
        },
        onError: () => setMsg({ ok: false, text: 'Échec du crédit — le serveur a refusé (voir note).' }),
    });

    function submit() {
        const key = code.trim().toLowerCase();
        const amount = CODES[key];
        if (!amount) { setMsg({ ok: false, text: 'Code invalide.' }); return; }
        setMsg(null);
        grantMut.mutate(amount);
    }

    return (
        <div className="admin-codebar">
            <span className="admin-codebar-key">🔑</span>
            <input
                className="admin-codebar-input"
                value={code}
                placeholder="code…"
                spellCheck={false}
                autoComplete="off"
                onChange={(e) => { setCode(e.target.value); setMsg(null); }}
                onKeyDown={(e) => e.key === 'Enter' && submit()}
            />
            <button className="btn btn-line btn-sm" onClick={submit} disabled={!code.trim() || grantMut.isPending}>
                {grantMut.isPending ? '…' : 'OK'}
            </button>
            {msg && (
                <span className="admin-codebar-msg" style={{ color: msg.ok ? 'var(--win)' : 'var(--loss)' }}>
                    {msg.text}
                </span>
            )}
            <span className="admin-codebar-balance">solde : {currentCoins} 🪙</span>
        </div>
    );
}

function Column({ admin, tone, tasks, onToggle, onDelete, onReassign, onAddComment, onDeleteComment }: {
    admin: User;
    tone: string;
    tasks: AdminTask[];
    onToggle: (t: AdminTask) => void;
    onDelete: (t: AdminTask) => void;
    onReassign: (t: AdminTask) => void;
    onAddComment: (t: AdminTask, text: string) => void;
    onDeleteComment: (t: AdminTask, cid: string) => void;
}) {
    const sorted = useMemo(
        () => [...tasks].sort((a, b) => Number(a.done) - Number(b.done) || (b.createdAt < a.createdAt ? -1 : 1)),
        [tasks],
    );
    const doneCount = tasks.filter((t) => t.done).length;

    return (
        <div className="admin-col" style={{ ['--col-tone' as string]: tone }}>
            <div className="admin-col-head">
                <Avatar seed={admin.pseudo} size={32} ring ringColor={tone} />
                <div className="admin-col-name">{admin.pseudo}</div>
                <div className="admin-col-count">{tasks.length - doneCount} à faire · {doneCount} OK</div>
            </div>

            <div className="admin-col-body">
                {sorted.length === 0 ? (
                    <div className="admin-empty">Aucune tâche ici.</div>
                ) : sorted.map((t) => (
                    <TaskCard
                        key={t.id} task={t}
                        onToggle={() => onToggle(t)}
                        onDelete={() => onDelete(t)}
                        onReassign={() => onReassign(t)}
                        onAddComment={(text) => onAddComment(t, text)}
                        onDeleteComment={(cid) => onDeleteComment(t, cid)}
                    />
                ))}
            </div>
        </div>
    );
}

function TaskCard({ task, onToggle, onDelete, onReassign, onAddComment, onDeleteComment }: {
    task: AdminTask;
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
                <button className="admin-icon" title="Réassigner à l'autre admin" onClick={onReassign}>⇄</button>
                <button className="admin-icon danger" title="Supprimer" onClick={onDelete}>×</button>
            </div>

            <div className="admin-task-foot">
                <button className="admin-comments-toggle" onClick={() => setOpen((v) => !v)}>
                    💬 {task.comments.length} commentaire{task.comments.length > 1 ? 's' : ''}
                </button>
                <span className="admin-task-date">{fmt(task.createdAt)}</span>
            </div>

            {open && (
                <div className="admin-comments">
                    {task.comments.map((c) => (
                        <div key={c.id} className="admin-comment">
                            <div className="admin-comment-meta">
                                <strong>{c.authorPseudo}</strong> · {fmt(c.createdAt)}
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

function fmt(iso: string): string {
    const d = new Date(iso);
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
.admin-composer-pick { display: flex; gap: 8px; flex-wrap: wrap; }

/* Colonnes */
.admin-cols { display: grid; gap: 16px; align-items: start; }
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

/* Barre code cachée */
.admin-codebar {
  margin-top: 44px; display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
  opacity: .18; transition: opacity .25s;
}
.admin-codebar:hover, .admin-codebar:focus-within { opacity: 1; }
.admin-codebar-key { font-size: 13px; }
.admin-codebar-input {
  width: 130px; background: var(--surface-2); border: 1px solid var(--line); border-radius: 9px;
  padding: 7px 10px; color: var(--text); font-size: 13px; outline: none;
}
.admin-codebar-input:focus { border-color: var(--accent); }
.admin-codebar-msg { font-size: 12.5px; font-weight: 600; }
.admin-codebar-balance { margin-left: auto; font-size: 11.5px; color: var(--muted); }

@media (max-width: 768px) {
  .admin-cols { grid-template-columns: 1fr !important; }
  .admin-wrap { padding: 22px 16px 60px; }
}
@media (prefers-reduced-motion: reduce) {
  .admin-lock-card.shake { animation: none; }
}
`;