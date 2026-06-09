// Modèles renvoyés par l'API — gardés stricts pour profiter de TypeScript.
export interface User {
  id: string;
  pseudo: string;
  createdAt?: string;
}

export type MatchStatus = 'pending' | 'active' | 'finished' | 'cancelled';
export type MatchSource = 'extension' | 'web' | 'manual';

export interface Match {
  id: string;
  game: string;
  code: string | null;
  status: MatchStatus;
  scoreP1: number;
  scoreP2: number;
  source: MatchSource | null;
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
