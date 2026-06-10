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
// Popup éphémère qui s'affiche à l'impact pour signaler le score gagné
// (style Plato : "T20 +60", "×2 16", "+50 BULL", etc.). Self-removed après ~1.4s.
interface ScorePopup { id: number; x: number; y: number; score: number; ring: Hit['ring']; segment: number }

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
  // Popups de score affichés au point d'impact. Plusieurs peuvent coexister
  // (ex : 3 darts d'un même tour rapprochées sur le bull).
  const [popups, setPopups] = useState<ScorePopup[]>([]);
  const popupIdRef = useRef(0);

  // État de la fléchette en cours de drag / vol
  const [dartPos, setDartPos] = useState<V2>({ x: DART_REST_X, y: DART_REST_Y });
  // Échelle de la fléchette : 1.0 au repos (close to viewer), ~0.5 en vol au moment
  // où elle se plante (perspective Plato : la dart "s'éloigne" vers la cible).
  const [dartScale, setDartScale] = useState(1.0);
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
    const pt = svgPointFromClient(e.clientX, e.clientY);
    // Hitbox élargie : si on tape n'importe où DANS LA MOITIÉ BASSE (sous la
    // cible), on attrape la fléchette. Beaucoup plus indulgent sur mobile que
    // l'ancienne zone circulaire 0.35u — fini les "j'ai loupé mon tap".
    if (pt.y < 0.95) return;

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
    // Validation plus indulgente : il suffit d'avoir relâché AU-DESSUS de la
    // zone de la fléchette (y < 0.95) pour valider — pas de seuil de distance
    // strict, donc même un slide court mais en direction du board envoie.
    if (releasePt.y > 0.95) {
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
    // À vitesse 10+ unités/sec → spread modéré (sensible mais pas punitif).
    // Plus indulgent qu'avant (0.06 max → 0.045) pour que les tirs précis
    // récompensent vraiment, sans handicaper les frappes rapides.
    const spread = Math.min(0.045, Math.max(0, (speed - 2) * 0.006));
    const offX = (Math.random() - 0.5) * 2 * spread;
    const offY = (Math.random() - 0.5) * 2 * spread;
    const landingPt: V2 = { x: releasePt.x + offX, y: releasePt.y + offY };

    dragHistoryRef.current = [];
    setFlying({ from: { x: DART_REST_X, y: DART_REST_Y }, to: landingPt, startedAt: performance.now() });
  }

  // Animation du vol : interpolation + parabole verticale + scale 3D (la dart
  // "s'éloigne" du viewer en plongeant vers la cible — feel Plato).
  // Durée raccourcie (350 → 240ms) pour un feedback plus snappy, surtout
  // utile en série quand on enchaîne 3 darts.
  useEffect(() => {
    if (!flying) return;
    let raf = 0;
    const dur = 240;
    const tick = () => {
      const t = Math.min(1, (performance.now() - flying.startedAt) / dur);
      const x = flying.from.x + (flying.to.x - flying.from.x) * t;
      const y = flying.from.y + (flying.to.y - flying.from.y) * t;
      const arc = Math.sin(t * Math.PI) * 0.08;
      setDartPos({ x, y: y - arc });
      // Perspective : scale 1.0 → 0.45 au cours du vol. La dart s'enfonce dans
      // la cible donc devient plus petite (effet de profondeur).
      setDartScale(1.0 - 0.55 * t);
      if (t < 1) {
        raf = requestAnimationFrame(tick);
      } else {
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

    // Spawn d'un popup de score façon Plato. Auto-remove après 1.4s.
    const popupId = ++popupIdRef.current;
    setPopups((p) => [...p, { id: popupId, x: at.x, y: at.y, score: hit.score, ring: hit.ring, segment: hit.segment }]);
    setTimeout(() => setPopups((p) => p.filter((x) => x.id !== popupId)), 1400);

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
        setDartScale(1.0);
      }, 1100);
      return;
    }

    const newScore = currentScore - hit.score;
    setScores((sc) => ({ ...sc, [myKey]: newScore }));
    const newTurnHits = [...turnHits, fullHit];
    setTurnHits(newTurnHits);
    // Dart suivante au repos, taille de prise en main (1.0)
    setDartPos({ x: DART_REST_X, y: DART_REST_Y });
    setDartScale(1.0);

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
        dartScale={dartScale}
        dragging={dragging}
        flying={!!flying}
        disabled={!canThrow}
        popups={popups}
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
function Dartboard({ svgRef, onPointerDown, onPointerMove, onPointerUp, hits, dartPos, dartScale, dragging, flying, disabled, popups }: {
  svgRef: React.RefObject<SVGSVGElement>;
  onPointerDown: (e: React.PointerEvent<SVGSVGElement>) => void;
  onPointerMove: (e: React.PointerEvent<SVGSVGElement>) => void;
  onPointerUp: (e: React.PointerEvent<SVGSVGElement>) => void;
  hits: Hit[];
  dartPos: V2;
  dartScale: number;
  dragging: boolean;
  flying: boolean;
  disabled: boolean;
  popups: ScorePopup[];
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
        <defs>
          {/* Lighting du board : highlight en haut-gauche pour évoquer une lumière de salle */}
          <radialGradient id="boardLight" cx="35%" cy="25%" r="100%">
            <stop offset="0%"  stopColor="rgba(255,255,255,0.18)" />
            <stop offset="55%" stopColor="rgba(255,255,255,0)" />
            <stop offset="100%" stopColor="rgba(0,0,0,0.35)" />
          </radialGradient>
          {/* Cerclage extérieur bois (frame du board réel) */}
          <radialGradient id="woodRing" cx="50%" cy="50%" r="50%">
            <stop offset="86%" stopColor="#3a2418" />
            <stop offset="95%" stopColor="#5d3a25" />
            <stop offset="100%" stopColor="#2a1810" />
          </radialGradient>
          {/* Bull/bullseye glossy */}
          <radialGradient id="bullGloss" cx="40%" cy="32%" r="70%">
            <stop offset="0%"  stopColor="#52c47b" />
            <stop offset="100%" stopColor="#0b6233" />
          </radialGradient>
          <radialGradient id="bullseyeGloss" cx="40%" cy="32%" r="70%">
            <stop offset="0%"  stopColor="#ed5048" />
            <stop offset="100%" stopColor="#8e1e1a" />
          </radialGradient>
          {/* Métal de la tige de la dart */}
          <linearGradient id="dartShaft" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%"  stopColor="#6b6f78" />
            <stop offset="48%" stopColor="#e0e3e8" />
            <stop offset="100%" stopColor="#5a5d65" />
          </linearGradient>
          {/* Pointe chrome */}
          <linearGradient id="dartTip" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%"  stopColor="#aab" />
            <stop offset="50%" stopColor="#fff" />
            <stop offset="100%" stopColor="#778" />
          </linearGradient>
          {/* Plumes : dégradé pour donner du volume */}
          <linearGradient id="dartFletchL" x1="1" y1="0" x2="0" y2="0">
            <stop offset="0%"  stopColor="#d6ff3d" />
            <stop offset="100%" stopColor="#7a9b22" />
          </linearGradient>
          <linearGradient id="dartFletchR" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%"  stopColor="#d6ff3d" />
            <stop offset="100%" stopColor="#7a9b22" />
          </linearGradient>
          {/* Filtre d'ombre du board sur le fond */}
          <filter id="boardShadow" x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur in="SourceAlpha" stdDeviation="0.04" />
            <feOffset dx="0" dy="0.025" result="off" />
            <feComponentTransfer><feFuncA type="linear" slope="0.6" /></feComponentTransfer>
            <feMerge><feMergeNode /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>

        {/* Mur de fond : ambient sombre + vignette */}
        <rect x="-1.15" y="-1.15" width="2.3" height="2.8" fill="#15161a" />
        <radialGradient id="wallVignette" cx="50%" cy="40%" r="70%">
          <stop offset="0%"  stopColor="rgba(40,42,48,0)" />
          <stop offset="100%" stopColor="rgba(0,0,0,0.6)" />
        </radialGradient>
        <rect x="-1.15" y="-1.15" width="2.3" height="2.8" fill="url(#wallVignette)" />

        {/* Ombre portée du board sur le mur */}
        <ellipse cx="0.04" cy="0.06" rx="1.13" ry="1.13" fill="rgba(0,0,0,0.55)" filter="url(#boardShadow)" />

        {/* Frame en bois autour du board */}
        <circle cx="0" cy="0" r="1.13" fill="url(#woodRing)" />
        {/* Fond noir du board (anneau extérieur numéroté) */}
        <circle cx="0" cy="0" r="1.05" fill="#0B0B0E" />

        {/* Segments + numéros */}
        {segments}

        {/* Bull (vert) + bullseye (rouge) avec glossy gradient */}
        <circle cx="0" cy="0" r={R_BULL} fill="url(#bullGloss)" />
        <circle cx="0" cy="0" r={R_BULLSEYE} fill="url(#bullseyeGloss)" />

        {/* Lighting overlay sur tout le board (highlight haut-gauche, vignette globale) */}
        <circle cx="0" cy="0" r="1.05" fill="url(#boardLight)" style={{ pointerEvents: 'none' }} />

        {/* Câblage métallique entre les segments (le "spider" du board réel) */}
        {[...Array(20)].map((_, i) => {
          const a = (-90 + i * 18 - 9) * Math.PI / 180;
          return (
            <line key={`sp-${i}`}
              x1={R_BULL * Math.cos(a)} y1={R_BULL * Math.sin(a)}
              x2={R_DOUBLE_OUT * Math.cos(a)} y2={R_DOUBLE_OUT * Math.sin(a)}
              stroke="rgba(180,180,180,0.35)" strokeWidth={0.004} style={{ pointerEvents: 'none' }} />
          );
        })}
        <circle cx="0" cy="0" r={R_BULL} fill="none" stroke="rgba(220,220,220,0.5)" strokeWidth={0.005} style={{ pointerEvents: 'none' }} />
        <circle cx="0" cy="0" r={R_TRIPLE_IN}  fill="none" stroke="rgba(180,180,180,0.35)" strokeWidth={0.004} style={{ pointerEvents: 'none' }} />
        <circle cx="0" cy="0" r={R_TRIPLE_OUT} fill="none" stroke="rgba(180,180,180,0.35)" strokeWidth={0.004} style={{ pointerEvents: 'none' }} />
        <circle cx="0" cy="0" r={R_DOUBLE_IN}  fill="none" stroke="rgba(180,180,180,0.35)" strokeWidth={0.004} style={{ pointerEvents: 'none' }} />
        <circle cx="0" cy="0" r={R_DOUBLE_OUT} fill="none" stroke="rgba(220,220,220,0.55)" strokeWidth={0.005} style={{ pointerEvents: 'none' }} />

        {/* Darts plantées du tour (look 3D : on voit la queue qui sort) */}
        {hits.map((h, i) => <StuckDart key={i} x={h.x} y={h.y} />)}

        {/* Ligne de visée pendant le drag */}
        {dragging && (
          <line
            x1={DART_REST_X} y1={DART_REST_Y}
            x2={dartPos.x} y2={dartPos.y}
            stroke="rgba(214,255,61,0.55)" strokeWidth={0.012}
            strokeDasharray="0.04 0.03"
            style={{ pointerEvents: 'none' }}
          />
        )}

        {/* Zone de la fléchette au repos — bande horizontale en bas, plus
            visible que l'ancien cercle, pour bien indiquer où poser le doigt */}
        {!dragging && !flying && (
          <>
            <rect x="-1.1" y="1.05" width="2.2" height="0.55" rx="0.08"
              fill="rgba(214,255,61,0.06)" stroke="rgba(214,255,61,0.25)" strokeWidth={0.006}
              strokeDasharray="0.04 0.03"
              style={{ pointerEvents: 'none' }} />
            <text x="0" y="1.55" textAnchor="middle" fontSize="0.07" fill="rgba(214,255,61,0.55)"
              style={{ pointerEvents: 'none', fontFamily: 'var(--font-body, sans-serif)', fontWeight: 600 }}>
              ↑ POSE TON DOIGT ET SLIDE
            </text>
          </>
        )}

        {/* La fléchette 3D : pointe métal, tige chrome, plumes vert-fluo + ombre */}
        <Dart x={dartPos.x} y={dartPos.y} scale={dartScale} flying={flying} dragging={dragging} />

        {/* Popups de score façon Plato — affichés au-dessus de la dart pour rester lisibles */}
        {popups.map((p) => <ScorePopupSvg key={p.id} popup={p} />)}
      </svg>
    </div>
  );
}

// ─── Popup de score animé style Plato ────────────────────────────────────
// Apparaît à l'impact avec un "pop" (scale 0.4→1.3→1.0), monte de ~0.3
// unités viewBox et fade out. ~1.2s de vie utile + 0.2s de delay résiduel.
function ScorePopupSvg({ popup }: { popup: ScorePopup }) {
  const [t, setT] = useState(0);
  useEffect(() => {
    let raf = 0;
    const start = performance.now();
    const dur = 1200;
    const tick = () => {
      const elapsed = performance.now() - start;
      setT(Math.min(1, elapsed / dur));
      if (elapsed < dur) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  // Anim : translateY négatif progressif + scale bounce + fade out fin
  const yOffset = -0.04 - 0.32 * easeOut(t);
  const scale =
    t < 0.18  ? lerp(0.45, 1.35, t / 0.18) :
    t < 0.30  ? lerp(1.35, 1.05, (t - 0.18) / 0.12) :
                1.05;
  const opacity = t < 0.10 ? t / 0.10 : t > 0.65 ? 1 - (t - 0.65) / 0.35 : 1;

  // Layout du texte : double ligne pour les multiplicateurs (×2 / ×3 / BULL),
  // simple sinon. Couleurs codées par type (or = bullseye, vert = bull/double-vert,
  // rouge = triple, gris = miss).
  let mainText: string;
  let badge: string | null = null;
  let color: string;
  let stroke = '#0b0b0e';

  switch (popup.ring) {
    case 'bullseye':
      mainText = '+50'; badge = 'BULLSEYE'; color = '#FFD700'; break;
    case 'bull':
      mainText = '+25'; badge = 'BULL'; color = '#52e07b'; break;
    case 'triple':
      mainText = `+${popup.score}`; badge = `×3   T${popup.segment}`; color = '#ff5246'; break;
    case 'double':
      mainText = `+${popup.score}`; badge = `×2   D${popup.segment}`; color = '#3dd68c'; break;
    case 'miss':
      mainText = 'MISS'; badge = null; color = '#888'; stroke = '#000'; break;
    default:
      mainText = `+${popup.score}`; badge = `S${popup.segment}`; color = '#FFE066'; break;
  }

  // Position du popup : on commence à l'impact, on monte. On le décale légèrement
  // pour qu'il ne se superpose pas à la dart plantée.
  return (
    <g
      transform={`translate(${popup.x}, ${popup.y + yOffset}) scale(${scale})`}
      opacity={opacity}
      style={{ pointerEvents: 'none' }}
    >
      {/* Badge "×3 T20" ou "BULL" au-dessus du gros chiffre */}
      {badge && (
        <text
          x="0" y="-0.12"
          textAnchor="middle"
          fontSize="0.07"
          fontWeight={800}
          fill={color}
          stroke={stroke}
          strokeWidth={0.012}
          paintOrder="stroke"
          style={{ fontFamily: 'var(--font-display, sans-serif)', letterSpacing: '0.04em' }}
        >
          {badge}
        </text>
      )}
      {/* Gros score */}
      <text
        x="0" y="-0.02"
        textAnchor="middle"
        fontSize="0.18"
        fontWeight={900}
        fill={color}
        stroke={stroke}
        strokeWidth={0.018}
        paintOrder="stroke"
        style={{ fontFamily: 'var(--font-display, sans-serif)' }}
      >
        {mainText}
      </text>
    </g>
  );
}

function lerp(a: number, b: number, t: number) { return a + (b - a) * t; }
function easeOut(t: number) { return 1 - Math.pow(1 - t, 3); }

// Fléchette 3D : pointe chrome + tige métallique + plumes en V avec dégradé.
// On la dessine centrée sur (0,0) à taille 1 puis on applique translate+scale
// → permet de la rétrécir naturellement pendant le vol (perspective).
function Dart({ x, y, scale, flying, dragging }: { x: number; y: number; scale: number; flying: boolean; dragging: boolean }) {
  const glowFilter = dragging
    ? 'drop-shadow(0 0 0.04px rgba(214,255,61,0.9)) drop-shadow(0 0.02px 0.02px rgba(0,0,0,0.4))'
    : flying
    ? 'drop-shadow(0 0.05px 0.04px rgba(0,0,0,0.6))'
    : 'drop-shadow(0 0.03px 0.02px rgba(0,0,0,0.45))';
  return (
    <g
      transform={`translate(${x}, ${y}) scale(${scale})`}
      style={{ filter: glowFilter, transition: dragging ? 'none' : 'transform 0.04s linear', pointerEvents: 'none' }}
    >
      {/* Pointe chrome (haut) — fine, longue, métallique */}
      <polygon
        points="0,-0.20 -0.014,-0.13 0.014,-0.13"
        fill="url(#dartTip)" stroke="#3a3e44" strokeWidth={0.003}
      />
      {/* Anneau de transition entre pointe et tige (le "barrel ferrule") */}
      <ellipse cx="0" cy="-0.128" rx="0.018" ry="0.008" fill="#d8dadf" stroke="#3a3e44" strokeWidth={0.002} />
      {/* Tige chrome — corps principal */}
      <rect x="-0.022" y="-0.12" width="0.044" height="0.18" rx="0.012"
        fill="url(#dartShaft)" stroke="#3a3e44" strokeWidth={0.003} />
      {/* Bague centrale (knurling) */}
      <rect x="-0.024" y="-0.06" width="0.048" height="0.018" rx="0.003"
        fill="#3a3e44" />
      <rect x="-0.024" y="-0.064" width="0.048" height="0.003" fill="rgba(255,255,255,0.4)" />
      {/* Plumes en V — deux triangles symétriques avec dégradé pour le relief */}
      <polygon
        points="0,0.04 -0.07,0.13 0,0.10"
        fill="url(#dartFletchL)" stroke="#0b0b0e" strokeWidth={0.003}
      />
      <polygon
        points="0,0.04 0.07,0.13 0,0.10"
        fill="url(#dartFletchR)" stroke="#0b0b0e" strokeWidth={0.003}
      />
      {/* Nervure centrale des plumes */}
      <line x1="0" y1="0.04" x2="0" y2="0.105" stroke="#0b0b0e" strokeWidth={0.004} />
    </g>
  );
}

// Dart plantée sur la cible. Look 3D : on voit principalement la queue qui sort
// du board (puisque la pointe est enfoncée et invisible). Petite ombre portée.
function StuckDart({ x, y }: { x: number; y: number }) {
  return (
    <g transform={`translate(${x}, ${y})`} style={{ pointerEvents: 'none' }}>
      {/* Ombre portée (la dart fait de l'ombre sur le board, vers la droite-bas) */}
      <ellipse cx="0.02" cy="0.045" rx="0.05" ry="0.014" fill="rgba(0,0,0,0.5)" />
      {/* Petit cercle à l'impact (le "trou" dans le board) */}
      <circle cx="0" cy="0" r="0.008" fill="#000" />
      {/* Tige courte qui sort de la cible (la pointe est invisible, plantée) */}
      <rect x="-0.012" y="-0.005" width="0.024" height="0.06" rx="0.006"
        fill="url(#dartShaft)" stroke="#3a3e44" strokeWidth={0.002} />
      {/* Plumes (vue de face) */}
      <polygon points="0,0.04 -0.038,0.08 0,0.065" fill="url(#dartFletchL)" stroke="#0b0b0e" strokeWidth={0.002} />
      <polygon points="0,0.04 0.038,0.08 0,0.065" fill="url(#dartFletchR)" stroke="#0b0b0e" strokeWidth={0.002} />
      <line x1="0" y1="0.04" x2="0" y2="0.075" stroke="#0b0b0e" strokeWidth={0.002} />
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
