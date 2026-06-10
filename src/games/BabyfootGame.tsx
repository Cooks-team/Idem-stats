import { useEffect, useRef, useState } from 'react';
import type { GameModule, GameProps } from './GameModule';

// Babyfoot version arcade air-hockey-style. Un faute palet sur chaque côté,
// une balle au milieu, un but à chaque extrémité. Premier à 5 gagne.
//   J1 (rouge, gauche)   : flèches ↑↓←→ (limité à sa moitié de terrain)
//   J2 (bleu,  droite)   : ZQSD / WASD (limité à sa moitié)
// Physique : friction sur la balle, rebond sur les murs et sur les palets
// (transfert d'énergie selon la vitesse du palet).

const W = 760;
const H = 380;
const PADDLE_R = 22;
const BALL_R = 12;
const GOAL_H = 130;     // hauteur d'ouverture des buts
const WIN_GOALS = 5;
const PADDLE_SPEED = 5.5;
const BALL_FRICTION = 0.995;
const MIN_BALL_SPEED = 0.05;
const TICK_MS = 16;

interface V2 { x: number; y: number }
interface State {
  p1: V2;
  p2: V2;
  p1V: V2; // vitesse instantanée pour transférer à la balle
  p2V: V2;
  ball: V2;
  ballV: V2;
  keys: Set<string>;
}

function initState(): State {
  return {
    // J1 (flèches, à droite) sur la moitié DROITE ; J2 (ZQSD, à gauche) sur la moitié GAUCHE.
    p1: { x: (3 * W) / 4, y: H / 2 },
    p2: { x: W / 4,       y: H / 2 },
    p1V: { x: 0, y: 0 }, p2V: { x: 0, y: 0 },
    ball: { x: W / 2, y: H / 2 },
    ballV: { x: 0, y: 0 },
    keys: new Set(),
  };
}

export const BabyfootGame: GameModule = {
  id: 'baby',
  apiId: 'baby',
  name: 'Babyfoot',
  description: '1v1 air-hockey arcade. J1 flèches, J2 ZQSD. Premier à 5 buts.',
  Component: BabyfootComponent,
};

function BabyfootComponent({ onFinish }: GameProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const stateRef = useRef<State>(initState());
  const [score, setScore] = useState({ p1: 0, p2: 0 });
  const [phase, setPhase] = useState<'ready' | 'running' | 'done'>('ready');

  const start = () => {
    stateRef.current = initState();
    setScore({ p1: 0, p2: 0 });
    // Petit kick aléatoire pour démarrer
    stateRef.current.ballV = randomKick();
    setPhase('running');
  };

  useEffect(() => {
    if (phase !== 'running') return;
    const down = (e: KeyboardEvent) => { stateRef.current.keys.add(e.key.toLowerCase()); if (isHandled(e.key)) e.preventDefault(); };
    const up   = (e: KeyboardEvent) => { stateRef.current.keys.delete(e.key.toLowerCase()); };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); };
  }, [phase]);

  useEffect(() => {
    if (phase !== 'running') return;
    const interval = window.setInterval(() => {
      const s = stateRef.current;

      // 1) Déplace les palets selon les touches, en limitant chacun à son demi-terrain
      const prevP1 = { ...s.p1 }, prevP2 = { ...s.p2 };
      if (s.keys.has('arrowup'))    s.p1.y -= PADDLE_SPEED;
      if (s.keys.has('arrowdown'))  s.p1.y += PADDLE_SPEED;
      if (s.keys.has('arrowleft'))  s.p1.x -= PADDLE_SPEED;
      if (s.keys.has('arrowright')) s.p1.x += PADDLE_SPEED;
      if (s.keys.has('z') || s.keys.has('w')) s.p2.y -= PADDLE_SPEED;
      if (s.keys.has('s'))                    s.p2.y += PADDLE_SPEED;
      if (s.keys.has('q') || s.keys.has('a')) s.p2.x -= PADDLE_SPEED;
      if (s.keys.has('d'))                    s.p2.x += PADDLE_SPEED;
      // Contraintes : J1 sur la moitié DROITE, J2 sur la moitié GAUCHE (clavier)
      s.p1.x = clamp(s.p1.x, W / 2 + PADDLE_R, W - PADDLE_R);
      s.p1.y = clamp(s.p1.y, PADDLE_R, H - PADDLE_R);
      s.p2.x = clamp(s.p2.x, PADDLE_R, W / 2 - PADDLE_R);
      s.p2.y = clamp(s.p2.y, PADDLE_R, H - PADDLE_R);
      s.p1V = { x: s.p1.x - prevP1.x, y: s.p1.y - prevP1.y };
      s.p2V = { x: s.p2.x - prevP2.x, y: s.p2.y - prevP2.y };

      // 2) Bouge la balle
      s.ball.x += s.ballV.x;
      s.ball.y += s.ballV.y;
      // Friction
      s.ballV.x *= BALL_FRICTION;
      s.ballV.y *= BALL_FRICTION;
      if (Math.abs(s.ballV.x) < MIN_BALL_SPEED && Math.abs(s.ballV.y) < MIN_BALL_SPEED) {
        s.ballV.x = 0; s.ballV.y = 0;
      }

      // 3) Rebond haut/bas (le but n'est que dans une fente verticale centrée)
      if (s.ball.y - BALL_R <= 0 && s.ballV.y < 0) { s.ball.y = BALL_R; s.ballV.y *= -1; }
      if (s.ball.y + BALL_R >= H && s.ballV.y > 0) { s.ball.y = H - BALL_R; s.ballV.y *= -1; }

      // 4) Collision palets : si la balle touche un palet, rebond + ajout de la vitesse du palet
      for (const [pad, padV] of [[s.p1, s.p1V], [s.p2, s.p2V]] as const) {
        const dx = s.ball.x - pad.x;
        const dy = s.ball.y - pad.y;
        const dist = Math.hypot(dx, dy);
        if (dist > 0 && dist < BALL_R + PADDLE_R) {
          const nx = dx / dist, ny = dy / dist;
          // Repousse la balle hors du palet
          s.ball.x = pad.x + nx * (BALL_R + PADDLE_R);
          s.ball.y = pad.y + ny * (BALL_R + PADDLE_R);
          // Reflète la vitesse sur la normale
          const dot = s.ballV.x * nx + s.ballV.y * ny;
          s.ballV.x = (s.ballV.x - 2 * dot * nx) + padV.x * 0.6;
          s.ballV.y = (s.ballV.y - 2 * dot * ny) + padV.y * 0.6;
          // Vitesse minimale après rebond pour rendre les rallyes dynamiques
          const sp = Math.hypot(s.ballV.x, s.ballV.y);
          if (sp < 3) { s.ballV.x *= 3 / Math.max(sp, 0.001); s.ballV.y *= 3 / Math.max(sp, 0.001); }
        }
      }

      // 5) But ? — J1 défend le but de DROITE, J2 le but de GAUCHE.
      //    Balle qui sort à gauche → J1 marque ; balle qui sort à droite → J2 marque.
      const goalYMin = (H - GOAL_H) / 2;
      const goalYMax = (H + GOAL_H) / 2;
      const inGoalY = s.ball.y >= goalYMin && s.ball.y <= goalYMax;
      if (s.ball.x - BALL_R <= 0) {
        if (inGoalY) {
          setScore((sc) => {
            const next = { ...sc, p1: sc.p1 + 1 };
            if (next.p1 >= WIN_GOALS) { setPhase('done'); setTimeout(() => onFinish(next.p1, next.p2), 700); }
            return next;
          });
          s.ball = { x: W / 2, y: H / 2 }; s.ballV = randomKick(1);
        } else {
          s.ball.x = BALL_R; s.ballV.x *= -1;
        }
      }
      if (s.ball.x + BALL_R >= W) {
        if (inGoalY) {
          setScore((sc) => {
            const next = { ...sc, p2: sc.p2 + 1 };
            if (next.p2 >= WIN_GOALS) { setPhase('done'); setTimeout(() => onFinish(next.p1, next.p2), 700); }
            return next;
          });
          s.ball = { x: W / 2, y: H / 2 }; s.ballV = randomKick(-1);
        } else {
          s.ball.x = W - BALL_R; s.ballV.x *= -1;
        }
      }

      // 6) Dessin
      const c = canvasRef.current;
      if (c) {
        const ctx = c.getContext('2d');
        if (ctx) draw(ctx, s);
      }
    }, TICK_MS);
    return () => clearInterval(interval);
  }, [phase, onFinish]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
      <div style={{ display: 'flex', gap: 60, fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 32 }}>
        <span style={{ color: '#FF6B57' }}>🔴 {score.p1}</span>
        <span style={{ color: '#5B8CFF' }}>🔵 {score.p2}</span>
      </div>
      <canvas
        ref={canvasRef}
        width={W}
        height={H}
        style={{ background: '#0E3318', borderRadius: 14, border: '1px solid var(--line)', maxWidth: '100%', height: 'auto' }}
      />
      {phase === 'ready' && (
        <>
          <button className="btn btn-accent btn-lg" onClick={start}>Démarrer</button>
          <div style={{ color: 'var(--muted)', fontSize: 13, textAlign: 'center' }}>
            🔵 J2 (gauche) : ZQSD &nbsp;·&nbsp; 🔴 J1 (droite) : flèches &nbsp;·&nbsp; Premier à {WIN_GOALS} buts.
          </div>
        </>
      )}
      {phase === 'running' && (
        <div style={{ color: 'var(--muted)', fontSize: 13 }}>Chacun bouge son palet sur sa moitié — premier à {WIN_GOALS} buts.</div>
      )}
      {phase === 'done' && <div style={{ color: 'var(--muted)' }}>Match terminé. Score envoyé…</div>}
    </div>
  );
}

function randomKick(dir?: 1 | -1): V2 {
  const d = dir ?? (Math.random() < 0.5 ? 1 : -1);
  const angle = (Math.random() - 0.5) * 0.6;
  const sp = 4;
  return { x: d * sp * Math.cos(angle), y: sp * Math.sin(angle) };
}

function clamp(v: number, lo: number, hi: number): number { return Math.max(lo, Math.min(hi, v)); }

function isHandled(key: string): boolean {
  const k = key.toLowerCase();
  return ['arrowup','arrowdown','arrowleft','arrowright','z','q','s','d','w','a'].includes(k);
}

function draw(ctx: CanvasRenderingContext2D, s: State) {
  // Terrain
  ctx.fillStyle = '#0E3318';
  ctx.fillRect(0, 0, W, H);
  // Ligne médiane + cercle central
  ctx.strokeStyle = 'rgba(255,255,255,0.25)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(W / 2, 0); ctx.lineTo(W / 2, H);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(W / 2, H / 2, 40, 0, Math.PI * 2);
  ctx.stroke();
  // Buts (zones d'entrée)
  const goalYMin = (H - GOAL_H) / 2;
  ctx.fillStyle = 'rgba(255,255,255,0.08)';
  ctx.fillRect(0, goalYMin, 8, GOAL_H);
  ctx.fillRect(W - 8, goalYMin, 8, GOAL_H);
  ctx.strokeStyle = 'rgba(255,255,255,0.55)';
  ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(0, goalYMin); ctx.lineTo(0, goalYMin + GOAL_H); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(W, goalYMin); ctx.lineTo(W, goalYMin + GOAL_H); ctx.stroke();
  // Palets — J1 rouge à droite (flèches), J2 bleu à gauche (ZQSD)
  ctx.fillStyle = '#FF6B57';
  ctx.beginPath(); ctx.arc(s.p1.x, s.p1.y, PADDLE_R, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#5B8CFF';
  ctx.beginPath(); ctx.arc(s.p2.x, s.p2.y, PADDLE_R, 0, Math.PI * 2); ctx.fill();
  // Balle
  ctx.fillStyle = '#D6FF3D';
  ctx.beginPath(); ctx.arc(s.ball.x, s.ball.y, BALL_R, 0, Math.PI * 2); ctx.fill();
}
