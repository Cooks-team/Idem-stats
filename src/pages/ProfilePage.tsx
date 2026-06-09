import { useQuery } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { Shell } from '../ui/Shell';
import { Avatar } from '../ui/Avatar';

export function ProfilePage() {
  const { user, logout } = useAuth();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const requested = params.get('pseudo');
  const target = requested ?? user?.pseudo;

  const { data: entries = [] } = useQuery({
    queryKey: ['leaderboard', 'all'],
    queryFn: () => api.leaderboard(),
  });
  const entry = entries.find((e) => e.user.pseudo === target);
  const rank = entries.findIndex((e) => e.user.pseudo === target);
  const isMe = !requested || requested === user?.pseudo;

  return (
    <Shell title={isMe ? 'Mon profil' : `Profil — ${target}`} onBack={requested ? () => nav(-1) : undefined}>
      <div style={{ display: 'flex', gap: 24, alignItems: 'center' }}>
        <Avatar seed={target ?? '?'} size={104} ring ringColor="var(--accent)" />
        <div>
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 36 }}>{target}</div>
          <div style={{ color: 'var(--muted)', marginTop: 4 }}>
            {rank >= 0 ? `Rang ${rank + 1} / ${entries.length}` : 'Pas encore classé'}
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginTop: 28 }}>
        <Stat label="Victoires" value={entry?.wins ?? 0} color="var(--win)" />
        <Stat label="Défaites" value={entry?.losses ?? 0} color="var(--loss)" />
        <Stat label="Parties" value={entry?.played ?? 0} color="var(--text)" />
        <Stat label="Winrate" value={entry ? `${Math.round(entry.winrate * 100)}%` : '—'} color="var(--accent)" />
      </div>

      {isMe && (
        <div style={{ marginTop: 32 }}>
          <button className="btn btn-ghost" onClick={() => { logout(); nav('/login'); }}>Se déconnecter</button>
        </div>
      )}
    </Shell>
  );
}

function Stat({ label, value, color }: { label: string; value: number | string; color: string }) {
  return (
    <div className="panel">
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.6, color: 'var(--muted)', textTransform: 'uppercase' }}>{label}</div>
      <div className="tabular" style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 36, color, marginTop: 6 }}>{value}</div>
    </div>
  );
}
