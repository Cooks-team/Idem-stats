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

type Tab = 'leaderboard' | 'shame';

export function HomePage() {
  const { user } = useAuth();
  const nav = useNavigate();
  const [tab, setTab] = useState<Tab>('leaderboard');
  const [filter, setFilter] = useState<string | null>(null); // null = Général

  const { data: entries = [], isLoading } = useQuery({
    queryKey: ['leaderboard', filter ?? 'all'],
    queryFn: () => api.leaderboard(filter ?? undefined),
  });
  // Wall of shame — chargé en parallèle pour pouvoir afficher la breaking
  // news même en vue Classement.
  const { data: shame } = useQuery({
    queryKey: ['wall-of-shame'],
    queryFn: () => api.wallOfShame(),
    refetchInterval: 15_000,
  });

  const myIndex = entries.findIndex((e) => e.user.pseudo === user?.pseudo);
  const myRank = myIndex >= 0 ? myIndex + 1 : null;
  const rest = entries.slice(3).filter((e) => e.user.pseudo !== user?.pseudo);
  const totalPlayed = entries.reduce((sum, e) => sum + e.played, 0);

  return (
    <Shell
      title={tab === 'shame' ? 'Wall of shame' : 'Classement'}
      subtitle={tab === 'shame'
        ? `${shame?.totalEvents ?? 0} fessées au Basket Random`
        : `${entries.length} joueurs · ${totalPlayed} parties`}
    >
      {/* Breaking news : dernier 5-0 Basket Random, affiché en haut quel que soit l'onglet */}
      {shame?.latest && <BreakingNews latest={shame.latest} onOpenShame={() => setTab('shame')} />}

      {/* Toggle Classement / Wall of shame */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <button
          className={`chip ${tab === 'leaderboard' ? 'active accent' : ''}`}
          onClick={() => setTab('leaderboard')}
        >🏆 Classement</button>
        <button
          className={`chip ${tab === 'shame' ? 'active' : ''}`}
          onClick={() => setTab('shame')}
          style={tab === 'shame' ? { background: 'var(--loss)', color: 'white', borderColor: 'var(--loss)' } : undefined}
        >💀 Wall of shame{shame?.totalEvents ? ` (${shame.totalEvents})` : ''}</button>
      </div>

      {tab === 'shame' ? (
        <WallOfShameView shame={shame} onPlayerClick={(p) => nav(`/profile?pseudo=${encodeURIComponent(p)}`)} />
      ) : (
        <LeaderboardView
          entries={entries} isLoading={isLoading} filter={filter} setFilter={setFilter}
          user={user} myIndex={myIndex} myRank={myRank} rest={rest} nav={nav}
        />
      )}
    </Shell>
  );
}

// ─── Bandeau breaking news ────────────────────────────────────────────────
function BreakingNews({ latest, onOpenShame }: {
  latest: import('../api/types').WallOfShameLatest;
  onOpenShame: () => void;
}) {
  return (
    <div
      onClick={onOpenShame}
      style={{
        display: 'flex', alignItems: 'center', gap: 14,
        padding: '12px 16px', marginBottom: 18,
        borderRadius: 12,
        background: 'linear-gradient(100deg, var(--loss), color-mix(in srgb, var(--loss) 60%, #000))',
        color: 'white', cursor: 'pointer',
        boxShadow: '0 4px 14px rgba(0,0,0,0.4)',
        animation: 'pulseShame 2.4s ease-in-out infinite',
      }}
      title="Voir le Wall of shame"
    >
      <span style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 11,
                     letterSpacing: 1.4, background: 'rgba(255,255,255,0.18)',
                     padding: '4px 10px', borderRadius: 6, whiteSpace: 'nowrap' }}>
        🔴 BREAKING
      </span>
      <Avatar seed={latest.loser.pseudo} size={36} imageUrl={absoluteAvatar(latest.loser.avatarUrl)} />
      <div style={{ flex: 1, minWidth: 0, fontSize: 14.5, lineHeight: 1.35 }}>
        <strong>{latest.loser.pseudo}</strong> s'est fait mangeave le cul par{' '}
        <strong>{latest.winner.pseudo}</strong> au Basket Random (5-0) 🔞
      </div>
      <span style={{ fontSize: 11, opacity: 0.85, whiteSpace: 'nowrap' }}>
        {timeAgo(latest.match.finishedAt)}
      </span>
      <style>{`@keyframes pulseShame { 0%,100% { box-shadow: 0 4px 14px rgba(0,0,0,0.4); } 50% { box-shadow: 0 4px 24px color-mix(in srgb, var(--loss) 70%, transparent); } }`}</style>
    </div>
  );
}

function timeAgo(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const sec = Math.max(0, Math.floor((Date.now() - d.getTime()) / 1000));
  if (sec < 60) return "à l'instant";
  if (sec < 3600) return `il y a ${Math.floor(sec / 60)} min`;
  if (sec < 86400) return `il y a ${Math.floor(sec / 3600)} h`;
  return `il y a ${Math.floor(sec / 86400)} j`;
}

// ─── Vue Wall of shame ───────────────────────────────────────────────────
function WallOfShameView({ shame, onPlayerClick }: {
  shame: import('../api/types').WallOfShameResponse | undefined;
  onPlayerClick: (pseudo: string) => void;
}) {
  if (!shame) return <div className="panel" style={{ textAlign: 'center', color: 'var(--muted)' }}>Chargement…</div>;
  if (shame.totalEvents === 0) {
    return (
      <div className="panel" style={{ textAlign: 'center', padding: 50 }}>
        <div style={{ fontSize: 60 }}>🧼</div>
        <div style={{ marginTop: 12, color: 'var(--muted)' }}>
          Personne ne s'est encore pris de 5-0 au Basket Random. Première fessée à venir !
        </div>
      </div>
    );
  }
  return (
    <>
      <div style={{ color: 'var(--muted)', fontSize: 13, marginBottom: 10 }}>
        Classement des joueurs qui se sont pris le plus de fessées à 5-0 au Basket Random.
        Aucun honneur, juste de la honte 🔞
      </div>
      <div className="panel" style={{ padding: 6 }}>
        {shame.ranking.map((e, i) => (
          <ShameRow
            key={e.user.id}
            rank={i + 1}
            entry={e}
            onClick={() => onPlayerClick(e.user.pseudo)}
          />
        ))}
      </div>
    </>
  );
}

function ShameRow({ rank, entry, onClick }: {
  rank: number;
  entry: import('../api/types').WallOfShameEntry;
  onClick: () => void;
}) {
  const skull = rank === 1 ? '💀💀💀' : rank === 2 ? '💀💀' : rank === 3 ? '💀' : '';
  return (
    <div
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: 14, padding: '12px 14px',
        borderRadius: 12, cursor: 'pointer',
      }}
    >
      <span className="tabular" style={{
        fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 18,
        color: 'var(--loss)', minWidth: 28, textAlign: 'center',
      }}>{rank}</span>
      <Avatar seed={entry.user.pseudo} size={40} imageUrl={absoluteAvatar(entry.user.avatarUrl)} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600, fontSize: 15.5 }}>
          {entry.user.pseudo} {skull && <span style={{ marginLeft: 6 }}>{skull}</span>}
        </div>
        <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>
          Dernière fessée {timeAgo(entry.lastAt)}
        </div>
      </div>
      <div style={{ textAlign: 'right' }}>
        <div className="tabular" style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 22, color: 'var(--loss)' }}>
          {entry.count}
        </div>
        <div style={{ fontSize: 11, color: 'var(--muted)' }}>5-0 PRIS</div>
      </div>
    </div>
  );
}

// ─── Vue Classement (extraite pour clarté) ──────────────────────────────
function LeaderboardView({ entries, isLoading, filter, setFilter, user, myIndex, myRank, rest, nav }: {
  entries: LeaderboardEntry[];
  isLoading: boolean;
  filter: string | null;
  setFilter: (s: string | null) => void;
  user: import('../api/types').User | null;
  myIndex: number;
  myRank: number | null;
  rest: LeaderboardEntry[];
  nav: ReturnType<typeof useNavigate>;
}) {
  return (
    <>
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
            <Podium top3={entries.slice(0, 3)} onPlayerClick={(p) => nav(`/profile?pseudo=${encodeURIComponent(p)}`)} />
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
    </>
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
