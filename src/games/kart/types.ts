// Types partagés du jeu de course kart. Les modules track/physics/ai/items
// dépendent uniquement de ce fichier (zéro import three).

export type ItemKind = 'boost' | 'banana' | 'shell';

export interface KartInput {
  throttle: number;   // 0..1 (gas)
  brake: number;      // 0..1
  steer: number;      // -1 (gauche) à +1 (droite)
  drift: boolean;     // tient le drift pour booster en sortie
  useItem: boolean;   // déclenche l'item en stock
}

export interface KartState {
  id: string;
  // Identité d'affichage (pseudo + avatar) — utilisé par le HUD/podium et la pancarte 3D.
  pseudo: string;
  color: number;            // couleur du kart, hex 0xRRGGBB
  // Position monde
  x: number; z: number; y: number;
  // Rotation autour de Y (radians). 0 = +X, π/2 = +Z (convention three)
  heading: number;
  // Cinématique
  speed: number;            // unités/seconde le long de heading
  // Item en stock + actifs
  itemStock: ItemKind | null;
  boostUntil: number;       // tick > now → boost actif
  stunUntil: number;        // immobilisé après collision banane/shell
  // Progression sur le circuit
  lapProgress: number;      // 0..1 dans le tour courant (basé sur centerline)
  lap: number;              // tour courant (commence à 0, on incrémente en passant la ligne)
  totalProgress: number;    // lap + lapProgress → utilisé pour le classement
  finished: boolean;
  finishedAt?: number;
  isBot: boolean;
  // Emote actif au-dessus du kart : affiché ~2.5s puis effacé.
  // emoteKey indexe EMOTES dans emotes.ts (ex. 'rage', 'clown', 'goat'…).
  emoteKey?: string | null;
  emoteUntil?: number;
}

export interface TrackSample {
  x: number; z: number;       // point sur la centerline
  tangentX: number; tangentZ: number; // dir unitaire le long du tracé (forward)
  normalX: number; normalZ: number;   // dir unitaire perpendiculaire (gauche)
  cumLen: number;             // longueur cumulée depuis le début
}

export interface TrackData {
  samples: TrackSample[];     // polyline dense, fermée (samples[N-1] ~= samples[0])
  totalLength: number;        // longueur du tour en unités
  width: number;              // largeur de la route (de bord à bord)
  startIndex: number;         // index sur lequel se trouve la ligne de départ
}

export interface ItemBox {
  id: string;
  x: number; z: number;
  respawnAt: number;          // < now → box active, sinon en cooldown
}

export interface ActiveItem {
  id: string;
  kind: ItemKind;
  ownerId: string;
  // Pour banane : position fixe, ttl long.
  // Pour shell : position + vélocité, homing vers la cible.
  x: number; z: number;
  vx: number; vz: number;
  expiresAt: number;
  targetId?: string;
}

export interface RaceState {
  karts: KartState[];
  itemBoxes: ItemBox[];
  activeItems: ActiveItem[];
  startedAt: number;
  totalLaps: number;
  finishedOrder: string[];    // ids dans l'ordre de fin
}
