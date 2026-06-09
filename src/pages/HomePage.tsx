import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { absoluteAvatar, api } from '../api/client';
import type { FriendshipRow, LeaderboardEntry } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { Shell } from '../ui/Shell';
import { Avatar } from '../ui/Avatar';
import { Podium } from '../ui/Podium';
import { KNOWN_GAMES } from '../games/registry';

export function HomePage() {
  const { user } = useAuth();
  const nav = useNavigate();
  const [filter, setFilter] = useState<string | null>(null); // null = Général

  const { data: entries = [], isLoading } = useQuery({
    queryKey: ['leaderboard', filter ?? 'all'],
    queryFn: () => api.leaderboard(filter ?? undefined),
  });

  const top3 = entries.slice(0, 3);
  const myIndex = entries.findIndex((e) => e.user.pseudo === user?.pseudo);
  const myRank = myIndex >= 0 ? myIndex + 1 : null;
  const rest = entries.slice(3).filter((e) => e.user.pseudo !== user?.pseudo);
  const totalPlayed = entries.reduce((sum, e) => sum + e.played, 0);

  return (
    <Shell
      title="Classement"
      subtitle={`${entries.length} joueurs · ${totalPlayed} parties`}
    >
      {/* Chips de filtres */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 24 }}>
        <button className={`chip ${filter === null ? 'active accent' : ''}`} onClick={() => setFilter(null)}>Général</button>
        {KNOWN_GAMES.map((g) => (
          <button
            key={g.apiId}
            className={`chip ${filter === g.apiId ? 'active' : ''}`}
            onClick={() => setFilter(g.apiId)}
          >{g.display}</button>
        ))}
      </div>

      {isLoading && entries.length === 0 ? (
        <div className="panel" style={{ textAlign: 'center', color: 'var(--muted)' }}>Chargement du classement…</div>
      ) : entries.length === 0 ? (
        <div className="panel" style={{ textAlign: 'center', color: 'var(--muted)' }}>
          Personne n'a encore joué. <button className="btn btn-accent btn-sm" style={{ marginLeft: 12 }} onClick={() => nav('/matches/new')}>Lancer le premier match</button>
        </div>
      ) : (
        <>
          <div className="panel" style={{ padding: '28px 28px 36px' }}>
            <div className="eyebrow"><span className="label">Podium</span></div>
            <Podium top3={top3} onPlayerClick={(p) => nav(`/profile?pseudo=${encodeURIComponent(p)}`)} />
          </div>

          {/* "Vous" */}
          {myRank && entries[myIndex] && (
            <div style={{
              marginTop: 20, padding: '18px 22px', borderRadius: 'var(--r)',
              background: 'linear-gradient(100deg, color-mix(in srgb, var(--accent) 16%, var(--surface)), var(--surface))',
              border: '1px solid color-mix(in srgb, var(--accent) 40%, var(--line))',
              display: 'flex', alignItems: 'center', gap: 16,
              cursor: 'pointer',
            }} onClick={() => nav('/profile')}>
              <RankNum n={myRank} size={22} />
              <Avatar seed={user!.pseudo} size={46} imageUrl={absoluteAvatar(user!.avatarUrl)} />
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: 17 }}>Vous · {user!.pseudo}</div>
                <div style={{ fontSize: 13, color: 'var(--muted)' }}>
                  {entries[myIndex].wins}V · {entries[myIndex].losses}D · {(entries[myIndex].winrate * 100).toFixed(0)}%
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div className="tabular" style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 28 }}>{entries[myIndex].wins}</div>
                <div style={{ fontSize: 11, color: 'var(--muted)' }}>VICTOIRES</div>
              </div>
            </div>
          )}

          {/* Amis — duels rapides */}
          <FriendsQuickStrip />

          {/* Le reste */}
          <div style={{ marginTop: 28 }}>
            <div className="eyebrow"><span className="label">Le reste de la meute</span></div>
            <div className="panel" style={{ padding: 6 }}>
              {rest.map((e) => {
                const n = entries.indexOf(e) + 1;
                return <RankRow key={e.user.id} rank={n} entry={e} onClick={() => nav(`/profile?pseudo=${encodeURIComponent(e.user.pseudo)}`)} />;
              })}
              {rest.length === 0 && (
                <div style={{ padding: 16, textAlign: 'center', color: 'var(--muted)' }}>Personne d'autre n'est encore classé.</div>
              )}
            </div>
          </div>
        </>
      )}
    </Shell>
  );
}

function RankNum({ n, size = 18 }: { n: number; size?: number }) {
  const color = n === 1 ? 'var(--gold)' : n === 2 ? 'var(--silver)' : n === 3 ? 'var(--bronze)' : 'var(--muted)';
  return (
    <span className="tabular" style={{
      fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: size,
      color, minWidth: 28, textAlign: 'center', display: 'inline-block',
    }}>{n}</span>
  );
}

// Bandeau "Mes amis" sur la home avec un bouton Shifumi distance par ami.
function FriendsQuickStrip() {
  const nav = useNavigate();
  const { data } = useQuery({
    queryKey: ['friends'],
    queryFn: () => api.listFriends(),
    refetchInterval: 10_000,
  });
  const friends = data?.friends ?? [];
  const hasIncoming = (data?.incoming.length ?? 0) > 0;

  return (
    <div style={{ marginTop: 28 }}>
      <div className="eyebrow">
        <span className="label">Mes amis · duels rapides</span>
        <button className="btn btn-line btn-sm" onClick={() => nav('/friends')}>
          {hasIncoming ? `Voir mes amis (${data!.incoming.length} demande${data!.incoming.length > 1 ? 's' : ''})` : 'Gérer mes amis'}
        </button>
      </div>
      {friends.length === 0 ? (
        <div className="panel" style={{ color: 'var(--muted)', textAlign: 'center' }}>
          Pas encore d'amis. <button className="btn btn-accent btn-sm" style={{ marginLeft: 12 }} onClick={() => nav('/friends')}>Ajouter</button>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 10 }}>
          {/* Duel rapide : on pré-remplit juste l'opponent + duelMode=remote, l'utilisateur choisit le jeu */}
          {friends.map((f) => <FriendCard key={f.id} row={f} onShifumi={(pseudo) => nav(`/matches/new?opponent=${encodeURIComponent(pseudo)}&duelMode=remote`)} />)}
        </div>
      )}
    </div>
  );
}

function FriendCard({ row, onShifumi }: { row: FriendshipRow; onShifumi: (pseudo: string) => void }) {
  // "Duel rapide" = ouvre NewMatchPage avec l'ami pré-rempli et le mode invitation,
  // mais SANS jeu présélectionné — l'utilisateur choisit parmi tous ceux dispo.
  return (
    <div className="panel" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 12 }}>
      <Avatar seed={row.user.pseudo} size={40} imageUrl={absoluteAvatar(row.user.avatarUrl)} />
      <div style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        <div style={{ fontWeight: 700 }}>{row.user.pseudo}</div>
      </div>
      <button className="btn btn-accent btn-sm" onClick={() => onShifumi(row.user.pseudo)} title="Choisis un jeu et invite cet ami">⚔️ Duel rapide</button>
    </div>
  );
}

function RankRow({ rank, entry, onClick }: { rank: number; entry: LeaderboardEntry; onClick?: () => void }) {
  return (
    <div
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: 14, padding: '12px 14px',
        borderRadius: 12, cursor: onClick ? 'pointer' : 'default',
      }}
    >
      <RankNum n={rank} />
      <Avatar seed={entry.user.pseudo} size={40} imageUrl={absoluteAvatar(entry.user.avatarUrl)} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600, fontSize: 15.5 }}>{entry.user.pseudo}</div>
        <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>{entry.wins}V · {entry.losses}D</div>
      </div>
      <div style={{ textAlign: 'right' }}>
        <div className="tabular" style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 18 }}>{entry.wins}</div>
        <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>{(entry.winrate * 100).toFixed(0)}%</div>
      </div>
    </div>
  );
}
