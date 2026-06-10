import type { ActiveItem, ItemBox, ItemKind, KartState, TrackData, RaceState } from './types';
import { PhysicsConfig } from './physics';

// Items du kart racing : 3 effets, distribution roulette.

const ITEM_BOX_RESPAWN_MS = 6_000;
const ITEM_BOX_RADIUS = 2.4;
const BANANA_TTL_MS = 25_000;
const BANANA_RADIUS = 1.6;
const SHELL_TTL_MS = 8_000;
const SHELL_SPEED = 48;
const SHELL_RADIUS = 1.4;
const SHELL_HOMING = 1.8;          // rad/s max correction du shell
const BOOST_DURATION_MS = 2_200;
const STUN_DURATION_MS = 1_400;

// Place des boîtes ?, espacées tous les ~80 unités le long de la centerline,
// 3 par segment alignées en travers de la piste.
export function spawnItemBoxes(track: TrackData): ItemBox[] {
  const boxes: ItemBox[] = [];
  const step = 80;
  const offsets = [-4, 0, 4];
  for (let cum = 60; cum < track.totalLength - 30; cum += step) {
    const idx = findSampleByCumLen(track, cum);
    const s = track.samples[idx];
    for (const off of offsets) {
      boxes.push({
        id: `box-${cum}-${off}`,
        x: s.x + s.normalX * off,
        z: s.z + s.normalZ * off,
        respawnAt: 0,
      });
    }
  }
  return boxes;
}

function findSampleByCumLen(track: TrackData, target: number): number {
  // recherche binaire — on aurait pu juste faire lookupSegment, mais ici on
  // cherche un sample précis sur cumLen → simple parcours.
  for (let i = 0; i < track.samples.length; i++) {
    if (track.samples[i].cumLen >= target) return i;
  }
  return 0;
}

// Roulette de tirage. Le 1er du peloton a + de chances d'avoir un piège
// (banane), les derniers + de chances d'avoir un boost ou shell — équilibrage
// catch-up classique.
export function rollItem(rankInRace: number, totalKarts: number): ItemKind {
  const fromBack = totalKarts - 1 - rankInRace; // 0 = dernier, totalKarts-1 = premier
  const r = Math.random();
  if (rankInRace === 0) {
    // Leader : surtout des bananes (défense)
    if (r < 0.65) return 'banana';
    if (r < 0.85) return 'boost';
    return 'shell';
  }
  if (fromBack === 0) {
    // Dernier : surtout boost + shell (catch-up)
    if (r < 0.5) return 'boost';
    if (r < 0.85) return 'shell';
    return 'banana';
  }
  // Milieu : équilibré
  if (r < 0.4) return 'boost';
  if (r < 0.75) return 'banana';
  return 'shell';
}

// Test ramassage : si un kart traverse une box active, on lui donne un item
// (s'il n'en a pas déjà un), et on met la box en cooldown.
export function pickupItemBoxes(state: RaceState, now: number) {
  for (const box of state.itemBoxes) {
    if (box.respawnAt > now) continue;
    for (const kart of state.karts) {
      if (kart.itemStock || kart.finished) continue;
      const dx = kart.x - box.x;
      const dz = kart.z - box.z;
      if (dx * dx + dz * dz < ITEM_BOX_RADIUS * ITEM_BOX_RADIUS) {
        const rank = rankOfKart(state, kart.id);
        kart.itemStock = rollItem(rank, state.karts.length);
        box.respawnAt = now + ITEM_BOX_RESPAWN_MS;
        break;
      }
    }
  }
}

// Rang d'un kart dans la course (0 = premier).
export function rankOfKart(state: RaceState, kartId: string): number {
  const sorted = [...state.karts].sort((a, b) => b.totalProgress - a.totalProgress);
  return sorted.findIndex((k) => k.id === kartId);
}

// Active l'item en stock du kart.
export function useItem(state: RaceState, kart: KartState, now: number) {
  const stock = kart.itemStock;
  if (!stock) return;
  kart.itemStock = null;
  if (stock === 'boost') {
    kart.boostUntil = now + BOOST_DURATION_MS;
    return;
  }
  if (stock === 'banana') {
    // Largue 2 unités derrière le kart
    const bx = kart.x - Math.cos(kart.heading) * 2.2;
    const bz = kart.z - Math.sin(kart.heading) * 2.2;
    state.activeItems.push({
      id: `b-${kart.id}-${now}`,
      kind: 'banana',
      ownerId: kart.id,
      x: bx, z: bz, vx: 0, vz: 0,
      expiresAt: now + BANANA_TTL_MS,
    });
    return;
  }
  if (stock === 'shell') {
    // Cible : le kart le plus proche devant moi sur la centerline
    const target = findShellTarget(state, kart);
    state.activeItems.push({
      id: `s-${kart.id}-${now}`,
      kind: 'shell',
      ownerId: kart.id,
      x: kart.x + Math.cos(kart.heading) * 3,
      z: kart.z + Math.sin(kart.heading) * 3,
      vx: Math.cos(kart.heading) * SHELL_SPEED,
      vz: Math.sin(kart.heading) * SHELL_SPEED,
      expiresAt: now + SHELL_TTL_MS,
      targetId: target?.id,
    });
  }
}

function findShellTarget(state: RaceState, owner: KartState): KartState | null {
  // Kart suivant dans le sens du tour
  const others = state.karts.filter((k) => k.id !== owner.id && !k.finished);
  if (others.length === 0) return null;
  // Plus simple : kart avec le totalProgress immédiatement supérieur au mien.
  let best: KartState | null = null;
  let bestGap = Infinity;
  for (const k of others) {
    const gap = k.totalProgress - owner.totalProgress;
    if (gap > 0 && gap < bestGap) {
      bestGap = gap;
      best = k;
    }
  }
  // Si je suis premier : cible le dernier (parce que sinon le shell sert à rien)
  if (!best) {
    let worst: KartState | null = null;
    let lowest = Infinity;
    for (const k of others) {
      if (k.totalProgress < lowest) { lowest = k.totalProgress; worst = k; }
    }
    best = worst;
  }
  return best;
}

// Update tick des items actifs (shells qui volent + bananes statiques) +
// détection collision items ↔ karts.
export function stepActiveItems(state: RaceState, now: number, dt: number) {
  const survivors: ActiveItem[] = [];
  for (const item of state.activeItems) {
    if (item.expiresAt < now) continue;
    if (item.kind === 'shell') {
      // Homing : ajuste la direction vers la cible (si encore en course)
      const target = item.targetId ? state.karts.find((k) => k.id === item.targetId && !k.finished) : null;
      if (target) {
        const dx = target.x - item.x;
        const dz = target.z - item.z;
        const len = Math.hypot(dx, dz) || 1;
        const desiredAngle = Math.atan2(dz, dx);
        const currentAngle = Math.atan2(item.vz, item.vx);
        const diff = wrapAngle(desiredAngle - currentAngle);
        const turn = clampNum(diff, -SHELL_HOMING * dt, SHELL_HOMING * dt);
        const newAngle = currentAngle + turn;
        item.vx = Math.cos(newAngle) * SHELL_SPEED;
        item.vz = Math.sin(newAngle) * SHELL_SPEED;
        // Si très proche, on a impacté
        if (len < SHELL_RADIUS + PhysicsConfig.KART_RADIUS) {
          stunKart(target, now);
          continue; // shell consommé
        }
      }
      item.x += item.vx * dt;
      item.z += item.vz * dt;
      // Test impact sur n'importe quel kart (au cas où le shell touche en route)
      let consumed = false;
      for (const k of state.karts) {
        if (k.id === item.ownerId || k.finished) continue;
        const dx = k.x - item.x;
        const dz = k.z - item.z;
        if (dx * dx + dz * dz < (SHELL_RADIUS + PhysicsConfig.KART_RADIUS) ** 2) {
          stunKart(k, now);
          consumed = true;
          break;
        }
      }
      if (consumed) continue;
    } else if (item.kind === 'banana') {
      // Statique : test collision avec karts
      let consumed = false;
      for (const k of state.karts) {
        if (k.finished) continue;
        const dx = k.x - item.x;
        const dz = k.z - item.z;
        if (dx * dx + dz * dz < (BANANA_RADIUS + PhysicsConfig.KART_RADIUS) ** 2) {
          stunKart(k, now);
          consumed = true;
          break;
        }
      }
      if (consumed) continue;
    }
    survivors.push(item);
  }
  state.activeItems = survivors;
}

function stunKart(kart: KartState, now: number) {
  kart.stunUntil = now + STUN_DURATION_MS;
  kart.speed = Math.min(kart.speed, 4);
}

function wrapAngle(a: number): number {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}
function clampNum(v: number, lo: number, hi: number) { return v < lo ? lo : v > hi ? hi : v; }
