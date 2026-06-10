// Interface commune des mini-jeux 1v1 jouables côté web.
// On ajoute un jeu en exportant un GameModule et en l'enregistrant dans GAME_MODULES.

import type { ComponentType } from 'react';

export interface GameProps {
  // Appelée par le jeu à la fin de la partie. Le wrapper s'occupera de PATCH + finish via l'API.
  onFinish: (scoreP1: number, scoreP2: number) => void;
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

export const GAME_MODULES: GameModule[] = [
  ClickerGame,
  SnakeGame,
  PongGame,
  DartsGame,
  BabyfootGame,
];

export function moduleById(id: string): GameModule | undefined {
  return GAME_MODULES.find((m) => m.id === id);
}
