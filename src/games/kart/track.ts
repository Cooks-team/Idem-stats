import type { TrackData, TrackSample } from './types';

// Circuit procédural — Catmull-Rom fermé à travers 12 points de contrôle
// formant un ovale avec 2 chicanes. Échantillonné densément pour faciliter
// la projection (kart → point le plus proche) et le rendu de la route.
//
// Repère monde : Y = vertical (gravité), X/Z = sol. La centerline vit en (x,z).

const TRACK_WIDTH = 16;
const SAMPLES_PER_SEGMENT = 24;

const CONTROL_POINTS: Array<[number, number]> = [
  [  0,  -90],
  [ 50,  -85],
  [ 90,  -60],
  [110,  -20],
  [ 95,   25],
  [ 60,   30],   // chicane droite
  [ 30,   55],
  [-20,   80],
  [-70,   55],
  [-100,  10],
  [-90,  -40],
  [-50,  -75],
];

// Catmull-Rom (centripetal-like): retourne le point au paramètre t∈[0,1]
// entre p1 et p2, avec p0 et p3 comme points de tension.
function catmullRom(
  p0: [number, number], p1: [number, number], p2: [number, number], p3: [number, number],
  t: number,
): [number, number] {
  const t2 = t * t;
  const t3 = t2 * t;
  const x =
    0.5 * (2 * p1[0] + (-p0[0] + p2[0]) * t +
      (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 +
      (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3);
  const z =
    0.5 * (2 * p1[1] + (-p0[1] + p2[1]) * t +
      (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 +
      (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3);
  return [x, z];
}

export function buildTrack(): TrackData {
  const cps = CONTROL_POINTS;
  const N = cps.length;
  const points: Array<[number, number]> = [];
  for (let i = 0; i < N; i++) {
    const p0 = cps[(i - 1 + N) % N];
    const p1 = cps[i];
    const p2 = cps[(i + 1) % N];
    const p3 = cps[(i + 2) % N];
    for (let s = 0; s < SAMPLES_PER_SEGMENT; s++) {
      const t = s / SAMPLES_PER_SEGMENT;
      points.push(catmullRom(p0, p1, p2, p3, t));
    }
  }

  // Tangents par différence finie + longueur cumulée
  const samples: TrackSample[] = [];
  let cum = 0;
  for (let i = 0; i < points.length; i++) {
    const cur = points[i];
    const nxt = points[(i + 1) % points.length];
    let dx = nxt[0] - cur[0];
    let dz = nxt[1] - cur[1];
    const len = Math.hypot(dx, dz) || 1;
    dx /= len; dz /= len;
    // Normale "gauche" = rotation -90° du forward : (dx,dz) → (-dz, dx)
    const nx = -dz;
    const nz = dx;
    samples.push({
      x: cur[0], z: cur[1],
      tangentX: dx, tangentZ: dz,
      normalX: nx, normalZ: nz,
      cumLen: cum,
    });
    cum += len;
  }

  // Ligne de départ = premier sample (proche du contrôle 0)
  return {
    samples,
    totalLength: cum,
    width: TRACK_WIDTH,
    startIndex: 0,
  };
}

// Position de départ pour le kart i (0..3) légèrement en arrière de la ligne,
// décalé latéralement pour ne pas se chevaucher.
export function gridStartPosition(track: TrackData, i: number, total: number) {
  const back = 6 + (i % 2) * 4;
  const target = (track.startIndex - back + track.samples.length) % track.samples.length;
  const s = track.samples[target];
  const lateralOffset = ((i - (total - 1) / 2) * 4); // 4 unités d'écart
  return {
    x: s.x + s.normalX * lateralOffset,
    z: s.z + s.normalZ * lateralOffset,
    heading: Math.atan2(s.tangentZ, s.tangentX),
  };
}

// Projette (x,z) sur la centerline. Retourne :
//  - sampleIndex : indice du sample le plus proche
//  - lateral : signe = côté (positif = côté "gauche"/normal)
//  - alongFraction : 0..1 dans le tour (cumLen / totalLength)
//
// Optimisation : recherche fenêtrée autour d'un hint d'indice précédent.
// Si pas de hint, fallback brute force (O(N)).
export function projectOnTrack(
  track: TrackData, x: number, z: number, hintIndex?: number,
): { sampleIndex: number; lateral: number; alongFraction: number; distance: number } {
  const N = track.samples.length;
  let bestIdx = 0;
  let bestD2 = Infinity;
  const range = hintIndex != null ? 24 : N;
  const start = hintIndex != null ? hintIndex - range / 2 : 0;
  for (let k = 0; k < range; k++) {
    const i = ((start + k) % N + N) % N;
    const s = track.samples[i];
    const dx = x - s.x;
    const dz = z - s.z;
    const d2 = dx * dx + dz * dz;
    if (d2 < bestD2) {
      bestD2 = d2;
      bestIdx = i;
    }
  }
  const s = track.samples[bestIdx];
  // lateral = projection sur la normale (côté + ou -)
  const dx = x - s.x;
  const dz = z - s.z;
  const lateral = dx * s.normalX + dz * s.normalZ;
  const distance = Math.abs(lateral);
  const alongFraction = s.cumLen / track.totalLength;
  return { sampleIndex: bestIdx, lateral, alongFraction, distance };
}
