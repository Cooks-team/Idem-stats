// Source de vérité côté front pour les jeux connus (filtres, chips, mini-jeux).
// Doit rester aligné avec src/lib/games.js de l'API et l'enum Game côté Kotlin.

export interface KnownGame {
  apiId: string;
  display: string;
  // jouable côté web ? (les autres sont saisis via détail match)
  playable?: boolean;
}

export const KNOWN_GAMES: KnownGame[] = [
  { apiId: 'basket_random', display: 'Basket Random' },
  { apiId: 'darts',         display: 'Fléchettes',   playable: true },
  { apiId: 'baby',          display: 'Babyfoot',     playable: true },
  { apiId: 'pingpong',      display: 'Ping-pong',    playable: true },
  { apiId: 'clicker',       display: 'Click Battle', playable: true },
  { apiId: 'snake',         display: 'Snake 1v1',    playable: true },
  { apiId: 'billiards',     display: 'Billard',      playable: true },
  { apiId: 'shifumi',       display: 'Shifumi' },
];

export function displayGame(apiId: string): string {
  return KNOWN_GAMES.find((g) => g.apiId === apiId)?.display ?? apiId;
}
