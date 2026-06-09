import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import { Shell } from '../ui/Shell';
import { Field } from '../ui/Field';
import { api } from '../api/client';
import type { Match } from '../api/types';
import { moduleById } from '../games/GameModule';
import { reportScore } from '../games/reportScore';

type Phase = 'setup' | 'playing' | 'done';

// Wrapper de jeu : crée le match (game + opponentPseudo), lance le composant du jeu,
// reçoit onFinish(p1, p2) → reportScore (PATCH + finish), affiche le résultat.
export function GamePlayPage() {
  const { gameId = '' } = useParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const mod = moduleById(gameId);

  const [opponent, setOpponent] = useState('');
  const [phase, setPhase] = useState<Phase>('setup');
  const [match, setMatch] = useState<Match | null>(null);
  const [error, setError] = useState<string | null>(null);

  const createMut = useMutation({
    mutationFn: () => api.createMatch(mod!.apiId, opponent.trim()),
    onSuccess: (m) => {
      setMatch(m);
      setPhase('playing');
      qc.invalidateQueries({ queryKey: ['matches'] });
    },
    onError: (e) => setError(humanize(e)),
  });

  const reportMut = useMutation({
    mutationFn: ({ p1, p2 }: { p1: number; p2: number }) => reportScore(match!.id, p1, p2),
    onSuccess: (m) => {
      setMatch(m);
      setPhase('done');
      qc.invalidateQueries({ queryKey: ['matches'] });
      qc.invalidateQueries({ queryKey: ['leaderboard'] });
    },
    onError: (e) => setError(humanize(e)),
  });

  if (!mod) {
    return (
      <Shell title="Jeu inconnu" onBack={() => nav('/games')} action={<span />}>
        <div className="panel" style={{ color: 'var(--loss)' }}>Aucun mini-jeu avec l'id "{gameId}".</div>
      </Shell>
    );
  }

  return (
    <Shell title={mod.name} onBack={() => nav('/games')} action={<span />}>
      {phase === 'setup' && (
        <div className="panel field-group" style={{ maxWidth: 540 }}>
          <p style={{ color: 'var(--muted)', margin: 0 }}>
            Qui affronte qui ? Saisis le pseudo de ton adversaire (compte existant).
            La partie se joue ici, sur le même écran.
          </p>
          <Field label="Adversaire" placeholder="pseudo" value={opponent} onChange={(e) => setOpponent(e.target.value)} />
          {error && <div style={{ color: 'var(--loss)', fontSize: 13 }}>{error}</div>}
          <button
            className="btn btn-accent btn-lg btn-full"
            disabled={opponent.trim().length < 3 || createMut.isPending}
            onClick={() => createMut.mutate()}
          >
            {createMut.isPending ? '…' : 'Lancer la partie'}
          </button>
        </div>
      )}

      {phase === 'playing' && match && (
        <div className="panel" style={{ padding: 20 }}>
          <mod.Component onFinish={(p1, p2) => reportMut.mutate({ p1, p2 })} />
        </div>
      )}

      {phase === 'done' && match && (
        <div className="panel" style={{ textAlign: 'center', padding: 40 }}>
          <div style={{ color: 'var(--muted)', fontSize: 14 }}>Score final</div>
          <div className="tabular" style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 80 }}>
            {match.scoreP1} – {match.scoreP2}
          </div>
          <div style={{ color: 'var(--win)', fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 22, marginTop: 6 }}>
            {match.winnerId == null ? 'Match nul' : `Victoire : ${match.winnerId === match.player1Id ? match.player1?.pseudo ?? 'P1' : match.player2?.pseudo ?? 'P2'}`}
          </div>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'center', marginTop: 24 }}>
            <button className="btn btn-ghost" onClick={() => nav('/games')}>Retour au hub</button>
            <button className="btn btn-accent" onClick={() => { setPhase('setup'); setMatch(null); }}>Rejouer</button>
          </div>
        </div>
      )}
    </Shell>
  );
}

function humanize(e: unknown): string {
  if (e && typeof e === 'object' && 'message' in e) {
    const m = String((e as { message: string }).message);
    if (m === 'opponent_not_found') return 'Cet adversaire n\'existe pas.';
    if (m === 'cannot_play_self') return 'Tu ne peux pas jouer contre toi-même.';
    return m;
  }
  return 'Action impossible.';
}
