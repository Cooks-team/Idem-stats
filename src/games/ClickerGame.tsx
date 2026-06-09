import { useEffect, useState } from 'react';
import type { GameModule, GameProps } from './GameModule';

// Placeholder de mini-jeu 1v1 sur le même écran : 10 s pour cliquer le plus vite.
// Premier en quantité gagne. Tous les jeux suivront ce même contrat onFinish(p1, p2).
const DURATION_S = 10;

function ClickerComponent({ onFinish }: GameProps) {
  const [phase, setPhase] = useState<'ready' | 'running' | 'done'>('ready');
  const [p1, setP1] = useState(0);
  const [p2, setP2] = useState(0);
  const [remaining, setRemaining] = useState(DURATION_S);

  useEffect(() => {
    if (phase !== 'running') return;
    if (remaining <= 0) {
      setPhase('done');
      onFinish(p1, p2);
      return;
    }
    const t = setTimeout(() => setRemaining((r) => r - 1), 1_000);
    return () => clearTimeout(t);
    // p1/p2 capturés au moment où on bascule "done" — c'est voulu
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, remaining]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ textAlign: 'center', fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 64, color: phase === 'running' ? 'var(--accent)' : 'var(--text)' }}>
        {phase === 'ready' ? 'Prêts ?' : phase === 'running' ? remaining : 'Terminé'}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, minHeight: 360 }}>
        <Pad label="Joueur 1" tone="#FF6B57" count={p1} enabled={phase === 'running'} onClick={() => setP1((v) => v + 1)} />
        <Pad label="Joueur 2" tone="#5B8CFF" count={p2} enabled={phase === 'running'} onClick={() => setP2((v) => v + 1)} />
      </div>

      {phase === 'ready' && (
        <button
          className="btn btn-accent btn-lg btn-full"
          onClick={() => { setRemaining(DURATION_S); setPhase('running'); }}
        >Démarrer (10 s)</button>
      )}
    </div>
  );
}

function Pad({ label, tone, count, enabled, onClick }: {
  label: string; tone: string; count: number; enabled: boolean; onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={!enabled}
      style={{
        border: `2px solid ${enabled ? tone : `color-mix(in srgb, ${tone} 20%, transparent)`}`,
        background: `color-mix(in srgb, ${tone} 12%, transparent)`,
        borderRadius: 22, color: tone,
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        gap: 14, padding: 16, cursor: enabled ? 'pointer' : 'default',
      }}
    >
      <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 22 }}>{label}</div>
      <div className="tabular" style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 140, lineHeight: 1 }}>{count}</div>
      <div style={{ fontSize: 14, opacity: 0.7 }}>{enabled ? 'Tape !' : '—'}</div>
    </button>
  );
}

export const ClickerGame: GameModule = {
  id: 'clicker',
  apiId: 'clicker',
  name: 'Click Battle',
  description: '10 secondes, deux pads. Premier en quantité gagne.',
  Component: ClickerComponent,
};
