import type { KartState, KartInput, TrackData } from './types';
import { projectOnTrack } from './track';

// Constantes arcade. Volontairement légères côté simulation pour éviter le
// "voiture rigide" : on veut un feeling kart, glisseur, pas de réalisme.
const MAX_SPEED = 38;          // unités/s
const ACCEL = 22;              // u/s² quand plein gaz
const BRAKE = 36;              // u/s² au frein
const NATURAL_DRAG = 6;        // décélération naturelle sans gaz
const STEER_RATE = 2.6;        // rad/s à vitesse de référence
const STEER_REF_SPEED = 18;    // au-delà, on perd un peu de braquage
const DRIFT_STEER_BOOST = 1.5; // braquage * X en drift
const DRIFT_SIDE_FRICTION = 0.85;  // grip latéral réduit en drift
const NORMAL_SIDE_FRICTION = 0.96; // grip latéral normal
const BOOST_MULT = 1.55;       // vitesse max * X quand boost actif
const WALL_PUSH = 14;          // pénalité de re-centrage
const STUN_DECEL = 30;         // freinage quand stun
const KART_RADIUS = 1.4;       // pour les collisions kart-kart / kart-item

export interface PhysicsCtx {
  track: TrackData;
  now: number;       // ms
  dt: number;        // s
}

// Avance le kart d'un pas dt en intégrant input + frottements + grip de piste.
// Mute les champs de KartState — c'est du physique inline, simple, pas de
// création d'objet par frame.
export function stepKart(kart: KartState, input: KartInput, ctx: PhysicsCtx) {
  const { track, now, dt } = ctx;
  if (kart.finished) {
    // Continue de rouler tout droit en décélérant, pour pas se planter sur la ligne.
    kart.speed = Math.max(0, kart.speed - NATURAL_DRAG * dt);
    kart.x += Math.cos(kart.heading) * kart.speed * dt;
    kart.z += Math.sin(kart.heading) * kart.speed * dt;
    return;
  }

  const stunned = now < kart.stunUntil;
  const boosted = now < kart.boostUntil;
  const speedCap = MAX_SPEED * (boosted ? BOOST_MULT : 1);

  // --- Accélération longitudinale
  if (stunned) {
    kart.speed -= STUN_DECEL * dt;
  } else {
    const throttle = clamp(input.throttle, 0, 1);
    const brake = clamp(input.brake, 0, 1);
    if (throttle > 0) {
      const headroom = Math.max(0, speedCap - kart.speed);
      kart.speed += ACCEL * throttle * dt * Math.min(1, headroom / 4 + 0.4);
    }
    if (brake > 0) {
      // Le frein freine quand on roule en avant, puis fait reculer doucement.
      kart.speed -= BRAKE * brake * dt;
    }
    // Drag passif : tire la vitesse vers ZÉRO, ne la pousse jamais en négatif.
    // (Bug v1 : on appliquait `speed -= NATURAL_DRAG*dt` même à v=0 → le kart
    // reculait tout seul à l'arrêt.)
    if (throttle < 0.05 && brake < 0.05) {
      if (kart.speed > 0) {
        kart.speed = Math.max(0, kart.speed - NATURAL_DRAG * dt);
      } else if (kart.speed < 0) {
        kart.speed = Math.min(0, kart.speed + NATURAL_DRAG * dt);
      }
    }
  }
  kart.speed = clamp(kart.speed, -10, speedCap);

  // --- Braquage
  const drifting = input.drift && Math.abs(kart.speed) > 6;
  const steer = clamp(input.steer, -1, 1);
  const speedFactor = STEER_REF_SPEED / Math.max(STEER_REF_SPEED, Math.abs(kart.speed));
  const turnRate = STEER_RATE * speedFactor * (drifting ? DRIFT_STEER_BOOST : 1);
  kart.heading += steer * turnRate * dt;

  // --- Intégration position
  const fx = Math.cos(kart.heading);
  const fz = Math.sin(kart.heading);
  kart.x += fx * kart.speed * dt;
  kart.z += fz * kart.speed * dt;
  kart.y = 0; // collé au sol (pas de saut)

  // --- Murs de piste
  const proj = projectOnTrack(track, kart.x, kart.z, undefined);
  const halfW = track.width / 2;
  const overshoot = Math.abs(proj.lateral) - halfW;
  if (overshoot > 0) {
    // On pousse le kart vers le centre, perp à la piste, et on punit la vitesse
    const s = track.samples[proj.sampleIndex];
    const sign = proj.lateral > 0 ? 1 : -1;
    kart.x -= s.normalX * sign * (overshoot + 0.05);
    kart.z -= s.normalZ * sign * (overshoot + 0.05);
    kart.speed *= 1 - Math.min(0.6, overshoot * 0.02);
    // léger feedback latéral : grip réduit déjà géré ailleurs, ici on freine.
    kart.speed -= WALL_PUSH * dt;
  } else {
    // En drift on perd un peu de vitesse au sol (sinon c'est cheaté)
    if (drifting) kart.speed *= Math.pow(DRIFT_SIDE_FRICTION, dt);
    else kart.speed *= Math.pow(NORMAL_SIDE_FRICTION, dt * 0.1); // imperceptible
  }

  // --- Progression sur le circuit (pour le classement et la ligne d'arrivée)
  const newFrac = proj.alongFraction;
  const oldFrac = kart.lapProgress;
  // Détection passage de ligne : on passe de 0.95+ à <0.1 → +1 tour
  if (oldFrac > 0.85 && newFrac < 0.15) {
    kart.lap += 1;
  } else if (oldFrac < 0.15 && newFrac > 0.85) {
    // tour à l'envers — ne pas décrémenter, on ignore
  }
  kart.lapProgress = newFrac;
  kart.totalProgress = kart.lap + newFrac;
}

// Collisions kart-kart : si deux karts se chevauchent, on les écarte et on
// échange un peu de vitesse. Très simple — pas de momentum strict.
export function resolveKartCollisions(karts: KartState[]) {
  const R = KART_RADIUS * 2;
  const R2 = R * R;
  for (let i = 0; i < karts.length; i++) {
    for (let j = i + 1; j < karts.length; j++) {
      const a = karts[i];
      const b = karts[j];
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < R2 && d2 > 0.01) {
        const d = Math.sqrt(d2);
        const overlap = (R - d) * 0.5;
        const nx = dx / d;
        const nz = dz / d;
        a.x -= nx * overlap;
        a.z -= nz * overlap;
        b.x += nx * overlap;
        b.z += nz * overlap;
        // Petit drain de vitesse pour rendre les contacts perceptibles
        a.speed *= 0.92;
        b.speed *= 0.92;
      }
    }
  }
}

function clamp(v: number, lo: number, hi: number) {
  return v < lo ? lo : v > hi ? hi : v;
}

export const PhysicsConfig = {
  MAX_SPEED, BOOST_MULT, KART_RADIUS,
};
