import { useEffect, useRef, useState } from 'react';
import type { GameModule, GameProps } from './GameModule';

// Snake 1v1 sur un même écran/clavier.
// Joueur 1 (rouge) : flèches ↑↓←→. Joueur 2 (bleu) : ZQSD ou WASD.
// On meurt en touchant : un mur, son propre corps, ou le corps de l'autre.
// Score d'un joueur = longueur de son serpent quand la partie s'arrête.

const COLS = 28;
const ROWS = 20;
const CELL = 22;     // px par cellule
const TICK_MS = 110;
const START_LEN = 4;

type Pt = { x: number; y: number };
type Dir = Pt;

const RIGHT: Dir = { x: 1, y: 0 };
const LEFT: Dir  = { x: -1, y: 0 };
const UP: Dir    = { x: 0, y: -1 };
const DOWN: Dir  = { x: 0, y: 1 };

interface Snake { body: Pt[]; dir: Dir; nextDir: Dir; alive: boolean; }

function initSnakes(): { p1: Snake; p2: Snake } {
  const midY = Math.floor(ROWS / 2);
  const p1Body: Pt[] = Array.from({ length: START_LEN }, (_, i) => ({ x: 4 - i, y: midY }));
  const p2Body: Pt[] = Array.from({ length: START_LEN }, (_, i) => ({ x: COLS - 5 + i, y: midY }));
  return {
    p1: { body: p1Body, dir: RIGHT, nextDir: RIGHT, alive: true },
    p2: { body: p2Body, dir: LEFT, nextDir: LEFT, alive: true },
  };
}

function randomFood(occupied: Set<string>): Pt {
  for (let i = 0; i < 200; i++) {
    const p = { x: Math.floor(Math.random() * COLS), y: Math.floor(Math.random() * ROWS) };
    if (!occupied.has(`${p.x},${p.y}`)) return p;
  }
  return { x: 0, y: 0 };
}

function isOpposite(a: Dir, b: Dir): boolean {
  return a.x === -b.x && a.y === -b.y;
}

export const SnakeGame: GameModule = {
  id: 'snake',
  apiId: 'snake',
  name: 'Snake 1v1',
  description: '1v1 sur un même clavier. Joueur 1 = flèches, Joueur 2 = ZQSD/WASD. Premier mort perd.',
  Component: SnakeComponent,
};

function SnakeComponent({ onFinish }: GameProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [phase, setPhase] = useState<'ready' | 'running' | 'done'>('ready');
  const stateRef = useRef<{ p1: Snake; p2: Snake; food: Pt }>({ ...initSnakes(), food: { x: 14, y: 10 } });
  const [tick, setTick] = useState(0); // déclenche un re-render pour refléter scores

  // Démarrer
  const start = () => {
    stateRef.current = { ...initSnakes(), food: { x: 14, y: 10 } };
    setPhase('running');
    setTick(0);
  };

  // Saisie clavier
  useEffect(() => {
    if (phase !== 'running') return;
    const onKey = (e: KeyboardEvent) => {
      const s = stateRef.current;
      const k = e.key.toLowerCase();
      // Joueur 1 — flèches
      if (k === 'arrowup' && !isOpposite(s.p1.dir, UP)) s.p1.nextDir = UP;
      else if (k === 'arrowdown' && !isOpposite(s.p1.dir, DOWN)) s.p1.nextDir = DOWN;
      else if (k === 'arrowleft' && !isOpposite(s.p1.dir, LEFT)) s.p1.nextDir = LEFT;
      else if (k === 'arrowright' && !isOpposite(s.p1.dir, RIGHT)) s.p1.nextDir = RIGHT;
      // Joueur 2 — ZQSD (FR) ou WASD (US)
      else if ((k === 'z' || k === 'w') && !isOpposite(s.p2.dir, UP)) s.p2.nextDir = UP;
      else if (k === 's' && !isOpposite(s.p2.dir, DOWN)) s.p2.nextDir = DOWN;
      else if ((k === 'q' || k === 'a') && !isOpposite(s.p2.dir, LEFT)) s.p2.nextDir = LEFT;
      else if (k === 'd' && !isOpposite(s.p2.dir, RIGHT)) s.p2.nextDir = RIGHT;
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [phase]);

  // Boucle de jeu
  useEffect(() => {
    if (phase !== 'running') return;
    const interval = window.setInterval(() => {
      const s = stateRef.current;
      stepSnakes(s);
      setTick((t) => t + 1);
      if (!s.p1.alive || !s.p2.alive) {
        clearInterval(interval);
        setPhase('done');
        // Score = longueur. En cas d'égalité de mort (les deux la même frame),
        // la longueur tranche.
        const sc1 = s.p1.body.length;
        const sc2 = s.p2.body.length;
        // Petit délai pour laisser voir la dernière frame
        setTimeout(() => onFinish(sc1, sc2), 600);
      }
    }, TICK_MS);
    return () => clearInterval(interval);
  }, [phase, onFinish]);

  // Dessin
  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    draw(ctx, stateRef.current);
  }, [tick, phase]);

  const score = { p1: stateRef.current.p1.body.length, p2: stateRef.current.p2.body.length };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
      <div style={{ display: 'flex', gap: 24, fontFamily: 'var(--font-display)', fontWeight: 700 }}>
        <span style={{ color: '#FF6B57', fontSize: 22 }}>🔴 J1 — {score.p1}</span>
        <span style={{ color: '#5B8CFF', fontSize: 22 }}>🔵 J2 — {score.p2}</span>
      </div>
      <canvas
        ref={canvasRef}
        width={COLS * CELL}
        height={ROWS * CELL}
        style={{ background: '#0B0D10', borderRadius: 14, border: '1px solid var(--line)', maxWidth: '100%', height: 'auto' }}
      />
      {phase === 'ready' && (
        <button className="btn btn-accent btn-lg" onClick={start}>Démarrer</button>
      )}
      {phase === 'running' && (
        <div style={{ color: 'var(--muted)', fontSize: 13, textAlign: 'center' }}>
          🔴 Joueur 1 : flèches du clavier &nbsp;·&nbsp; 🔵 Joueur 2 : ZQSD ou WASD<br />
          Premier qui meurt perd. Manger une pomme allonge le serpent.
        </div>
      )}
      {phase === 'done' && (
        <div style={{ color: 'var(--muted)' }}>Partie terminée. Score envoyé…</div>
      )}
    </div>
  );
}

function stepSnakes(s: { p1: Snake; p2: Snake; food: Pt }) {
  for (const snake of [s.p1, s.p2]) {
    if (!snake.alive) continue;
    snake.dir = snake.nextDir;
    const head = snake.body[0];
    const next: Pt = { x: head.x + snake.dir.x, y: head.y + snake.dir.y };
    // Mur ?
    if (next.x < 0 || next.x >= COLS || next.y < 0 || next.y >= ROWS) {
      snake.alive = false;
      continue;
    }
    snake.body.unshift(next);
    // Mange ?
    const ateFood = next.x === s.food.x && next.y === s.food.y;
    if (!ateFood) snake.body.pop();
  }
  // Une fois les deux têtes avancées, on check les collisions (sur soi ou sur l'autre)
  const occupied = new Set<string>();
  for (const p of s.p1.body) occupied.add(`${p.x},${p.y}`);
  for (const p of s.p2.body) occupied.add(`${p.x},${p.y}`);
  for (const snake of [s.p1, s.p2]) {
    if (!snake.alive) continue;
    const head = snake.body[0];
    // Compte les occurrences de la tête dans toutes les cellules occupées
    let n = 0;
    for (const p of s.p1.body) if (p.x === head.x && p.y === head.y) n++;
    for (const p of s.p2.body) if (p.x === head.x && p.y === head.y) n++;
    if (n > 1) snake.alive = false;
  }
  // Reposition la pomme si elle a été mangée
  if (s.p1.body[0].x === s.food.x && s.p1.body[0].y === s.food.y
      || s.p2.body[0].x === s.food.x && s.p2.body[0].y === s.food.y) {
    s.food = randomFood(occupied);
  }
}

function draw(ctx: CanvasRenderingContext2D, s: { p1: Snake; p2: Snake; food: Pt }) {
  const W = COLS * CELL, H = ROWS * CELL;
  // Fond + grille discrète
  ctx.fillStyle = '#0B0D10';
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = 'rgba(255,255,255,0.04)';
  ctx.lineWidth = 1;
  for (let x = 0; x <= COLS; x++) { ctx.beginPath(); ctx.moveTo(x * CELL + 0.5, 0); ctx.lineTo(x * CELL + 0.5, H); ctx.stroke(); }
  for (let y = 0; y <= ROWS; y++) { ctx.beginPath(); ctx.moveTo(0, y * CELL + 0.5); ctx.lineTo(W, y * CELL + 0.5); ctx.stroke(); }

  // Pomme
  ctx.fillStyle = '#D6FF3D';
  drawRoundRect(ctx, s.food.x * CELL + 3, s.food.y * CELL + 3, CELL - 6, CELL - 6, 6);

  // Serpents
  drawSnake(ctx, s.p1, '#FF6B57', '#C2331F');
  drawSnake(ctx, s.p2, '#5B8CFF', '#2E4FCC');
}

function drawSnake(ctx: CanvasRenderingContext2D, snake: Snake, body: string, head: string) {
  for (let i = snake.body.length - 1; i >= 0; i--) {
    const p = snake.body[i];
    ctx.fillStyle = i === 0 ? head : body;
    drawRoundRect(ctx, p.x * CELL + 2, p.y * CELL + 2, CELL - 4, CELL - 4, 5);
  }
  if (!snake.alive) {
    const head = snake.body[0];
    ctx.fillStyle = 'rgba(255,255,255,0.3)';
    ctx.font = `${CELL * 0.8}px serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('💀', head.x * CELL + CELL / 2, head.y * CELL + CELL / 2);
  }
}

function drawRoundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.fill();
}
