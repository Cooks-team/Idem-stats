import { useEffect, useRef, useState } from 'react';
import type { GameModule, GameProps } from './GameModule';
import { useRemoteGameSync } from '../realtime/useRemoteGameSync';
import { useEmotePair } from '../realtime/useEmotePair';
import { EmoteBubble } from '../ui/EmoteBubble';
import { EmotePicker } from '../ui/EmotePicker';
import { MobileDPad } from '../ui/MobileDPad';
import { useIsMobile } from '../hooks/useIsMobile';

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
const TICK_MS = 95;  // tick légèrement plus rapide qu'avant (110ms) → meilleur ressenti
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

// Position de départ. Côtés alignés avec la disposition du clavier physique :
//   - les touches des J1 (flèches) et J3 (IJKL) sont sur la moitié DROITE du clavier
//     → on les place à DROITE de l'écran
//   - les touches des J2 (ZQSD/WASD) et J4 (TFGH) sont sur la moitié GAUCHE du clavier
//     → on les place à GAUCHE de l'écran
function initSnakes(count: 2 | 4): Snake[] {
  const midY = Math.floor(ROWS / 2);
  if (count === 2) {
    return [
      makeSnake(0, COLS - 5, midY, LEFT),  // J1 (flèches) à droite, va vers la gauche
      makeSnake(1, 4,        midY, RIGHT), // J2 (ZQSD) à gauche, va vers la droite
    ];
  }
  // 4 joueurs : J1+J3 à droite, J2+J4 à gauche
  return [
    makeSnake(0, COLS - 5,  3,            LEFT),  // J1 haut-droit
    makeSnake(1, 4,         3,            RIGHT), // J2 haut-gauche
    makeSnake(2, COLS - 5,  ROWS - 4,     LEFT),  // J3 bas-droit
    makeSnake(3, 4,         ROWS - 4,     RIGHT), // J4 bas-gauche
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

type Scheme = 'arrows' | 'zqsd';
type DirName = 'up' | 'down' | 'left' | 'right';

interface SnakeStateMsg {
  snakes: Array<{ body: Pt[]; dir: Dir; alive: boolean }>;
  food: Pt;
  tick: number;
}
interface SnakeInputMsg {
  dir: DirName;
}

function SnakeComponent({ onFinish, mode = 'local', matchId }: GameProps) {
  const emotes = useEmotePair({ matchId, mode });
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [phase, setPhase] = useState<'ready' | 'running' | 'done'>('ready');
  // En remote, on force 2 joueurs (le match record n'en accepte que 2 de toute façon).
  const [playerCount, setPlayerCount] = useState<2 | 4>(2);
  const effectivePlayerCount: 2 | 4 = mode === 'local' ? playerCount : 2;
  const [myScheme, setMyScheme] = useState<Scheme>(mode === 'guest' ? 'zqsd' : 'arrows');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const stateRef = useRef<{ snakes: Snake[]; food: Pt }>({ snakes: initSnakes(2), food: { x: 14, y: 10 } });
  const [tick, setTick] = useState(0);
  const isMobile = useIsMobile();

  // Wrapper tactile : équivalent d'un keydown direction. Réutilise la même
  // logique que le handler clavier — applique direct en host/local (snake 0)
  // ou envoie au host en guest.
  const pressDir = (dirName: DirName) => {
    if (phase !== 'running') return;
    const snakes = stateRef.current.snakes;
    if (mode === 'guest') {
      sendInput({ dir: dirName });
      return;
    }
    // local + host : on pilote son propre serpent (snake[0]).
    const snake = snakes[0];
    if (!snake) return;
    const dir = dirNameToVec(dirName);
    if (!isOpposite(snake.dir, dir)) snake.nextDir = dir;
  };

  // Sync remote
  const { sendInput, sendState } = useRemoteGameSync<SnakeInputMsg, SnakeStateMsg>({
    matchId: matchId ?? null,
    role: mode,
    onInput: (input) => {
      // Host : applique le nextDir du guest (snake[1] = J2)
      const s = stateRef.current;
      const snake = s.snakes[1];
      if (!snake) return;
      const dir = dirNameToVec(input.dir);
      if (!isOpposite(snake.dir, dir)) snake.nextDir = dir;
    },
    onState: (snapshot) => {
      // Guest : remplace l'état local par celui reçu
      const s = stateRef.current;
      s.snakes = snapshot.snakes.map((sn) => ({ ...sn, body: sn.body.map((p) => ({ ...p })), nextDir: sn.dir, id: 0 as PlayerId } as Snake));
      s.snakes.forEach((sn, i) => { sn.id = i as PlayerId; });
      s.food = { ...snapshot.food };
      setTick(snapshot.tick);
      // Auto-start guest dès qu'un state arrive (plus besoin de cliquer Démarrer)
      setPhase((p) => (p === 'ready' ? 'running' : p));
    },
  });

  const start = () => {
    stateRef.current = { snakes: initSnakes(effectivePlayerCount), food: { x: 14, y: 10 } };
    setPhase('running');
    setTick(0);
    // Demande le fullscreen sur le wrapper. Le browser peut refuser si non
    // déclenché par un user gesture (ici on est dans onClick → OK).
    const el = wrapperRef.current;
    if (el && el.requestFullscreen && !document.fullscreenElement) {
      el.requestFullscreen().catch(() => { /* silencieux : si le navigateur refuse, on reste embedded */ });
    }
  };

  // Sync l'état React avec le statut fullscreen réel (l'utilisateur peut
  // appuyer sur Échap, on doit le savoir pour réajuster le rendu).
  useEffect(() => {
    const onChange = () => setIsFullscreen(document.fullscreenElement === wrapperRef.current);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  // Sort du fullscreen quand la partie est finie + cleanup au unmount
  useEffect(() => {
    if (phase === 'done' && document.fullscreenElement === wrapperRef.current) {
      document.exitFullscreen().catch(() => {});
    }
  }, [phase]);
  useEffect(() => () => {
    if (document.fullscreenElement === wrapperRef.current) {
      document.exitFullscreen().catch(() => {});
    }
  }, []);

  // Saisie tactile (mobile) : swipe sur le canvas → direction.
  // Le seuil de 22px évite que le moindre tap glissé soit pris pour un swipe.
  // Indépendant du clavier : marche en parallèle. Applique au snake "à moi"
  // selon le mode (J1 si local/host, envoyé au host si guest).
  useEffect(() => {
    if (phase !== 'running') return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    let startX = 0, startY = 0;
    const onStart = (e: TouchEvent) => {
      const t = e.touches[0]; if (!t) return;
      startX = t.clientX; startY = t.clientY;
    };
    const onEnd = (e: TouchEvent) => {
      const t = e.changedTouches[0]; if (!t) return;
      const dx = t.clientX - startX;
      const dy = t.clientY - startY;
      const adx = Math.abs(dx), ady = Math.abs(dy);
      if (Math.max(adx, ady) < 22) return; // tap trop court
      let dirName: DirName;
      if (adx > ady) dirName = dx > 0 ? 'right' : 'left';
      else            dirName = dy > 0 ? 'down'  : 'up';
      e.preventDefault();
      const snakes = stateRef.current.snakes;
      if (mode === 'local') {
        // En local le swipe contrôle J1 (le serpent du joueur sur ce poste).
        // Les autres joueurs continuent au clavier comme avant.
        const snake = snakes[0];
        if (!snake) return;
        const dir = dirNameToVec(dirName);
        if (!isOpposite(snake.dir, dir)) snake.nextDir = dir;
      } else if (mode === 'host') {
        const snake = snakes[0];
        if (!snake) return;
        const dir = dirNameToVec(dirName);
        if (!isOpposite(snake.dir, dir)) snake.nextDir = dir;
      } else {
        sendInput({ dir: dirName });
      }
    };
    canvas.addEventListener('touchstart', onStart, { passive: true });
    canvas.addEventListener('touchend', onEnd, { passive: false });
    return () => {
      canvas.removeEventListener('touchstart', onStart);
      canvas.removeEventListener('touchend', onEnd);
    };
  }, [phase, mode, sendInput]);

  // Saisie clavier — adaptée au mode
  useEffect(() => {
    if (phase !== 'running') return;
    const onKey = (e: KeyboardEvent) => {
      const snakes = stateRef.current.snakes;
      const k = e.key.toLowerCase();
      if (mode === 'local') {
        // Tout le clavier pilote les 2 ou 4 serpents
        if (applyKey(k, snakes)) e.preventDefault();
        return;
      }
      // Remote : on ne capture QUE le schéma préféré du joueur
      const dirName = keyToDir(k, myScheme);
      if (!dirName) return;
      e.preventDefault();
      if (mode === 'host') {
        // J1 (snake[0]) → applique direct
        const snake = snakes[0];
        if (!snake) return;
        const dir = dirNameToVec(dirName);
        if (!isOpposite(snake.dir, dir)) snake.nextDir = dir;
      } else {
        // Guest : envoie au host
        sendInput({ dir: dirName });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [phase, mode, myScheme, sendInput]);

  // Boucle de jeu — seulement host ou local
  useEffect(() => {
    if (phase !== 'running') return;
    if (mode === 'guest') return;
    const interval = window.setInterval(() => {
      const s = stateRef.current;
      stepSnakes(s);
      const nextTick = tick + 1;
      setTick(nextTick);

      // Broadcast state au guest (snapshot léger, ~9 fois/sec à 110ms)
      if (mode === 'host' && matchId) {
        sendState({
          snakes: s.snakes.map((sn) => ({ body: sn.body, dir: sn.dir, alive: sn.alive })),
          food: s.food,
          tick: nextTick,
        });
      }

      const aliveCount = s.snakes.filter((sn) => sn.alive).length;
      if (aliveCount <= 1) {
        clearInterval(interval);
        setPhase('done');
        const sc1 = s.snakes[0]?.alive ? 1 : 0;
        const sc2 = s.snakes[1]?.alive ? 1 : 0;
        // Dernier broadcast pour que le guest voit la fin
        if (mode === 'host' && matchId) {
          sendState({
            snakes: s.snakes.map((sn) => ({ body: sn.body, dir: sn.dir, alive: sn.alive })),
            food: s.food,
            tick: nextTick + 1,
          });
        }
        setTimeout(() => onFinish(sc1, sc2), 600);
      }
    }, TICK_MS);
    return () => clearInterval(interval);
  }, [phase, mode, matchId, sendState, onFinish, tick]);

  // Dessin
  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    draw(ctx, stateRef.current);
  }, [tick, phase]);

  return (
    <div
      ref={wrapperRef}
      style={{
        position: 'relative',
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        justifyContent: isFullscreen ? 'center' : 'flex-start',
        gap: 14,
        // En fullscreen on prend l'écran complet avec fond sombre. Hors fullscreen
        // on garde la mise en page intégrée habituelle.
        background: isFullscreen ? '#0B0D10' : 'transparent',
        width: isFullscreen ? '100vw' : 'auto',
        height: isFullscreen ? '100vh' : 'auto',
        padding: isFullscreen ? 24 : 0,
      }}
    >
      {phase === 'ready' && mode === 'local' && (
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

      <div style={{ position: 'absolute', top: isFullscreen ? 16 : 0, right: isFullscreen ? 16 : 0, zIndex: 5 }}>
        <EmotePicker onPick={emotes.triggerMine} label="Emotes" />
      </div>
      <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', justifyContent: 'center', fontFamily: 'var(--font-display)', fontWeight: 700, alignItems: 'center' }}>
        {stateRef.current.snakes.map((sn) => {
          // Le snake "moi" reçoit la bulle d'emote à côté de son label. En local
          // c'est J1 (snake 0). En guest, c'est J2 (snake 1).
          const mySnakeId = mode === 'guest' ? 1 : 0;
          const isMe = sn.id === mySnakeId;
          const isOpponent = sn.id === (mySnakeId === 0 ? 1 : 0);
          return (
            <span key={sn.id} style={{ color: SKINS[sn.id].fill, fontSize: 20, opacity: sn.alive ? 1 : 0.4, display: 'inline-flex', alignItems: 'center' }}>
              {SKINS[sn.id].label} — {sn.body.length}
              {!sn.alive && ' 💀'}
              {isMe && <EmoteBubble emoteKey={emotes.myKey} side="right" />}
              {isOpponent && <EmoteBubble emoteKey={emotes.opponentKey} side="right" />}
            </span>
          );
        })}
      </div>

      <canvas
        ref={canvasRef}
        width={COLS * CELL}
        height={ROWS * CELL}
        // En fullscreen on agrandit le canvas pour qu'il occupe la plus grande
        // surface possible tout en préservant son ratio (28/20 = 1.4) et en
        // laissant de la place pour le score au-dessus.
        style={{
          background: '#0B0D10', borderRadius: 14,
          border: '1px solid var(--line)',
          maxWidth: '100%',
          maxHeight: isFullscreen ? 'calc(100vh - 140px)' : 'none',
          width: isFullscreen ? 'auto' : undefined,
          height: 'auto',
        }}
      />

      {phase === 'ready' && mode !== 'local' && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, marginBottom: 4 }}>
          <div className="eyebrow"><span className="label">Tes contrôles</span></div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" className={`chip ${myScheme === 'arrows' ? 'active accent' : ''}`} onClick={() => setMyScheme('arrows')}>Flèches ↑↓←→</button>
            <button type="button" className={`chip ${myScheme === 'zqsd' ? 'active accent' : ''}`} onClick={() => setMyScheme('zqsd')}>ZQSD / WASD</button>
          </div>
        </div>
      )}
      {phase === 'ready' && mode !== 'guest' && (
        <>
          <button className="btn btn-accent btn-lg" onClick={start}>Démarrer</button>
          <div style={{ color: 'var(--muted)', fontSize: 13, textAlign: 'center', lineHeight: 1.6 }}>
            {mode === 'local'
              ? SKINS.slice(0, effectivePlayerCount).map((sk) => (
                  <div key={sk.label}>{sk.label} : {sk.controls}</div>
                ))
              : (
                  <div>Tu pilotes <strong>🔴 J1</strong> avec {myScheme === 'arrows' ? 'les flèches' : 'ZQSD/WASD'}. Dernier survivant gagne.</div>
                )}
            {mode === 'host' && <div style={{ marginTop: 4, opacity: 0.7 }}>Mode distance — c'est toi qui lances la partie.</div>}
          </div>
        </>
      )}
      {phase === 'ready' && mode === 'guest' && (
        <div style={{ color: 'var(--muted)', fontSize: 14, textAlign: 'center', lineHeight: 1.6, padding: '10px 0' }}>
          ⚡ Tu es <strong style={{ color: '#5B8CFF' }}>🔵 J2</strong>. Contrôles : <strong>{myScheme === 'arrows' ? 'flèches' : 'ZQSD'}</strong>.<br />
          <span style={{ opacity: 0.85 }}>En attente que ton adversaire lance la partie…</span>
        </div>
      )}
      {phase === 'running' && (
        <div style={{ color: 'var(--muted)', fontSize: 13, textAlign: 'center', lineHeight: 1.6 }}>
          {SKINS.slice(0, playerCount).map((sk, i) => (
            <span key={sk.label}>{i > 0 && ' · '}{sk.label} {sk.controls}</span>
          ))}
          <br />Dernier survivant gagne. Une pomme allonge le serpent.
        </div>
      )}

      {/* DPad tactile mobile — uniquement quand on joue. Pilote J1 (snake 0)
          en local/host ou émet vers le host en guest. Pas de boost. */}
      <MobileDPad
        visible={isMobile && phase === 'running'}
        onPress={(dir, state) => { if (state === 'down') pressDir(dir); }}
      />

      {phase === 'done' && (
        <div style={{ color: 'var(--muted)' }}>Partie terminée. Score envoyé…</div>
      )}
    </div>
  );
}

// Helpers pour mode remote : convertit le code clavier en direction canonique
// selon le schéma préféré du joueur.
function keyToDir(k: string, scheme: Scheme): DirName | null {
  if (scheme === 'arrows') {
    if (k === 'arrowup') return 'up';
    if (k === 'arrowdown') return 'down';
    if (k === 'arrowleft') return 'left';
    if (k === 'arrowright') return 'right';
  } else {
    if (k === 'z' || k === 'w') return 'up';
    if (k === 's') return 'down';
    if (k === 'q' || k === 'a') return 'left';
    if (k === 'd') return 'right';
  }
  return null;
}
function dirNameToVec(d: DirName): Dir {
  switch (d) {
    case 'up': return UP;
    case 'down': return DOWN;
    case 'left': return LEFT;
    case 'right': return RIGHT;
  }
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
