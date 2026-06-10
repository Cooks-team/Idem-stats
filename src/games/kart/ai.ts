import type { KartInput, KartState, TrackData, RaceState } from './types';
import { projectOnTrack } from './track';
import { rankOfKart } from './items';

// Bot pilote très simple :
//  - vise un point ~10-14 unités devant sur la centerline (look-ahead)
//  - braque pour aligner heading avec la direction vers ce point
//  - throttle plein à fond, sauf en virage serré (réduit pour ne pas sortir)
//  - utilise l'item dès qu'il en a un (timer aléatoire 1-3s)
//
// Difficulté = facteur lookahead + agressivité. 0.7-1.0 = humain ralenti.

export interface BotMemory {
  itemUseAt: number;       // ms — quand le bot tentera d'utiliser son item
  driftHold: number;       // tick counter pour décider un drift court
}

const BOT_MEM = new Map<string, BotMemory>();

export function getBotInput(
  kart: KartState,
  state: RaceState,
  track: TrackData,
  now: number,
  skill: number, // 0.6-1.05, plus haut = plus rapide
): KartInput {
  const mem = BOT_MEM.get(kart.id) || (() => {
    const m: BotMemory = { itemUseAt: now + 1500 + Math.random() * 2500, driftHold: 0 };
    BOT_MEM.set(kart.id, m);
    return m;
  })();

  // Cible : sample look-ahead sur la centerline.
  const lookahead = 14 * skill;
  const proj = projectOnTrack(track, kart.x, kart.z);
  const targetCum = (track.samples[proj.sampleIndex].cumLen + lookahead) % track.totalLength;
  const targetIdx = sampleNearCum(track, targetCum);
  const ts = track.samples[targetIdx];

  // Petit décalage latéral aléatoire pour éviter que tous les bots collent
  // exactement la centerline (sinon ils se ratent en train).
  const offset = ((hashString(kart.id) % 7) - 3) * 0.5;
  const tx = ts.x + ts.normalX * offset;
  const tz = ts.z + ts.normalZ * offset;

  // Angle vers la cible vs heading actuel
  const dx = tx - kart.x;
  const dz = tz - kart.z;
  const desired = Math.atan2(dz, dx);
  const diff = wrapAngle(desired - kart.heading);

  const steer = clamp(diff * 2.2, -1, 1);
  // Throttle réduit en virage serré
  const sharp = Math.abs(diff);
  const throttle = clamp(1.0 - Math.max(0, sharp - 0.45) * 1.4, 0.3, 1) * skill;
  // Drift en virage long (≥ ~50°)
  const drift = sharp > 0.85;

  // Utilisation d'item
  let useItem = false;
  if (kart.itemStock && now > mem.itemUseAt) {
    useItem = true;
    mem.itemUseAt = now + 1500 + Math.random() * 3500;
  }

  return {
    throttle,
    brake: 0,
    steer,
    drift,
    useItem,
  };
}

function sampleNearCum(track: TrackData, target: number): number {
  // Recherche linéaire (assez rapide pour ~300 samples)
  for (let i = 0; i < track.samples.length; i++) {
    if (track.samples[i].cumLen >= target) return i;
  }
  return 0;
}
function clamp(v: number, lo: number, hi: number) { return v < lo ? lo : v > hi ? hi : v; }
function wrapAngle(a: number): number {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}
function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

// Helper rang du bot pour ajuster son skill (catch-up rubber-banding).
// Utile pour rendre la course tendue sans tricher trop visiblement.
export function botSkillFor(kart: KartState, state: RaceState, base: number): number {
  const rank = rankOfKart(state, kart.id);
  const total = state.karts.length;
  const fromBack = total - 1 - rank;
  // dernier : +0.08, milieu : 0, premier : -0.04
  const rubber = fromBack === 0 ? 0.08 : rank === 0 ? -0.04 : 0;
  return base + rubber;
}
