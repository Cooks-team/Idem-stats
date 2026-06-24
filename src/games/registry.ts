// Source de vérité côté front pour les jeux connus (filtres, chips, mini-jeux).
// Doit rester aligné avec src/lib/games.js de l'API et l'enum Game côté Kotlin.

export type DuelMode = 'local' | 'remote';

export interface KnownGame {
  apiId: string;
  display: string;
  // jouable côté web ? (les autres sont saisis via détail match)
  playable?: boolean;
  // Maintenance : si true, le jeu est complètement injouable, on redirige
  // sur la page "Bientôt disponible". Sert le temps d'un refacto.
  disabled?: boolean;
  // Maintenance partielle : modes spécifiques cassés / non implémentés.
  // Ex : Basket Random en remote, Click Battle en local (2 souris impossible).
  disabledModes?: DuelMode[];
}

export const KNOWN_GAMES: KnownGame[] = [
  // Maintenance : Basket Random remote indispo (sync extension cassée),
  // Click Battle local indispo (2 souris sur le même écran = pas faisable),
  // Chess et Kart désactivés en attendant des refactors.
  { apiId: 'basket_random', display: 'Basket Random', disabledModes: ['remote'] },
  { apiId: 'darts',         display: 'Fléchettes',   playable: true },
  { apiId: 'baby',          display: 'Babyfoot',     playable: true },
  { apiId: 'pong',          display: 'Pong',         playable: true },
  { apiId: 'clicker',       display: 'Click Battle', playable: true, disabledModes: ['local'] },
  { apiId: 'snake',         display: 'Snake',        playable: true },
  { apiId: 'billiards',     display: 'Billard',      playable: true },
  { apiId: 'chess',         display: 'Échecs',       playable: true, disabled: true },
  { apiId: 'kart',          display: 'Kart Race',    playable: true, disabled: true },
  { apiId: 'shifumi',       display: 'Shifumi' },
];

/** Retourne true si le jeu (ou un mode donné du jeu) est temporairement
 *  désactivé. Sert à gater UI + routes. */
export function isGameDisabled(apiId: string, mode?: DuelMode): boolean {
  const g = KNOWN_GAMES.find((x) => x.apiId === apiId);
  if (!g) return false;
  if (g.disabled) return true;
  if (mode && g.disabledModes?.includes(mode)) return true;
  return false;
}

// Alias d'affichage pour les anciens apiId qui ont été renommés. Permet de
// continuer à afficher correctement le nom des matchs en BDD avec l'ancien id.
const APIID_ALIASES: Record<string, string> = {
  pingpong: 'Pong',
};

export function displayGame(apiId: string): string {
  return KNOWN_GAMES.find((g) => g.apiId === apiId)?.display ?? APIID_ALIASES[apiId] ?? apiId;
}
