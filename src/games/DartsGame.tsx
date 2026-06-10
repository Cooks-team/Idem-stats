import { useRef, useState } from 'react';
import type { GameModule, GameProps } from './GameModule';

// Fléchettes — mécanique 501 façon Plato.
//   - Chaque joueur démarre à 501 points
//   - À son tour, il lance 3 fléchettes en touchant la cible
//   - Le score de chaque dart est soustrait au total
//   - Première personne à exactement 0 GAGNE
//   - Si une dart fait passer le total en dessous de 0 → "BUST"
//     la dart compte 0 et on passe au joueur suivant
//   - Tour par tour, alternance après les 3 darts (ou un bust)
// Cible SVG : 20 segments standard (20 en haut, sens horaire 1,18,4,13,…),
// rings double / triple (cylindres rouge/vert), bull (vert 25), bullseye
// (rouge 50). Le tap/click sur la cible = throw précis (pas de spread —
// la difficulté c'est de viser juste sur petite surface, surtout sur mobile).

const START_SCORE = 501;
const DARTS_PER_TURN = 3;

// Rayons (en unités SVG, board centré 0,0 avec radius 1.0)
const R_BULLSEYE = 0.038;
const R_BULL     = 0.094;
const R_TRIPLE_IN = 0.55;
const R_TRIPLE_OUT = 0.605;
const R_DOUBLE_IN  = 0.94;
const R_DOUBLE_OUT = 1.0;

// Ordre des segments en partant du haut, sens horaire (standard "20 au sommet")
const SEGMENTS = [20, 1, 18, 4, 13, 6, 10, 15, 2, 17, 3, 19, 7, 16, 8, 11, 14, 9, 12, 5] as const;

// Couleurs standard d'une cible : single black ou crème, double/triple rouge/vert,
// alternance entre segments
const COLOR_SINGLE_DARK = '#0E0E12';
const COLOR_SINGLE_LIGHT = '#F0E6D2';
const COLOR_RED = '#C8302B';
const COLOR_GREEN = '#1E8246';
const COLOR_BULL = '#1E8246';
const COLOR_BULLSEYE = '#C8302B';

interface Hit { score: number; ring: 'bullseye' | 'bull' | 'triple' | 'double' | 'single' | 'miss'; segment: number; x: number; y: number; }

export const DartsGame: GameModule = {
  id: 'darts',
  apiId: 'darts',
  name: 'Fléchettes',
  description: '501 façon Plato. Touche la cible, le score se soustrait jusqu\'à 0.',
  Component: DartsComponent,
};

function DartsComponent({ onFinish }: GameProps) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [scores, setScores] = useState({ p1: START_SCORE, p2: START_SCORE });
  const [turn, setTurn] = useState<1 | 2>(1);
  const [turnHits, setTurnHits] = useState<Hit[]>([]);   // hits du tour courant
  const [allHits, setAllHits] = useState<Hit[]>([]);     // hits de toute la partie (visuels sur la cible)
  const [phase, setPhase] = useState<'playing' | 'done'>('playing');
  const [busted, setBusted] = useState(false);

  function handleThrow(e: React.MouseEvent<SVGSVGElement> | React.TouchEvent<SVGSVGElement>) {
    if (phase !== 'playing') return;
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    let cx: number, cy: number;
    if ('touches' in e) {
      const t = e.touches[0] ?? e.changedTouches[0];
      if (!t) return;
      cx = t.clientX; cy = t.clientY;
    } else {
      cx = e.clientX; cy = e.clientY;
    }
    // Coordonnées SVG en unités viewBox (-1.05 .. 1.05)
    const x = ((cx - rect.left) / rect.width)  * 2.1 - 1.05;
    const y = ((cy - rect.top)  / rect.height) * 2.1 - 1.05;
    const hit = scoreFromPoint(x, y);

    const myScoreKey = turn === 1 ? 'p1' : 'p2' as const;
    const currentScore = scores[myScoreKey];
    const newAllHits = [...allHits, { ...hit, x, y }];
    setAllHits(newAllHits);

    // BUST : si la fléchette fait passer en dessous de 0 → dart vaut 0, on
    // tourne immédiatement au joueur suivant.
    if (currentScore - hit.score < 0) {
      setBusted(true);
      setTimeout(() => {
        setBusted(false);
        setTurnHits([]);
        setTurn(turn === 1 ? 2 : 1);
      }, 1100);
      return;
    }

    const newScore = currentScore - hit.score;
    setScores((sc) => ({ ...sc, [myScoreKey]: newScore }));
    const newTurnHits = [...turnHits, { ...hit, x, y }];
    setTurnHits(newTurnHits);

    // WIN : exactement 0
    if (newScore === 0) {
      setPhase('done');
      // En 501 : winner=1, loser garde son score restant. On envoie comme score
      // dans le match record : winner=START_SCORE, loser=START_SCORE - leur reste
      // (ce qui revient à "points marqués"). Le winner a toujours plus de points
      // donc l'invariant scoreP1>scoreP2 ↔ P1 wins est respecté.
      setTimeout(() => {
        const sc1 = turn === 1 ? START_SCORE : START_SCORE - scores.p1;
        const sc2 = turn === 2 ? START_SCORE : START_SCORE - scores.p2;
        onFinish(sc1, sc2);
      }, 900);
      return;
    }

    // Fin de tour après 3 darts
    if (newTurnHits.length >= DARTS_PER_TURN) {
      setTimeout(() => {
        setTurnHits([]);
        setTurn(turn === 1 ? 2 : 1);
      }, 800);
    }
  }

  const currentPlayer = turn === 1 ? 'p1' : 'p2';
  const currentColor = turn === 1 ? '#FF6B57' : '#5B8CFF';
  const currentLabel = turn === 1 ? '🔴 Joueur 1' : '🔵 Joueur 2';
  const dartsLeftInTurn = DARTS_PER_TURN - turnHits.length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, width: '100%' }}>
      {/* Score 501 → 0, en grand pour les deux joueurs */}
      <div style={{ display: 'flex', width: '100%', maxWidth: 480, gap: 10 }}>
        <PlayerCard label="J1 🔴" score={scores.p1} active={currentPlayer === 'p1' && phase === 'playing'} color="#FF6B57" />
        <PlayerCard label="J2 🔵" score={scores.p2} active={currentPlayer === 'p2' && phase === 'playing'} color="#5B8CFF" />
      </div>

      {/* Tour courant + 3 darts du tour */}
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

      {/* Vraie cible standard 20 segments */}
      <Dartboard
        svgRef={svgRef}
        onThrow={handleThrow}
        hits={allHits}
        disabled={phase !== 'playing' || busted}
      />

      <div style={{ color: 'var(--muted)', fontSize: 12.5, textAlign: 'center', maxWidth: 360, lineHeight: 1.5 }}>
        Touche la cible — bullseye <strong style={{ color: COLOR_BULLSEYE }}>50</strong>,
        bull <strong style={{ color: COLOR_BULL }}>25</strong>,
        triple <strong>×3</strong>, double <strong>×2</strong>.<br />
        Premier à <strong>exactement 0</strong> gagne. Passer en dessous = BUST.
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

// ─── Cible SVG ────────────────────────────────────────────────────────────
function Dartboard({ svgRef, onThrow, hits, disabled }: {
  svgRef: React.RefObject<SVGSVGElement>;
  onThrow: (e: React.MouseEvent<SVGSVGElement> | React.TouchEvent<SVGSVGElement>) => void;
  hits: Hit[];
  disabled: boolean;
}) {
  // 20 segments × 4 zones (single-out, double, triple, single-in)
  const segments: React.ReactNode[] = [];
  for (let i = 0; i < 20; i++) {
    const segValue = SEGMENTS[i];
    const isOdd = i % 2 === 1;
    const angStart = -90 + i * 18 - 9;
    const angEnd   = -90 + i * 18 + 9;
    // single-in (entre bull et triple)
    segments.push(
      <path key={`si-${i}`} d={ringPath(R_BULL, R_TRIPLE_IN, angStart, angEnd)}
        fill={isOdd ? COLOR_SINGLE_LIGHT : COLOR_SINGLE_DARK} />,
    );
    // triple
    segments.push(
      <path key={`t-${i}`} d={ringPath(R_TRIPLE_IN, R_TRIPLE_OUT, angStart, angEnd)}
        fill={isOdd ? COLOR_GREEN : COLOR_RED} />,
    );
    // single-out (entre triple et double)
    segments.push(
      <path key={`so-${i}`} d={ringPath(R_TRIPLE_OUT, R_DOUBLE_IN, angStart, angEnd)}
        fill={isOdd ? COLOR_SINGLE_LIGHT : COLOR_SINGLE_DARK} />,
    );
    // double
    segments.push(
      <path key={`d-${i}`} d={ringPath(R_DOUBLE_IN, R_DOUBLE_OUT, angStart, angEnd)}
        fill={isOdd ? COLOR_GREEN : COLOR_RED} />,
    );
    // numéro du segment
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

  return (
    <div style={{ width: '100%', maxWidth: 560, aspectRatio: '1 / 1', position: 'relative' }}>
      <svg
        ref={svgRef}
        viewBox="-1.15 -1.15 2.3 2.3"
        onClick={onThrow}
        onTouchStart={(e) => { e.preventDefault(); onThrow(e); }}
        style={{
          width: '100%', height: '100%', display: 'block',
          touchAction: 'none',
          cursor: disabled ? 'wait' : 'crosshair',
          opacity: disabled ? 0.7 : 1,
        }}
      >
        {/* Anneau extérieur noir (bordure du board) */}
        <circle cx="0" cy="0" r="1.13" fill="#0B0B0E" />
        {/* Numéros sur le bord noir */}
        {segments}
        {/* Bull (vert 25) */}
        <circle cx="0" cy="0" r={R_BULL} fill={COLOR_BULL} />
        {/* Bullseye (rouge 50) */}
        <circle cx="0" cy="0" r={R_BULLSEYE} fill={COLOR_BULLSEYE} />

        {/* Impacts précédents — petits cercles blancs avec bordure */}
        {hits.map((h, i) => (
          <g key={i}>
            <circle cx={h.x} cy={h.y} r={0.022} fill="white" stroke="#000" strokeWidth={0.006} />
            <line x1={h.x - 0.018} y1={h.y - 0.018} x2={h.x + 0.018} y2={h.y + 0.018}
              stroke="#666" strokeWidth={0.005} />
          </g>
        ))}
      </svg>
    </div>
  );
}

// Path SVG d'un segment d'anneau entre 2 rayons et 2 angles (en degrés)
function ringPath(rIn: number, rOut: number, angStartDeg: number, angEndDeg: number): string {
  const a1 = angStartDeg * Math.PI / 180;
  const a2 = angEndDeg * Math.PI / 180;
  const xIn1 = rIn * Math.cos(a1), yIn1 = rIn * Math.sin(a1);
  const xIn2 = rIn * Math.cos(a2), yIn2 = rIn * Math.sin(a2);
  const xOut1 = rOut * Math.cos(a1), yOut1 = rOut * Math.sin(a1);
  const xOut2 = rOut * Math.cos(a2), yOut2 = rOut * Math.sin(a2);
  return `M ${xIn1} ${yIn1} L ${xOut1} ${yOut1} A ${rOut} ${rOut} 0 0 1 ${xOut2} ${yOut2} L ${xIn2} ${yIn2} A ${rIn} ${rIn} 0 0 0 ${xIn1} ${yIn1} Z`;
}

// Calcul du score à partir d'un point (x, y) dans le viewBox de la cible.
// y positif = bas (convention SVG).
function scoreFromPoint(x: number, y: number): { score: number; ring: Hit['ring']; segment: number } {
  const dist = Math.hypot(x, y);
  if (dist > R_DOUBLE_OUT) return { score: 0, ring: 'miss', segment: 0 };
  if (dist <= R_BULLSEYE)  return { score: 50, ring: 'bullseye', segment: 50 };
  if (dist <= R_BULL)      return { score: 25, ring: 'bull', segment: 25 };

  // Angle en degrés, 0° = top, sens horaire (donc atan2(x, -y))
  let angle = Math.atan2(x, -y) * 180 / Math.PI;
  if (angle < 0) angle += 360;
  // Chaque segment = 18° de large, segment 20 centré sur 0°
  const segIdx = Math.floor(((angle + 9) % 360) / 18) % 20;
  const segValue = SEGMENTS[segIdx];

  if (dist > R_DOUBLE_IN  && dist <= R_DOUBLE_OUT)  return { score: segValue * 2, ring: 'double', segment: segValue };
  if (dist > R_TRIPLE_IN  && dist <= R_TRIPLE_OUT)  return { score: segValue * 3, ring: 'triple', segment: segValue };
  return { score: segValue, ring: 'single', segment: segValue };
}
