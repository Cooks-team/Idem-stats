import { useEffect, useRef, useState } from 'react';
import type { GameModule, GameProps } from './GameModule';
import { useRemoteGameSync } from '../realtime/useRemoteGameSync';

// Pong classique 1v1 sur le même écran. Premier à 10 gagne.
//   J1 (rouge, gauche)  : ↑ ↓
//   J2 (bleu,  droite)  : Z (ou W) / S
// Physique simple : la balle accélère un peu à chaque rebond sur une raquette,
// avec un angle qui dépend de l'endroit où elle frappe (centre = horizontal,
// bord = angle prononcé).

const W = 720;
const H = 400;
const PADDLE_W = 12;
const PADDLE_H = 80;
const BALL_R = 8;
const PADDLE_SPEED = 6;
const INIT_BALL_SPEED = 5;
// Accélération à chaque rebond paddle. Plus le rally dure, plus ça pique.
const SPEED_INCREMENT = 0.85;
// Drift continu : la balle prend +0.5% de vitesse par frame quand elle est en
// play (entre 2 points). Sur 5 secondes de rally ça finit par +20% sans rebond.
const SPEED_DRIFT_PER_FRAME = 1.005;
const MAX_BALL_SPEED = 18;
const WIN_SCORE = 10;
const TICK_MS = 16; // ~60fps

interface Ball { x: number; y: number; vx: number; vy: number }
interface Paddles { p1Y: number; p2Y: number }

// Couleur de la balle qui shift selon la vitesse — jaune fluo au démarrage,
// orange en milieu de rally, rouge incandescent quand ça tape vite.
function ballColorForSpeed(speed: number): string {
  // Range : INIT_BALL_SPEED → MAX_BALL_SPEED mappé sur 0..1
  const t = Math.min(1, Math.max(0, (speed - INIT_BALL_SPEED) / (MAX_BALL_SPEED - INIT_BALL_SPEED)));
  // Interpole jaune-fluo (#D6FF3D) → orange (#FF8C42) → rouge incandescent (#FF3D2D)
  if (t < 0.5) {
    const k = t / 0.5;
    return lerpColor('#D6FF3D', '#FF8C42', k);
  }
  const k = (t - 0.5) / 0.5;
  return lerpColor('#FF8C42', '#FF3D2D', k);
}
function lerpColor(a: string, b: string, t: number): string {
  const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
  const ra = (pa >> 16) & 0xff, ga = (pa >> 8) & 0xff, ba = pa & 0xff;
  const rb = (pb >> 16) & 0xff, gb = (pb >> 8) & 0xff, bb = pb & 0xff;
  const r = Math.round(ra + (rb - ra) * t);
  const g = Math.round(ga + (gb - ga) * t);
  const bl = Math.round(ba + (bb - ba) * t);
  return `rgb(${r}, ${g}, ${bl})`;
}

function initBall(direction: 1 | -1): Ball {
  const angle = (Math.random() - 0.5) * 0.6; // léger angle initial
  return {
    x: W / 2, y: H / 2,
    vx: direction * INIT_BALL_SPEED * Math.cos(angle),
    vy: INIT_BALL_SPEED * Math.sin(angle),
  };
}

export const PongGame: GameModule = {
  id: 'pong',
  apiId: 'pong',
  name: 'Pong',
  description: '1v1 Pong. J1 = flèches, J2 = ZQSD/WASD. Premier à 10.',
  Component: PongComponent,
};

type PongScheme = 'arrows' | 'zqsd';
interface PongStateMsg { paddles: Paddles; ball: Ball; score: { p1: number; p2: number } }
interface PongInputMsg { dir: 'up' | 'down'; state: 'down' | 'up' }

function PongComponent({ onFinish, mode = 'local', matchId }: GameProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [phase, setPhase] = useState<'ready' | 'running' | 'done'>('ready');
  const [myScheme, setMyScheme] = useState<PongScheme>(mode === 'guest' ? 'zqsd' : 'arrows');
  // Trail de la balle (5 dernières positions) → ligne lumineuse derrière elle
  // qui s'épaissit avec la vitesse. Donne le feel arcade quand ça envoie.
  const stateRef = useRef<{ paddles: Paddles; ball: Ball; keys: Set<string>; guestUp: boolean; guestDown: boolean; trail: Array<{ x: number; y: number }> }>({
    paddles: { p1Y: (H - PADDLE_H) / 2, p2Y: (H - PADDLE_H) / 2 },
    ball: initBall(1),
    keys: new Set(),
    guestUp: false,
    guestDown: false,
    trail: [],
  });
  const [score, setScore] = useState({ p1: 0, p2: 0 });

  const { sendInput, sendState } = useRemoteGameSync<PongInputMsg, PongStateMsg>({
    matchId: matchId ?? null,
    role: mode,
    onInput: (input) => {
      // Host : applique l'input du guest (J2)
      const s = stateRef.current;
      if (input.dir === 'up') s.guestUp = input.state === 'down';
      else s.guestDown = input.state === 'down';
    },
    onState: (snapshot) => {
      // Guest : copie l'état pour rendre
      const s = stateRef.current;
      s.paddles = { ...snapshot.paddles };
      s.ball = { ...snapshot.ball };
      setScore(snapshot.score);
      // Auto-start guest dès qu'un state arrive
      setPhase((p) => (p === 'ready' ? 'running' : p));
    },
  });
  const sentGuestRef = useRef<{ up: boolean; down: boolean }>({ up: false, down: false });

  const start = () => {
    stateRef.current = {
      paddles: { p1Y: (H - PADDLE_H) / 2, p2Y: (H - PADDLE_H) / 2 },
      ball: initBall(Math.random() < 0.5 ? 1 : -1),
      keys: new Set(),
      guestUp: false,
      guestDown: false,
      trail: [],
    };
    setScore({ p1: 0, p2: 0 });
    sentGuestRef.current = { up: false, down: false };
    setPhase('running');
  };

  // Touches : adapté au mode
  useEffect(() => {
    if (phase !== 'running') return;
    const keyToDir = (k: string): 'up' | 'down' | null => {
      const scheme = mode === 'local' ? null : myScheme;
      if (scheme === null) return null; // local : on garde les keys brutes
      if (scheme === 'arrows') {
        if (k === 'arrowup') return 'up';
        if (k === 'arrowdown') return 'down';
      } else {
        if (k === 'z' || k === 'w') return 'up';
        if (k === 's') return 'down';
      }
      return null;
    };
    const down = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (mode === 'local') {
        stateRef.current.keys.add(k);
        if (isHandled(e.key)) e.preventDefault();
        return;
      }
      const dir = keyToDir(k);
      if (!dir) return;
      e.preventDefault();
      if (mode === 'host') {
        // J1 (host) : applique direct via keys
        stateRef.current.keys.add(dir === 'up' ? 'arrowup' : 'arrowdown');
      } else {
        // Guest : envoie au host (dédup)
        const cur = sentGuestRef.current;
        if (!cur[dir]) {
          cur[dir] = true;
          sendInput({ dir, state: 'down' });
        }
      }
    };
    const up = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (mode === 'local') {
        stateRef.current.keys.delete(k);
        return;
      }
      const dir = keyToDir(k);
      if (!dir) return;
      if (mode === 'host') {
        stateRef.current.keys.delete(dir === 'up' ? 'arrowup' : 'arrowdown');
      } else {
        const cur = sentGuestRef.current;
        if (cur[dir]) {
          cur[dir] = false;
          sendInput({ dir, state: 'up' });
        }
      }
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); };
  }, [phase, mode, myScheme, sendInput]);

  // Boucle de jeu — seulement host ou local
  useEffect(() => {
    if (phase !== 'running') return;
    if (mode === 'guest') return;
    const lastBroadcast = { t: 0 };
    const interval = window.setInterval(() => {
      const s = stateRef.current;
      // 1) Bouge les raquettes
      // J1 (host ou local) : flèches OU zqsd (peu importe en host car listener filtre)
      if (s.keys.has('arrowup') || s.keys.has('z') || s.keys.has('w')) s.paddles.p1Y = Math.max(0, s.paddles.p1Y - PADDLE_SPEED);
      if (s.keys.has('arrowdown') || s.keys.has('s')) s.paddles.p1Y = Math.min(H - PADDLE_H, s.paddles.p1Y + PADDLE_SPEED);
      // J2 :
      //  - en local : zqsd locales
      //  - en host  : inputs guest (guestUp/Down)
      if (mode === 'local') {
        if (s.keys.has('z') || s.keys.has('w')) s.paddles.p2Y = Math.max(0, s.paddles.p2Y - PADDLE_SPEED);
        if (s.keys.has('s')) s.paddles.p2Y = Math.min(H - PADDLE_H, s.paddles.p2Y + PADDLE_SPEED);
      } else {
        if (s.guestUp) s.paddles.p2Y = Math.max(0, s.paddles.p2Y - PADDLE_SPEED);
        if (s.guestDown) s.paddles.p2Y = Math.min(H - PADDLE_H, s.paddles.p2Y + PADDLE_SPEED);
      }

      // 2) Drift continu : la balle accélère légèrement chaque frame tant
      //    qu'elle est en play. Plafonné par MAX_BALL_SPEED.
      const curSp = Math.hypot(s.ball.vx, s.ball.vy);
      if (curSp > 0 && curSp < MAX_BALL_SPEED) {
        const targetSp = Math.min(curSp * SPEED_DRIFT_PER_FRAME, MAX_BALL_SPEED);
        const k = targetSp / curSp;
        s.ball.vx *= k;
        s.ball.vy *= k;
      }

      // 3) Trail (5 dernières positions, FIFO)
      s.trail.push({ x: s.ball.x, y: s.ball.y });
      if (s.trail.length > 5) s.trail.shift();

      // 4) Bouge la balle
      s.ball.x += s.ball.vx;
      s.ball.y += s.ball.vy;

      // 5) Rebonds haut/bas
      if (s.ball.y - BALL_R <= 0 && s.ball.vy < 0) { s.ball.y = BALL_R; s.ball.vy *= -1; }
      if (s.ball.y + BALL_R >= H && s.ball.vy > 0) { s.ball.y = H - BALL_R; s.ball.vy *= -1; }

      // 4) Collision raquettes — J1 est à DROITE (flèches), J2 à GAUCHE (ZQSD)
      // Raquette J2 (gauche) : x = 20..32
      if (s.ball.x - BALL_R <= 32 && s.ball.x - BALL_R >= 18 && s.ball.vx < 0
        && s.ball.y >= s.paddles.p2Y && s.ball.y <= s.paddles.p2Y + PADDLE_H) {
        s.ball = bounceFromPaddle(s.ball, s.paddles.p2Y, 1);
      }
      // Raquette J1 (droite) : x = W-32..W-20
      if (s.ball.x + BALL_R >= W - 32 && s.ball.x + BALL_R <= W - 18 && s.ball.vx > 0
        && s.ball.y >= s.paddles.p1Y && s.ball.y <= s.paddles.p1Y + PADDLE_H) {
        s.ball = bounceFromPaddle(s.ball, s.paddles.p1Y, -1);
      }

      // 7) But ? — la balle sort à gauche → J1 marque ; à droite → J2 marque
      //    On reset aussi le trail au nouveau point pour qu'il ne traverse pas
      //    le terrain.
      if (s.ball.x < -BALL_R) {
        setScore((sc) => {
          const next = { ...sc, p1: sc.p1 + 1 };
          if (next.p1 >= WIN_SCORE) { setPhase('done'); setTimeout(() => onFinish(next.p1, next.p2), 700); }
          return next;
        });
        s.ball = initBall(1);
        s.trail = [];
      } else if (s.ball.x > W + BALL_R) {
        setScore((sc) => {
          const next = { ...sc, p2: sc.p2 + 1 };
          if (next.p2 >= WIN_SCORE) { setPhase('done'); setTimeout(() => onFinish(next.p1, next.p2), 700); }
          return next;
        });
        s.ball = initBall(-1);
        s.trail = [];
      }

      // 6) Broadcast state au guest (host)
      if (mode === 'host' && matchId) {
        const now = performance.now();
        if (now - lastBroadcast.t >= 33) {
          lastBroadcast.t = now;
          sendState({
            paddles: { ...s.paddles },
            ball: { ...s.ball },
            score,
          });
        }
      }

      // 7) Dessin
      const c = canvasRef.current;
      if (c) {
        const ctx = c.getContext('2d');
        if (ctx) draw(ctx, s);
      }
    }, TICK_MS);
    return () => clearInterval(interval);
  }, [phase, mode, matchId, sendState, onFinish, score]);

  // Boucle rendu guest
  useEffect(() => {
    if (phase !== 'running' || mode !== 'guest') return;
    let raf = 0;
    const tick = () => {
      const c = canvasRef.current;
      if (c) {
        const ctx = c.getContext('2d');
        if (ctx) draw(ctx, stateRef.current);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [phase, mode]);

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
        style={{ background: '#0B0D10', borderRadius: 14, border: '1px solid var(--line)', maxWidth: '100%', height: 'auto' }}
      />
      {phase === 'ready' && mode !== 'local' && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
          <div className="eyebrow"><span className="label">Tes contrôles</span></div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" className={`chip ${myScheme === 'arrows' ? 'active accent' : ''}`} onClick={() => setMyScheme('arrows')}>Flèches ↑↓</button>
            <button type="button" className={`chip ${myScheme === 'zqsd' ? 'active accent' : ''}`} onClick={() => setMyScheme('zqsd')}>Z/S ou W/S</button>
          </div>
        </div>
      )}
      {phase === 'ready' && mode !== 'guest' && (
        <>
          <button className="btn btn-accent btn-lg" onClick={start}>Démarrer</button>
          <div style={{ color: 'var(--muted)', fontSize: 13, textAlign: 'center' }}>
            {mode === 'local'
              ? <>🔵 J2 (gauche) : Z/S ou W/S &nbsp;·&nbsp; 🔴 J1 (droite) : ↑ ↓ &nbsp;·&nbsp; Premier à {WIN_SCORE}.</>
              : <>Tu pilotes <strong>🔴 J1 (droite)</strong> avec {myScheme === 'arrows' ? 'les flèches' : 'Z/S ou W/S'}. Premier à {WIN_SCORE}.{mode === 'host' && ' Mode distance — c\'est toi qui lances la partie.'}</>}
          </div>
        </>
      )}
      {phase === 'ready' && mode === 'guest' && (
        <div style={{ color: 'var(--muted)', fontSize: 14, textAlign: 'center', padding: '10px 0' }}>
          ⚡ Tu es <strong style={{ color: '#5B8CFF' }}>🔵 J2 (gauche)</strong>. Contrôles : <strong>{myScheme === 'arrows' ? 'flèches' : 'Z/S'}</strong>.<br />
          <span style={{ opacity: 0.85 }}>En attente que ton adversaire lance la partie…</span>
        </div>
      )}
      {phase === 'running' && (
        <div style={{ color: 'var(--muted)', fontSize: 13 }}>Premier à {WIN_SCORE} points gagne.</div>
      )}
      {phase === 'done' && <div style={{ color: 'var(--muted)' }}>Match terminé. Score envoyé…</div>}
    </div>
  );
}

// Rebond sur raquette : angle proportionnel à l'offset du point d'impact / centre raquette.
function bounceFromPaddle(ball: Ball, paddleY: number, signX: 1 | -1): Ball {
  const offset = (ball.y - (paddleY + PADDLE_H / 2)) / (PADDLE_H / 2); // -1..1
  const speed = Math.min(Math.hypot(ball.vx, ball.vy) + SPEED_INCREMENT, MAX_BALL_SPEED);
  const angle = offset * (Math.PI / 3); // jusqu'à ±60°
  return {
    x: ball.x, y: ball.y,
    vx: signX * speed * Math.cos(angle),
    vy: speed * Math.sin(angle),
  };
}

function isHandled(key: string): boolean {
  const k = key.toLowerCase();
  return k === 'arrowup' || k === 'arrowdown' || k === 'z' || k === 'w' || k === 's';
}

function draw(ctx: CanvasRenderingContext2D, s: { paddles: Paddles; ball: Ball; trail: Array<{ x: number; y: number }> }) {
  ctx.fillStyle = '#0B0D10';
  ctx.fillRect(0, 0, W, H);

  // Ligne médiane pointillée
  ctx.strokeStyle = 'rgba(255,255,255,0.15)';
  ctx.lineWidth = 2;
  ctx.setLineDash([10, 10]);
  ctx.beginPath();
  ctx.moveTo(W / 2, 0); ctx.lineTo(W / 2, H);
  ctx.stroke();
  ctx.setLineDash([]);

  // Raquettes — J1 rouge à DROITE (flèches), J2 bleu à GAUCHE (ZQSD)
  ctx.fillStyle = '#5B8CFF';
  ctx.fillRect(20, s.paddles.p2Y, PADDLE_W, PADDLE_H);
  ctx.fillStyle = '#FF6B57';
  ctx.fillRect(W - 20 - PADDLE_W, s.paddles.p1Y, PADDLE_W, PADDLE_H);

  // Trail derrière la balle — devient plus visible et plus épais à mesure
  // que la balle accélère.
  const speed = Math.hypot(s.ball.vx, s.ball.vy);
  const speedT = Math.min(1, Math.max(0, (speed - INIT_BALL_SPEED) / (MAX_BALL_SPEED - INIT_BALL_SPEED)));
  const color = ballColorForSpeed(speed);
  if (s.trail && s.trail.length > 1) {
    for (let i = 0; i < s.trail.length; i++) {
      const p = s.trail[i];
      const alpha = ((i + 1) / s.trail.length) * (0.18 + 0.4 * speedT);
      const r = BALL_R * (0.35 + (i / s.trail.length) * 0.55);
      ctx.fillStyle = color.replace('rgb', 'rgba').replace(')', `, ${alpha})`);
      ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fill();
    }
  }

  // Glow autour de la balle à haute vitesse
  if (speedT > 0.4) {
    const glowR = BALL_R + 6 + speedT * 8;
    ctx.fillStyle = color.replace('rgb', 'rgba').replace(')', `, ${0.18 * speedT})`);
    ctx.beginPath(); ctx.arc(s.ball.x, s.ball.y, glowR, 0, Math.PI * 2); ctx.fill();
  }

  // Balle (couleur shift selon vitesse : jaune fluo → orange → rouge)
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(s.ball.x, s.ball.y, BALL_R, 0, Math.PI * 2);
  ctx.fill();
}
