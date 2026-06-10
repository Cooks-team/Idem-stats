import { useEffect, useRef, useState } from 'react';
import type { GameModule, GameProps } from './GameModule';
import { useRemoteGameSync } from '../realtime/useRemoteGameSync';

// Babyfoot version arcade air-hockey, désormais multiplayer remote.
//
// Architecture host-authoritative :
//   - HOST (player1)  : simulation locale, broadcast l'état ~30Hz au guest
//   - GUEST (player2) : reçoit l'état du host et rend (read-only), envoie ses
//                       inputs canoniques (up/down/left/right + boost) au host
//   - LOCAL : tout sur un même écran/clavier comme avant (hub games)
//
// Contrôles : chaque joueur choisit AVANT le démarrage son schéma préféré
// (Flèches ou ZQSD). En local, J1 et J2 partagent le même clavier (défaut
// J1=flèches, J2=ZQSD). En remote, chacun pick le sien sur sa machine.

const W = 800;
const H = 420;
const PADDLE_R = 24;
const GK_R = 14;             // nerf : 18 → 14 (gardien plus petit)
const BALL_R = 12;
const GOAL_H = 140;
const WIN_GOALS = 5;
const PADDLE_SPEED = 5.5;
const PADDLE_BOOST_SPEED = 8.5;
const GK_SPEED = 1.6;        // nerf : 2.6 → 1.6 (réactions plus molles)
// Le gardien ne réagit que si la balle est proche de SON but. Au-delà de
// cette distance, il rentre tranquillement au centre. Évite qu'il colle
// la balle dès qu'elle franchit la médiane.
const GK_REACT_RANGE = 220;  // px depuis la ligne de but
const BALL_FRICTION = 0.998;
const MIN_BALL_SPEED = 0.05;
const TICK_MS = 16;
const STATE_BROADCAST_MS = 33; // ~30Hz
const TRAIL_LEN = 10;

type Scheme = 'arrows' | 'zqsd';
type Dir = 'up' | 'down' | 'left' | 'right';

interface V2 { x: number; y: number }
interface State {
  p1: V2; p2: V2;
  p1V: V2; p2V: V2;
  gk1: V2; gk2: V2;
  ball: V2; ballV: V2;
  trail: V2[];
  // Inputs des deux côtés. Le host calcule à partir des keys locales + des
  // inputs reçus du guest. En local, tout vient des keys locales.
  keysHost: Set<string>;  // joueur sur ce poste (en local : tout le clavier)
  keysGuest: Set<Dir | 'boost'>; // directions canoniques envoyées par le guest
}

interface InputMsg {
  dir: Dir | 'boost';
  state: 'down' | 'up';
}

interface StateMsg {
  p1: V2; p2: V2;
  gk1: V2; gk2: V2;
  ball: V2;
  trail: V2[];
  score: { p1: number; p2: number };
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
    keysHost: new Set(),
    keysGuest: new Set(),
  };
}

export const BabyfootGame: GameModule = {
  id: 'baby',
  apiId: 'baby',
  name: 'Babyfoot',
  description: '1v1 arcade. Local sur 1 clavier ou remote chacun chez soi. Premier à 5.',
  Component: BabyfootComponent,
};

function BabyfootComponent({ onFinish, player1, player2, mode = 'local', matchId }: GameProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const stateRef = useRef<State>(initState());
  const [score, setScore] = useState({ p1: 0, p2: 0 });
  const [phase, setPhase] = useState<'setup' | 'running' | 'done'>('setup');

  // Schéma de contrôle du joueur sur ce poste (sa préférence). En local, le
  // schéma sert juste à l'affichage : le clavier complet pilote J1 et J2.
  // En remote, mon schéma préféré décide quelles touches contrôlent MA paddle.
  const [myScheme, setMyScheme] = useState<Scheme>(mode === 'guest' ? 'zqsd' : 'arrows');

  // Avatars dans des Image objects pour dessiner sur le canvas
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

  // Sync remote. Host reçoit les inputs du guest, guest reçoit le state.
  const { sendInput, sendState } = useRemoteGameSync<InputMsg, StateMsg>({
    matchId: matchId ?? null,
    role: mode,
    onInput: (input) => {
      // Host : on stocke l'input du guest dans keysGuest pour que la game loop applique
      const s = stateRef.current;
      if (input.state === 'down') s.keysGuest.add(input.dir);
      else s.keysGuest.delete(input.dir);
    },
    onState: (newState) => {
      // Guest : on copie le state reçu dans notre stateRef pour le rendu
      const s = stateRef.current;
      s.p1 = newState.p1; s.p2 = newState.p2;
      s.gk1 = newState.gk1; s.gk2 = newState.gk2;
      s.ball = newState.ball;
      s.trail = newState.trail;
      setScore(newState.score);
      // Auto-démarrage : dès que le host envoie un state, le guest entre
      // automatiquement en phase running (plus besoin de cliquer Démarrer
      // côté invité — ça pouvait laisser le user bloqué sur l'écran "ready"
      // sans comprendre qu'il fallait cliquer).
      setPhase((p) => (p === 'setup' ? 'running' : p));
    },
  });

  // Démarrer la partie
  const start = () => {
    stateRef.current = initState();
    setScore({ p1: 0, p2: 0 });
    stateRef.current.ballV = randomKick();
    setPhase('running');
  };

  // ─ Saisie clavier ─────────────────────────────────────────────────────
  // En LOCAL : on capture toutes les touches (arrows + zqsd) → directement
  //            attribuées à J1 (arrows) et J2 (zqsd).
  // En HOST  : on capture mon schéma préféré → bouge mon paddle (J1).
  //            Les inputs du guest arrivent via onInput.
  // En GUEST : on capture mon schéma préféré → envoie input canonique au host.
  //            Aucune simulation locale, juste rendu.
  useEffect(() => {
    if (phase !== 'running') return;
    const isHostKey = (k: string): Dir | 'boost' | null => {
      const scheme = mode === 'local' ? 'both' : myScheme;
      if ((scheme === 'arrows' || scheme === 'both') && k === 'arrowup') return 'up';
      if ((scheme === 'arrows' || scheme === 'both') && k === 'arrowdown') return 'down';
      if ((scheme === 'arrows' || scheme === 'both') && k === 'arrowleft') return 'left';
      if ((scheme === 'arrows' || scheme === 'both') && k === 'arrowright') return 'right';
      if ((scheme === 'zqsd' || scheme === 'both') && (k === 'z' || k === 'w')) return 'up';
      if ((scheme === 'zqsd' || scheme === 'both') && k === 's') return 'down';
      if ((scheme === 'zqsd' || scheme === 'both') && (k === 'q' || k === 'a')) return 'left';
      if ((scheme === 'zqsd' || scheme === 'both') && k === 'd') return 'right';
      if (k === 'shift') return 'boost';
      return null;
    };

    const down = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      const d = isHostKey(k);
      if (d === null) return;
      e.preventDefault();
      if (mode === 'guest') {
        // Envoie input canonique au host (idempotent côté serveur)
        if (!sentGuestKeys.current.has(d)) {
          sentGuestKeys.current.add(d);
          sendInput({ dir: d, state: 'down' });
        }
      } else {
        // local ou host : stocke la touche brute pour la game loop
        stateRef.current.keysHost.add(k);
      }
    };
    const up = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      const d = isHostKey(k);
      if (d === null) return;
      if (mode === 'guest') {
        if (sentGuestKeys.current.has(d)) {
          sentGuestKeys.current.delete(d);
          sendInput({ dir: d, state: 'up' });
        }
      } else {
        stateRef.current.keysHost.delete(k);
      }
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, [phase, mode, myScheme, sendInput]);

  // Suivi des touches déjà envoyées au host (pour éviter les keydown répétés)
  const sentGuestKeys = useRef<Set<Dir | 'boost'>>(new Set());

  // ─ Game loop : uniquement en host ou local ────────────────────────────
  useEffect(() => {
    if (phase !== 'running') return;
    if (mode === 'guest') return; // guest ne simule pas

    const lastBroadcast = { t: 0 };
    const interval = window.setInterval(() => {
      const s = stateRef.current;
      stepGame(s, mode);

      // Check fin de partie
      // (les buts sont gérés dans stepGame via les callbacks)

      // Broadcast state au guest si remote (host)
      if (mode === 'host' && matchId) {
        const now = performance.now();
        if (now - lastBroadcast.t >= STATE_BROADCAST_MS) {
          lastBroadcast.t = now;
          sendState({
            p1: { ...s.p1 }, p2: { ...s.p2 },
            gk1: { ...s.gk1 }, gk2: { ...s.gk2 },
            ball: { ...s.ball },
            trail: s.trail.slice(),
            score,
          });
        }
      }

      // Dessin (local et host)
      const c = canvasRef.current;
      if (c) {
        const ctx = c.getContext('2d');
        if (ctx) draw(ctx, s, avatar1Ref.current, avatar2Ref.current, player1?.pseudo, player2?.pseudo);
      }
    }, TICK_MS);
    return () => clearInterval(interval);
    // score dans deps pour que le state broadcast inclue le score à jour
  }, [phase, mode, matchId, sendState, player1?.pseudo, player2?.pseudo, score]);

  // ─ Boucle rendu côté guest ───────────────────────────────────────────
  useEffect(() => {
    if (phase !== 'running' || mode !== 'guest') return;
    let raf = 0;
    const tick = () => {
      const c = canvasRef.current;
      if (c) {
        const ctx = c.getContext('2d');
        if (ctx) draw(ctx, stateRef.current, avatar1Ref.current, avatar2Ref.current, player1?.pseudo, player2?.pseudo);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [phase, mode, player1?.pseudo, player2?.pseudo]);

  // ─ Logique de buts → score / fin ─────────────────────────────────────
  // On surveille la position de la balle pour détecter quand elle sort par
  // un but. Comme stepGame mute s.ball, on observe les changements via un
  // effet qui ne dépend pas de score (sinon boucle infinie).
  const lastBallSideRef = useRef<'none' | 'left' | 'right'>('none');
  useEffect(() => {
    if (phase !== 'running') return;
    if (mode === 'guest') return;
    const check = setInterval(() => {
      const s = stateRef.current;
      const goalYMin = (H - GOAL_H) / 2;
      const goalYMax = (H + GOAL_H) / 2;
      const inGoal = s.ball.y >= goalYMin && s.ball.y <= goalYMax;
      if (s.ball.x - BALL_R <= 0 && inGoal && lastBallSideRef.current !== 'left') {
        lastBallSideRef.current = 'left';
        setScore((sc) => {
          const next = { ...sc, p1: sc.p1 + 1 };
          if (next.p1 >= WIN_GOALS) {
            setPhase('done');
            setTimeout(() => onFinish(next.p1, next.p2), 700);
          } else {
            resetBall(s, 1);
            setTimeout(() => { lastBallSideRef.current = 'none'; }, 80);
          }
          return next;
        });
      } else if (s.ball.x + BALL_R >= W && inGoal && lastBallSideRef.current !== 'right') {
        lastBallSideRef.current = 'right';
        setScore((sc) => {
          const next = { ...sc, p2: sc.p2 + 1 };
          if (next.p2 >= WIN_GOALS) {
            setPhase('done');
            setTimeout(() => onFinish(next.p1, next.p2), 700);
          } else {
            resetBall(s, -1);
            setTimeout(() => { lastBallSideRef.current = 'none'; }, 80);
          }
          return next;
        });
      }
    }, 25);
    return () => clearInterval(check);
  }, [phase, mode, onFinish]);

  // ─ UI ────────────────────────────────────────────────────────────────
  const showSchemePicker = phase === 'setup' && mode !== 'local';
  const ctrlHint = mode === 'local'
    ? '🔵 J2 (gauche) : ZQSD · 🔴 J1 (droite) : flèches · Shift = boost'
    : mode === 'host'
    ? `Tu joues 🔴 J1 (droite) — ${myScheme === 'arrows' ? 'flèches ↑↓←→' : 'ZQSD'} + Shift pour booster`
    : `Tu joues 🔵 J2 (gauche) — ${myScheme === 'arrows' ? 'flèches ↑↓←→' : 'ZQSD'} + Shift pour booster`;

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
      {showSchemePicker && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
          <div className="eyebrow"><span className="label">Tes contrôles</span></div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              className={`chip ${myScheme === 'arrows' ? 'active accent' : ''}`}
              onClick={() => setMyScheme('arrows')}
            >Flèches ↑↓←→</button>
            <button
              type="button"
              className={`chip ${myScheme === 'zqsd' ? 'active accent' : ''}`}
              onClick={() => setMyScheme('zqsd')}
            >ZQSD / WASD</button>
          </div>
        </div>
      )}
      {phase === 'setup' && mode !== 'guest' && (
        <>
          <button className="btn btn-accent btn-lg" onClick={start}>Démarrer</button>
          <div style={{ color: 'var(--muted)', fontSize: 13, textAlign: 'center', lineHeight: 1.6 }}>
            {ctrlHint}<br />
            Chacun a un gardien automatique. Premier à {WIN_GOALS} buts gagne.
            {mode === 'host' && <><br />⚡ Mode distance — c'est toi qui lances la partie pour les deux.</>}
          </div>
        </>
      )}
      {phase === 'setup' && mode === 'guest' && (
        <div style={{ color: 'var(--muted)', fontSize: 14, textAlign: 'center', lineHeight: 1.6, padding: '10px 0' }}>
          ⚡ Tu es <strong style={{ color: '#5B8CFF' }}>🔵 J2</strong>. Tu joues avec <strong>{myScheme === 'arrows' ? 'les flèches' : 'ZQSD'}</strong>{' '}
          + Shift pour booster.<br />
          <span style={{ opacity: 0.85 }}>En attente que ton adversaire lance la partie…</span>
        </div>
      )}
      {phase === 'running' && (
        <div style={{ color: 'var(--muted)', fontSize: 13 }}>
          Shift = boost · Premier à {WIN_GOALS} buts.
          {mode === 'guest' && ' · Distance ~50-150ms (relais SSE)'}
        </div>
      )}
      {phase === 'done' && <div style={{ color: 'var(--muted)' }}>Match terminé. Score envoyé…</div>}
    </div>
  );
}

// Game step : appelé par le host (et le local). Bouge tout selon les inputs.
function stepGame(s: State, mode: 'local' | 'host' | 'guest') {
  // En guest, on ne simule pas — la fonction ne devrait pas être appelée mais
  // on protège par sécurité.
  if (mode === 'guest') return;

  // 1) Déplace les attaquants
  const prevP1 = { ...s.p1 }, prevP2 = { ...s.p2 };
  if (mode === 'local') {
    // Tout le clavier contrôle J1 (arrows) et J2 (zqsd)
    const speedP1 = s.keysHost.has('shift') ? PADDLE_BOOST_SPEED : PADDLE_SPEED;
    const speedP2 = s.keysHost.has('shift') ? PADDLE_BOOST_SPEED : PADDLE_SPEED;
    if (s.keysHost.has('arrowup'))    s.p1.y -= speedP1;
    if (s.keysHost.has('arrowdown'))  s.p1.y += speedP1;
    if (s.keysHost.has('arrowleft'))  s.p1.x -= speedP1;
    if (s.keysHost.has('arrowright')) s.p1.x += speedP1;
    if (s.keysHost.has('z') || s.keysHost.has('w')) s.p2.y -= speedP2;
    if (s.keysHost.has('s'))                         s.p2.y += speedP2;
    if (s.keysHost.has('q') || s.keysHost.has('a')) s.p2.x -= speedP2;
    if (s.keysHost.has('d'))                         s.p2.x += speedP2;
  } else {
    // Host : mes touches locales (canonicalisées via myScheme par le listener
    // → on doit ré-canonicaliser ici puisque keysHost contient les codes
    // bruts). Pour simplifier : en host, on stocke les touches brutes et on
    // gère l'attribution ici. Mais le mapping varie par scheme — on va
    // utiliser un trick : keysHost contient déjà les codes ; pour le host,
    // on map vers J1 et keysGuest vers J2.
    const speedP1 = s.keysHost.has('shift') ? PADDLE_BOOST_SPEED : PADDLE_SPEED;
    const speedP2 = s.keysGuest.has('boost') ? PADDLE_BOOST_SPEED : PADDLE_SPEED;
    // J1 (host) : on accepte arrows OU zqsd, peu importe la pref (le listener
    // a déjà filtré côté browser).
    if (s.keysHost.has('arrowup') || s.keysHost.has('z') || s.keysHost.has('w')) s.p1.y -= speedP1;
    if (s.keysHost.has('arrowdown') || s.keysHost.has('s'))                       s.p1.y += speedP1;
    if (s.keysHost.has('arrowleft') || s.keysHost.has('q') || s.keysHost.has('a')) s.p1.x -= speedP1;
    if (s.keysHost.has('arrowright') || s.keysHost.has('d'))                       s.p1.x += speedP1;
    // J2 (guest) : depuis les directions canoniques envoyées par le guest
    if (s.keysGuest.has('up'))    s.p2.y -= speedP2;
    if (s.keysGuest.has('down'))  s.p2.y += speedP2;
    if (s.keysGuest.has('left'))  s.p2.x -= speedP2;
    if (s.keysGuest.has('right')) s.p2.x += speedP2;
  }
  s.p1.x = clamp(s.p1.x, W / 2 + PADDLE_R, W - PADDLE_R);
  s.p1.y = clamp(s.p1.y, PADDLE_R, H - PADDLE_R);
  s.p2.x = clamp(s.p2.x, PADDLE_R, W / 2 - PADDLE_R);
  s.p2.y = clamp(s.p2.y, PADDLE_R, H - PADDLE_R);
  s.p1V = { x: s.p1.x - prevP1.x, y: s.p1.y - prevP1.y };
  s.p2V = { x: s.p2.x - prevP2.x, y: s.p2.y - prevP2.y };

  // 2) Gardiens auto — nerfés : ne réagissent que si la balle est dans leur
  //    zone de réaction (les GK_REACT_RANGE px devant leur but). Au-delà,
  //    ils retournent tranquillement au centre du but. Combiné avec
  //    GK_SPEED 1.6 (vs 2.6 avant), il devient possible de tirer en lob /
  //    angle prononcé / boost paddle sans qu'ils colmatent tout.
  const goalYMin = (H - GOAL_H) / 2 + GK_R;
  const goalYMax = (H + GOAL_H) / 2 - GK_R;
  const distGk1 = W - s.ball.x;   // distance balle → but de droite (J1 défend)
  const distGk2 = s.ball.x;       // distance balle → but de gauche (J2 défend)

  // GK1 (J1, droite) : actif si balle dans les GK_REACT_RANGE px à sa droite
  if (distGk1 < GK_REACT_RANGE) {
    const dy = clamp(s.ball.y - s.gk1.y, -GK_SPEED, GK_SPEED);
    s.gk1.y = clamp(s.gk1.y + dy, goalYMin, goalYMax);
  } else {
    const dy = clamp(H / 2 - s.gk1.y, -GK_SPEED * 0.6, GK_SPEED * 0.6);
    s.gk1.y = clamp(s.gk1.y + dy, goalYMin, goalYMax);
  }

  // GK2 (J2, gauche) : symétrique
  if (distGk2 < GK_REACT_RANGE) {
    const dy = clamp(s.ball.y - s.gk2.y, -GK_SPEED, GK_SPEED);
    s.gk2.y = clamp(s.gk2.y + dy, goalYMin, goalYMax);
  } else {
    const dy = clamp(H / 2 - s.gk2.y, -GK_SPEED * 0.6, GK_SPEED * 0.6);
    s.gk2.y = clamp(s.gk2.y + dy, goalYMin, goalYMax);
  }

  // 3) Balle + trail
  s.trail.push({ x: s.ball.x, y: s.ball.y });
  if (s.trail.length > TRAIL_LEN) s.trail.shift();
  s.ball.x += s.ballV.x;
  s.ball.y += s.ballV.y;
  s.ballV.x *= BALL_FRICTION;
  s.ballV.y *= BALL_FRICTION;
  if (Math.abs(s.ballV.x) < MIN_BALL_SPEED && Math.abs(s.ballV.y) < MIN_BALL_SPEED) {
    s.ballV.x = 0; s.ballV.y = 0;
  }
  if (s.ball.y - BALL_R <= 0 && s.ballV.y < 0) { s.ball.y = BALL_R; s.ballV.y *= -1; }
  if (s.ball.y + BALL_R >= H && s.ballV.y > 0) { s.ball.y = H - BALL_R; s.ballV.y *= -1; }

  // 4) Collisions paddles + gks
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
      s.ball.x = pad.x + nx * (BALL_R + r);
      s.ball.y = pad.y + ny * (BALL_R + r);
      const dot = s.ballV.x * nx + s.ballV.y * ny;
      s.ballV.x = (s.ballV.x - 2 * dot * nx) + padV.x * 0.85;
      s.ballV.y = (s.ballV.y - 2 * dot * ny) + padV.y * 0.85;
      const sp = Math.hypot(s.ballV.x, s.ballV.y);
      if (sp < 4) { const k = 4 / Math.max(sp, 0.001); s.ballV.x *= k; s.ballV.y *= k; }
      const maxSp = 18;
      if (sp > maxSp) { const k = maxSp / sp; s.ballV.x *= k; s.ballV.y *= k; }
    }
  }

  // 5) Rebonds horizontaux hors but
  const goalYMinB = (H - GOAL_H) / 2;
  const goalYMaxB = (H + GOAL_H) / 2;
  const inGoalY = s.ball.y >= goalYMinB && s.ball.y <= goalYMaxB;
  if (s.ball.x - BALL_R <= 0 && !inGoalY) { s.ball.x = BALL_R; s.ballV.x *= -1; }
  if (s.ball.x + BALL_R >= W && !inGoalY) { s.ball.x = W - BALL_R; s.ballV.x *= -1; }
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

function draw(
  ctx: CanvasRenderingContext2D, s: State,
  avatar1: HTMLImageElement | null, avatar2: HTMLImageElement | null,
  pseudo1?: string, pseudo2?: string,
) {
  ctx.fillStyle = '#0E3318';
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = 'rgba(255,255,255,0.25)';
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(W / 2, 0); ctx.lineTo(W / 2, H); ctx.stroke();
  ctx.beginPath(); ctx.arc(W / 2, H / 2, 44, 0, Math.PI * 2); ctx.stroke();
  ctx.strokeRect(0, (H - GOAL_H - 40) / 2, 80, GOAL_H + 40);
  ctx.strokeRect(W - 80, (H - GOAL_H - 40) / 2, 80, GOAL_H + 40);
  const goalYMin = (H - GOAL_H) / 2;
  ctx.fillStyle = 'rgba(255,255,255,0.10)';
  ctx.fillRect(0, goalYMin, 6, GOAL_H);
  ctx.fillRect(W - 6, goalYMin, 6, GOAL_H);
  ctx.strokeStyle = 'rgba(255,255,255,0.55)';
  ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(0, goalYMin); ctx.lineTo(0, goalYMin + GOAL_H); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(W, goalYMin); ctx.lineTo(W, goalYMin + GOAL_H); ctx.stroke();

  for (let i = 0; i < s.trail.length; i++) {
    const t = s.trail[i];
    const alpha = (i + 1) / s.trail.length * 0.4;
    ctx.fillStyle = `rgba(214, 255, 61, ${alpha})`;
    ctx.beginPath();
    ctx.arc(t.x, t.y, BALL_R * (0.4 + (i / s.trail.length) * 0.6), 0, Math.PI * 2);
    ctx.fill();
  }
  drawGoalkeeper(ctx, s.gk1, '#FF6B57');
  drawGoalkeeper(ctx, s.gk2, '#5B8CFF');
  drawPlayerPaddle(ctx, s.p1, '#FF6B57', avatar1, pseudo1, 'right');
  drawPlayerPaddle(ctx, s.p2, '#5B8CFF', avatar2, pseudo2, 'left');
  ctx.fillStyle = '#D6FF3D';
  ctx.beginPath(); ctx.arc(s.ball.x, s.ball.y, BALL_R, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#7A9B22'; ctx.lineWidth = 2; ctx.stroke();
}

function drawGoalkeeper(ctx: CanvasRenderingContext2D, pos: V2, color: string) {
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  ctx.beginPath(); ctx.arc(pos.x, pos.y, GK_R, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = color; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.arc(pos.x, pos.y, GK_R, 0, Math.PI * 2); ctx.stroke();
  ctx.fillStyle = color;
  ctx.font = `${GK_R * 1.1}px serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('🧤', pos.x, pos.y + 1);
}

function drawPlayerPaddle(
  ctx: CanvasRenderingContext2D, pos: V2, color: string,
  avatar: HTMLImageElement | null, pseudo: string | undefined, pseudoSide: 'left' | 'right',
) {
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
  ctx.strokeStyle = color; ctx.lineWidth = 4;
  ctx.beginPath(); ctx.arc(pos.x, pos.y, PADDLE_R, 0, Math.PI * 2); ctx.stroke();
  if (pseudo) {
    ctx.fillStyle = color;
    ctx.font = `bold 13px var(--font-body, sans-serif)`;
    ctx.textAlign = pseudoSide === 'right' ? 'left' : 'right';
    ctx.textBaseline = 'middle';
    ctx.fillText(pseudo, pos.x + (pseudoSide === 'right' ? PADDLE_R + 8 : -PADDLE_R - 8), pos.y);
  }
}
