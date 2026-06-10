import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import { Shell } from '../ui/Shell';
import { Field } from '../ui/Field';
import { Avatar } from '../ui/Avatar';
import { absoluteAvatar, api } from '../api/client';
import type { Match } from '../api/types';
import { moduleById } from '../games/GameModule';
import { reportScore } from '../games/reportScore';
import { useAuth } from '../auth/AuthContext';
import { MatchResultModal } from '../ui/MatchResultModal';

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

  // On affiche la liste d'amis pour pouvoir lancer un duel d'un tap sans
  // taper de pseudo. Fallback : input pseudo classique en dessous.
  const { data: friendsData } = useQuery({
    queryKey: ['friends'],
    queryFn: () => api.listFriends(),
    staleTime: 30_000,
  });
  const friends = friendsData?.friends ?? [];

  // Mutation acceptant le pseudo en argument → on peut la déclencher sans
  // attendre que le state opponent soit synchro (utile pour le click sur
  // un ami : on lance direct avec son pseudo).
  const createMut = useMutation({
    mutationFn: (pseudo: string) => api.createMatch(mod!.apiId, pseudo.trim()),
    onSuccess: (m) => {
      setMatch(m);
      setPhase('playing');
      qc.invalidateQueries({ queryKey: ['matches'] });
    },
    onError: (e) => setError(humanize(e)),
  });

  const { user, setUser } = useAuth();
  const reportMut = useMutation({
    mutationFn: ({ p1, p2 }: { p1: number; p2: number }) => reportScore(match!.id, p1, p2),
    onSuccess: (m) => {
      setMatch(m);
      setPhase('done');
      qc.invalidateQueries({ queryKey: ['matches'] });
      qc.invalidateQueries({ queryKey: ['leaderboard'] });
      // Sync solde de coins après le crédit serveur (gain de match)
      const rewards = (m.metadata as { rewards?: import('../api/types').MatchRewards } | null)?.rewards;
      if (rewards && user) {
        const mine = m.player1Id === user.id ? rewards.p1 : m.player2Id === user.id ? rewards.p2 : null;
        if (mine && typeof user.coins === 'number') {
          setUser({ ...user, coins: user.coins + mine.coinsDelta });
        }
      }
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
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 640 }}>
          <p style={{ color: 'var(--muted)', margin: 0 }}>
            Qui affronte qui ? Tape un ami pour lancer direct, ou saisis le pseudo
            d'un autre joueur. La partie se joue ici, sur le même écran.
          </p>

          {friends.length > 0 && (
            <div className="panel" style={{ padding: 16 }}>
              <div className="eyebrow"><span className="label">Mes amis</span></div>
              <div style={{
                display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))',
                gap: 10,
              }}>
                {friends.map((f) => (
                  <button
                    key={f.id}
                    onClick={() => createMut.mutate(f.user.pseudo)}
                    disabled={createMut.isPending}
                    style={{
                      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
                      padding: '14px 8px', borderRadius: 12,
                      background: 'var(--surface-2)',
                      border: '1px solid var(--line)',
                      color: 'var(--text)', cursor: createMut.isPending ? 'wait' : 'pointer',
                      transition: 'transform .08s ease, border-color .15s ease',
                    }}
                    onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--accent)'; }}
                    onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--line)'; }}
                  >
                    <Avatar seed={f.user.pseudo} size={56} imageUrl={absoluteAvatar(f.user.avatarUrl)} />
                    <div style={{ fontWeight: 600, fontSize: 14, textAlign: 'center', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '100%', whiteSpace: 'nowrap' }}>
                      {f.user.pseudo}
                    </div>
                    <span style={{
                      fontSize: 11, fontWeight: 700, letterSpacing: 0.5,
                      color: 'var(--accent-ink)', background: 'var(--accent)',
                      padding: '3px 8px', borderRadius: 6,
                    }}>⚔️ Duel</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="panel field-group" style={{ padding: 16 }}>
            <div className="eyebrow">
              <span className="label">{friends.length > 0 ? 'Ou par pseudo' : 'Adversaire'}</span>
            </div>
            <Field
              label="Adversaire"
              placeholder="pseudo (compte existant)"
              value={opponent}
              onChange={(e) => setOpponent(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && opponent.trim().length >= 3 && createMut.mutate(opponent.trim())}
            />
            {error && <div style={{ color: 'var(--loss)', fontSize: 13 }}>{error}</div>}
            <button
              className="btn btn-accent btn-lg btn-full"
              disabled={opponent.trim().length < 3 || createMut.isPending}
              onClick={() => createMut.mutate(opponent.trim())}
            >
              {createMut.isPending ? '…' : 'Lancer la partie'}
            </button>
          </div>
        </div>
      )}

      {phase === 'playing' && match && (
        <div className="panel" style={{ padding: 20 }}>
          <mod.Component
            onFinish={(p1, p2) => reportMut.mutate({ p1, p2 })}
            player1={match.player1 ? { pseudo: match.player1.pseudo, avatarUrl: absoluteAvatar(match.player1.avatarUrl ?? null) } : undefined}
            player2={match.player2 ? { pseudo: match.player2.pseudo, avatarUrl: absoluteAvatar(match.player2.avatarUrl ?? null) } : undefined}
          />
        </div>
      )}

      {/* Modal de gains (ELO + coins) au-dessus du panel done */}
      {phase === 'done' && match && user && (
        <MatchResultModal match={match} myUserId={user.id} />
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
