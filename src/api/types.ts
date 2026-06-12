// Modèles renvoyés par l'API — gardés stricts pour profiter de TypeScript.
export interface User {
  id: string;
  pseudo: string;
  avatarUrl?: string | null;
  createdAt?: string;
  // Jetons gagnés via les 1v1, dépensés au casino. Optionnel pour rétro-compat.
  coins?: number;
  // Rôle utilisateur — 'admin' débloque le lien Admin dans la sidebar.
  // Optionnel : si l'API ne le renvoie pas (vieille version), on retombe
  // sur 'user' implicite côté UI. Mis à jour via la page admin.
  role?: 'user' | 'admin';
}

export interface BlackjackRoundResponse {
  coins: number;
  delta: number;
}

// ─ Admin modération ────────────────────────────────────────────────────
export interface AdminPerGameElo { rating: number; games: number }

export interface AdminUserRow {
  id: string;
  pseudo: string;
  avatarUrl: string | null;
  coins: number;
  banned: boolean;
  bannedAt: string | null;
  banReason: string | null;
  role: 'user' | 'admin';
  createdAt: string;
  matchCount: number;
  globalElo: number | null;
  perGame: Record<string, AdminPerGameElo>;
}

export interface AdminStats {
  usersTotal: number;
  usersBanned: number;
  usersAdmin: number;
  matchesTotal: number;
  matchesFinished: number;
}

export interface AdminMatchPlayer {
  id: string;
  pseudo: string;
  avatarUrl: string | null;
}

export interface AdminMatchRow {
  id: string;
  game: string;
  status: 'finished' | 'cancelled';
  scoreP1: number;
  scoreP2: number;
  winnerId: string | null;
  player1: AdminMatchPlayer | null;
  player2: AdminMatchPlayer | null;
  finishedAt: string | null;
}

// ─ Blackjack rooms (multi-joueurs) ──────────────────────────────────────
export interface BJCard { rank?: string; suit?: string; hidden?: boolean }
export type BJHandStatus = 'playing' | 'standing' | 'busted' | 'blackjack';
export type BJResult = 'blackjack' | 'win' | 'push' | 'lose' | 'busted' | null;
export type BJPhase = 'waiting' | 'betting' | 'insurance' | 'playing' | 'dealer' | 'result';

export interface BJSeat {
  index: number;
  empty: boolean;
  userId?: string;
  pseudo?: string;
  avatarUrl?: string | null;
  bet?: number;
  insuranceBet?: number;
  insuranceDecided?: boolean;
  hands?: BJCard[][];
  handBets?: number[];
  handStatus?: BJHandStatus[];
  activeHandIdx?: number;
  result?: BJResult;
  payout?: number;
  insurancePayout?: number;
  isMe?: boolean;
}

export interface BlackjackRoom {
  id: string;
  isMain?: boolean;
  phase: BJPhase;
  roundId: number;
  insuranceOffered?: boolean;
  maxSeats: number;
  dealer: { name?: string; hand: BJCard[]; total: number };
  seats: BJSeat[];
}

export type MatchStatus = 'pending' | 'active' | 'finished' | 'cancelled';
export type MatchSource = 'extension' | 'web' | 'manual';

export type ShifumiPick = 'rock' | 'paper' | 'scissors';

export type ShifumiMode = 'irl' | 'remote';

export interface ShifumiMetadata {
  mode?: ShifumiMode;
  // IRL (et reveal d'une remote terminée) :
  winnerPseudo?: string;
  loserPseudo?: string;
  winnerPick?: ShifumiPick;
  loserPick?: ShifumiPick;
  // Remote pending / résolu :
  creatorPick?: ShifumiPick;          // visible par le créateur en pending, par tous en finished
  opponentPick?: ShifumiPick;         // visible par tous en finished
  awaitingMyPick?: boolean;           // mon pick n'est pas posé pour ce round
  awaitingOpponentPick?: boolean;     // mon pick est posé, l'autre attend
  tie?: boolean;                       // (legacy — anciens matchs où tie = finished)
  // Round courant et historique des rounds écoulés (ties + round final)
  round?: number;
  history?: ShifumiRoundEntry[];
  lastTieRound?: number;              // = round qui vient de se conclure en égalité
  // Enjeu du duel ("celui qui perd paye"…), max 200 chars, visible des deux côtés
  condition?: string;
  // Série BO3/BO5 (remote uniquement). Défaut bestOf=1 (1 manche unique).
  bestOf?: 1 | 3 | 5;
  seriesP1?: number;
  seriesP2?: number;
  // Rewards inscrits par le serveur à la finalisation
  rewards?: MatchRewards;
}

// Récompenses calculées à la fin d'un match, stockées dans metadata.rewards.
// Permet au front d'afficher un modal "Tu as gagné +24 ELO, +50 🪙" sans
// recalculer côté client.
export interface MatchRewardEntry {
  eloBefore: number;
  eloAfter: number;
  eloDelta: number;   // peut être négatif si défaite
  coinsDelta: number; // toujours ≥ 0 (REWARD_LOSS = +10 minimum)
}
export interface MatchRewards {
  winnerId: string | null;
  p1?: MatchRewardEntry;
  p2?: MatchRewardEntry;
}

export interface ShifumiRoundEntry {
  round: number;
  creatorPick: ShifumiPick;
  opponentPick: ShifumiPick;
  tie?: boolean;
  winnerPseudo?: string;
}

export interface FriendshipRow {
  id: string;
  status: 'pending' | 'accepted';
  direction: 'incoming' | 'outgoing';
  createdAt: string;
  acceptedAt: string | null;
  user: User;
}

export interface FriendsResponse {
  friends: FriendshipRow[];
  incoming: FriendshipRow[];
  outgoing: FriendshipRow[];
}

export interface InboxResponse {
  friendRequests: Array<{ id: string; createdAt: string; user: User }>;
  matchInvites: Match[];
  shifumiPendingPicks: Match[];
  // Compteur de messages non lus toutes conversations confondues. Affiché
  // comme une row cliquable dans la cloche → /messages.
  unreadMessages?: number;
  total: number;
}

export interface Match {
  id: string;
  game: string;
  code: string | null;
  status: MatchStatus;
  scoreP1: number;
  scoreP2: number;
  source: MatchSource | null;
  metadata: ShifumiMetadata | Record<string, unknown> | null;
  createdAt: string;
  finishedAt: string | null;
  player1Id: string;
  player2Id: string | null;
  winnerId: string | null;
  player1?: User;
  player2?: User | null;
}

export type BadgeKind = 'monster' | 'shame' | 'winrate' | 'streak' | 'volume';
export type BadgeTone = 'accent' | 'win' | 'loss' | 'gold' | 'muted';

export interface Badge {
  id: string;
  kind: BadgeKind;
  label: string;
  description: string;
  emoji: string;
  tone: BadgeTone;
}

export interface BadgesResponse {
  user: User;
  badges: Badge[];
}

export interface WallOfShameLatest {
  match: { id: string; finishedAt: string | null };
  loser: User;
  winner: User;
}

export interface WallOfShameEntry {
  user: User;
  count: number;
  lastAt: string | null;
}

export interface WallOfShameResponse {
  latest: WallOfShameLatest | null;
  // Tous les 5-0 datant de moins d'1h, ordre desc (le plus récent en tête).
  // Utilisé par le ticker breaking-news global qui défile sur toutes les pages.
  recent: WallOfShameLatest[];
  ranking: WallOfShameEntry[];
  totalEvents: number;
}

export interface RankTier {
  name: string;
  color: string;
  emoji: string;
  min: number;
  nextMin: number | null;
}

export interface PerGameEloEntry {
  rating: number;
  games: number;
  rank: RankTier;
}

export interface LeaderboardEntry {
  user: User;
  wins: number;
  losses: number;
  played: number;
  winrate: number; // 0..1
  elo: number;
  rank: RankTier;
  // Détail des ELO par jeu (utile au profil pour montrer le rang dans chaque jeu)
  perGameElo: Record<string, PerGameEloEntry>;
}

export interface AuthResponse {
  token: string;
  user: User;
}

// Helpers shifumi
export const SHIFUMI_PICKS: ShifumiPick[] = ['rock', 'paper', 'scissors'];
export const SHIFUMI_LABELS: Record<ShifumiPick, string> = {
  rock: 'Pierre',
  paper: 'Papier',
  scissors: 'Ciseaux',
};
export const SHIFUMI_EMOJIS: Record<ShifumiPick, string> = {
  rock: '🪨',
  paper: '📄',
  scissors: '✂️',
};
// Quelle main perd contre la main gagnante (utilisé pour filtrer le sélecteur)
export const SHIFUMI_LOSES_TO: Record<ShifumiPick, ShifumiPick> = {
  rock: 'scissors',
  paper: 'rock',
  scissors: 'paper',
};

export interface Message {
  id: string;
  senderId: string;
  recipientId: string;
  body: string;
  createdAt: string;
  readAt: string | null;
}
export interface ConversationSummary {
  user: User;
  lastMessage: Message | null;
  unread: number;
}

export interface AdminComment {
  id: string;
  authorId: string;
  authorPseudo: string;
  text: string;
  createdAt: string;
}
export interface AdminTask {
  id: string;
  title: string;
  assigneeId: string;
  done: boolean;
  createdAt: string;
  comments: AdminComment[];
}