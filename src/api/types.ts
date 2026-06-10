// Modèles renvoyés par l'API — gardés stricts pour profiter de TypeScript.
export interface User {
  id: string;
  pseudo: string;
  avatarUrl?: string | null;
  createdAt?: string;
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

export interface LeaderboardEntry {
  user: User;
  wins: number;
  losses: number;
  played: number;
  winrate: number; // 0..1
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
