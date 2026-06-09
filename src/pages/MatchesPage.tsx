import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import type { Match } from '../api/types';
import { Shell } from '../ui/Shell';
import { displayGame } from '../games/registry';

export function MatchesPage() {
  const nav = useNavigate();
  const { data: matches = [], isLoading } = useQuery({
    queryKey: ['matches', 'me'],
    queryFn: () => api.listMatches('me'),
    refetchInterval: 6_000,
  });

  return (
    <Shell title="Mes matchs">
      {isLoading && matches.length === 0 ? (
        <div className="panel" style={{ textAlign: 'center', color: 'var(--muted)' }}>Chargement…</div>
      ) : matches.length === 0 ? (
        <div className="panel" style={{ textAlign: 'center', padding: 40 }}>
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 24, marginBottom: 8 }}>
            Pas encore de match
          </div>
          <div style={{ color: 'var(--muted)', marginBottom: 18 }}>Lance ta première partie ou rejoins-en une avec un code.</div>
          <button className="btn btn-accent" onClick={() => nav('/matches/new')}>Démarrer un match</button>
        </div>
      ) : (
        <div className="panel" style={{ padding: 6 }}>
          {matches.map((m) => <MatchRow key={m.id} m={m} onClick={() => nav(`/matches/${m.id}`)} />)}
        </div>
      )}
    </Shell>
  );
}

function MatchRow({ m, onClick }: { m: Match; onClick: () => void }) {
  const [color, label] = (() => {
    switch (m.status) {
      case 'pending': return ['var(--muted)', `En attente — code ${m.code ?? '—'}`];
      case 'active': return ['var(--accent)', 'En direct'];
      case 'finished': return ['var(--win)', 'Terminé'];
      case 'cancelled': return ['var(--loss)', 'Annulé'];
    }
  })();
  return (
    <div onClick={onClick} style={{
      display: 'flex', alignItems: 'center', gap: 16, padding: '14px 14px',
      borderRadius: 12, cursor: 'pointer',
    }}>
      <span style={{ width: 10, height: 10, borderRadius: 10, background: color, flexShrink: 0 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600, fontSize: 15 }}>{displayGame(m.game)}</div>
        <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>{label}</div>
      </div>
      <div className="tabular" style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 22 }}>
        {m.scoreP1} – {m.scoreP2}
      </div>
    </div>
  );
}
