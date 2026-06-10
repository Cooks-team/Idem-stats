// Mince wrapper fetch : ajoute Bearer si dispo, sérialise JSON, jette une ApiError typée.
import type { AuthResponse, BadgesResponse, BlackjackRoundResponse, ConversationSummary, FriendsResponse, FriendshipRow, InboxResponse, LeaderboardEntry, Match, MatchSource, Message, ShifumiPick, User, WallOfShameResponse } from './types';

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

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (!(init.body instanceof FormData)) headers.set('Content-Type', 'application/json');
  const token = readPersistedToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);
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

  // Sync temps réel pour les jeux remote (host-authoritative).
  // sendPlayInput : envoyé par le guest, reçu par le host via SSE
  // sendPlayState : envoyé par le host, reçu par le guest via SSE
  sendPlayInput: (matchId: string, payload: unknown) =>
    call<{ ok: true }>(`/matches/${matchId}/play/input`, { method: 'POST', body: JSON.stringify({ payload }) }),
  sendPlayState: (matchId: string, payload: unknown) =>
    call<{ ok: true }>(`/matches/${matchId}/play/state`, { method: 'POST', body: JSON.stringify({ payload }) }),
};
