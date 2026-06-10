import { useEffect, useRef, useState } from 'react';
import type { GameModule, GameProps } from './GameModule';

// Billard 1v1 simplifié : 1 boule blanche + 8 colorées. Drag depuis la table
// pour viser (direction = de la blanche vers ton pointeur, puissance = distance
// du drag). Release pour tirer. Tour suivant après chaque coup SAUF si tu
// pochettes une boule colorée (rejoue). Boule blanche pochée = pas de pénalité,
// elle respawn à son point de départ. Fin de partie : quand toutes les boules
// colorées sont pochées. Vainqueur = plus haut score (4-4 possible = nul).

const W = 720;
const H = 380;
const BALL_R = 12;
const POCKET_R = 18;
const CUSHION = 14;
const FRICTION = 0.987;
const MIN_SPEED = 0.05;
const POWER_SCALE = 1 / 7;   // distance pixels → vitesse boule
const MAX_POWER = 22;
const TOTAL_BALLS = 8;
const TICK_MS = 16;
const CUE_START: V2 = { x: 175, y: H / 2 };

interface V2 { x: number; y: number }
interface Ball {
  id: number; // 0 = cue, 1-8 = colored
  pos: V2;
  vel: V2;
  color: string;
  ringColor: string;
  alive: boolean;
}

// Couleurs façon pool : solid 1-8 (jaune, bleu, rouge, violet, orange, vert, bordeaux, noir)
const BALL_COLORS = [
  '#FFFFFF',                          // 0 cue
  '#FFD400', '#0050C8', '#D32030',    // 1 2 3
  '#7B2B8E', '#FF7A1F', '#0F8A3E',    // 4 5 6
  '#7A1B1B', '#0E0E12',               // 7 8
];
const BALL_RING_COLORS = [
  '#cdcdcd',
  '#a88800', '#003088', '#871424', '#4d1959', '#a04612', '#0a5b29', '#491010', '#000',
];

function initBalls(): Ball[] {
  const cue: Ball = {
    id: 0, pos: { ...CUE_START }, vel: { x: 0, y: 0 },
    color: BALL_COLORS[0], ringColor: BALL_RING_COLORS[0], alive: true,
  };
  // Triangle compact à droite : rangs de 1, 2, 3, 2 = 8 boules
  const startX = 470;
  const startY = H / 2;
  const rowSpacing = BALL_R * 1.85;
  const colSpacing = BALL_R * 2.05;
  const balls: Ball[] = [cue];
  let id = 1;
  const layout: Array<{ row: number; col: number }> = [];
  // Row 0: 1 ball
  // Row 1: 2 balls
  // Row 2: 3 balls
  // Row 3: 2 balls
  for (let i = 0; i < 1; i++) layout.push({ row: 0, col: 0 });
  for (let i = 0; i < 2; i++) layout.push({ row: 1, col: i });
  for (let i = 0; i < 3; i++) layout.push({ row: 2, col: i });
  for (let i = 0; i < 2; i++) layout.push({ row: 3, col: i });
  // On positionne en triangle : la rangée row a (row+1 ou row-1) cases centrées
  const rowCounts = [1, 2, 3, 2];
  layout.forEach((slot) => {
    const count = rowCounts[slot.row];
    const x = startX + slot.row * rowSpacing;
    const y = startY + (slot.col - (count - 1) / 2) * colSpacing;
    balls.push({
      id, pos: { x, y }, vel: { x: 0, y: 0 },
      color: BALL_COLORS[id], ringColor: BALL_RING_COLORS[id], alive: true,
    });
    id++;
  });
  return balls;
}

const POCKETS: V2[] = [
  { x: CUSHION,         y: CUSHION         },
  { x: W / 2,           y: CUSHION - 2     },
  { x: W - CUSHION,     y: CUSHION         },
  { x: CUSHION,         y: H - CUSHION     },
  { x: W / 2,           y: H - CUSHION + 2 },
  { x: W - CUSHION,     y: H - CUSHION     },
];

export const BilliardsGame: GameModule = {
  id: 'billiards',
  apiId: 'billiards',
  name: 'Billard',
  description: '1v1 pool. Drag pour viser, release pour tirer. Pochete plus que ton adversaire.',
  Component: BilliardsComponent,
};

function BilliardsComponent({ onFinish }: GameProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const stateRef = useRef<{ balls: Ball[]; aim: V2 | null }>({ balls: initBalls(), aim: null });
  const [phase, setPhase] = useState<'aim' | 'shooting' | 'done'>('aim');
  const [currentPlayer, setCurrentPlayer] = useState<1 | 2>(1);
  const [scores, setScores] = useState({ p1: 0, p2: 0 });
  // Compte les boules alive avant chaque coup pour savoir combien ont été potées
  const aliveBeforeShotRef = useRef(0);

  // Coord canvas → SVG/viewport
  function pointFromEvent(e: React.PointerEvent<HTMLCanvasElement>): V2 {
    const c = canvasRef.current;
    if (!c) return { x: 0, y: 0 };
    const rect = c.getBoundingClientRect();
    const x = (e.clientX - rect.left) * (W / rect.width);
    const y = (e.clientY - rect.top)  * (H / rect.height);
    return { x, y };
  }

  function onPointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    if (phase !== 'aim') return;
    const cue = stateRef.current.balls[0];
    if (!cue.alive) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    stateRef.current.aim = pointFromEvent(e);
  }
  function onPointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (phase !== 'aim' || !stateRef.current.aim) return;
    stateRef.current.aim = pointFromEvent(e);
    redraw();
  }
  function onPointerUp(e: React.PointerEvent<HTMLCanvasElement>) {
    if (phase !== 'aim' || !stateRef.current.aim) return;
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* déjà relâché */ }
    const cue = stateRef.current.balls[0];
    const aim = stateRef.current.aim;
    const dx = aim.x - cue.pos.x;
    const dy = aim.y - cue.pos.y;
    const dist = Math.hypot(dx, dy);
    stateRef.current.aim = null;
    if (dist < 12) {
      // Trop court → on annule, pas de tir
      redraw();
      return;
    }
    const power = Math.min(MAX_POWER, dist * POWER_SCALE);
    const k = power / dist;
    cue.vel.x = dx * k;
    cue.vel.y = dy * k;
    aliveBeforeShotRef.current = stateRef.current.balls.filter((b) => b.id !== 0 && b.alive).length;
    setPhase('shooting');
  }

  function redraw() {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    draw(ctx, stateRef.current.balls, stateRef.current.aim, phase, currentPlayer);
  }

  // Boucle physique
  useEffect(() => {
    if (phase !== 'shooting') return;
    const interval = window.setInterval(() => {
      const s = stateRef.current;
      stepBalls(s.balls);
      redraw();

      // Toutes les boules sont arrêtées ?
      const stopped = s.balls.every((b) => !b.alive || (Math.abs(b.vel.x) < 0.001 && Math.abs(b.vel.y) < 0.001));
      if (!stopped) return;
      clearInterval(interval);

      // Compte les boules potées sur ce coup
      const aliveAfter = s.balls.filter((b) => b.id !== 0 && b.alive).length;
      const potted = aliveBeforeShotRef.current - aliveAfter;
      const myKey = currentPlayer === 1 ? 'p1' : 'p2';

      // Cue ball potée ? Respawn (pas de pénalité de score).
      const cue = s.balls[0];
      if (!cue.alive) {
        cue.alive = true;
        cue.pos = { ...CUE_START };
        cue.vel = { x: 0, y: 0 };
      }

      // Met à jour les scores
      let nextScores = scores;
      if (potted > 0) {
        nextScores = { ...scores, [myKey]: scores[myKey] + potted };
        setScores(nextScores);
      }

      // Fin de partie : toutes les colorées potées
      if (aliveAfter === 0) {
        setPhase('done');
        setTimeout(() => onFinish(nextScores.p1, nextScores.p2), 800);
        return;
      }

      // Changement de tour si rien poté, sinon rejoue
      if (potted === 0) {
        setCurrentPlayer((p) => (p === 1 ? 2 : 1));
      }
      setPhase('aim');
      redraw();
    }, TICK_MS);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, currentPlayer, scores]);

  // Premier rendu
  useEffect(() => { redraw(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const turnColor = currentPlayer === 1 ? '#FF6B57' : '#5B8CFF';
  const turnLabel = currentPlayer === 1 ? '🔴 Joueur 1' : '🔵 Joueur 2';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
      {/* Score */}
      <div style={{ display: 'flex', gap: 60, fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 30 }}>
        <span style={{ color: '#FF6B57' }}>🔴 {scores.p1}</span>
        <span style={{ color: '#5B8CFF' }}>🔵 {scores.p2}</span>
      </div>
      {phase !== 'done' && (
        <div style={{ color: turnColor, fontWeight: 700, fontSize: 14 }}>
          Au tour de {turnLabel} {phase === 'shooting' && '· en attente…'}
        </div>
      )}
      {phase === 'done' && (
        <div style={{ color: 'var(--win)', fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 22 }}>
          Terminé ! Score envoyé…
        </div>
      )}
      <canvas
        ref={canvasRef}
        width={W}
        height={H}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        style={{
          borderRadius: 14,
          maxWidth: '100%', height: 'auto',
          cursor: phase === 'aim' ? 'crosshair' : 'wait',
          touchAction: 'none',
          userSelect: 'none',
        }}
      />
      <div style={{ color: 'var(--muted)', fontSize: 12.5, textAlign: 'center', maxWidth: 480, lineHeight: 1.5 }}>
        <strong>Drag depuis n'importe où</strong> vers la direction que tu veux donner à la blanche.
        Plus tu tires loin, plus le tir est fort.<br />
        Pochete une boule = tu rejoues. Ratée = au tour de l'autre. Blanche dans le trou = respawn.
      </div>
    </div>
  );
}

// ── Physique ──────────────────────────────────────────────────────────────
function stepBalls(balls: Ball[]) {
  for (const b of balls) {
    if (!b.alive) continue;
    b.pos.x += b.vel.x;
    b.pos.y += b.vel.y;
    b.vel.x *= FRICTION;
    b.vel.y *= FRICTION;
    if (Math.abs(b.vel.x) < MIN_SPEED) b.vel.x = 0;
    if (Math.abs(b.vel.y) < MIN_SPEED) b.vel.y = 0;
    // Cushions (avec un léger amortissement)
    if (b.pos.x - BALL_R <= CUSHION && b.vel.x < 0)  { b.pos.x = CUSHION + BALL_R;     b.vel.x *= -0.82; }
    if (b.pos.x + BALL_R >= W - CUSHION && b.vel.x > 0) { b.pos.x = W - CUSHION - BALL_R; b.vel.x *= -0.82; }
    if (b.pos.y - BALL_R <= CUSHION && b.vel.y < 0)  { b.pos.y = CUSHION + BALL_R;     b.vel.y *= -0.82; }
    if (b.pos.y + BALL_R >= H - CUSHION && b.vel.y > 0) { b.pos.y = H - CUSHION - BALL_R; b.vel.y *= -0.82; }
  }
  // Pochettes
  for (const b of balls) {
    if (!b.alive) continue;
    for (const p of POCKETS) {
      if (Math.hypot(b.pos.x - p.x, b.pos.y - p.y) < POCKET_R) {
        b.alive = false;
        b.vel.x = 0; b.vel.y = 0;
        break;
      }
    }
  }
  // Collisions inter-boules : élastique, masses égales
  for (let i = 0; i < balls.length; i++) {
    const a = balls[i];
    if (!a.alive) continue;
    for (let j = i + 1; j < balls.length; j++) {
      const b = balls[j];
      if (!b.alive) continue;
      const dx = b.pos.x - a.pos.x;
      const dy = b.pos.y - a.pos.y;
      const dist = Math.hypot(dx, dy);
      const minDist = BALL_R * 2;
      if (dist > 0 && dist < minDist) {
        // Sépare les deux boules pour éviter le sticking
        const overlap = (minDist - dist) / 2;
        const nx = dx / dist, ny = dy / dist;
        a.pos.x -= nx * overlap;
        a.pos.y -= ny * overlap;
        b.pos.x += nx * overlap;
        b.pos.y += ny * overlap;
        // Échange élastique : composante perpendiculaire à la normale conservée,
        // composante parallèle échangée.
        const dvx = b.vel.x - a.vel.x;
        const dvy = b.vel.y - a.vel.y;
        const dot = dvx * nx + dvy * ny;
        if (dot < 0) {
          a.vel.x += dot * nx;
          a.vel.y += dot * ny;
          b.vel.x -= dot * nx;
          b.vel.y -= dot * ny;
        }
      }
    }
  }
}

// ── Dessin ────────────────────────────────────────────────────────────────
function draw(
  ctx: CanvasRenderingContext2D, balls: Ball[], aim: V2 | null,
  phase: 'aim' | 'shooting' | 'done', currentPlayer: 1 | 2,
) {
  // Table verte avec dégradé subtil
  const grad = ctx.createRadialGradient(W / 2, H / 2, 50, W / 2, H / 2, Math.max(W, H));
  grad.addColorStop(0, '#0E693A');
  grad.addColorStop(1, '#08471F');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);

  // Cushions (bandes brunes)
  ctx.fillStyle = '#5B3A1F';
  ctx.fillRect(0, 0, W, CUSHION);
  ctx.fillRect(0, H - CUSHION, W, CUSHION);
  ctx.fillRect(0, 0, CUSHION, H);
  ctx.fillRect(W - CUSHION, 0, CUSHION, H);

  // Pockets
  for (const p of POCKETS) {
    ctx.fillStyle = '#000';
    ctx.beginPath(); ctx.arc(p.x, p.y, POCKET_R, 0, Math.PI * 2); ctx.fill();
  }

  // D-zone d'origine de la blanche (petite ligne)
  ctx.strokeStyle = 'rgba(255,255,255,0.15)';
  ctx.lineWidth = 1.5;
  ctx.setLineDash([6, 6]);
  ctx.beginPath();
  ctx.moveTo(CUE_START.x, CUSHION + 4);
  ctx.lineTo(CUE_START.x, H - CUSHION - 4);
  ctx.stroke();
  ctx.setLineDash([]);

  // Boules
  for (const b of balls) {
    if (!b.alive) continue;
    // Ombre
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath(); ctx.arc(b.pos.x + 2, b.pos.y + 3, BALL_R, 0, Math.PI * 2); ctx.fill();
    // Boule
    ctx.fillStyle = b.color;
    ctx.beginPath(); ctx.arc(b.pos.x, b.pos.y, BALL_R, 0, Math.PI * 2); ctx.fill();
    // Highlight (effet 3D minimal)
    const hg = ctx.createRadialGradient(b.pos.x - 4, b.pos.y - 5, 1, b.pos.x, b.pos.y, BALL_R);
    hg.addColorStop(0, 'rgba(255,255,255,0.55)');
    hg.addColorStop(0.5, 'rgba(255,255,255,0)');
    hg.addColorStop(1, 'rgba(0,0,0,0.25)');
    ctx.fillStyle = hg;
    ctx.beginPath(); ctx.arc(b.pos.x, b.pos.y, BALL_R, 0, Math.PI * 2); ctx.fill();
    // Numéro pour les colorées (sauf la noire qui est numérotée 8 en blanc)
    if (b.id > 0) {
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(b.pos.x, b.pos.y, BALL_R * 0.42, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#000';
      ctx.font = `bold ${Math.round(BALL_R * 0.85)}px sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(String(b.id), b.pos.x, b.pos.y + 1);
    }
  }

  // Aim line + power indicator
  if (phase === 'aim' && aim) {
    const cue = balls[0];
    if (!cue.alive) return;
    const dx = aim.x - cue.pos.x;
    const dy = aim.y - cue.pos.y;
    const dist = Math.hypot(dx, dy);
    if (dist > 6) {
      const ux = dx / dist, uy = dy / dist;
      // Ligne de visée pointillée (s'étire vers l'avant pour montrer la trajectoire)
      ctx.strokeStyle = 'rgba(255,255,255,0.55)';
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      ctx.moveTo(cue.pos.x + ux * BALL_R, cue.pos.y + uy * BALL_R);
      ctx.lineTo(cue.pos.x + ux * 220, cue.pos.y + uy * 220);
      ctx.stroke();
      ctx.setLineDash([]);

      // Cue stick : ligne épaisse derrière la blanche, proportionnelle à la puissance
      const power = Math.min(MAX_POWER, dist * POWER_SCALE);
      const powerT = power / MAX_POWER;
      const stickLen = 100 + powerT * 80;
      ctx.strokeStyle = `rgb(${165 + powerT * 90}, ${110 - powerT * 90}, ${30})`;
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(cue.pos.x - ux * (BALL_R + 4), cue.pos.y - uy * (BALL_R + 4));
      ctx.lineTo(cue.pos.x - ux * (BALL_R + 4 + stickLen), cue.pos.y - uy * (BALL_R + 4 + stickLen));
      ctx.stroke();
      // Embout de la queue (noir)
      ctx.strokeStyle = '#222';
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(cue.pos.x - ux * (BALL_R + 4 + stickLen), cue.pos.y - uy * (BALL_R + 4 + stickLen));
      ctx.lineTo(cue.pos.x - ux * (BALL_R + 4 + stickLen + 16), cue.pos.y - uy * (BALL_R + 4 + stickLen + 16));
      ctx.stroke();

      // Barre de puissance en bas
      const barW = 180, barH = 8;
      const barX = (W - barW) / 2, barY = H - CUSHION - 14;
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.fillRect(barX, barY, barW, barH);
      const powerColor = powerT < 0.5
        ? `rgb(${Math.round(60 + powerT * 300)}, ${Math.round(200 + powerT * 100)}, 60)`
        : `rgb(${Math.round(210 + powerT * 45)}, ${Math.round(250 - powerT * 200)}, 30)`;
      ctx.fillStyle = powerColor;
      ctx.fillRect(barX, barY, barW * powerT, barH);
      ctx.strokeStyle = 'rgba(255,255,255,0.4)';
      ctx.lineWidth = 1;
      ctx.strokeRect(barX, barY, barW, barH);
    }
  }

  // Indicateur joueur actif (petit cadre coloré en haut à gauche)
  ctx.fillStyle = currentPlayer === 1 ? 'rgba(255, 107, 87, 0.85)' : 'rgba(91, 140, 255, 0.85)';
  ctx.fillRect(CUSHION + 8, CUSHION + 8, 8, 8);
}
