import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import {
  FiUsers, FiUserX, FiShield, FiTarget, FiSearch, FiTrash2, FiRefreshCw,
  FiKey, FiArrowUp, FiArrowDown, FiX, FiLock, FiCheckSquare, FiActivity,
  FiSlash, FiUserCheck, FiAward,
} from 'react-icons/fi';
import { api, ApiError, readAdminApiKey, setAdminApiKey } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { Avatar } from '../ui/Avatar';
import { absoluteAvatar } from '../api/client';
import { KNOWN_GAMES, displayGame } from '../games/registry';
import type { AdminMatchRow, AdminStats, AdminTask, AdminUserRow, User } from '../api/types';

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
                {unlocked
                  ? <Board onLock={() => { sessionStorage.removeItem(UNLOCK_KEY); setAdminApiKey(null); setUnlocked(false); }} />
                  : <Lock onUnlock={() => { sessionStorage.setItem(UNLOCK_KEY, '1'); setUnlocked(true); }} />}
            </div>
            <style>{ADMIN_CSS}</style>
        </div>
    );
}

// ── Écran de verrouillage ────────────────────────────────────────────────────
// Deux voies :
//  1. "Auto" — l'utilisateur est connecté avec un compte dont le pseudo est
//     dans ADMIN_PSEUDOS côté serveur. Au mount, on tente /admin/users avec
//     son JWT ; si 200, on unlock direct. Si 403 → la voie API key reste.
//  2. "Clé API" — input pour saisir ADMIN_API_KEY. On la pose dans
//     sessionStorage via setAdminApiKey() et on retry. Si le serveur accepte
//     (200), on unlock. Sinon, on affiche l'erreur et on efface la clé.
function Lock({ onUnlock }: { onUnlock: () => void }) {
    const nav = useNavigate();
    const { user } = useAuth();
    const [key, setKey] = useState('');
    const [shake, setShake] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [checking, setChecking] = useState(true);

    // Au mount : tente d'accéder à /admin/users avec ce qu'on a (JWT seul,
    // ou JWT + clé déjà en sessionStorage si on a déjà unlock une fois).
    useEffect(() => {
        let alive = true;
        api.adminListUsers()
          .then(() => { if (alive) onUnlock(); })
          .catch((e: unknown) => {
              if (!alive) return;
              if (e instanceof ApiError && (e.status === 401 || e.status === 403)) {
                  setChecking(false);
              } else {
                  setChecking(false);
                  setError('Erreur inattendue. Réessaie ou utilise une clé API.');
              }
          });
        return () => { alive = false; };
    }, [onUnlock]);

    async function tryWithKey() {
        if (!key.trim()) return;
        setAdminApiKey(key.trim());
        try {
            await api.adminListUsers();
            onUnlock();
        } catch (e) {
            setAdminApiKey(null);
            setError(e instanceof ApiError && e.status === 403 ? 'Clé invalide.' : 'Erreur réseau.');
            setShake(true);
            setTimeout(() => setShake(false), 450);
        }
    }

    if (checking) {
        return (
            <div className="admin-lock">
                <div className="panel admin-lock-card">
                    <div className="admin-lock-badge">🔒</div>
                    <h1 className="admin-lock-title">Vérification…</h1>
                </div>
            </div>
        );
    }

    return (
        <div className="admin-lock">
            <div className={`panel admin-lock-card${shake ? ' shake' : ''}`}>
                <div className="admin-lock-badge">🔒</div>
                <div className="eyebrow" style={{ justifyContent: 'center' }}><span className="label">Accès restreint</span></div>
                <h1 className="admin-lock-title">Espace admin</h1>
                <p className="admin-lock-sub">
                    {user
                      ? `Connecté en tant que ${user.pseudo}, mais ton compte n'est pas admin. Utilise une clé API pour entrer.`
                      : "Connecte-toi avec un compte admin, ou utilise une clé API."}
                </p>

                <div className="field" style={{ marginTop: 4 }}>
                    <div className="field-label">Clé API admin</div>
                    <input
                        type="password"
                        autoFocus
                        value={key}
                        placeholder="ADMIN_API_KEY"
                        onChange={(e) => { setKey(e.target.value); setError(null); }}
                        onKeyDown={(e) => e.key === 'Enter' && tryWithKey()}
                    />
                </div>
                {error && <div className="admin-lock-error">{error}</div>}

                <button className="btn btn-accent btn-full" style={{ marginTop: 14 }} onClick={tryWithKey}>
                    Entrer
                </button>
                <button className="btn btn-ghost btn-sm btn-full" style={{ marginTop: 8 }} onClick={() => nav('/')}>
                    ← Retour au site
                </button>
            </div>
        </div>
    );
}

// ── Tableau (données API) ─────────────────────────────────────────────────────
type AdminTab = 'mod' | 'tasks';

function Board({ onLock }: { onLock: () => void }) {
    const nav = useNavigate();
    const { user, setUser } = useAuth();
    const qc = useQueryClient();
    const [tab, setTab] = useState<AdminTab>('mod');

    const { data, isLoading, error } = useQuery({
        queryKey: ['admin', 'tasks'],
        queryFn: () => api.adminListTasks(),
        refetchInterval: 3000,
        refetchOnWindowFocus: true,
        retry: false,
        enabled: tab === 'tasks',
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

            <div className="admin-tabs">
                <button className={`chip ${tab === 'mod' ? 'active accent' : ''}`} onClick={() => setTab('mod')}>
                    🛡️ Modération
                </button>
                <button className={`chip ${tab === 'tasks' ? 'active accent' : ''}`} onClick={() => setTab('tasks')}>
                    ✅ Tâches admin
                </button>
            </div>

            {tab === 'mod' && <ModerationPanel />}

            {tab === 'tasks' && (notAdmin ? (
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
            ))}

            {/* Barre "code" cachée — quasi invisible, s'éclaire au survol/focus */}
            <CodeBar
                currentCoins={user?.coins ?? 0}
                onGranted={(coins) => { if (user) setUser({ ...user, coins }); }}
            />
        </>
    );
}

// ── Modération : Stats + Joueurs + Matches ──────────────────────────────────
type ModSubTab = 'users' | 'matches';

function ModerationPanel() {
    const qc = useQueryClient();
    const [sub, setSub] = useState<ModSubTab>('users');
    const [userQ, setUserQ] = useState('');
    const [userBanned, setUserBanned] = useState<'all' | 'banned' | 'active'>('all');
    const [userRole, setUserRole] = useState<'all' | 'admin' | 'user'>('all');
    const [matchQ, setMatchQ] = useState('');
    const [matchGame, setMatchGame] = useState('');
    const [drawerUserId, setDrawerUserId] = useState<string | null>(null);

    const statsQ = useQuery({
        queryKey: ['admin', 'stats'],
        queryFn: () => api.adminStats(),
        refetchInterval: 8000,
    });

    const usersQ = useQuery({
        queryKey: ['admin', 'users', { q: userQ, banned: userBanned, role: userRole }],
        queryFn: () => api.adminListUsers({
            q: userQ || undefined,
            banned: userBanned === 'all' ? undefined : userBanned === 'banned',
            role: userRole === 'all' ? undefined : userRole,
        }),
        refetchInterval: 8000,
    });

    const matchesQ = useQuery({
        queryKey: ['admin', 'matches', { q: matchQ, game: matchGame }],
        queryFn: () => api.adminListMatches({
            q: matchQ || undefined,
            game: matchGame || undefined,
        }),
        refetchInterval: 8000,
    });

    const invalidateUsers = () => {
        qc.invalidateQueries({ queryKey: ['admin', 'users'] });
        qc.invalidateQueries({ queryKey: ['admin', 'stats'] });
    };
    const invalidateAll = () => {
        invalidateUsers();
        qc.invalidateQueries({ queryKey: ['admin', 'matches'] });
        qc.invalidateQueries({ queryKey: ['leaderboard'] });
    };

    const banMut = useMutation({
        mutationFn: (v: { id: string; reason?: string }) => api.adminBan(v.id, v.reason),
        onSuccess: invalidateUsers,
    });
    const unbanMut = useMutation({
        mutationFn: (id: string) => api.adminUnban(id),
        onSuccess: invalidateUsers,
    });
    const resetMut = useMutation({
        mutationFn: (v: { id: string; game?: string }) => api.adminResetElo(v.id, v.game),
        onSuccess: invalidateAll,
    });
    const roleMut = useMutation({
        mutationFn: (v: { id: string; role: 'user' | 'admin' }) => api.adminSetRole(v.id, v.role),
        onSuccess: invalidateUsers,
    });
    const delMatchMut = useMutation({
        mutationFn: (id: string) => api.adminDeleteMatch(id),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ['admin', 'matches'] });
            qc.invalidateQueries({ queryKey: ['admin', 'users'] });
            qc.invalidateQueries({ queryKey: ['leaderboard'] });
        },
    });

    const users = usersQ.data ?? [];
    const matches = matchesQ.data ?? [];
    const stats = statsQ.data;
    const drawerUser = users.find((u) => u.id === drawerUserId) ?? null;
    const hasApiKey = !!readAdminApiKey();

    return (
        <>
            <StatsHeader stats={stats} />

            <div className="admin-subtabs">
                <button className={`admin-subtab ${sub === 'users' ? 'active' : ''}`} onClick={() => setSub('users')}>
                    <FiUsers /> Joueurs
                    <span className="admin-subtab-count">{users.length}</span>
                </button>
                <button className={`admin-subtab ${sub === 'matches' ? 'active' : ''}`} onClick={() => setSub('matches')}>
                    <FiActivity /> Matchs
                    <span className="admin-subtab-count">{matches.length}</span>
                </button>
            </div>

            {sub === 'users' && (
                <>
                    <UsersFilters
                        q={userQ} setQ={setUserQ}
                        banned={userBanned} setBanned={setUserBanned}
                        role={userRole} setRole={setUserRole}
                    />
                    {usersQ.isLoading && !users.length && <div className="admin-mod-empty">Chargement…</div>}
                    {!usersQ.isLoading && users.length === 0 && <div className="admin-mod-empty">Aucun joueur trouvé.</div>}
                    <div className="admin-user-grid">
                        {users.map((u) => (
                            <UserCard key={u.id} row={u} onClick={() => setDrawerUserId(u.id)} />
                        ))}
                    </div>
                </>
            )}

            {sub === 'matches' && (
                <>
                    <MatchesFilters
                        q={matchQ} setQ={setMatchQ}
                        game={matchGame} setGame={setMatchGame}
                    />
                    {matchesQ.isLoading && !matches.length && <div className="admin-mod-empty">Chargement…</div>}
                    {!matchesQ.isLoading && matches.length === 0 && <div className="admin-mod-empty">Aucun match trouvé.</div>}
                    <div className="admin-mod-rows">
                        {matches.map((m) => (
                            <MatchRow
                                key={m.id}
                                row={m}
                                disabled={delMatchMut.isPending}
                                onDelete={() => delMatchMut.mutate(m.id)}
                            />
                        ))}
                    </div>
                </>
            )}

            {drawerUser && (
                <UserDrawer
                    row={drawerUser}
                    hasApiKey={hasApiKey}
                    disabled={banMut.isPending || unbanMut.isPending || resetMut.isPending || roleMut.isPending}
                    onClose={() => setDrawerUserId(null)}
                    onBan={(reason) => banMut.mutate({ id: drawerUser.id, reason })}
                    onUnban={() => unbanMut.mutate(drawerUser.id)}
                    onResetElo={(game) => resetMut.mutate({ id: drawerUser.id, game })}
                    onSetRole={(role) => roleMut.mutate({ id: drawerUser.id, role })}
                />
            )}
        </>
    );
}

// ── Stats header ────────────────────────────────────────────────────────────
function StatsHeader({ stats }: { stats?: AdminStats }) {
    const cards: Array<{ label: string; value: number; icon: JSX.Element; tone: string }> = [
        { label: 'Joueurs',  value: stats?.usersTotal ?? 0,    icon: <FiUsers />,    tone: 'var(--accent)' },
        { label: 'Bannis',   value: stats?.usersBanned ?? 0,   icon: <FiSlash />,    tone: 'var(--loss)' },
        { label: 'Admins',   value: stats?.usersAdmin ?? 0,    icon: <FiShield />,   tone: '#FFD700' },
        { label: 'Matchs',   value: stats?.matchesFinished ?? 0, icon: <FiTarget />, tone: 'var(--win)' },
    ];
    return (
        <div className="admin-stats">
            {cards.map((c) => (
                <div key={c.label} className="admin-stats-card" style={{ borderColor: c.tone }}>
                    <div className="admin-stats-icon" style={{ color: c.tone, background: `color-mix(in oklab, ${c.tone} 18%, transparent)` }}>
                        {c.icon}
                    </div>
                    <div>
                        <div className="admin-stats-label">{c.label.toUpperCase()}</div>
                        <div className="admin-stats-value" style={{ color: c.tone }}>{c.value}</div>
                    </div>
                </div>
            ))}
        </div>
    );
}

// ── Filtres ────────────────────────────────────────────────────────────────
function UsersFilters({ q, setQ, banned, setBanned, role, setRole }: {
    q: string; setQ: (v: string) => void;
    banned: 'all' | 'banned' | 'active'; setBanned: (v: 'all' | 'banned' | 'active') => void;
    role: 'all' | 'admin' | 'user'; setRole: (v: 'all' | 'admin' | 'user') => void;
}) {
    return (
        <div className="admin-filters">
            <div className="admin-search">
                <FiSearch />
                <input
                    placeholder="Chercher un pseudo…"
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                />
                {q && <button className="admin-search-clear" onClick={() => setQ('')}><FiX /></button>}
            </div>
            <div className="admin-filter-pills">
                {(['all', 'active', 'banned'] as const).map((v) => (
                    <button key={v} className={`chip ${banned === v ? 'active accent' : ''}`} onClick={() => setBanned(v)}>
                        {v === 'all' ? 'Tous' : v === 'active' ? 'Actifs' : 'Bannis'}
                    </button>
                ))}
                <div style={{ width: 8 }} />
                {(['all', 'user', 'admin'] as const).map((v) => (
                    <button key={v} className={`chip ${role === v ? 'active accent' : ''}`} onClick={() => setRole(v)}>
                        {v === 'all' ? 'Tous rôles' : v === 'user' ? 'Joueurs' : 'Admins'}
                    </button>
                ))}
            </div>
        </div>
    );
}

function MatchesFilters({ q, setQ, game, setGame }: {
    q: string; setQ: (v: string) => void;
    game: string; setGame: (v: string) => void;
}) {
    return (
        <div className="admin-filters">
            <div className="admin-search">
                <FiSearch />
                <input placeholder="Chercher un pseudo (P1 ou P2)…" value={q} onChange={(e) => setQ(e.target.value)} />
                {q && <button className="admin-search-clear" onClick={() => setQ('')}><FiX /></button>}
            </div>
            <div className="admin-filter-pills">
                <button className={`chip ${game === '' ? 'active accent' : ''}`} onClick={() => setGame('')}>Tous jeux</button>
                {KNOWN_GAMES.map((g) => (
                    <button key={g.apiId} className={`chip ${game === g.apiId ? 'active accent' : ''}`} onClick={() => setGame(g.apiId)}>
                        {g.display}
                    </button>
                ))}
            </div>
        </div>
    );
}

// ── User card (compact) ────────────────────────────────────────────────────
function UserCard({ row, onClick }: { row: AdminUserRow; onClick: () => void }) {
    const sortedGames = Object.entries(row.perGame).sort((a, b) => b[1].rating - a[1].rating).slice(0, 3);
    return (
        <button className={`admin-user-card${row.banned ? ' banned' : ''}`} onClick={onClick}>
            <div className="admin-user-card-head">
                <Avatar seed={row.pseudo} size={56} ring ringColor={row.banned ? 'var(--loss)' : (row.role === 'admin' ? '#FFD700' : 'var(--accent)')} imageUrl={absoluteAvatar(row.avatarUrl)} />
                <div className="admin-user-card-main">
                    <div className="admin-user-card-pseudo">
                        {row.pseudo}
                        {row.role === 'admin' && <span className="admin-pill admin"><FiShield /> ADMIN</span>}
                        {row.banned && <span className="admin-pill loss"><FiSlash /> BANNI</span>}
                    </div>
                    <div className="admin-user-card-sub">
                        {row.matchCount} matchs · {row.coins} 🪙
                    </div>
                </div>
                {row.globalElo !== null && (
                    <div className="admin-user-card-elo">
                        <div className="admin-user-card-elo-value">{row.globalElo}</div>
                        <div className="admin-user-card-elo-label">ELO</div>
                    </div>
                )}
            </div>
            {sortedGames.length > 0 && (
                <div className="admin-user-card-games">
                    {sortedGames.map(([game, e]) => (
                        <div key={game} className="admin-user-card-game">
                            <span className="admin-user-card-game-name">{displayGame(game)}</span>
                            <span className="admin-user-card-game-elo">{e.rating}</span>
                        </div>
                    ))}
                </div>
            )}
            {row.banReason && <div className="admin-user-card-reason">« {row.banReason} »</div>}
        </button>
    );
}

// ── User drawer (détail + actions) ──────────────────────────────────────────
function UserDrawer({ row, hasApiKey, disabled, onClose, onBan, onUnban, onResetElo, onSetRole }: {
    row: AdminUserRow; hasApiKey: boolean; disabled: boolean;
    onClose: () => void;
    onBan: (reason?: string) => void;
    onUnban: () => void;
    onResetElo: (game?: string) => void;
    onSetRole: (role: 'user' | 'admin') => void;
}) {
    function confirmBan() {
        const reason = window.prompt(`Bannir ${row.pseudo} ?\nRaison (optionnelle) :`);
        if (reason === null) return;
        onBan(reason.trim() || undefined);
    }
    function confirmResetAll() {
        if (!window.confirm(`Reset ELO complet de ${row.pseudo} ?\nSupprime tous ses matchs finis — irréversible.`)) return;
        onResetElo();
    }
    function confirmResetGame(game: string) {
        if (!window.confirm(`Reset ELO de ${row.pseudo} sur ${displayGame(game)} ?\nSupprime ses matchs finis sur ce jeu.`)) return;
        onResetElo(game);
    }
    function confirmPromote() {
        if (!window.confirm(`Promouvoir ${row.pseudo} en admin ?`)) return;
        onSetRole('admin');
    }
    function confirmDemote() {
        if (!window.confirm(`Retirer le rôle admin à ${row.pseudo} ?`)) return;
        onSetRole('user');
    }

    const sortedGames = Object.entries(row.perGame).sort((a, b) => b[1].rating - a[1].rating);

    return (
        <div className="admin-drawer-backdrop" onClick={onClose}>
            <div className="admin-drawer" onClick={(e) => e.stopPropagation()}>
                <div className="admin-drawer-head">
                    <Avatar seed={row.pseudo} size={72} ring ringColor={row.banned ? 'var(--loss)' : (row.role === 'admin' ? '#FFD700' : 'var(--accent)')} imageUrl={absoluteAvatar(row.avatarUrl)} />
                    <div style={{ flex: 1 }}>
                        <h2 className="admin-drawer-pseudo">
                            {row.pseudo}
                            {row.role === 'admin' && <span className="admin-pill admin"><FiShield /> ADMIN</span>}
                            {row.banned && <span className="admin-pill loss"><FiSlash /> BANNI</span>}
                        </h2>
                        <div className="admin-drawer-sub">
                            Inscrit le {new Date(row.createdAt).toLocaleDateString('fr-FR')} · {row.matchCount} matchs · {row.coins} 🪙
                        </div>
                    </div>
                    <button className="admin-drawer-close" onClick={onClose}><FiX /></button>
                </div>

                {row.banReason && (
                    <div className="admin-drawer-section">
                        <div className="admin-drawer-section-title"><FiSlash /> Raison du ban</div>
                        <div className="admin-drawer-reason">« {row.banReason} »</div>
                    </div>
                )}

                <div className="admin-drawer-section">
                    <div className="admin-drawer-section-title"><FiAward /> ELO par jeu</div>
                    {sortedGames.length === 0 ? (
                        <div className="admin-mod-empty">Aucun match joué.</div>
                    ) : (
                        <div className="admin-elo-table">
                            {sortedGames.map(([game, e]) => (
                                <div key={game} className="admin-elo-row">
                                    <div className="admin-elo-game">{displayGame(game)}</div>
                                    <div className="admin-elo-rating">{e.rating}</div>
                                    <div className="admin-elo-games">{e.games} parties</div>
                                    <button
                                        className="btn btn-ghost btn-sm"
                                        disabled={disabled}
                                        onClick={() => confirmResetGame(game)}
                                        title={`Reset ELO ${displayGame(game)}`}
                                    >
                                        <FiRefreshCw /> Reset
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                <div className="admin-drawer-section">
                    <div className="admin-drawer-section-title"><FiKey /> Actions</div>
                    <div className="admin-drawer-actions">
                        {row.banned
                          ? <button className="btn btn-line" disabled={disabled} onClick={onUnban}><FiUserCheck /> Débannir</button>
                          : <button className="btn btn-loss" disabled={disabled} onClick={confirmBan}><FiUserX /> Bannir</button>}
                        <button className="btn btn-line" disabled={disabled || row.matchCount === 0} onClick={confirmResetAll}>
                            <FiRefreshCw /> Reset ELO global
                        </button>
                        {hasApiKey ? (
                            row.role === 'admin'
                              ? <button className="btn btn-line" disabled={disabled} onClick={confirmDemote}><FiArrowDown /> Retirer admin</button>
                              : <button className="btn btn-accent" disabled={disabled} onClick={confirmPromote}><FiArrowUp /> Passer admin</button>
                        ) : (
                            <div className="admin-drawer-hint">
                                <FiLock /> Le changement de rôle nécessite la clé API. Verrouille et entre avec la clé pour pouvoir promouvoir.
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}

function MatchRow({ row, disabled, onDelete }: {
    row: AdminMatchRow; disabled: boolean; onDelete: () => void;
}) {
    const p1 = row.player1?.pseudo ?? '?';
    const p2 = row.player2?.pseudo ?? '?';
    const winner = row.winnerId === row.player1?.id ? p1 : row.winnerId === row.player2?.id ? p2 : null;
    function confirmDelete() {
        if (!window.confirm(`Supprimer ${p1} vs ${p2} (${row.scoreP1}-${row.scoreP2}) ?\nL'ELO sera recalculé sans ce match.`)) return;
        onDelete();
    }
    return (
        <div className="admin-mod-row">
            <div style={{ display: 'flex', gap: 6 }}>
                <Avatar seed={p1} size={32} imageUrl={absoluteAvatar(row.player1?.avatarUrl ?? null)} />
                <Avatar seed={p2} size={32} imageUrl={absoluteAvatar(row.player2?.avatarUrl ?? null)} />
            </div>
            <div className="admin-mod-row-main">
                <div className="admin-mod-row-title">
                    {p1} <span style={{ color: 'var(--muted)' }}>vs</span> {p2}
                    <span className="admin-pill"><FiTarget /> {displayGame(row.game)}</span>
                    {row.status === 'cancelled' && <span className="admin-pill loss">ANNULÉ</span>}
                </div>
                <div className="admin-mod-row-sub">
                    <span className="admin-score">{row.scoreP1}–{row.scoreP2}</span>
                    {winner && <> · 🏆 {winner}</>}
                    {row.finishedAt && <> · {new Date(row.finishedAt).toLocaleString('fr-FR')}</>}
                </div>
            </div>
            <div className="admin-mod-actions">
                <button className="btn btn-loss btn-sm" disabled={disabled} onClick={confirmDelete}>
                    <FiTrash2 /> Supprimer
                </button>
            </div>
        </div>
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

/* Tabs entre Modération et Tâches admin */
.admin-tabs { display: flex; gap: 8px; margin-bottom: 18px; flex-wrap: wrap; }

/* Stats header en bannière */
.admin-stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 12px; margin-bottom: 22px; }
.admin-stats-card {
  display: flex; align-items: center; gap: 14px;
  padding: 14px 16px;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 14px;
}
.admin-stats-icon {
  width: 42px; height: 42px; border-radius: 12px;
  display: flex; align-items: center; justify-content: center;
  font-size: 22px;
}
.admin-stats-label { font-size: 10.5px; color: var(--muted); letter-spacing: 1.2px; font-weight: 700; }
.admin-stats-value { font-family: var(--font-display); font-weight: 800; font-size: 28px; line-height: 1.1; margin-top: 2px; }

/* Sous-tabs Joueurs / Matchs */
.admin-subtabs { display: flex; gap: 6px; border-bottom: 1px solid var(--line); margin-bottom: 14px; }
.admin-subtab {
  display: inline-flex; align-items: center; gap: 8px;
  padding: 10px 16px;
  background: transparent; border: none; border-bottom: 2px solid transparent;
  color: var(--muted); cursor: pointer;
  font-family: var(--font-display); font-weight: 700; font-size: 14px;
  transition: color 0.15s, border-color 0.15s;
}
.admin-subtab:hover { color: var(--text); }
.admin-subtab.active { color: var(--accent); border-bottom-color: var(--accent); }
.admin-subtab-count {
  display: inline-flex; align-items: center; justify-content: center;
  min-width: 22px; height: 18px; padding: 0 6px; border-radius: 999px;
  background: var(--surface-2); color: var(--muted);
  font-size: 11px; font-weight: 800;
}
.admin-subtab.active .admin-subtab-count { background: color-mix(in oklab, var(--accent) 25%, transparent); color: var(--accent); }

/* Barre de filtres */
.admin-filters { display: flex; flex-wrap: wrap; gap: 10px; margin-bottom: 14px; align-items: center; }
.admin-search {
  position: relative; display: flex; align-items: center; gap: 8px;
  flex: 1; min-width: 220px;
  background: var(--surface-2); border: 1px solid var(--line); border-radius: 10px;
  padding: 8px 12px;
  color: var(--muted);
}
.admin-search > svg { font-size: 16px; flex-shrink: 0; }
.admin-search input {
  flex: 1; background: transparent; border: none; outline: none;
  color: var(--text); font-size: 14px;
}
.admin-search-clear { background: transparent; border: none; color: var(--muted); cursor: pointer; display: flex; }
.admin-filter-pills { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }

/* Grille de cartes users */
.admin-user-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  grid-auto-rows: max-content;   /* rangée = hauteur du contenu MAX */
  align-items: start;            /* item aligné en haut de sa cell */
  align-content: start;          /* toute la grille alignée en haut */
  gap: 12px;
}
.admin-user-card {
  appearance: none;
  -webkit-appearance: none;
  font: inherit;
  color: var(--text);

  text-align: left;
  display: flex; flex-direction: column; gap: 10px;
  padding: 14px 16px;
  background: var(--surface); border: 1px solid var(--line); border-radius: 14px;
  cursor: pointer;
  /* Hover passé sur OUTLINE plutôt que border-color : un outline ne
     prend pas de place dans le layout et ne peut PAS se déformer en
     barre verticale même si la card est mal dimensionnée. */
  outline: 0 solid transparent;
  outline-offset: -1px;
  transition: outline-color 0.15s, transform 0.1s;
  /* Contraintes dures : la card ne doit JAMAIS prendre plus que la
     hauteur de son contenu. contain: layout isole le layout interne
     du parent, max-height + overflow: hidden agissent en filet. */
  contain: layout;
  align-self: start;
  height: auto;
  max-height: max-content;
  overflow: hidden;
}
.admin-user-card:hover {
  outline: 2px solid var(--accent);
  transform: translateY(-1px);
}
.admin-user-card.banned { border-color: color-mix(in oklab, var(--loss) 50%, var(--line)); }
.admin-user-card-head { display: flex; align-items: center; gap: 12px; }
.admin-user-card-main { flex: 1; min-width: 0; }
.admin-user-card-pseudo {
  font-family: var(--font-display); font-weight: 700; font-size: 16px;
  color: var(--text);
  display: flex; align-items: center; gap: 6px;
  flex-wrap: wrap;
  /* CRITIQUE : sans align-content explicite, le default est stretch.
     Quand le pseudo + la pill admin wrap sur 2 lignes ET que le parent
     leak de la hauteur, la 2e ligne (qui contient la pill) prenait
     toute la hauteur disponible — la pill apparaissait comme une
     barre olive verticale géante. align-content: flex-start aligne
     toutes les lignes wrappées en haut, sans étirement vertical. */
  align-content: flex-start;
}
.admin-user-card-sub { font-size: 12px; color: var(--muted); margin-top: 2px; }
.admin-user-card-elo { text-align: right; }
.admin-user-card-elo-value { font-family: var(--font-display); font-weight: 800; font-size: 22px; line-height: 1; color: var(--accent); }
.admin-user-card-elo-label { font-size: 9.5px; color: var(--muted); letter-spacing: 1px; font-weight: 800; }
.admin-user-card-games { display: flex; flex-direction: column; gap: 4px; }
.admin-user-card-game {
  display: flex; justify-content: space-between; align-items: center;
  padding: 4px 8px; background: var(--surface-2); border-radius: 6px;
  font-size: 11.5px;
}
.admin-user-card-game-name { color: var(--muted); }
.admin-user-card-game-elo { font-weight: 800; color: var(--text); font-feature-settings: 'tnum'; }
.admin-user-card-reason {
  font-size: 11px; color: var(--loss); font-style: italic;
  background: color-mix(in oklab, var(--loss) 10%, transparent);
  padding: 4px 8px; border-radius: 6px;
}

/* Pills génériques */
.admin-pill {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 2px 8px; border-radius: 999px; font-size: 10px; font-weight: 800;
  letter-spacing: 0.5px;
  background: color-mix(in oklab, var(--muted) 25%, transparent);
  color: var(--text);
  /* Garde-fou : flex-shrink: 0 + align-self pour ne JAMAIS s'étirer dans
     un flex parent (cas observé : barre jaune verticale sur toute la
     hauteur de la card quand la card prenait > pleine hauteur). */
  flex-shrink: 0;
  align-self: center;
  height: auto;
  line-height: 1.3;
  white-space: nowrap;
}
.admin-pill > svg { font-size: 11px; }
.admin-pill.loss   { background: color-mix(in oklab, var(--loss) 22%, transparent);  color: var(--loss); }
.admin-pill.admin  { background: color-mix(in oklab, #FFD700 22%, transparent);       color: #FFD700; }

/* Sections Users / Matches (rows liste verticale pour matches) */
.admin-mod-section { padding: 16px; margin-bottom: 16px; }
.admin-mod-empty { color: var(--muted); text-align: center; padding: 30px 0; }
.admin-mod-rows { display: flex; flex-direction: column; gap: 8px; margin-top: 10px; }
.admin-mod-row { display: flex; align-items: center; gap: 12px; padding: 10px 12px; background: var(--surface); border: 1px solid var(--line); border-radius: 10px; }
.admin-mod-row-main { flex: 1; min-width: 0; }
.admin-mod-row-title { font-weight: 700; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.admin-mod-row-sub { color: var(--muted); font-size: 12px; margin-top: 2px; display: flex; gap: 6px; align-items: center; }
.admin-mod-actions { display: flex; gap: 6px; flex-wrap: wrap; justify-content: flex-end; }
.admin-score { font-family: var(--font-display); font-weight: 700; color: var(--text); }

/* Bouton "loss" pour danger zone */
.btn.btn-loss {
  background: color-mix(in oklab, var(--loss) 18%, transparent);
  border: 1px solid var(--loss);
  color: var(--loss);
}
.btn.btn-loss:hover { background: color-mix(in oklab, var(--loss) 30%, transparent); }
.btn.btn-loss[disabled] { opacity: 0.5; cursor: not-allowed; }

/* Drawer détail user */
.admin-drawer-backdrop {
  position: fixed; inset: 0; z-index: 250;
  background: rgba(0,0,0,0.55);
  display: flex; justify-content: flex-end;
  animation: idemDrawerBg 0.18s ease-out both;
}
.admin-drawer {
  width: 100%; max-width: 520px; height: 100%;
  background: var(--bg); border-left: 1px solid var(--line);
  display: flex; flex-direction: column;
  overflow-y: auto;
  animation: idemDrawerIn 0.22s cubic-bezier(0.2, 0.9, 0.3, 1) both;
}
@keyframes idemDrawerBg { from { opacity: 0; } to { opacity: 1; } }
@keyframes idemDrawerIn { from { transform: translateX(40px); opacity: 0.6; } to { transform: translateX(0); opacity: 1; } }
.admin-drawer-head {
  display: flex; align-items: center; gap: 14px;
  padding: 22px 22px 16px;
  border-bottom: 1px solid var(--line);
}
.admin-drawer-pseudo {
  font-family: var(--font-display); font-weight: 800; font-size: 22px;
  margin: 0 0 4px;
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
  /* Pareil que .admin-user-card-pseudo : sans align-content explicite,
     les lignes wrappées (cas pseudo long + pill ADMIN) s'étirent à la
     hauteur disponible et la pill devient une barre verticale géante. */
  align-content: flex-start;
}
.admin-drawer-sub { font-size: 12px; color: var(--muted); }
.admin-drawer-close {
  background: var(--surface-2); border: 1px solid var(--line);
  width: 36px; height: 36px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  cursor: pointer; color: var(--text);
}
.admin-drawer-section { padding: 18px 22px; border-bottom: 1px solid var(--line); }
.admin-drawer-section-title {
  display: flex; align-items: center; gap: 6px;
  font-size: 11px; font-weight: 800; letter-spacing: 1.2px;
  color: var(--muted); text-transform: uppercase;
  margin-bottom: 12px;
}
.admin-drawer-reason {
  font-style: italic; color: var(--loss); font-size: 13px;
  background: color-mix(in oklab, var(--loss) 10%, transparent);
  padding: 10px 12px; border-radius: 8px;
}
.admin-drawer-actions { display: flex; flex-wrap: wrap; gap: 8px; }
.admin-drawer-hint {
  display: flex; align-items: center; gap: 8px;
  font-size: 12px; color: var(--muted);
  padding: 10px 12px;
  background: var(--surface-2); border-radius: 8px;
  border: 1px dashed var(--line);
}
.admin-elo-table { display: flex; flex-direction: column; gap: 6px; }
.admin-elo-row {
  display: grid; grid-template-columns: 1fr auto auto auto; gap: 10px; align-items: center;
  padding: 8px 12px;
  background: var(--surface); border: 1px solid var(--line); border-radius: 8px;
}
.admin-elo-game { font-weight: 700; font-size: 13.5px; }
.admin-elo-rating { font-family: var(--font-display); font-weight: 800; color: var(--accent); }
.admin-elo-games { font-size: 11.5px; color: var(--muted); }

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