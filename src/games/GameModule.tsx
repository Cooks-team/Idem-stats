// Interface commune des mini-jeux 1v1 jouables côté web.
// On ajoute un jeu en exportant un GameModule et en l'enregistrant dans GAME_MODULES.

import type { ComponentType } from 'react';

export interface GameProps {
  // Appelée par le jeu à la fin de la partie. Le wrapper s'occupera de PATCH + finish via l'API.
  onFinish: (scoreP1: number, scoreP2: number) => void;
  // Identité visuelle des joueurs (avatar + pseudo) — utilisée par certains jeux
  // pour afficher le pseudo et la photo sur les éléments contrôlés (paddle babyfoot, etc.)
  player1?: { pseudo?: string; avatarUrl?: string | null };
  player2?: { pseudo?: string; avatarUrl?: string | null };
  // Mode multiplayer pour les jeux temps réel via SSE relay :
  //  - 'local' : 2 joueurs sur le même clavier (comportement par défaut, hub games)
  //  - 'host'  : je suis player1 d'un match remote → je fais tourner la simulation
  //              et je broadcast l'état au guest. Mes inputs me bougent localement.
  //  - 'guest' : je suis player2 d'un match remote → je n'exécute pas la simu,
  //              je reçois l'état du host et je rends, et j'envoie mes inputs.
  // Si le jeu ne supporte pas le multiplayer, il ignore ces props et reste local.
  mode?: 'local' | 'host' | 'guest';
  matchId?: string;
}

export interface GameModule {
  id: string;             // id stable (ex: "clicker")
  apiId: string;          // id côté API (l'enum Game de la spec)
  name: string;
  description: string;
  Component: ComponentType<GameProps>;
}

import { ClickerGame } from './ClickerGame';
import { SnakeGame } from './SnakeGame';
import { PongGame } from './PongGame';
import { DartsGame } from './DartsGame';
import { BabyfootGame } from './BabyfootGame';
import { BilliardsGame } from './BilliardsGame';
import { ChessGame } from './ChessGame';

export const GAME_MODULES: GameModule[] = [
  ClickerGame,
  SnakeGame,
  PongGame,
  DartsGame,
  BabyfootGame,
  BilliardsGame,
  ChessGame,
];

export function moduleById(id: string): GameModule | undefined {
  return GAME_MODULES.find((m) => m.id === id);
}
