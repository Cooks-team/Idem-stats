import { useEffect, useRef, useState } from 'react';
import type { GameModule, GameProps } from './GameModule';

// Snake local multi-joueurs : 2 ou 4 sur le même écran/clavier.
// Schéma de contrôle :
//   J1 (rouge)  : flèches ↑↓←→
//   J2 (bleu)   : ZQSD (FR) / WASD (US)
//   J3 (vert)   : IJKL          [mode 4 joueurs uniquement]
//   J4 (jaune)  : TFGH          [mode 4 joueurs uniquement]
// Tu meurs en touchant : un mur, ton propre corps, le corps d'un autre.
// Dernier survivant gagne. Quand il ne reste qu'un joueur en vie, la partie s'arrête.
// Score remonté à l'API : longueur P1, longueur P2 (les J3/J4 sont locaux, on
// remonte le résultat 1v1 du match record qui est lui-même 2-player).

const COLS = 28;
const ROWS = 20;
const CELL = 22;
const TICK_MS = 110;
const START_LEN = 4;

type Pt = { x: number; y: number };
type Dir = Pt;

const RIGHT: Dir = { x: 1, y: 0 };
const LEFT: Dir  = { x: -1, y: 0 };
const UP: Dir    = { x: 0, y: -1 };
const DOWN: Dir  = { x: 0, y: 1 };

type PlayerId = 0 | 1 | 2 | 3;

interface Snake {
  id: PlayerId;
  body: Pt[];
  dir: Dir;
  nextDir: Dir;
  alive: boolean;
}

// Couleurs : { fill, head, label, controlsHint }
const SKINS = [
  { fill: '#FF6B57', head: '#C2331F', label: '🔴 J1', emoji: '🔴', controls: 'flèches ↑↓←→' },
  { fill: '#5B8CFF', head: '#2E4FCC', label: '🔵 J2', emoji: '🔵', controls: 'ZQSD / WASD' },
  { fill: '#3DD68C', head: '#1B8C53', label: '🟢 J3', emoji: '🟢', controls: 'IJKL' },
  { fill: '#F5C542', head: '#B88A12', label: '🟡 J4', emoji: '🟡', controls: 'TFGH' },
] as const;

// Position de départ + direction initiale pour chaque joueur, choisies pour qu'ils
// se font face en 2P et qu'ils partent des 4 coins en 4P.
function initSnakes(count: 2 | 4): Snake[] {
  const midY = Math.floor(ROWS / 2);
  if (count === 2) {
    return [
      makeSnake(0, 4, midY, RIGHT),                       // J1 part en haut-gauche-ish, va à droite
      makeSnake(1, COLS - 5, midY, LEFT),                 // J2 part en haut-droite-ish, va à gauche
    ];
  }
  // 4 joueurs : un par coin, tous tournés vers l'intérieur
  return [
    makeSnake(0, 4,            3,            RIGHT), // J1 haut-gauche → droite
    makeSnake(1, COLS - 5,     3,            LEFT),  // J2 haut-droit  → gauche
    makeSnake(2, COLS - 5,     ROWS - 4,     LEFT),  // J3 bas-droit   → gauche
    makeSnake(3, 4,            ROWS - 4,     RIGHT), // J4 bas-gauche  → droite
  ];
}

function makeSnake(id: PlayerId, headX: number, headY: number, dir: Dir): Snake {
  // Le corps part de la tête vers l'arrière (selon -dir)
  const body: Pt[] = [];
  for (let i = 0; i < START_LEN; i++) {
    body.push({ x: headX - i * dir.x, y: headY - i * dir.y });
  }
  return { id, body, dir, nextDir: dir, alive: true };
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
  name: 'Snake 1v1 / 1v1v1v1',
  description: '2 ou 4 joueurs sur un même clavier. Dernier survivant gagne.',
  Component: SnakeComponent,
};

function SnakeComponent({ onFinish }: GameProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [phase, setPhase] = useState<'ready' | 'running' | 'done'>('ready');
  const [playerCount, setPlayerCount] = useState<2 | 4>(2);
  const stateRef = useRef<{ snakes: Snake[]; food: Pt }>({ snakes: initSnakes(2), food: { x: 14, y: 10 } });
  const [tick, setTick] = useState(0);

  const start = () => {
    stateRef.current = { snakes: initSnakes(playerCount), food: { x: 14, y: 10 } };
    setPhase('running');
    setTick(0);
  };

  // Saisie clavier — multiplexe sur les 2 ou 4 snakes selon le mode actuel
  useEffect(() => {
    if (phase !== 'running') return;
    const onKey = (e: KeyboardEvent) => {
      const snakes = stateRef.current.snakes;
      const k = e.key.toLowerCase();
      const handled = applyKey(k, snakes);
      if (handled) e.preventDefault();
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
      // Fin de partie : un seul ou zéro survivant
      const aliveCount = s.snakes.filter((sn) => sn.alive).length;
      if (aliveCount <= 1) {
        clearInterval(interval);
        setPhase('done');
        // Score remonté au match record (qui est 2-player) :
        //   - en 2P : longueurs J1 vs J2
        //   - en 4P : on remonte la longueur du gagnant (P1) vs celle du dernier mort (P2)
        //     C'est imparfait mais le match record est 2-player ; la souveraineté
        //     du résultat reste correcte (le gagnant a le plus haut score).
        const sorted = [...s.snakes].sort((a, b) => Number(b.alive) - Number(a.alive) || b.body.length - a.body.length);
        const sc1 = sorted[0]?.body.length ?? 0;
        const sc2 = sorted[1]?.body.length ?? 0;
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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
      {phase === 'ready' && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 4 }}>
          <button
            className={`chip ${playerCount === 2 ? 'active accent' : ''}`}
            onClick={() => setPlayerCount(2)}
          >1v1 (2 joueurs)</button>
          <button
            className={`chip ${playerCount === 4 ? 'active accent' : ''}`}
            onClick={() => setPlayerCount(4)}
          >1v1v1v1 (4 joueurs)</button>
        </div>
      )}

      <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', justifyContent: 'center', fontFamily: 'var(--font-display)', fontWeight: 700 }}>
        {stateRef.current.snakes.map((sn) => (
          <span key={sn.id} style={{ color: SKINS[sn.id].fill, fontSize: 20, opacity: sn.alive ? 1 : 0.4 }}>
            {SKINS[sn.id].label} — {sn.body.length}
            {!sn.alive && ' 💀'}
          </span>
        ))}
      </div>

      <canvas
        ref={canvasRef}
        width={COLS * CELL}
        height={ROWS * CELL}
        style={{ background: '#0B0D10', borderRadius: 14, border: '1px solid var(--line)', maxWidth: '100%', height: 'auto' }}
      />

      {phase === 'ready' && (
        <>
          <button className="btn btn-accent btn-lg" onClick={start}>Démarrer</button>
          <div style={{ color: 'var(--muted)', fontSize: 13, textAlign: 'center', lineHeight: 1.6 }}>
            {SKINS.slice(0, playerCount).map((sk) => (
              <div key={sk.label}>{sk.label} : {sk.controls}</div>
            ))}
          </div>
        </>
      )}
      {phase === 'running' && (
        <div style={{ color: 'var(--muted)', fontSize: 13, textAlign: 'center', lineHeight: 1.6 }}>
          {SKINS.slice(0, playerCount).map((sk, i) => (
            <span key={sk.label}>{i > 0 && ' · '}{sk.label} {sk.controls}</span>
          ))}
          <br />Dernier survivant gagne. Une pomme allonge le serpent.
        </div>
      )}
      {phase === 'done' && (
        <div style={{ color: 'var(--muted)' }}>Partie terminée. Score envoyé…</div>
      )}
    </div>
  );
}

// Mappe une touche à un input directionnel sur l'un des snakes. Retourne true si la touche a été utilisée.
function applyKey(k: string, snakes: Snake[]): boolean {
  const trySet = (id: PlayerId, dir: Dir) => {
    const s = snakes[id];
    if (!s) return false;
    if (isOpposite(s.dir, dir)) return true; // touche reconnue, mais ignorée
    s.nextDir = dir;
    return true;
  };
  // J1 — flèches
  if (k === 'arrowup')    return trySet(0, UP);
  if (k === 'arrowdown')  return trySet(0, DOWN);
  if (k === 'arrowleft')  return trySet(0, LEFT);
  if (k === 'arrowright') return trySet(0, RIGHT);
  // J2 — ZQSD / WASD
  if (k === 'z' || k === 'w') return trySet(1, UP);
  if (k === 's')              return trySet(1, DOWN);
  if (k === 'q' || k === 'a') return trySet(1, LEFT);
  if (k === 'd')              return trySet(1, RIGHT);
  // J3 — IJKL
  if (k === 'i') return trySet(2, UP);
  if (k === 'k') return trySet(2, DOWN);
  if (k === 'j') return trySet(2, LEFT);
  if (k === 'l') return trySet(2, RIGHT);
  // J4 — TFGH
  if (k === 't') return trySet(3, UP);
  if (k === 'g') return trySet(3, DOWN);
  if (k === 'f') return trySet(3, LEFT);
  if (k === 'h') return trySet(3, RIGHT);
  return false;
}

function stepSnakes(s: { snakes: Snake[]; food: Pt }) {
  // 1) Avance toutes les têtes
  for (const snake of s.snakes) {
    if (!snake.alive) continue;
    snake.dir = snake.nextDir;
    const head = snake.body[0];
    const next: Pt = { x: head.x + snake.dir.x, y: head.y + snake.dir.y };
    if (next.x < 0 || next.x >= COLS || next.y < 0 || next.y >= ROWS) {
      snake.alive = false;
      continue;
    }
    snake.body.unshift(next);
    const ateFood = next.x === s.food.x && next.y === s.food.y;
    if (!ateFood) snake.body.pop();
  }
  // 2) Détecte les collisions (corps propre + corps des autres) en comptant les
  //    occurrences de la tête sur l'ensemble des cellules occupées.
  for (const snake of s.snakes) {
    if (!snake.alive) continue;
    const head = snake.body[0];
    let n = 0;
    for (const other of s.snakes) {
      for (const p of other.body) {
        if (p.x === head.x && p.y === head.y) n++;
      }
    }
    if (n > 1) snake.alive = false;
  }
  // 3) Repose la pomme si elle a été mangée par n'importe quel snake ce tour
  const eaten = s.snakes.some((sn) => sn.alive && sn.body[0].x === s.food.x && sn.body[0].y === s.food.y);
  if (eaten) {
    const occupied = new Set<string>();
    for (const sn of s.snakes) {
      for (const p of sn.body) occupied.add(`${p.x},${p.y}`);
    }
    s.food = randomFood(occupied);
  }
}

function draw(ctx: CanvasRenderingContext2D, s: { snakes: Snake[]; food: Pt }) {
  const W = COLS * CELL, H = ROWS * CELL;
  ctx.fillStyle = '#0B0D10';
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = 'rgba(255,255,255,0.04)';
  ctx.lineWidth = 1;
  for (let x = 0; x <= COLS; x++) { ctx.beginPath(); ctx.moveTo(x * CELL + 0.5, 0); ctx.lineTo(x * CELL + 0.5, H); ctx.stroke(); }
  for (let y = 0; y <= ROWS; y++) { ctx.beginPath(); ctx.moveTo(0, y * CELL + 0.5); ctx.lineTo(W, y * CELL + 0.5); ctx.stroke(); }

  ctx.fillStyle = '#D6FF3D';
  drawRoundRect(ctx, s.food.x * CELL + 3, s.food.y * CELL + 3, CELL - 6, CELL - 6, 6);

  for (const snake of s.snakes) {
    const skin = SKINS[snake.id];
    drawSnake(ctx, snake, skin.fill, skin.head);
  }
}

function drawSnake(ctx: CanvasRenderingContext2D, snake: Snake, body: string, head: string) {
  for (let i = snake.body.length - 1; i >= 0; i--) {
    const p = snake.body[i];
    ctx.fillStyle = i === 0 ? head : body;
    drawRoundRect(ctx, p.x * CELL + 2, p.y * CELL + 2, CELL - 4, CELL - 4, 5);
  }
  if (!snake.alive) {
    const h = snake.body[0];
    ctx.fillStyle = 'rgba(255,255,255,0.3)';
    ctx.font = `${CELL * 0.8}px serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('💀', h.x * CELL + CELL / 2, h.y * CELL + CELL / 2);
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
