import { useEffect, useRef, useState } from 'react';
import type { GameModule, GameProps } from './GameModule';

// Babyfoot version arcade améliorée :
//   - 1 attaquant par joueur (contrôle manuel)
//   - 1 gardien par joueur (auto, suit la position Y de la balle quand elle est
//     dans sa moitié de terrain)
//   - Friction très faible → la balle reste vive, rallyes longs
//   - Boost de frappe : tenir Shift en plus du déplacement = palet plus rapide
//     → meilleur transfert d'énergie à la balle
//   - Avatar des joueurs collé sur le palet principal
//   - Trail visuel derrière la balle
// Premier à 5 buts gagne.
//   J1 (rouge, à droite)  : ↑↓←→  + Shift (droite) pour booster
//   J2 (bleu,  à gauche)  : ZQSD   + Shift (gauche) pour booster

const W = 800;
const H = 420;
const PADDLE_R = 24;
const GK_R = 18;
const BALL_R = 12;
const GOAL_H = 140;
const WIN_GOALS = 5;
const PADDLE_SPEED = 5.5;
const PADDLE_BOOST_SPEED = 8.5;
const GK_SPEED = 2.6;
const BALL_FRICTION = 0.998; // quasi pas de friction
const MIN_BALL_SPEED = 0.05;
const TICK_MS = 16;
const TRAIL_LEN = 10;

interface V2 { x: number; y: number }
interface State {
  // Attaquants (joueurs contrôlent ceux-ci)
  p1: V2; p2: V2;
  p1V: V2; p2V: V2; // vitesse pour transfert d'énergie
  // Gardiens auto
  gk1: V2; gk2: V2;
  // Balle
  ball: V2;
  ballV: V2;
  trail: V2[];
  keys: Set<string>;
}

function initState(): State {
  return {
    p1: { x: (3 * W) / 4, y: H / 2 },
    p2: { x: W / 4, y: H / 2 },
    p1V: { x: 0, y: 0 }, p2V: { x: 0, y: 0 },
    gk1: { x: W - 40, y: H / 2 },
    gk2: { x: 40,     y: H / 2 },
    ball: { x: W / 2, y: H / 2 },
    ballV: { x: 0, y: 0 },
    trail: [],
    keys: new Set(),
  };
}

export const BabyfootGame: GameModule = {
  id: 'baby',
  apiId: 'baby',
  name: 'Babyfoot',
  description: '1v1 arcade avec gardiens. J1 flèches+Shift, J2 ZQSD+Shift. Premier à 5.',
  Component: BabyfootComponent,
};

function BabyfootComponent({ onFinish, player1, player2 }: GameProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const stateRef = useRef<State>(initState());
  const [score, setScore] = useState({ p1: 0, p2: 0 });
  const [phase, setPhase] = useState<'ready' | 'running' | 'done'>('ready');

  // Pré-charge les avatars dans des Image objects pour pouvoir les dessiner
  // sur le canvas (clip circle). Si l'avatar n'est pas dispo, on tombe sur
  // un cercle avec l'initiale du pseudo.
  const avatar1Ref = useRef<HTMLImageElement | null>(null);
  const avatar2Ref = useRef<HTMLImageElement | null>(null);
  useEffect(() => {
    if (!player1?.avatarUrl) return;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => { avatar1Ref.current = img; };
    img.src = player1.avatarUrl;
  }, [player1?.avatarUrl]);
  useEffect(() => {
    if (!player2?.avatarUrl) return;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => { avatar2Ref.current = img; };
    img.src = player2.avatarUrl;
  }, [player2?.avatarUrl]);

  const start = () => {
    stateRef.current = initState();
    setScore({ p1: 0, p2: 0 });
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

      // 1) Déplace les attaquants. Shift dans la moitié clavier du joueur = boost.
      const p1Speed = (s.keys.has('shift')) ? PADDLE_BOOST_SPEED : PADDLE_SPEED;
      const p2Speed = (s.keys.has('shift')) ? PADDLE_BOOST_SPEED : PADDLE_SPEED;
      const prevP1 = { ...s.p1 }, prevP2 = { ...s.p2 };
      if (s.keys.has('arrowup'))    s.p1.y -= p1Speed;
      if (s.keys.has('arrowdown'))  s.p1.y += p1Speed;
      if (s.keys.has('arrowleft'))  s.p1.x -= p1Speed;
      if (s.keys.has('arrowright')) s.p1.x += p1Speed;
      if (s.keys.has('z') || s.keys.has('w')) s.p2.y -= p2Speed;
      if (s.keys.has('s'))                    s.p2.y += p2Speed;
      if (s.keys.has('q') || s.keys.has('a')) s.p2.x -= p2Speed;
      if (s.keys.has('d'))                    s.p2.x += p2Speed;
      // Contraintes : J1 sur la moitié DROITE, J2 sur la moitié GAUCHE
      // (mais ils peuvent franchir la ligne médiane sur la zone d'attaque).
      s.p1.x = clamp(s.p1.x, W / 2 - 60, W - PADDLE_R - 50);
      s.p1.y = clamp(s.p1.y, PADDLE_R, H - PADDLE_R);
      s.p2.x = clamp(s.p2.x, PADDLE_R + 50, W / 2 + 60);
      s.p2.y = clamp(s.p2.y, PADDLE_R, H - PADDLE_R);
      s.p1V = { x: s.p1.x - prevP1.x, y: s.p1.y - prevP1.y };
      s.p2V = { x: s.p2.x - prevP2.x, y: s.p2.y - prevP2.y };

      // 2) Gardiens auto : suivent la position Y de la balle, mais seulement
      //    quand la balle est dans leur moitié de terrain (sinon ils restent
      //    centrés). Vitesse limitée → on peut les contourner avec un bon angle.
      const goalYMin = (H - GOAL_H) / 2 + GK_R;
      const goalYMax = (H + GOAL_H) / 2 - GK_R;
      if (s.ball.x > W / 2) {
        const dy = clamp(s.ball.y - s.gk1.y, -GK_SPEED, GK_SPEED);
        s.gk1.y = clamp(s.gk1.y + dy, goalYMin, goalYMax);
      } else {
        const dy = clamp(H / 2 - s.gk1.y, -GK_SPEED, GK_SPEED);
        s.gk1.y = clamp(s.gk1.y + dy, goalYMin, goalYMax);
      }
      if (s.ball.x < W / 2) {
        const dy = clamp(s.ball.y - s.gk2.y, -GK_SPEED, GK_SPEED);
        s.gk2.y = clamp(s.gk2.y + dy, goalYMin, goalYMax);
      } else {
        const dy = clamp(H / 2 - s.gk2.y, -GK_SPEED, GK_SPEED);
        s.gk2.y = clamp(s.gk2.y + dy, goalYMin, goalYMax);
      }

      // 3) Bouge la balle + trail
      s.trail.push({ x: s.ball.x, y: s.ball.y });
      if (s.trail.length > TRAIL_LEN) s.trail.shift();
      s.ball.x += s.ballV.x;
      s.ball.y += s.ballV.y;
      s.ballV.x *= BALL_FRICTION;
      s.ballV.y *= BALL_FRICTION;
      if (Math.abs(s.ballV.x) < MIN_BALL_SPEED && Math.abs(s.ballV.y) < MIN_BALL_SPEED) {
        s.ballV.x = 0; s.ballV.y = 0;
      }

      // 4) Rebond haut/bas
      if (s.ball.y - BALL_R <= 0 && s.ballV.y < 0) { s.ball.y = BALL_R; s.ballV.y *= -1; }
      if (s.ball.y + BALL_R >= H && s.ballV.y > 0) { s.ball.y = H - BALL_R; s.ballV.y *= -1; }

      // 5) Collision avec les 4 paddles (2 attaquants + 2 gardiens)
      const collisions: Array<[V2, V2, number]> = [
        [s.p1, s.p1V, PADDLE_R],
        [s.p2, s.p2V, PADDLE_R],
        [s.gk1, { x: 0, y: 0 }, GK_R],
        [s.gk2, { x: 0, y: 0 }, GK_R],
      ];
      for (const [pad, padV, r] of collisions) {
        const dx = s.ball.x - pad.x;
        const dy = s.ball.y - pad.y;
        const dist = Math.hypot(dx, dy);
        if (dist > 0 && dist < BALL_R + r) {
          const nx = dx / dist, ny = dy / dist;
          // Push la balle hors du paddle
          s.ball.x = pad.x + nx * (BALL_R + r);
          s.ball.y = pad.y + ny * (BALL_R + r);
          // Reflète vélocité + transfert d'énergie du paddle (mécanique boost)
          const dot = s.ballV.x * nx + s.ballV.y * ny;
          s.ballV.x = (s.ballV.x - 2 * dot * nx) + padV.x * 0.85;
          s.ballV.y = (s.ballV.y - 2 * dot * ny) + padV.y * 0.85;
          const sp = Math.hypot(s.ballV.x, s.ballV.y);
          if (sp < 4) { const k = 4 / Math.max(sp, 0.001); s.ballV.x *= k; s.ballV.y *= k; }
          // Plafond pour éviter les bugs de tunneling
          const maxSp = 18;
          if (sp > maxSp) { const k = maxSp / sp; s.ballV.x *= k; s.ballV.y *= k; }
        }
      }

      // 6) But ? — J1 défend le but de droite, J2 le but de gauche.
      const inGoalY = s.ball.y >= (H - GOAL_H) / 2 && s.ball.y <= (H + GOAL_H) / 2;
      if (s.ball.x - BALL_R <= 0) {
        if (inGoalY) {
          setScore((sc) => {
            const next = { ...sc, p1: sc.p1 + 1 };
            if (next.p1 >= WIN_GOALS) { setPhase('done'); setTimeout(() => onFinish(next.p1, next.p2), 700); }
            return next;
          });
          resetBall(s, 1);
        } else { s.ball.x = BALL_R; s.ballV.x *= -1; }
      }
      if (s.ball.x + BALL_R >= W) {
        if (inGoalY) {
          setScore((sc) => {
            const next = { ...sc, p2: sc.p2 + 1 };
            if (next.p2 >= WIN_GOALS) { setPhase('done'); setTimeout(() => onFinish(next.p1, next.p2), 700); }
            return next;
          });
          resetBall(s, -1);
        } else { s.ball.x = W - BALL_R; s.ballV.x *= -1; }
      }

      // 7) Dessin
      const c = canvasRef.current;
      if (c) {
        const ctx = c.getContext('2d');
        if (ctx) draw(ctx, s, avatar1Ref.current, avatar2Ref.current, player1?.pseudo, player2?.pseudo);
      }
    }, TICK_MS);
    return () => clearInterval(interval);
  }, [phase, onFinish, player1?.pseudo, player2?.pseudo]);

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
          <div style={{ color: 'var(--muted)', fontSize: 13, textAlign: 'center', lineHeight: 1.6 }}>
            🔵 J2 (gauche) : ZQSD &nbsp;·&nbsp; 🔴 J1 (droite) : flèches<br />
            Maintiens <strong>Shift</strong> pour booster ton palet et tirer fort.<br />
            Chacun a un gardien automatique qui couvre son but.<br />
            Premier à {WIN_GOALS} buts gagne.
          </div>
        </>
      )}
      {phase === 'running' && (
        <div style={{ color: 'var(--muted)', fontSize: 13 }}>
          Shift = boost de tir &nbsp;·&nbsp; Premier à {WIN_GOALS} buts.
        </div>
      )}
      {phase === 'done' && <div style={{ color: 'var(--muted)' }}>Match terminé. Score envoyé…</div>}
    </div>
  );
}

function resetBall(s: State, dir: 1 | -1) {
  s.ball = { x: W / 2, y: H / 2 };
  s.ballV = randomKick(dir);
  s.trail = [];
}

function randomKick(dir?: 1 | -1): V2 {
  const d = dir ?? (Math.random() < 0.5 ? 1 : -1);
  const angle = (Math.random() - 0.5) * 0.6;
  const sp = 5;
  return { x: d * sp * Math.cos(angle), y: sp * Math.sin(angle) };
}

function clamp(v: number, lo: number, hi: number): number { return Math.max(lo, Math.min(hi, v)); }

function isHandled(key: string): boolean {
  const k = key.toLowerCase();
  return ['arrowup','arrowdown','arrowleft','arrowright','z','q','s','d','w','a','shift'].includes(k);
}

function draw(
  ctx: CanvasRenderingContext2D,
  s: State,
  avatar1: HTMLImageElement | null,
  avatar2: HTMLImageElement | null,
  pseudo1?: string,
  pseudo2?: string,
) {
  // Terrain
  ctx.fillStyle = '#0E3318';
  ctx.fillRect(0, 0, W, H);

  // Ligne médiane + cercle central + lignes des surfaces de réparation
  ctx.strokeStyle = 'rgba(255,255,255,0.25)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(W / 2, 0); ctx.lineTo(W / 2, H);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(W / 2, H / 2, 44, 0, Math.PI * 2);
  ctx.stroke();
  // Surfaces de réparation (rectangles vers chaque but)
  ctx.strokeRect(0, (H - GOAL_H - 40) / 2, 80, GOAL_H + 40);
  ctx.strokeRect(W - 80, (H - GOAL_H - 40) / 2, 80, GOAL_H + 40);

  // Buts (zones d'entrée)
  const goalYMin = (H - GOAL_H) / 2;
  ctx.fillStyle = 'rgba(255,255,255,0.10)';
  ctx.fillRect(0, goalYMin, 6, GOAL_H);
  ctx.fillRect(W - 6, goalYMin, 6, GOAL_H);
  ctx.strokeStyle = 'rgba(255,255,255,0.55)';
  ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(0, goalYMin); ctx.lineTo(0, goalYMin + GOAL_H); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(W, goalYMin); ctx.lineTo(W, goalYMin + GOAL_H); ctx.stroke();

  // Trail de la balle
  for (let i = 0; i < s.trail.length; i++) {
    const t = s.trail[i];
    const alpha = (i + 1) / s.trail.length * 0.4;
    ctx.fillStyle = `rgba(214, 255, 61, ${alpha})`;
    ctx.beginPath();
    ctx.arc(t.x, t.y, BALL_R * (0.4 + (i / s.trail.length) * 0.6), 0, Math.PI * 2);
    ctx.fill();
  }

  // Gardiens (cercles simples avec contour de la couleur de leur équipe)
  drawGoalkeeper(ctx, s.gk1, '#FF6B57');
  drawGoalkeeper(ctx, s.gk2, '#5B8CFF');

  // Attaquants — avatar du joueur clippé sur un cercle, contour coloré
  drawPlayerPaddle(ctx, s.p1, '#FF6B57', avatar1, pseudo1, 'right');
  drawPlayerPaddle(ctx, s.p2, '#5B8CFF', avatar2, pseudo2, 'left');

  // Balle
  ctx.fillStyle = '#D6FF3D';
  ctx.beginPath(); ctx.arc(s.ball.x, s.ball.y, BALL_R, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#7A9B22'; ctx.lineWidth = 2;
  ctx.stroke();
}

function drawGoalkeeper(ctx: CanvasRenderingContext2D, pos: V2, color: string) {
  // Cercle plein avec contour blanc + couleur d'équipe
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  ctx.beginPath(); ctx.arc(pos.x, pos.y, GK_R, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = color; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.arc(pos.x, pos.y, GK_R, 0, Math.PI * 2); ctx.stroke();
  // Petit symbole gardien
  ctx.fillStyle = color;
  ctx.font = `${GK_R * 1.1}px serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('🧤', pos.x, pos.y + 1);
}

function drawPlayerPaddle(
  ctx: CanvasRenderingContext2D,
  pos: V2,
  color: string,
  avatar: HTMLImageElement | null,
  pseudo: string | undefined,
  pseudoSide: 'left' | 'right',
) {
  // Avatar clipé en cercle (si dispo), sinon cercle plein de la couleur avec initiale
  ctx.save();
  ctx.beginPath();
  ctx.arc(pos.x, pos.y, PADDLE_R, 0, Math.PI * 2);
  ctx.clip();
  if (avatar) {
    ctx.drawImage(avatar, pos.x - PADDLE_R, pos.y - PADDLE_R, PADDLE_R * 2, PADDLE_R * 2);
  } else {
    ctx.fillStyle = color;
    ctx.fillRect(pos.x - PADDLE_R, pos.y - PADDLE_R, PADDLE_R * 2, PADDLE_R * 2);
    if (pseudo) {
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.font = `bold ${PADDLE_R}px sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(pseudo[0]?.toUpperCase() ?? '?', pos.x, pos.y + 1);
    }
  }
  ctx.restore();
  // Contour coloré
  ctx.strokeStyle = color; ctx.lineWidth = 4;
  ctx.beginPath(); ctx.arc(pos.x, pos.y, PADDLE_R, 0, Math.PI * 2); ctx.stroke();
  // Pseudo affiché à côté
  if (pseudo) {
    ctx.fillStyle = color;
    ctx.font = `bold 13px var(--font-body, sans-serif)`;
    ctx.textAlign = pseudoSide === 'right' ? 'left' : 'right';
    ctx.textBaseline = 'middle';
    ctx.fillText(pseudo, pos.x + (pseudoSide === 'right' ? PADDLE_R + 8 : -PADDLE_R - 8), pos.y);
  }
}
