// Mince wrapper fetch : ajoute Bearer si dispo, sérialise JSON, jette une ApiError typée.
import type { AdminMatchRow, AdminStats, AdminUserRow, AuthResponse, BadgesResponse, BlackjackRoom, BlackjackRoundResponse, ConversationSummary, FriendsResponse, FriendshipRow, InboxResponse, LeaderboardEntry, Match, MatchSource, Message, ShifumiPick, User, WallOfShameResponse, AdminTask } from './types';

const BASE = (import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
export const API_BASE_URL = BASE;

// Compose une URL absolue pour un avatarUrl renvoyé par l'API ("/uploads/avatars/...").
// Si la valeur est déjà absolue (http(s)://...), on la laisse telle quelle.
export function absoluteAvatar(avatarUrl: string | null | undefined): string | null {
  if (!avatarUrl) return null;
  if (/^https?:\/\//.test(avatarUrl)) return avatarUrl;
  return BASE + avatarUrl;
}

let inMemoryToken: string | null = null;
export function setToken(t: string | null) {
  inMemoryToken = t;
  if (typeof window !== 'undefined') {
    if (t) localStorage.setItem('idem.token', t);
    else localStorage.removeItem('idem.token');
  }
}
export function readPersistedToken(): string | null {
  if (inMemoryToken) return inMemoryToken;
  if (typeof window === 'undefined') return null;
  inMemoryToken = localStorage.getItem('idem.token');
  return inMemoryToken;
}

// Cache local du dernier user connu (pour restauration instantanée au reload,
// sans attendre la round-trip /me). On garde un timestamp pour expirer le cache
// après une journée si on n'a jamais re-vérifié.
const USER_CACHE_KEY = 'idem.user.v1';
export function cacheUser(u: import('./types').User | null) {
  if (typeof window === 'undefined') return;
  if (u) localStorage.setItem(USER_CACHE_KEY, JSON.stringify({ at: Date.now(), u }));
  else localStorage.removeItem(USER_CACHE_KEY);
}
export function readCachedUser(): import('./types').User | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(USER_CACHE_KEY);
    if (!raw) return null;
    const { at, u } = JSON.parse(raw) as { at: number; u: import('./types').User };
    // Cache valide 7 jours — au-delà on force une revalidation
    if (Date.now() - at > 7 * 86_400_000) return null;
    return u;
  } catch { return null; }
}

export class ApiError extends Error {
  status: number;
  body: unknown;
  constructor(status: number, body: unknown, message: string) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

// Admin API key — alternative au JWT pour les endpoints /admin/*. Stockée
// uniquement en sessionStorage (clearée à la fermeture de l'onglet).
const ADMIN_KEY_STORAGE = 'podium.admin.apikey';
export function setAdminApiKey(key: string | null) {
  try {
    if (key) sessionStorage.setItem(ADMIN_KEY_STORAGE, key);
    else sessionStorage.removeItem(ADMIN_KEY_STORAGE);
  } catch { /* sessionStorage indisponible */ }
}
export function readAdminApiKey(): string | null {
  try { return sessionStorage.getItem(ADMIN_KEY_STORAGE); } catch { return null; }
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (!(init.body instanceof FormData)) headers.set('Content-Type', 'application/json');
  const token = readPersistedToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);
  // Admin key envoyée pour les routes /admin/* (le backend accepte SOIT
  // un JWT admin SOIT cette clé). On la pose pour tous les paths car
  // c'est ignoré côté serveur ailleurs.
  const adminKey = readAdminApiKey();
  if (adminKey) headers.set('x-admin-key', adminKey);
  const res = await fetch(`${BASE}${path}`, { ...init, headers });
  const ct = res.headers.get('content-type') || '';
  const data = ct.includes('application/json') ? await res.json().catch(() => null) : await res.text();
  if (!res.ok) {
    const msg = (data && typeof data === 'object' && 'error' in data && typeof (data as Record<string, unknown>).error === 'string')
      ? String((data as Record<string, unknown>).error)
      : `http_${res.status}`;
    throw new ApiError(res.status, data, msg);
  }
  return data as T;
}

export const api = {
  register: (pseudo: string, password: string) =>
    call<AuthResponse>('/auth/register', { method: 'POST', body: JSON.stringify({ pseudo, password }) }),
  login: (pseudo: string, password: string) =>
    call<AuthResponse>('/auth/login', { method: 'POST', body: JSON.stringify({ pseudo, password }) }),
  me: () => call<User>('/me'),
  updateMe: (patch: { pseudo?: string }) =>
    call<User>('/me', { method: 'PATCH', body: JSON.stringify(patch) }),
  listConversations: () => call<ConversationSummary[]>('/messages/conversations'),
  getMessages: (friendId: string) => call<Message[]>(`/messages/${friendId}`),
  sendMessage: (friendId: string, body: string) =>
    call<Message>(`/messages/${friendId}`, { method: 'POST', body: JSON.stringify({ body }) }),
  markMessagesRead: (friendId: string) =>
    call<{ ok: true }>(`/messages/${friendId}/read`, { method: 'POST' }),

  // Multipart : un FormData avec une seule entrée "file" (cf. multer côté API).
  uploadAvatar: (file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    return call<User>('/me/avatar', { method: 'POST', body: fd });
  },
  deleteAvatar: () => call<User>('/me/avatar', { method: 'DELETE' }),

  listMatches: (scope: 'me' | 'all' = 'me', game?: string) =>
    call<Match[]>(`/matches?scope=${scope}${game ? `&game=${encodeURIComponent(game)}` : ''}`),
  // Historique d'un joueur (le mien si rien, sinon n'importe quel pseudo public)
  listMatchesOf: (pseudo: string) =>
    call<Match[]>(`/matches?userPseudo=${encodeURIComponent(pseudo)}`),
  getMatch: (id: string) => call<Match>(`/matches/${id}`),
  createMatch: (game: string, opponentPseudo?: string, mode?: 'local' | 'remote') =>
    call<Match>('/matches', { method: 'POST', body: JSON.stringify({ game, opponentPseudo: opponentPseudo || undefined, mode }) }),
  acceptInvitation: (matchId: string) => call<Match>(`/matches/${matchId}/accept`, { method: 'POST' }),
  declineInvitation: (matchId: string) => call<Match>(`/matches/${matchId}/decline`, { method: 'POST' }),
  createShifumi: (opponentPseudo: string, winnerPseudo: string, winnerPick: ShifumiPick, loserPick: ShifumiPick, condition?: string, bestOf?: 1 | 3 | 5) =>
    call<Match>('/matches', {
      method: 'POST',
      body: JSON.stringify({
        game: 'shifumi',
        opponentPseudo,
        shifumi: { mode: 'irl', winnerPseudo, winnerPick, loserPick, condition: condition?.trim() || undefined, bestOf },
      }),
    }),
  createShifumiRemote: (opponentPseudo: string, myPick: ShifumiPick, condition?: string, bestOf?: 1 | 3 | 5) =>
    call<Match>('/matches', {
      method: 'POST',
      body: JSON.stringify({
        game: 'shifumi',
        opponentPseudo,
        shifumi: { mode: 'remote', myPick, condition: condition?.trim() || undefined, bestOf },
      }),
    }),
  shifumiPick: (matchId: string, pick: ShifumiPick) =>
    call<Match>(`/matches/${matchId}/shifumi-pick`, { method: 'POST', body: JSON.stringify({ pick }) }),

  // Inbox (agrège demandes d'amis + invitations match + shifumi à pioche)
  inbox: () => call<InboxResponse>('/me/inbox'),

  // Friends
  listFriends: () => call<FriendsResponse>('/friends'),
  sendFriendRequest: (pseudo: string) =>
    call<FriendshipRow>('/friends', { method: 'POST', body: JSON.stringify({ pseudo }) }),
  acceptFriend: (requestId: string) => call<FriendshipRow>(`/friends/${requestId}/accept`, { method: 'POST' }),
  removeFriend: (requestId: string) => call<void>(`/friends/${requestId}`, { method: 'DELETE' }),
  joinMatch: (code: string) =>
    call<Match>('/matches/join', { method: 'POST', body: JSON.stringify({ code }) }),
  patchScore: (id: string, scoreP1: number, scoreP2: number, source: MatchSource) =>
    call<Match>(`/matches/${id}/score`, { method: 'PATCH', body: JSON.stringify({ scoreP1, scoreP2, source }) }),
  finishMatch: (id: string) =>
    call<Match>(`/matches/${id}/finish`, { method: 'POST' }),
  // Annule un match pending ou active (status → 'cancelled'). Ignoré par
  // leaderboard / historique / badges. N'importe quel participant peut annuler.
  cancelMatch: (id: string) =>
    call<Match>(`/matches/${id}/cancel`, { method: 'POST' }),

  leaderboard: (game?: string) =>
    call<LeaderboardEntry[]>(`/leaderboard${game ? `?game=${encodeURIComponent(game)}` : ''}`),

  // Badges décernés à un user (Monster/Pue sa mère/Sniper/streak/volume)
  badges: (pseudo: string) => call<BadgesResponse>(`/badges/${encodeURIComponent(pseudo)}`),

  // Wall of shame : latest 5-0 + ranking des joueurs qui en ont pris le plus
  wallOfShame: () => call<WallOfShameResponse>('/wall-of-shame'),

  // Blackjack — applique le delta de coins après une manche (friend-trust).
  blackjackRound: (bet: number, payout: number, meta?: unknown) =>
    call<BlackjackRoundResponse>('/blackjack/round', { method: 'POST', body: JSON.stringify({ bet, payout, meta }) }),

  // Blackjack rooms — multi-joueurs server-authoritative
  blackjackJoin: () =>
    call<{ seatIndex: number; room: BlackjackRoom }>('/blackjack/rooms/join', { method: 'POST' }),
  blackjackLeave: () => call<{ ok: true }>('/blackjack/rooms/leave', { method: 'POST' }),
  blackjackHeartbeat: () => call<{ ok: boolean }>('/blackjack/rooms/heartbeat', { method: 'POST' }),
  blackjackBet: (bet: number) =>
    call<{ ok: true }>('/blackjack/rooms/bet', { method: 'POST', body: JSON.stringify({ bet }) }),
  blackjackStart: () => call<{ ok: true }>('/blackjack/rooms/start', { method: 'POST' }),
  blackjackNext:  () => call<{ ok: true }>('/blackjack/rooms/next',  { method: 'POST' }),
  blackjackInsurance: (bet: number) =>
    call<{ ok: true }>('/blackjack/rooms/insurance', { method: 'POST', body: JSON.stringify({ bet }) }),
  blackjackHit:   () => call<{ ok: true }>('/blackjack/rooms/hit',   { method: 'POST' }),
  blackjackStand: () => call<{ ok: true }>('/blackjack/rooms/stand', { method: 'POST' }),
  blackjackDouble:() => call<{ ok: true }>('/blackjack/rooms/double',{ method: 'POST' }),
  blackjackSplit: () => call<{ ok: true }>('/blackjack/rooms/split', { method: 'POST' }),

  // Sync temps réel pour les jeux remote (host-authoritative).
  // sendPlayInput : envoyé par le guest, reçu par le host via SSE
  // sendPlayState : envoyé par le host, reçu par le guest via SSE
  sendPlayInput: (matchId: string, payload: unknown) =>
    call<{ ok: true }>(`/matches/${matchId}/play/input`, { method: 'POST', body: JSON.stringify({ payload }) }),
  sendPlayState: (matchId: string, payload: unknown) =>
    call<{ ok: true }>(`/matches/${matchId}/play/state`, { method: 'POST', body: JSON.stringify({ payload }) }),

  // Emote relay — déclenche un emote chez l'adversaire pendant un match remote.
  sendEmote: (matchId: string, key: string) =>
    call<{ ok: true }>(`/matches/${matchId}/emote`, { method: 'POST', body: JSON.stringify({ key }) }),

  // Admin todo board (réservé aux comptes admins côté serveur)
  adminListTasks: () => call<{ admins: User[]; tasks: AdminTask[] }>('/admin/tasks'),
  adminCreateTask: (title: string, assigneeId: string) =>
    call<AdminTask>('/admin/tasks', { method: 'POST', body: JSON.stringify({ title, assigneeId }) }),
  adminUpdateTask: (id: string, patch: { title?: string; done?: boolean; assigneeId?: string }) =>
    call<AdminTask>(`/admin/tasks/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  adminDeleteTask: (id: string) =>
    call<{ ok: true }>(`/admin/tasks/${id}`, { method: 'DELETE' }),
  adminAddComment: (id: string, text: string) =>
    call<AdminTask>(`/admin/tasks/${id}/comments`, { method: 'POST', body: JSON.stringify({ text }) }),
  adminDeleteComment: (id: string, commentId: string) =>
    call<AdminTask>(`/admin/tasks/${id}/comments/${commentId}`, { method: 'DELETE' }),

  // Admin modération — users + matches
  adminStats: () => call<AdminStats>('/admin/stats'),
  adminListUsers: (filters?: { q?: string; banned?: boolean; role?: 'user' | 'admin' }) => {
    const qs = new URLSearchParams();
    if (filters?.q) qs.set('q', filters.q);
    if (filters?.banned !== undefined) qs.set('banned', String(filters.banned));
    if (filters?.role) qs.set('role', filters.role);
    const suffix = qs.toString() ? `?${qs}` : '';
    return call<AdminUserRow[]>(`/admin/users${suffix}`);
  },
  adminBan: (id: string, reason?: string) =>
    call<{ ok: true }>(`/admin/users/${id}/ban`, { method: 'POST', body: JSON.stringify({ reason }) }),
  adminUnban: (id: string) =>
    call<{ ok: true }>(`/admin/users/${id}/unban`, { method: 'POST' }),
  adminResetElo: (id: string, game?: string) => {
    const suffix = game ? `?game=${encodeURIComponent(game)}` : '';
    return call<{ ok: true; deleted: number }>(`/admin/users/${id}/reset-elo${suffix}`, { method: 'POST' });
  },
  adminSetRole: (id: string, role: 'user' | 'admin') =>
    call<{ ok: true }>(`/admin/users/${id}/role`, { method: 'POST', body: JSON.stringify({ role }) }),
  adminListMatches: (filters?: { q?: string; game?: string; status?: 'finished' | 'cancelled' }) => {
    const qs = new URLSearchParams();
    if (filters?.q) qs.set('q', filters.q);
    if (filters?.game) qs.set('game', filters.game);
    if (filters?.status) qs.set('status', filters.status);
    const suffix = qs.toString() ? `?${qs}` : '';
    return call<AdminMatchRow[]>(`/admin/matches${suffix}`);
  },
  adminDeleteMatch: (id: string) =>
    call<{ ok: true }>(`/admin/matches/${id}`, { method: 'DELETE' }),
};
