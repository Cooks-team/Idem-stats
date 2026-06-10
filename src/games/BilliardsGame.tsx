import { useEffect, useRef, useState } from 'react';
import type { GameModule, GameProps } from './GameModule';
import { useEmotePair } from '../realtime/useEmotePair';
import { EmoteBubble } from '../ui/EmoteBubble';
import { EmotePicker } from '../ui/EmotePicker';

// Billard 8-ball avec les vraies règles :
//   1. Pile ou face animé pour décider qui commence
//   2. 15 boules en triangle : 7 solid (1-7) + 7 stripe (9-15) + noire (8)
//      au centre du triangle (rangée 2, position centrale)
//   3. Tant que les groupes ne sont pas attribués (open game), la 1ère
//      boule colorée potée définit le groupe du joueur qui l'a potée.
//      L'opponent récupère l'autre groupe.
//   4. Une fois les groupes attribués :
//        - tu pottes ton groupe = +1, tu rejoues
//        - tu pottes l'autre groupe = opponent +1, tu perds ton tour
//        - tu pottes la noire AVANT d'avoir clear ton groupe = LOSS instant
//        - tu pottes la noire APRÈS avoir clear ton groupe = WIN instant
//   5. Boule blanche pochée = respawn, tu perds ton tour (faute simple).

const W = 720;
const H = 380;
const BALL_R = 12;
const POCKET_R = 18;
const CUSHION = 14;
const FRICTION = 0.987;
const MIN_SPEED = 0.05;
const POWER_SCALE = 1 / 7;
const MAX_POWER = 22;
const TICK_MS = 16;
const CUE_START: V2 = { x: 175, y: H / 2 };
const FLIP_DURATION_MS = 2400;
const FLIP_RESULT_DELAY_MS = 1600;

type Group = 'solid' | 'stripe';
type Phase = 'choosing' | 'coinflip' | 'flipresult' | 'aim' | 'shooting' | 'done';
type Owner = Group | 'eight';
type CoinSide = 'pile' | 'face';

interface V2 { x: number; y: number }
interface Ball {
  id: number; // 0 = cue, 1-7 solid, 8 = noire, 9-15 stripe
  pos: V2;
  vel: V2;
  color: string;        // couleur dominante (jaune, bleu…)
  alive: boolean;
  owner: Owner | 'cue'; // pour grouper rapidement
}

// Palette pool standard
//   1 = jaune, 2 = bleu, 3 = rouge, 4 = violet, 5 = orange, 6 = vert, 7 = bordeaux
//   8 = noire, 9-15 = stripe des mêmes couleurs
const BALL_COLORS = [
  '#FFFFFF',                                                                                  // 0 cue
  '#FFD400', '#0050C8', '#D32030', '#7B2B8E', '#FF7A1F', '#0F8A3E', '#7A1B1B',                // 1-7 solid
  '#0E0E12',                                                                                  // 8
  '#FFD400', '#0050C8', '#D32030', '#7B2B8E', '#FF7A1F', '#0F8A3E', '#7A1B1B',                // 9-15 stripe
];

function ownerOf(id: number): Owner | 'cue' {
  if (id === 0) return 'cue';
  if (id === 8) return 'eight';
  if (id <= 7) return 'solid';
  return 'stripe';
}

function initBalls(): Ball[] {
  const cue: Ball = {
    id: 0, pos: { ...CUE_START }, vel: { x: 0, y: 0 },
    color: BALL_COLORS[0], alive: true, owner: 'cue',
  };
  // Triangle 8-ball standard : 5 rangées (1, 2, 3, 4, 5)
  // Position de la noire : rangée 2, centre (index 4 dans l'ordre apex-vers-arrière)
  const rowCounts = [1, 2, 3, 4, 5];
  const startX = 460;
  const startY = H / 2;
  const rowSpacing = BALL_R * 1.87;
  const ballSpacing = BALL_R * 2.05;

  // Layout des IDs : on alterne solid/stripe avec la noire pile au milieu
  //   Row 0 (1) : 1
  //   Row 1 (2) : 9, 2
  //   Row 2 (3) : 10, 8, 3       ← noire au centre
  //   Row 3 (4) : 11, 4, 12, 5
  //   Row 4 (5) : 6, 13, 7, 14, 15
  const ids = [
    1,
    9, 2,
    10, 8, 3,
    11, 4, 12, 5,
    6, 13, 7, 14, 15,
  ];

  const balls: Ball[] = [cue];
  let idx = 0;
  for (let row = 0; row < 5; row++) {
    const count = rowCounts[row];
    const x = startX + row * rowSpacing;
    for (let i = 0; i < count; i++) {
      const y = startY + (i - (count - 1) / 2) * ballSpacing;
      const id = ids[idx++];
      balls.push({
        id, pos: { x, y }, vel: { x: 0, y: 0 },
        color: BALL_COLORS[id], alive: true, owner: ownerOf(id),
      });
    }
  }
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
  description: '8-ball pool. Pile ou face puis vraies règles : groupe par 1er pot, finir par la noire.',
  Component: BilliardsComponent,
};

function BilliardsComponent({ onFinish, mode = 'local', matchId }: GameProps) {
  const emotes = useEmotePair({ matchId, mode });
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const stateRef = useRef<{ balls: Ball[]; aim: V2 | null }>({ balls: initBalls(), aim: null });
  // Démarre sur 'choosing' : J1 choisit pile ou face avant le flip
  const [phase, setPhase] = useState<Phase>('choosing');
  const [currentPlayer, setCurrentPlayer] = useState<1 | 2>(1);
  const [scores, setScores] = useState({ p1: 0, p2: 0 });
  const [groups, setGroups] = useState<{ p1?: Group; p2?: Group }>({});
  const aliveBeforeShotRef = useRef(0);
  // Tracking de l'animation pile ou face
  const flipStartRef = useRef<number>(0);
  const flipResultRef = useRef<1 | 2 | null>(null);
  // Choix du joueur (J1 par convention) et résultat réel du tirage
  const [chosenSide, setChosenSide] = useState<CoinSide | null>(null);
  const flippedSideRef = useRef<CoinSide>('pile');
  // Raison de fin de partie pour le message
  const [endReason, setEndReason] = useState<'eight_correct' | 'eight_wrong' | 'normal'>('normal');
  const [endWinner, setEndWinner] = useState<1 | 2 | null>(null);

  // ─ Phase 'choosing' : on affiche juste la table verte avec la pièce posée
  //   en attendant que J1 clique Pile ou Face. Le dessin se fait via le UI
  //   React au-dessous (boutons), pas dans le canvas.
  useEffect(() => {
    if (phase !== 'choosing') return;
    drawChoosing(canvasRef);
  }, [phase]);

  function callCoin(side: CoinSide) {
    if (phase !== 'choosing') return;
    setChosenSide(side);
    // Tirage réel : pile = J1 gagne, face = J2 gagne (convention arbitraire).
    // Le côté tiré au sort est indépendant du choix de J1 — J1 a 50% de
    // tomber juste.
    const tirage: CoinSide = Math.random() < 0.5 ? 'pile' : 'face';
    flippedSideRef.current = tirage;
    // J1 gagne s'il a deviné juste
    const winner: 1 | 2 = side === tirage ? 1 : 2;
    flipResultRef.current = winner;
    setPhase('coinflip');
  }

  // ─ Pile ou face : animation ─────────────────────────────────────────────
  // Lance un rAF pour animer le flip. La face finale = flippedSideRef (tiré
  // au sort à la frame de l'appel). Le winner sortant est figé via setCurrentPlayer.
  useEffect(() => {
    if (phase !== 'coinflip') return;
    flipStartRef.current = performance.now();
    const winner = flipResultRef.current ?? 1;
    const finalSide = flippedSideRef.current;
    let raf = 0;
    const tick = () => {
      const elapsed = performance.now() - flipStartRef.current;
      drawCoinFlip(canvasRef, elapsed, finalSide, chosenSide ?? 'pile');
      if (elapsed < FLIP_DURATION_MS) {
        raf = requestAnimationFrame(tick);
      } else {
        setCurrentPlayer(winner);
        setPhase('flipresult');
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [phase, chosenSide]);

  // Affiche le résultat du flip pendant ~1.6s puis bascule en aim
  useEffect(() => {
    if (phase !== 'flipresult') return;
    drawFlipResult(canvasRef, flipResultRef.current ?? 1, flippedSideRef.current, chosenSide ?? 'pile');
    const t = window.setTimeout(() => {
      setPhase('aim');
      redraw();
    }, FLIP_RESULT_DELAY_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

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
    drawTable(ctx, stateRef.current.balls, stateRef.current.aim, phase, currentPlayer, groups);
  }

  // ─ Physique ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (phase !== 'shooting') return;
    const interval = window.setInterval(() => {
      const s = stateRef.current;
      stepBalls(s.balls);
      redraw();

      const stopped = s.balls.every((b) => !b.alive || (Math.abs(b.vel.x) < 0.001 && Math.abs(b.vel.y) < 0.001));
      if (!stopped) return;
      clearInterval(interval);

      // Inventaire des boules potées sur ce coup
      const pottedThisShot: Ball[] = [];
      // On refait un balayage : tout ce qui a alive=false sans avoir été déjà
      // marqué dans un tour précédent (en pratique : tout ce qui était alive
      // au début du shot et qui ne l'est plus).
      // Plus simple : on snapshot avant et on diff. Mais on a juste alive un bit,
      // donc on regarde tout ce qui n'est plus alive et qui ne l'était pas avant
      // serait complexe. À la place, on track "deaths during shot" autrement :
      // pas le temps, on regarde "alive après" et on compare au count avant.
      // Pour identifier QUELLES boules, on stocke leur owner avec un tag.
      // Simplification : on parcourt tout, on identifie celles qui sont mortes
      // (alive=false) et on classe par owner. Comme les boules mortes restent
      // mortes, on ne re-traite pas celles d'avant — on ne saurait pas.
      // SOLUTION : on stocke un Set des ids morts au START du shot.
      // → cf. plus haut on a aliveBeforeShotRef = count uniquement. Il faut
      //   aussi un Set ids vivants avant. Trop tard pour ça : on fait un hack
      //   en passant pottedJustNow via stateRef.
      // Pour bien faire, refactor : on stocke aliveIdsBeforeShot dans une ref.
      const allDeadIds = s.balls.filter((b) => !b.alive).map((b) => b.id);
      const beforeAliveIds = aliveIdsBeforeShotRef.current;
      for (const id of allDeadIds) {
        if (beforeAliveIds.has(id)) {
          const ball = s.balls.find((b) => b.id === id);
          if (ball) pottedThisShot.push(ball);
        }
      }

      const myKey = currentPlayer === 1 ? 'p1' : 'p2';
      const myGroup = groups[myKey];
      const otherKey = currentPlayer === 1 ? 'p2' : 'p1';

      // Cue ball pochée ?
      const cuePotted = pottedThisShot.some((b) => b.id === 0);
      const eightPotted = pottedThisShot.some((b) => b.id === 8);
      const coloredPotted = pottedThisShot.filter((b) => b.id !== 0 && b.id !== 8);

      // Respawn cue si nécessaire
      const cue = s.balls[0];
      if (cuePotted) {
        cue.alive = true;
        cue.pos = { ...CUE_START };
        cue.vel = { x: 0, y: 0 };
      }

      // CAS NOIRE POTÉE → fin de partie immédiate
      if (eightPotted) {
        const myColoredLeft = s.balls.filter((b) => b.alive && b.owner === myGroup).length;
        const clearedMyGroup = myGroup !== undefined && myColoredLeft === 0;
        const winner: 1 | 2 = clearedMyGroup && !cuePotted ? currentPlayer : (currentPlayer === 1 ? 2 : 1);
        setEndWinner(winner);
        setEndReason(clearedMyGroup && !cuePotted ? 'eight_correct' : 'eight_wrong');
        setPhase('done');
        // Score envoyé : winner reçoit bonus 100 + ses pots, loser garde ses pots
        const myPots = scores[myKey];
        const otherPots = scores[otherKey];
        const winnerKey = winner === 1 ? 'p1' : 'p2';
        const winnerPots = winnerKey === myKey ? myPots : otherPots;
        const loserPots = winnerKey === myKey ? otherPots : myPots;
        const sc1 = winner === 1 ? 100 + winnerPots : loserPots;
        const sc2 = winner === 2 ? 100 + winnerPots : loserPots;
        setTimeout(() => onFinish(sc1, sc2), 1500);
        return;
      }

      // Attribution des groupes si pas encore fait + coloured potted
      let updatedGroups = groups;
      let scoreDelta = { p1: 0, p2: 0 };
      if (!groups.p1 && !groups.p2 && coloredPotted.length > 0) {
        // Prend l'owner de la première colorée potée
        const firstOwner = coloredPotted[0].owner as Group;
        const otherOwner: Group = firstOwner === 'solid' ? 'stripe' : 'solid';
        updatedGroups = currentPlayer === 1
          ? { p1: firstOwner, p2: otherOwner }
          : { p1: otherOwner, p2: firstOwner };
        setGroups(updatedGroups);
      }

      // Calcul des scores : chaque colorée potée donne 1 point à son owner
      // (pas au joueur qui a tiré — si tu pottes la boule de l'autre, c'est
      // lui qui marque, règle classique).
      const myGroupFinal = currentPlayer === 1 ? updatedGroups.p1 : updatedGroups.p2;
      const otherGroupFinal = currentPlayer === 1 ? updatedGroups.p2 : updatedGroups.p1;
      for (const b of coloredPotted) {
        if (b.owner === myGroupFinal) scoreDelta[myKey] += 1;
        else if (b.owner === otherGroupFinal) scoreDelta[otherKey] += 1;
      }

      let nextScores = scores;
      if (scoreDelta.p1 !== 0 || scoreDelta.p2 !== 0) {
        nextScores = { p1: scores.p1 + scoreDelta.p1, p2: scores.p2 + scoreDelta.p2 };
        setScores(nextScores);
      }

      // Tour suivant ?
      // - Cue pochée → on perd le tour, faute simple
      // - Si on a poté au moins UNE boule de notre groupe (et pas cue) → rejouons
      // - Sinon → l'autre joueur joue
      const myOwnPotted = coloredPotted.some((b) => b.owner === myGroupFinal);
      if (cuePotted || !myOwnPotted) {
        setCurrentPlayer((p) => (p === 1 ? 2 : 1));
      }

      setPhase('aim');
      redraw();
    }, TICK_MS);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, currentPlayer, scores, groups]);

  // Stocke l'état "ids alive avant le shot" pour pouvoir identifier
  // les boules potées au moment du resolve
  const aliveIdsBeforeShotRef = useRef<Set<number>>(new Set());
  useEffect(() => {
    if (phase !== 'shooting') return;
    aliveIdsBeforeShotRef.current = new Set(
      stateRef.current.balls.filter((b) => b.alive).map((b) => b.id),
    );
  }, [phase]);

  // Premier rendu une fois sorti du coinflip
  useEffect(() => {
    if (phase === 'aim') redraw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  const turnColor = currentPlayer === 1 ? '#FF6B57' : '#5B8CFF';
  const turnLabel = currentPlayer === 1 ? '🔴 Joueur 1' : '🔵 Joueur 2';
  const myGroup = currentPlayer === 1 ? groups.p1 : groups.p2;

  // Billard turn-based : pas de "côté" gauche/droite, mais on attache
  // myKey à P1 si je suis host/local, à P2 si je suis guest — pareil que
  // les autres jeux.
  const p1EmoteKey = mode === 'guest' ? emotes.opponentKey : emotes.myKey;
  const p2EmoteKey = mode === 'guest' ? emotes.myKey : emotes.opponentKey;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, position: 'relative' }}>
      <div style={{ position: 'absolute', top: 0, right: 0, zIndex: 5 }}>
        <EmotePicker onPick={emotes.triggerMine} />
      </div>
      <div style={{ display: 'flex', gap: 60, fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 30, alignItems: 'center' }}>
        <span style={{ color: '#FF6B57', display: 'inline-flex', alignItems: 'center' }}>
          🔴 {scores.p1}
          {groups.p1 && <span style={{ fontSize: 14, marginLeft: 6, opacity: 0.85 }}>{groups.p1 === 'solid' ? '● PLEINES' : '◐ RAYÉES'}</span>}
          <EmoteBubble emoteKey={p1EmoteKey} side="right" />
        </span>
        <span style={{ color: '#5B8CFF', display: 'inline-flex', alignItems: 'center' }}>
          🔵 {scores.p2}
          {groups.p2 && <span style={{ fontSize: 14, marginLeft: 6, opacity: 0.85 }}>{groups.p2 === 'solid' ? '● PLEINES' : '◐ RAYÉES'}</span>}
          <EmoteBubble emoteKey={p2EmoteKey} side="right" />
        </span>
      </div>

      {phase === 'choosing' && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 18, color: '#FF6B57' }}>
            🔴 Joueur 1, à toi de choisir :
          </div>
          <div style={{ display: 'flex', gap: 12 }}>
            <button
              type="button"
              className="btn btn-accent btn-lg"
              onClick={() => callCoin('pile')}
              style={{ minWidth: 120, fontSize: 18 }}
            >🪙 PILE</button>
            <button
              type="button"
              className="btn btn-accent btn-lg"
              onClick={() => callCoin('face')}
              style={{ minWidth: 120, fontSize: 18 }}
            >🪙 FACE</button>
          </div>
          <div style={{ color: 'var(--muted)', fontSize: 12.5, textAlign: 'center', maxWidth: 360 }}>
            Si tu devines juste, tu commences. Sinon, c'est ton adversaire qui ouvre.
          </div>
        </div>
      )}
      {phase === 'coinflip' && chosenSide && (
        <div style={{ color: 'var(--muted)', fontSize: 14 }}>
          J1 a appelé <strong style={{ color: '#FF6B57' }}>{chosenSide.toUpperCase()}</strong>… on tire !
        </div>
      )}
      {phase === 'flipresult' && (
        <div style={{ color: turnColor, fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 22 }}>
          {turnLabel} commence !
        </div>
      )}
      {(phase === 'aim' || phase === 'shooting') && (
        <div style={{ color: turnColor, fontWeight: 700, fontSize: 14, textAlign: 'center' }}>
          Au tour de {turnLabel}
          {myGroup && <span style={{ marginLeft: 8, opacity: 0.85 }}>· vise les {myGroup === 'solid' ? 'pleines' : 'rayées'}</span>}
          {!myGroup && (groups.p1 || groups.p2) === undefined && <span style={{ marginLeft: 8, opacity: 0.7 }}>· open game (1er pot = ton groupe)</span>}
          {phase === 'shooting' && ' · en attente…'}
        </div>
      )}
      {phase === 'done' && (
        <div style={{ color: endReason === 'eight_correct' ? 'var(--win)' : 'var(--loss)',
                     fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 22, textAlign: 'center' }}>
          {endReason === 'eight_correct' && `🎱 Joueur ${endWinner} gagne en empochant la noire ! 👑`}
          {endReason === 'eight_wrong' && `💀 Noire trop tôt — Joueur ${endWinner} gagne par défaut`}
          {endReason === 'normal' && 'Terminé !'}
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
      <div style={{ color: 'var(--muted)', fontSize: 12.5, textAlign: 'center', maxWidth: 520, lineHeight: 1.5 }}>
        <strong>Drag pour viser, lâche pour tirer.</strong> Pochete une boule de TON groupe = tu rejoues.
        L'opponent gagne le point sur tes erreurs.<br />
        Finis par la <strong style={{ color: '#000' }}>noire</strong> APRÈS avoir clear tout ton groupe.
        Noire trop tôt = défaite immédiate.
      </div>
    </div>
  );
}

// ─ Physique balls ────────────────────────────────────────────────────────
function stepBalls(balls: Ball[]) {
  for (const b of balls) {
    if (!b.alive) continue;
    b.pos.x += b.vel.x;
    b.pos.y += b.vel.y;
    b.vel.x *= FRICTION;
    b.vel.y *= FRICTION;
    if (Math.abs(b.vel.x) < MIN_SPEED) b.vel.x = 0;
    if (Math.abs(b.vel.y) < MIN_SPEED) b.vel.y = 0;
    if (b.pos.x - BALL_R <= CUSHION && b.vel.x < 0)  { b.pos.x = CUSHION + BALL_R;     b.vel.x *= -0.82; }
    if (b.pos.x + BALL_R >= W - CUSHION && b.vel.x > 0) { b.pos.x = W - CUSHION - BALL_R; b.vel.x *= -0.82; }
    if (b.pos.y - BALL_R <= CUSHION && b.vel.y < 0)  { b.pos.y = CUSHION + BALL_R;     b.vel.y *= -0.82; }
    if (b.pos.y + BALL_R >= H - CUSHION && b.vel.y > 0) { b.pos.y = H - CUSHION - BALL_R; b.vel.y *= -0.82; }
  }
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
        const overlap = (minDist - dist) / 2;
        const nx = dx / dist, ny = dy / dist;
        a.pos.x -= nx * overlap;
        a.pos.y -= ny * overlap;
        b.pos.x += nx * overlap;
        b.pos.y += ny * overlap;
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

// ─ Dessin pile ou face animé ─────────────────────────────────────────────
function drawChoosing(canvasRef: React.RefObject<HTMLCanvasElement>) {
  const c = canvasRef.current; if (!c) return;
  const ctx = c.getContext('2d'); if (!ctx) return;
  // Table verte
  ctx.fillStyle = '#0E693A';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#5B3A1F';
  ctx.fillRect(0, 0, W, CUSHION);
  ctx.fillRect(0, H - CUSHION, W, CUSHION);
  ctx.fillRect(0, 0, CUSHION, H);
  ctx.fillRect(W - CUSHION, 0, CUSHION, H);

  // Pièce posée au centre avec un léger glow d'attente
  const cx = W / 2, cy = H / 2;
  const coinR = 56;
  // Halo doré pulsant léger (basé sur Date pas dispo dans rAF, on prend juste un cercle simple)
  ctx.fillStyle = 'rgba(255, 215, 0, 0.12)';
  ctx.beginPath(); ctx.arc(cx, cy, coinR + 24, 0, Math.PI * 2); ctx.fill();
  // Ombre
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.beginPath(); ctx.ellipse(cx, cy + coinR + 18, coinR * 0.85, 7, 0, 0, Math.PI * 2); ctx.fill();
  // Pièce (montrant PILE par défaut au repos)
  const grad = ctx.createRadialGradient(cx - coinR * 0.3, cy - coinR * 0.4, 5, cx, cy, coinR);
  grad.addColorStop(0, '#FFEB7A');
  grad.addColorStop(1, '#C49B22');
  ctx.fillStyle = grad;
  ctx.beginPath(); ctx.arc(cx, cy, coinR, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#7A5E16'; ctx.lineWidth = 3; ctx.stroke();
  ctx.fillStyle = '#3D2D08';
  ctx.font = 'bold 28px var(--font-display, sans-serif)';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('?', cx, cy);

  // Bandeau supérieur
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.fillRect(0, CUSHION, W, 36);
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 18px var(--font-display, sans-serif)';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('À toi de choisir !', W / 2, CUSHION + 18);
}

function drawCoinFlip(canvasRef: React.RefObject<HTMLCanvasElement>, elapsed: number, finalSide: CoinSide, chosen: CoinSide) {
  const c = canvasRef.current; if (!c) return;
  const ctx = c.getContext('2d'); if (!ctx) return;
  ctx.fillStyle = '#0E693A';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#5B3A1F';
  ctx.fillRect(0, 0, W, CUSHION);
  ctx.fillRect(0, H - CUSHION, W, CUSHION);
  ctx.fillRect(0, 0, CUSHION, H);
  ctx.fillRect(W - CUSHION, 0, CUSHION, H);

  // Pièce qui flip : scaleY oscille selon le cosinus, fréquence = 8 flips total
  const flipsTotal = 8;
  const t = Math.min(1, elapsed / FLIP_DURATION_MS);
  const easedT = 1 - Math.pow(1 - t, 2.2);
  const scaleY = Math.abs(Math.cos(easedT * Math.PI * flipsTotal));
  const flipIndex = Math.floor(easedT * flipsTotal * 2);
  // En fin de flip on force la face TIRÉE (finalSide), pas celle du winner.
  // C'est la suspense honnête : on voit pile ou face vraiment tomber.
  const showWinnerFace = t > 0.93;
  const showingPile = showWinnerFace
    ? finalSide === 'pile'
    : flipIndex % 2 === 0;

  const cx = W / 2, cy = H / 2;
  const coinR = 56;
  // Ombre au sol
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  const shadowScale = 0.6 + 0.4 * (1 - scaleY);
  ctx.beginPath();
  ctx.ellipse(cx, cy + coinR + 20, coinR * shadowScale, 8, 0, 0, Math.PI * 2);
  ctx.fill();

  // Soulèvement vertical : la pièce monte au début, redescend à la fin
  const bounceY = -Math.sin(easedT * Math.PI) * 30;

  ctx.save();
  ctx.translate(cx, cy + bounceY);
  ctx.scale(1, Math.max(0.08, scaleY));
  // Pièce
  const grad = ctx.createRadialGradient(-coinR * 0.3, -coinR * 0.4, 5, 0, 0, coinR);
  grad.addColorStop(0, showingPile ? '#FFEB7A' : '#E8C063');
  grad.addColorStop(1, showingPile ? '#C49B22' : '#9A7A1A');
  ctx.fillStyle = grad;
  ctx.beginPath(); ctx.arc(0, 0, coinR, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#7A5E16'; ctx.lineWidth = 3;
  ctx.stroke();
  // Liseré intérieur
  ctx.strokeStyle = 'rgba(255,255,255,0.25)';
  ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.arc(0, 0, coinR - 6, 0, Math.PI * 2); ctx.stroke();
  // Texte de la face
  ctx.fillStyle = '#3D2D08';
  ctx.font = 'bold 28px var(--font-display, sans-serif)';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(showingPile ? 'PILE' : 'FACE', 0, 0);
  ctx.restore();

  // Bandeau supérieur — montre le choix de J1 pendant le flip
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.fillRect(0, CUSHION, W, 36);
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 18px var(--font-display, sans-serif)';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(`J1 a appelé ${chosen.toUpperCase()}…`, W / 2, CUSHION + 18);
}

function drawFlipResult(canvasRef: React.RefObject<HTMLCanvasElement>, winner: 1 | 2, finalSide: CoinSide, chosen: CoinSide) {
  const c = canvasRef.current; if (!c) return;
  const ctx = c.getContext('2d'); if (!ctx) return;
  ctx.fillStyle = '#0E693A';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#5B3A1F';
  ctx.fillRect(0, 0, W, CUSHION);
  ctx.fillRect(0, H - CUSHION, W, CUSHION);
  ctx.fillRect(0, 0, CUSHION, H);
  ctx.fillRect(W - CUSHION, 0, CUSHION, H);

  // Pièce immobile (face réellement tirée)
  const showingPile = finalSide === 'pile';
  const cx = W / 2, cy = H / 2;
  const coinR = 56;
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.beginPath(); ctx.ellipse(cx, cy + coinR + 20, coinR, 8, 0, 0, Math.PI * 2); ctx.fill();
  const grad = ctx.createRadialGradient(cx - coinR * 0.3, cy - coinR * 0.4, 5, cx, cy, coinR);
  grad.addColorStop(0, showingPile ? '#FFEB7A' : '#E8C063');
  grad.addColorStop(1, showingPile ? '#C49B22' : '#9A7A1A');
  ctx.fillStyle = grad;
  ctx.beginPath(); ctx.arc(cx, cy, coinR, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#7A5E16'; ctx.lineWidth = 3; ctx.stroke();
  ctx.fillStyle = '#3D2D08';
  ctx.font = 'bold 28px var(--font-display, sans-serif)';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(showingPile ? 'PILE' : 'FACE', cx, cy);

  // Verdict : juste / raté
  const guessed = chosen === finalSide;
  const verdictColor = guessed ? '#3DD68C' : '#FF6B57';
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(0, cy - coinR - 70, W, 38);
  ctx.fillStyle = verdictColor;
  ctx.font = 'bold 20px var(--font-display, sans-serif)';
  ctx.fillText(
    guessed ? `Bien deviné ! ${chosen.toUpperCase()} pour J1` : `Raté — c'était ${finalSide.toUpperCase()}`,
    W / 2, cy - coinR - 50,
  );

  // Annonce du vainqueur
  const wColor = winner === 1 ? '#FF6B57' : '#5B8CFF';
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(0, cy + coinR + 38, W, 36);
  ctx.fillStyle = wColor;
  ctx.font = 'bold 18px var(--font-display, sans-serif)';
  ctx.fillText(`${winner === 1 ? '🔴' : '🔵'} Joueur ${winner} commence !`, W / 2, cy + coinR + 56);
}

// ─ Dessin table + boules ────────────────────────────────────────────────
function drawTable(
  ctx: CanvasRenderingContext2D, balls: Ball[], aim: V2 | null,
  phase: Phase, currentPlayer: 1 | 2, groups: { p1?: Group; p2?: Group },
) {
  const grad = ctx.createRadialGradient(W / 2, H / 2, 50, W / 2, H / 2, Math.max(W, H));
  grad.addColorStop(0, '#0E693A');
  grad.addColorStop(1, '#08471F');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);

  ctx.fillStyle = '#5B3A1F';
  ctx.fillRect(0, 0, W, CUSHION);
  ctx.fillRect(0, H - CUSHION, W, CUSHION);
  ctx.fillRect(0, 0, CUSHION, H);
  ctx.fillRect(W - CUSHION, 0, CUSHION, H);

  for (const p of POCKETS) {
    ctx.fillStyle = '#000';
    ctx.beginPath(); ctx.arc(p.x, p.y, POCKET_R, 0, Math.PI * 2); ctx.fill();
  }

  ctx.strokeStyle = 'rgba(255,255,255,0.15)';
  ctx.lineWidth = 1.5;
  ctx.setLineDash([6, 6]);
  ctx.beginPath();
  ctx.moveTo(CUE_START.x, CUSHION + 4);
  ctx.lineTo(CUE_START.x, H - CUSHION - 4);
  ctx.stroke();
  ctx.setLineDash([]);

  for (const b of balls) {
    if (!b.alive) continue;
    drawBall(ctx, b);
  }

  if (phase === 'aim' && aim) {
    const cue = balls[0];
    if (!cue.alive) return;
    drawAim(ctx, cue.pos, aim);
  }

  ctx.fillStyle = currentPlayer === 1 ? 'rgba(255, 107, 87, 0.85)' : 'rgba(91, 140, 255, 0.85)';
  ctx.fillRect(CUSHION + 8, CUSHION + 8, 8, 8);
}

function drawBall(ctx: CanvasRenderingContext2D, b: Ball) {
  // Ombre
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.beginPath(); ctx.arc(b.pos.x + 2, b.pos.y + 3, BALL_R, 0, Math.PI * 2); ctx.fill();

  if (b.owner === 'stripe') {
    // Boule rayée : fond blanc + bande colorée horizontale au milieu
    ctx.save();
    ctx.beginPath();
    ctx.arc(b.pos.x, b.pos.y, BALL_R, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(b.pos.x - BALL_R, b.pos.y - BALL_R, BALL_R * 2, BALL_R * 2);
    ctx.fillStyle = b.color;
    ctx.fillRect(b.pos.x - BALL_R, b.pos.y - BALL_R * 0.55, BALL_R * 2, BALL_R * 1.1);
    ctx.restore();
  } else {
    // Boule pleine (solid) ou noire ou cue
    ctx.fillStyle = b.color;
    ctx.beginPath(); ctx.arc(b.pos.x, b.pos.y, BALL_R, 0, Math.PI * 2); ctx.fill();
  }

  // Highlight 3D
  const hg = ctx.createRadialGradient(b.pos.x - 4, b.pos.y - 5, 1, b.pos.x, b.pos.y, BALL_R);
  hg.addColorStop(0, 'rgba(255,255,255,0.55)');
  hg.addColorStop(0.5, 'rgba(255,255,255,0)');
  hg.addColorStop(1, 'rgba(0,0,0,0.25)');
  ctx.fillStyle = hg;
  ctx.beginPath(); ctx.arc(b.pos.x, b.pos.y, BALL_R, 0, Math.PI * 2); ctx.fill();

  // Numéro pour toutes les colorées (sauf cue)
  if (b.id > 0) {
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(b.pos.x, b.pos.y, BALL_R * 0.42, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#000';
    ctx.font = `bold ${Math.round(BALL_R * 0.85)}px sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(String(b.id), b.pos.x, b.pos.y + 1);
  }
}

function drawAim(ctx: CanvasRenderingContext2D, cuePos: V2, aim: V2) {
  const dx = aim.x - cuePos.x;
  const dy = aim.y - cuePos.y;
  const dist = Math.hypot(dx, dy);
  if (dist <= 6) return;
  const ux = dx / dist, uy = dy / dist;

  ctx.strokeStyle = 'rgba(255,255,255,0.55)';
  ctx.lineWidth = 2;
  ctx.setLineDash([6, 4]);
  ctx.beginPath();
  ctx.moveTo(cuePos.x + ux * BALL_R, cuePos.y + uy * BALL_R);
  ctx.lineTo(cuePos.x + ux * 220, cuePos.y + uy * 220);
  ctx.stroke();
  ctx.setLineDash([]);

  const power = Math.min(MAX_POWER, dist * POWER_SCALE);
  const powerT = power / MAX_POWER;
  const stickLen = 100 + powerT * 80;
  ctx.strokeStyle = `rgb(${165 + powerT * 90}, ${110 - powerT * 90}, ${30})`;
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(cuePos.x - ux * (BALL_R + 4), cuePos.y - uy * (BALL_R + 4));
  ctx.lineTo(cuePos.x - ux * (BALL_R + 4 + stickLen), cuePos.y - uy * (BALL_R + 4 + stickLen));
  ctx.stroke();
  ctx.strokeStyle = '#222';
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(cuePos.x - ux * (BALL_R + 4 + stickLen), cuePos.y - uy * (BALL_R + 4 + stickLen));
  ctx.lineTo(cuePos.x - ux * (BALL_R + 4 + stickLen + 16), cuePos.y - uy * (BALL_R + 4 + stickLen + 16));
  ctx.stroke();

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
