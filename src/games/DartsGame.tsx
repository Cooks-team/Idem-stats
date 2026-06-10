import { useEffect, useRef, useState } from 'react';
import type { GameModule, GameProps } from './GameModule';

// Fléchettes — mécanique 501 façon Plato avec SLIDE TO THROW.
//   - Une fléchette posée en bas du board, visible dans la zone "ready"
//   - L'utilisateur pose son doigt (ou souris) dessus, slide vers la cible
//   - Pendant le slide, la fléchette suit le doigt + une ligne de visée
//     part du point de départ
//   - À la release, la position finale du doigt = point d'impact, animé
//     en ~300ms avec une légère parabole
//   - Petit spread aléatoire basé sur la vitesse à la release (slide trop
//     vite = main qui tremble = moins précis)
//
// Pourquoi pas le simple tap : la sensation Plato c'est de SENTIR la
// fléchette, de viser avec le slide, et de relâcher quand on est bien.
//
// Mécanique 501 : tour à 3 darts, soustraction jusqu'à exactement 0.
// BUST si on dépasse → la dart vaut 0 et on file au joueur suivant.

const START_SCORE = 501;
const DARTS_PER_TURN = 3;

// Rayons cible (en unités viewBox, board centré 0,0 rayon 1)
const R_BULLSEYE = 0.038;
const R_BULL     = 0.094;
const R_TRIPLE_IN = 0.55;
const R_TRIPLE_OUT = 0.605;
const R_DOUBLE_IN  = 0.94;
const R_DOUBLE_OUT = 1.0;

// Position de repos de la fléchette : juste sous le board
const DART_REST_Y = 1.45;
const DART_REST_X = 0;

const SEGMENTS = [20, 1, 18, 4, 13, 6, 10, 15, 2, 17, 3, 19, 7, 16, 8, 11, 14, 9, 12, 5] as const;

const COLOR_SINGLE_DARK = '#0E0E12';
const COLOR_SINGLE_LIGHT = '#F0E6D2';
const COLOR_RED = '#C8302B';
const COLOR_GREEN = '#1E8246';
const COLOR_BULL = '#1E8246';
const COLOR_BULLSEYE = '#C8302B';

interface V2 { x: number; y: number }
interface Hit { score: number; ring: 'bullseye' | 'bull' | 'triple' | 'double' | 'single' | 'miss'; segment: number; x: number; y: number }

export const DartsGame: GameModule = {
  id: 'darts',
  apiId: 'darts',
  name: 'Fléchettes',
  description: '501 style Plato. Slide la fléchette vers la cible. Premier à 0 gagne.',
  Component: DartsComponent,
};

function DartsComponent({ onFinish }: GameProps) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [scores, setScores] = useState({ p1: START_SCORE, p2: START_SCORE });
  const [turn, setTurn] = useState<1 | 2>(1);
  const [turnHits, setTurnHits] = useState<Hit[]>([]);
  const [allHits, setAllHits] = useState<Hit[]>([]);
  const [phase, setPhase] = useState<'playing' | 'done'>('playing');
  const [busted, setBusted] = useState(false);

  // État de la fléchette en cours de drag / vol
  const [dartPos, setDartPos] = useState<V2>({ x: DART_REST_X, y: DART_REST_Y });
  const [dragging, setDragging] = useState(false);
  const [flying, setFlying] = useState<{ from: V2; to: V2; startedAt: number } | null>(null);
  // Historique des positions pendant le drag → utilisé pour estimer la vitesse à la release
  const dragHistoryRef = useRef<Array<{ pos: V2; t: number }>>([]);

  const canThrow = phase === 'playing' && !busted && !flying;

  function svgPointFromClient(clientX: number, clientY: number): V2 {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const rect = svg.getBoundingClientRect();
    // viewBox : -1.15 .. 1.15 en X, -1.15 .. 1.65 en Y (on étend en bas pour la zone de la fléchette)
    const x = ((clientX - rect.left) / rect.width)  * 2.3 - 1.15;
    const y = ((clientY - rect.top)  / rect.height) * 2.8 - 1.15;
    return { x, y };
  }

  function onPointerDown(e: React.PointerEvent<SVGSVGElement>) {
    if (!canThrow) return;
    // On ne démarre un throw que si on touche la zone de la fléchette en bas.
    // On donne une hitbox assez large pour faciliter le tap mobile (0.25 unités).
    const pt = svgPointFromClient(e.clientX, e.clientY);
    const dx = pt.x - DART_REST_X;
    const dy = pt.y - DART_REST_Y;
    if (Math.hypot(dx, dy) > 0.35) return;

    e.currentTarget.setPointerCapture(e.pointerId);
    setDragging(true);
    setDartPos(pt);
    dragHistoryRef.current = [{ pos: pt, t: performance.now() }];
  }

  function onPointerMove(e: React.PointerEvent<SVGSVGElement>) {
    if (!dragging) return;
    const pt = svgPointFromClient(e.clientX, e.clientY);
    setDartPos(pt);
    dragHistoryRef.current.push({ pos: pt, t: performance.now() });
    // On garde les ~120ms d'historique pour estimer la vitesse à la release
    const cutoff = performance.now() - 120;
    while (dragHistoryRef.current.length > 0 && dragHistoryRef.current[0].t < cutoff) {
      dragHistoryRef.current.shift();
    }
  }

  function onPointerUp(e: React.PointerEvent<SVGSVGElement>) {
    if (!dragging) return;
    setDragging(false);
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* déjà relâché */ }

    const releasePt = svgPointFromClient(e.clientX, e.clientY);
    // Distance minimale pour valider le throw — sinon on rétracte juste la fléchette
    const dx = releasePt.x - DART_REST_X;
    const dy = releasePt.y - DART_REST_Y;
    if (Math.hypot(dx, dy) < 0.2 || releasePt.y > 0.9) {
      // Trop court ou pas assez vers le haut → on annule, dart retourne au repos
      setDartPos({ x: DART_REST_X, y: DART_REST_Y });
      dragHistoryRef.current = [];
      return;
    }

    // Spread basé sur la vitesse à la release : un slide trop rapide = main moins précise.
    // On calcule la vitesse moyenne des dernières ~120ms.
    const hist = dragHistoryRef.current;
    let speed = 0;
    if (hist.length >= 2) {
      const a = hist[0], b = hist[hist.length - 1];
      const dt = (b.t - a.t) / 1000; // secondes
      if (dt > 0) speed = Math.hypot(b.pos.x - a.pos.x, b.pos.y - a.pos.y) / dt;
    }
    // À vitesse 3 unités/sec → spread négligeable.
    // À vitesse 10+ unités/sec → spread ~0.05 (sensible mais pas catastrophique)
    const spread = Math.min(0.06, Math.max(0, (speed - 2) * 0.008));
    const offX = (Math.random() - 0.5) * 2 * spread;
    const offY = (Math.random() - 0.5) * 2 * spread;
    const landingPt: V2 = { x: releasePt.x + offX, y: releasePt.y + offY };

    dragHistoryRef.current = [];
    setFlying({ from: { x: DART_REST_X, y: DART_REST_Y }, to: landingPt, startedAt: performance.now() });
  }

  // Animation du vol : interpolation + parabole verticale, ~300ms
  useEffect(() => {
    if (!flying) return;
    let raf = 0;
    const dur = 320;
    const tick = () => {
      const t = Math.min(1, (performance.now() - flying.startedAt) / dur);
      const x = flying.from.x + (flying.to.x - flying.from.x) * t;
      const y = flying.from.y + (flying.to.y - flying.from.y) * t;
      // Parabole : on monte un peu au milieu
      const arc = Math.sin(t * Math.PI) * 0.08;
      setDartPos({ x, y: y - arc });
      if (t < 1) {
        raf = requestAnimationFrame(tick);
      } else {
        // Atterrissage → score + reset
        applyHit(flying.to);
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flying]);

  function applyHit(at: V2) {
    const hit = scoreFromPoint(at.x, at.y);
    const fullHit: Hit = { ...hit, x: at.x, y: at.y };
    setAllHits((prev) => [...prev, fullHit]);
    setFlying(null);

    const myKey = turn === 1 ? 'p1' : 'p2';
    const currentScore = scores[myKey];

    // BUST : passe sous 0 → la dart vaut 0, tour suivant
    if (currentScore - hit.score < 0) {
      setBusted(true);
      setTimeout(() => {
        setBusted(false);
        setTurnHits([]);
        setTurn(turn === 1 ? 2 : 1);
        // Dart au repos
        setDartPos({ x: DART_REST_X, y: DART_REST_Y });
      }, 1100);
      return;
    }

    const newScore = currentScore - hit.score;
    setScores((sc) => ({ ...sc, [myKey]: newScore }));
    const newTurnHits = [...turnHits, fullHit];
    setTurnHits(newTurnHits);
    // Dart suivante au repos
    setDartPos({ x: DART_REST_X, y: DART_REST_Y });

    // WIN
    if (newScore === 0) {
      setPhase('done');
      setTimeout(() => {
        const sc1 = turn === 1 ? START_SCORE : START_SCORE - scores.p1;
        const sc2 = turn === 2 ? START_SCORE : START_SCORE - scores.p2;
        onFinish(sc1, sc2);
      }, 900);
      return;
    }

    if (newTurnHits.length >= DARTS_PER_TURN) {
      setTimeout(() => {
        setTurnHits([]);
        setTurn(turn === 1 ? 2 : 1);
      }, 600);
    }
  }

  const currentColor = turn === 1 ? '#FF6B57' : '#5B8CFF';
  const currentLabel = turn === 1 ? '🔴 Joueur 1' : '🔵 Joueur 2';
  const dartsLeftInTurn = DARTS_PER_TURN - turnHits.length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, width: '100%' }}>
      <div style={{ display: 'flex', width: '100%', maxWidth: 480, gap: 10 }}>
        <PlayerCard label="J1 🔴" score={scores.p1} active={turn === 1 && phase === 'playing'} color="#FF6B57" />
        <PlayerCard label="J2 🔵" score={scores.p2} active={turn === 2 && phase === 'playing'} color="#5B8CFF" />
      </div>

      {phase === 'playing' && (
        <div style={{ textAlign: 'center', minHeight: 38 }}>
          {busted ? (
            <div style={{ color: 'var(--loss)', fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 26 }}>
              BUST ! 💥
            </div>
          ) : (
            <>
              <div style={{ color: currentColor, fontWeight: 700, fontSize: 15 }}>
                {currentLabel} — {dartsLeftInTurn} fléchette{dartsLeftInTurn > 1 ? 's' : ''} restante{dartsLeftInTurn > 1 ? 's' : ''}
              </div>
              <div style={{ display: 'flex', gap: 6, justifyContent: 'center', marginTop: 4 }}>
                {[0, 1, 2].map((i) => (
                  <span key={i} style={{
                    minWidth: 44, textAlign: 'center', padding: '2px 8px',
                    borderRadius: 8, fontWeight: 700, fontSize: 14,
                    background: turnHits[i] ? 'var(--surface-2)' : 'transparent',
                    border: '1px solid var(--line)',
                    color: turnHits[i] ? 'var(--text)' : 'var(--muted)',
                  }}>
                    {turnHits[i] ? `−${turnHits[i].score}` : '—'}
                  </span>
                ))}
              </div>
            </>
          )}
        </div>
      )}
      {phase === 'done' && <div style={{ color: 'var(--win)', fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 22 }}>Terminé ! Score envoyé…</div>}

      <Dartboard
        svgRef={svgRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        hits={allHits}
        dartPos={dartPos}
        dragging={dragging}
        flying={!!flying}
        disabled={!canThrow}
      />

      <div style={{ color: 'var(--muted)', fontSize: 12.5, textAlign: 'center', maxWidth: 420, lineHeight: 1.5 }}>
        <strong>Pose ton doigt sur la fléchette en bas</strong>, slide vers la cible, relâche pour lancer.<br />
        Bullseye <strong style={{ color: COLOR_BULLSEYE }}>50</strong> · bull <strong style={{ color: COLOR_BULL }}>25</strong> · triple <strong>×3</strong> · double <strong>×2</strong>. Premier à <strong>exactement 0</strong> gagne.
      </div>
    </div>
  );
}

function PlayerCard({ label, score, active, color }: { label: string; score: number; active: boolean; color: string }) {
  return (
    <div style={{
      flex: 1, padding: '10px 14px', borderRadius: 14,
      background: active ? 'color-mix(in oklab, var(--accent) 16%, var(--surface))' : 'var(--surface)',
      border: `2px solid ${active ? 'var(--accent)' : 'var(--line)'}`,
      textAlign: 'center',
      transition: 'background .15s ease, border-color .15s ease',
    }}>
      <div style={{ color, fontWeight: 700, fontSize: 13, letterSpacing: 0.5 }}>{label}</div>
      <div className="tabular" style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 44, lineHeight: 1, marginTop: 4 }}>
        {score}
      </div>
    </div>
  );
}

// ─── Cible SVG + fléchette draggable ──────────────────────────────────────
function Dartboard({ svgRef, onPointerDown, onPointerMove, onPointerUp, hits, dartPos, dragging, flying, disabled }: {
  svgRef: React.RefObject<SVGSVGElement>;
  onPointerDown: (e: React.PointerEvent<SVGSVGElement>) => void;
  onPointerMove: (e: React.PointerEvent<SVGSVGElement>) => void;
  onPointerUp: (e: React.PointerEvent<SVGSVGElement>) => void;
  hits: Hit[];
  dartPos: V2;
  dragging: boolean;
  flying: boolean;
  disabled: boolean;
}) {
  const segments: React.ReactNode[] = [];
  for (let i = 0; i < 20; i++) {
    const segValue = SEGMENTS[i];
    const isOdd = i % 2 === 1;
    const angStart = -90 + i * 18 - 9;
    const angEnd   = -90 + i * 18 + 9;
    segments.push(<path key={`si-${i}`} d={ringPath(R_BULL, R_TRIPLE_IN, angStart, angEnd)} fill={isOdd ? COLOR_SINGLE_LIGHT : COLOR_SINGLE_DARK} />);
    segments.push(<path key={`t-${i}`}  d={ringPath(R_TRIPLE_IN, R_TRIPLE_OUT, angStart, angEnd)} fill={isOdd ? COLOR_GREEN : COLOR_RED} />);
    segments.push(<path key={`so-${i}`} d={ringPath(R_TRIPLE_OUT, R_DOUBLE_IN, angStart, angEnd)} fill={isOdd ? COLOR_SINGLE_LIGHT : COLOR_SINGLE_DARK} />);
    segments.push(<path key={`d-${i}`}  d={ringPath(R_DOUBLE_IN, R_DOUBLE_OUT, angStart, angEnd)} fill={isOdd ? COLOR_GREEN : COLOR_RED} />);
    const angMid = -90 + i * 18;
    const rText = 1.085;
    const tx = rText * Math.cos(angMid * Math.PI / 180);
    const ty = rText * Math.sin(angMid * Math.PI / 180);
    segments.push(
      <text key={`n-${i}`} x={tx} y={ty} fill="white" fontSize={0.10} fontWeight={800}
        textAnchor="middle" dominantBaseline="central" style={{ userSelect: 'none', pointerEvents: 'none' }}>
        {segValue}
      </text>,
    );
  }

  // viewBox : -1.15..1.15 en X, -1.15..1.65 en Y (= board + zone fléchette en bas)
  return (
    <div style={{ width: '100%', maxWidth: 560, aspectRatio: '23 / 28', position: 'relative' }}>
      <svg
        ref={svgRef}
        viewBox="-1.15 -1.15 2.3 2.8"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        style={{
          width: '100%', height: '100%', display: 'block',
          touchAction: 'none',
          cursor: disabled ? 'wait' : (dragging ? 'grabbing' : 'grab'),
          userSelect: 'none',
        }}
      >
        {/* Fond du board (cercle noir) */}
        <circle cx="0" cy="0" r="1.13" fill="#0B0B0E" />
        {segments}
        <circle cx="0" cy="0" r={R_BULL} fill={COLOR_BULL} />
        <circle cx="0" cy="0" r={R_BULLSEYE} fill={COLOR_BULLSEYE} />

        {/* Impacts précédents */}
        {hits.map((h, i) => (
          <g key={i}>
            <circle cx={h.x} cy={h.y} r={0.022} fill="white" stroke="#000" strokeWidth={0.006} />
            <line x1={h.x - 0.018} y1={h.y - 0.018} x2={h.x + 0.018} y2={h.y + 0.018}
              stroke="#666" strokeWidth={0.005} />
          </g>
        ))}

        {/* Ligne de visée pendant le drag */}
        {dragging && (
          <line
            x1={DART_REST_X} y1={DART_REST_Y}
            x2={dartPos.x} y2={dartPos.y}
            stroke="rgba(214,255,61,0.55)" strokeWidth={0.012}
            strokeDasharray="0.04 0.03"
          />
        )}

        {/* Zone de la fléchette au repos (cercle subtil pour indiquer le hit target) */}
        {!dragging && !flying && (
          <circle cx={DART_REST_X} cy={DART_REST_Y} r="0.28"
            fill="rgba(214,255,61,0.07)" stroke="rgba(214,255,61,0.30)" strokeWidth={0.008}
            strokeDasharray="0.04 0.03" />
        )}

        {/* La fléchette : pointe + tige + plumes */}
        <Dart x={dartPos.x} y={dartPos.y} flying={flying} dragging={dragging} />
      </svg>
    </div>
  );
}

// Représentation d'une fléchette pointant vers le haut. On la dessine relative à un (x,y).
function Dart({ x, y, flying, dragging }: { x: number; y: number; flying: boolean; dragging: boolean }) {
  // Taille de la fléchette
  const len = 0.34;
  // Pointe en haut, plumes en bas (pointe vers la cible quand au repos)
  const tipY = y - len * 0.55;
  const tailY = y + len * 0.45;
  return (
    <g style={{ filter: dragging ? 'drop-shadow(0 0 6px rgba(214,255,61,0.6))' : flying ? 'drop-shadow(0 4px 6px rgba(0,0,0,0.5))' : 'none' }}>
      {/* Tige */}
      <line x1={x} y1={tipY + 0.02} x2={x} y2={tailY - 0.05}
        stroke="#cfd1d6" strokeWidth={0.022} strokeLinecap="round" />
      {/* Pointe */}
      <polygon
        points={`${x},${tipY} ${x - 0.024},${tipY + 0.07} ${x + 0.024},${tipY + 0.07}`}
        fill="#d6ff3d" stroke="#7a9b22" strokeWidth={0.005}
      />
      {/* Plumes */}
      <polygon
        points={`${x},${tailY - 0.06} ${x - 0.06},${tailY} ${x},${tailY - 0.02} ${x + 0.06},${tailY}`}
        fill="#ff6b57" stroke="#0b0b0e" strokeWidth={0.005}
      />
    </g>
  );
}

function ringPath(rIn: number, rOut: number, angStartDeg: number, angEndDeg: number): string {
  const a1 = angStartDeg * Math.PI / 180;
  const a2 = angEndDeg * Math.PI / 180;
  const xIn1 = rIn * Math.cos(a1), yIn1 = rIn * Math.sin(a1);
  const xIn2 = rIn * Math.cos(a2), yIn2 = rIn * Math.sin(a2);
  const xOut1 = rOut * Math.cos(a1), yOut1 = rOut * Math.sin(a1);
  const xOut2 = rOut * Math.cos(a2), yOut2 = rOut * Math.sin(a2);
  return `M ${xIn1} ${yIn1} L ${xOut1} ${yOut1} A ${rOut} ${rOut} 0 0 1 ${xOut2} ${yOut2} L ${xIn2} ${yIn2} A ${rIn} ${rIn} 0 0 0 ${xIn1} ${yIn1} Z`;
}

function scoreFromPoint(x: number, y: number): { score: number; ring: Hit['ring']; segment: number } {
  const dist = Math.hypot(x, y);
  if (dist > R_DOUBLE_OUT) return { score: 0, ring: 'miss', segment: 0 };
  if (dist <= R_BULLSEYE)  return { score: 50, ring: 'bullseye', segment: 50 };
  if (dist <= R_BULL)      return { score: 25, ring: 'bull', segment: 25 };
  let angle = Math.atan2(x, -y) * 180 / Math.PI;
  if (angle < 0) angle += 360;
  const segIdx = Math.floor(((angle + 9) % 360) / 18) % 20;
  const segValue = SEGMENTS[segIdx];
  if (dist > R_DOUBLE_IN  && dist <= R_DOUBLE_OUT)  return { score: segValue * 2, ring: 'double', segment: segValue };
  if (dist > R_TRIPLE_IN  && dist <= R_TRIPLE_OUT)  return { score: segValue * 3, ring: 'triple', segment: segValue };
  return { score: segValue, ring: 'single', segment: segValue };
}
