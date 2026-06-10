import { useRef, useState } from 'react';
import type { GameModule, GameProps } from './GameModule';

// Darts 1v1 — version arcade.
// Chaque joueur joue 5 tours de 3 fléchettes. À son tour, il clique sur la cible :
// la fléchette atterrit à proximité (avec un léger offset aléatoire pour simuler
// la difficulté). Score par zone : bullseye 50, mid 25, inner 10, outer 5, dehors 0.
// Après 5 tours pour chacun (30 fléchettes au total), le plus haut score gagne.

const ROUNDS = 5;
const DARTS_PER_TURN = 3;
const BOARD_R = 150;     // rayon visuel
const SPREAD = 22;       // px d'écart aléatoire autour du clic

interface Hit { x: number; y: number; score: number; player: 1 | 2; turn: number }

export const DartsGame: GameModule = {
  id: 'darts',
  apiId: 'darts',
  name: 'Fléchettes',
  description: 'Tour par tour, 3 fléchettes chacun. Plus haut score sur 5 tours gagne.',
  Component: DartsComponent,
};

function DartsComponent({ onFinish }: GameProps) {
  const boardRef = useRef<HTMLDivElement | null>(null);
  const [scores, setScores] = useState({ p1: 0, p2: 0 });
  const [turn, setTurn] = useState<1 | 2>(1);
  const [dartsLeftInTurn, setDartsLeftInTurn] = useState(DARTS_PER_TURN);
  const [completedTurns, setCompletedTurns] = useState({ p1: 0, p2: 0 });
  const [hits, setHits] = useState<Hit[]>([]);
  const [phase, setPhase] = useState<'playing' | 'done'>('playing');

  function throwDart(e: React.MouseEvent<HTMLDivElement>) {
    if (phase !== 'playing') return;
    const board = boardRef.current;
    if (!board) return;
    const rect = board.getBoundingClientRect();
    // Coordonnées centrées sur le board (centre = 0,0)
    const aimX = e.clientX - rect.left - BOARD_R;
    const aimY = e.clientY - rect.top - BOARD_R;
    const dx = (Math.random() - 0.5) * 2 * SPREAD;
    const dy = (Math.random() - 0.5) * 2 * SPREAD;
    const hitX = aimX + dx;
    const hitY = aimY + dy;
    const r = Math.hypot(hitX, hitY);
    const score =
      r <= 15  ? 50 :
      r <= 40  ? 25 :
      r <= 80  ? 10 :
      r <= BOARD_R ? 5 : 0;

    const newHit: Hit = { x: hitX + BOARD_R, y: hitY + BOARD_R, score, player: turn, turn: completedTurns[turn === 1 ? 'p1' : 'p2'] + 1 };
    const newHits = [...hits, newHit];
    setHits(newHits);
    setScores((sc) => ({ ...sc, [turn === 1 ? 'p1' : 'p2']: sc[turn === 1 ? 'p1' : 'p2'] + score }));
    const left = dartsLeftInTurn - 1;
    setDartsLeftInTurn(left);
    if (left === 0) {
      // Fin du tour pour ce joueur
      const newCompleted = { ...completedTurns, [turn === 1 ? 'p1' : 'p2']: completedTurns[turn === 1 ? 'p1' : 'p2'] + 1 };
      setCompletedTurns(newCompleted);
      // Si chacun a fait ROUNDS tours, on termine
      if (newCompleted.p1 >= ROUNDS && newCompleted.p2 >= ROUNDS) {
        setPhase('done');
        // setState async — on calcule le score final à partir de l'état que l'on s'apprête à poser
        setTimeout(() => {
          // Recompute sums depuis newHits pour éviter la stale closure
          let p1 = 0, p2 = 0;
          for (const h of newHits) (h.player === 1 ? p1 += h.score : p2 += h.score);
          onFinish(p1, p2);
        }, 800);
        return;
      }
      // Sinon, on passe au joueur suivant
      setTurn(turn === 1 ? 2 : 1);
      setDartsLeftInTurn(DARTS_PER_TURN);
    }
  }

  const currentPlayerLabel = turn === 1 ? '🔴 Joueur 1' : '🔵 Joueur 2';
  const currentPlayerColor = turn === 1 ? '#FF6B57' : '#5B8CFF';
  const currentTurnNum = completedTurns[turn === 1 ? 'p1' : 'p2'] + 1;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
      <div style={{ display: 'flex', gap: 40, fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 28 }}>
        <span style={{ color: '#FF6B57' }}>🔴 {scores.p1}</span>
        <span style={{ color: '#5B8CFF' }}>🔵 {scores.p2}</span>
      </div>
      {phase === 'playing' && (
        <div style={{ color: currentPlayerColor, fontWeight: 600 }}>
          {currentPlayerLabel} — Tour {currentTurnNum}/{ROUNDS} — {dartsLeftInTurn} fléchette{dartsLeftInTurn > 1 ? 's' : ''} restante{dartsLeftInTurn > 1 ? 's' : ''}
        </div>
      )}
      {phase === 'done' && <div style={{ color: 'var(--muted)' }}>Partie terminée. Score envoyé…</div>}

      <div
        ref={boardRef}
        onClick={throwDart}
        style={{
          position: 'relative',
          width: BOARD_R * 2, height: BOARD_R * 2,
          borderRadius: '50%',
          background: 'radial-gradient(circle at center, #D6FF3D 0 15px, #f5c542 15px 40px, #FF6B57 40px 80px, #2E4FCC 80px 150px, transparent 150px)',
          border: '4px solid #0B0D10', cursor: phase === 'playing' ? 'crosshair' : 'default',
          boxShadow: '0 8px 30px rgba(0,0,0,0.6)',
        }}
      >
        {/* Centre */}
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none', fontSize: 12, color: 'rgba(0,0,0,0.4)' }}>•</div>
        {hits.map((h, i) => (
          <div key={i} style={{
            position: 'absolute', left: h.x - 5, top: h.y - 5,
            width: 10, height: 10, borderRadius: '50%',
            background: h.player === 1 ? '#FF6B57' : '#5B8CFF',
            border: '2px solid white', pointerEvents: 'none',
          }} title={`${h.score} pts`} />
        ))}
      </div>

      <div style={{ color: 'var(--muted)', fontSize: 12.5, textAlign: 'center', maxWidth: 360, lineHeight: 1.5 }}>
        Bullseye 🟡 = 50 · Anneau jaune = 25 · Rouge = 10 · Bleu = 5 · Dehors = 0<br />
        Vise précisément — ta fléchette atterrira à ±{SPREAD}px du clic.
      </div>
    </div>
  );
}
