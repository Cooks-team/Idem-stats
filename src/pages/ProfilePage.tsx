import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { absoluteAvatar, api } from '../api/client';
import type { Badge, Match, ShifumiMetadata } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { Shell } from '../ui/Shell';
import { Avatar } from '../ui/Avatar';
import { displayGame, KNOWN_GAMES } from '../games/registry';
import { RankBadge } from './HomePage';

export function ProfilePage() {
  const { user, logout, setUser } = useAuth();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const requested = params.get('pseudo');
  const target = requested ?? user?.pseudo;
  const [visibleCount, setVisibleCount] = useState(5);

  const { data: entries = [] } = useQuery({
    queryKey: ['leaderboard', 'all'],
    queryFn: () => api.leaderboard(),
  });
  const entry = entries.find((e) => e.user.pseudo === target);
  const rank = entries.findIndex((e) => e.user.pseudo === target);
  const isMe = !requested || requested === user?.pseudo;

  // Pour le profil "moi", on prend l'avatar du user en mémoire (à jour si on vient
  // d'uploader). Sinon on prend celui du leaderboard.
  const targetAvatar = isMe ? user?.avatarUrl : entry?.user.avatarUrl;
  const imageUrl = absoluteAvatar(targetAvatar ?? null);

  // Historique des matchs (finis pour la plupart) du user affiché.
  const { data: history = [], isLoading: histLoading } = useQuery({
    queryKey: ['history', target ?? ''],
    queryFn: () => target ? api.listMatchesOf(target) : Promise.resolve([] as Match[]),
    enabled: !!target,
  });

  // Badges du user affiché (Monster, Pue sa mère, Sniper, streak, etc.)
  const { data: badgesData } = useQuery({
    queryKey: ['badges', target ?? ''],
    queryFn: () => target ? api.badges(target) : Promise.resolve({ user: { id: '', pseudo: '' }, badges: [] }),
    enabled: !!target,
  });
  const badges = badgesData?.badges ?? [];

  return (
    <Shell title={isMe ? 'Mon profil' : `Profil — ${target}`} onBack={requested ? () => nav(-1) : undefined}>
      <div style={{ display: 'flex', gap: 24, alignItems: 'center', flexWrap: 'wrap' }}>
        <Avatar seed={target ?? '?'} size={104} ring ringColor="var(--accent)" imageUrl={imageUrl} />
        <div style={{ flex: 1, minWidth: 0 }}>
          {isMe ? (
            <PseudoEditor current={target ?? ''} onSaved={setUser} />
          ) : (
            <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 36 }}>{target}</div>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
            {entry?.rank && <RankBadge rank={entry.rank} />}
            {entry && (
              <button
                type="button"
                onClick={() => nav('/ranks')}
                title="Voir le barème des ranks"
                style={{
                  background: 'transparent', border: 'none', cursor: 'pointer', padding: 0,
                  fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 18, color: entry.rank.color,
                }}
              >
                {entry.elo} <span style={{ fontSize: 12, color: 'var(--muted)' }}>ELO</span>
              </button>
            )}
            <span style={{ color: 'var(--muted)', fontSize: 13 }}>
              · {rank >= 0 ? `Rang ${rank + 1} / ${entries.length}` : 'Pas encore classé'}
            </span>
          </div>
        </div>
        {isMe && <AvatarUpload onChange={setUser} hasAvatar={!!user?.avatarUrl} />}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12, marginTop: 28 }}>
        <Stat label="Victoires" value={entry?.wins ?? 0} color="var(--win)" />
        <Stat label="Défaites" value={entry?.losses ?? 0} color="var(--loss)" />
        <Stat label="Parties" value={entry?.played ?? 0} color="var(--text)" />
        <Stat label="Winrate" value={entry ? `${Math.round(entry.winrate * 100)}%` : '—'} color="var(--accent)" />
      </div>

      {/* ELO par jeu — utile pour voir où le joueur est fort */}
      {entry && Object.keys(entry.perGameElo).length > 0 && (
        <div style={{ marginTop: 28 }}>
          <div className="eyebrow"><span className="label">ELO par jeu</span></div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 10 }}>
            {KNOWN_GAMES
              .map((g) => ({ apiId: g.apiId, display: g.display, e: entry.perGameElo[g.apiId] }))
              .filter((row) => row.e)
              .sort((a, b) => (b.e!.rating - a.e!.rating))
              .map(({ apiId, display, e }) => (
                <div key={apiId} className="panel" style={{ padding: 12, display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 700 }}>{display}</div>
                    <div style={{ marginTop: 4 }}>
                      <RankBadge rank={e!.rank} size="sm" />
                    </div>
                    <div style={{ marginTop: 4, fontSize: 11.5, color: 'var(--muted)' }}>{e!.games} partie{e!.games > 1 ? 's' : ''}</div>
                  </div>
                  <div className="tabular" style={{
                    fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 28,
                    color: e!.rank.color, lineHeight: 1,
                  }}>{e!.rating}</div>
                </div>
              ))}
          </div>
        </div>
      )}

      {/* Badges décernés */}
      {badges.length > 0 && (
        <div style={{ marginTop: 32 }}>
          <div className="eyebrow"><span className="label">Badges</span></div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {badges.map((b) => <BadgeChip key={b.id} badge={b} />)}
          </div>
        </div>
      )}

      {/* Historique des duels */}
      <div style={{ marginTop: 32 }}>
        <div className="eyebrow"><span className="label">Historique des duels</span></div>
        {histLoading && history.length === 0 ? (
          <div className="panel" style={{ color: 'var(--muted)', textAlign: 'center' }}>Chargement…</div>
        ) : history.length === 0 ? (
          <div className="panel" style={{ color: 'var(--muted)', textAlign: 'center' }}>Aucun duel pour l'instant.</div>
        ) : (
          <div className="panel" style={{ padding: 6 }}>
            {(() => {
            const finished = history.filter((m) => m.status === 'finished');
            return finished.length === 0 ? (
              <div style={{ padding: 16, textAlign: 'center', color: 'var(--muted)' }}>Pas encore de duel terminé.</div>
            ) : (
              <div className="panel" style={{ padding: 6 }}>
                {finished.slice(0, visibleCount).map((m) => (
                  <HistoryRow key={m.id} match={m} viewedPseudo={target ?? ''} onPlayer={(p) => nav(`/profile?pseudo=${encodeURIComponent(p)}`)} onOpen={() => nav(`/matches/${m.id}`)} />
                ))}
                {visibleCount < finished.length && (
                  <button
                    className="btn btn-line btn-sm"
                    style={{ display: 'block', margin: '10px auto 4px' }}
                    onClick={() => setVisibleCount((v) => v + 15)}
                  >
                    Voir plus ({Math.min(15, finished.length - visibleCount)} de plus)
                  </button>
                )}
              </div>
            );
          })()}
          </div>
        )}
      </div>

      {isMe && (
        <div style={{ marginTop: 32 }}>
          <button className="btn btn-ghost" onClick={() => { logout(); nav('/login'); }}>Se déconnecter</button>
        </div>
      )}
    </Shell>
  );
}

// Édition inline du pseudo. Toggle entre "affichage" et "édition".
function PseudoEditor({ current, onSaved }: { current: string; onSaved: (u: import('../api/types').User) => void }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(current);
  const [error, setError] = useState<string | null>(null);

  const mut = useMutation({
    mutationFn: () => api.updateMe({ pseudo: value.trim() }),
    onSuccess: (u) => {
      onSaved(u);
      // Invalide tout ce qui peut afficher le pseudo (leaderboard, friends, history)
      qc.invalidateQueries({ queryKey: ['leaderboard'] });
      qc.invalidateQueries({ queryKey: ['history'] });
      qc.invalidateQueries({ queryKey: ['friends'] });
      setEditing(false);
    },
    onError: (e) => setError(humanizePseudo(e)),
  });

  if (!editing) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 36, lineHeight: 1 }}>{current}</div>
        <button
          className="btn btn-ghost btn-sm"
          onClick={() => { setEditing(true); setValue(current); setError(null); }}
        >Modifier</button>
      </div>
    );
  }
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      <input
        autoFocus
        value={value}
        onChange={(e) => { setValue(e.target.value); setError(null); }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') mut.mutate();
          if (e.key === 'Escape') { setEditing(false); setError(null); }
        }}
        style={{
          fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 32,
          background: 'var(--surface)', border: '1px solid var(--accent)',
          borderRadius: 12, padding: '6px 14px', color: 'var(--text)',
          outline: 'none', minWidth: 0, maxWidth: '100%',
        }}
      />
      <button
        className="btn btn-accent btn-sm"
        disabled={value.trim().length < 3 || mut.isPending || value.trim() === current}
        onClick={() => mut.mutate()}
      >{mut.isPending ? '…' : 'Enregistrer'}</button>
      <button
        className="btn btn-line btn-sm"
        onClick={() => { setEditing(false); setError(null); }}
      >Annuler</button>
      {error && <div style={{ flexBasis: '100%', color: 'var(--loss)', fontSize: 13 }}>{error}</div>}
    </div>
  );
}

function humanizePseudo(e: unknown): string {
  if (e && typeof e === 'object' && 'message' in e) {
    const m = String((e as { message: string }).message);
    if (m === 'pseudo_taken') return 'Ce pseudo est déjà pris.';
    if (m === 'validation_error') return 'Pseudo invalide (3-24 chars, lettres/chiffres/_.-).';
    if (m === 'nothing_to_update') return 'Aucun changement.';
    return m;
  }
  return 'Modification impossible.';
}

// Une ligne d'historique : opponent (cliquable), jeu, score, W/L, date, condition shifumi.
function HistoryRow({ match: m, viewedPseudo, onPlayer, onOpen }: {
  match: Match;
  viewedPseudo: string;
  onPlayer: (pseudo: string) => void;
  onOpen: () => void;
}) {
  // "viewedPseudo" = côté du profil regardé. On normalise pour que "moi" = ce profil.
  const meIsP1 = m.player1?.pseudo === viewedPseudo;
  const opponent = meIsP1 ? m.player2 : m.player1;
  const myScore = meIsP1 ? m.scoreP1 : m.scoreP2;
  const oppScore = meIsP1 ? m.scoreP2 : m.scoreP1;
  const myId = meIsP1 ? m.player1Id : m.player2Id;
  const won = m.winnerId === myId;
  const tie = m.winnerId == null;
  const result = tie ? 'NUL' : won ? 'V' : 'D';
  const resultColor = tie ? 'var(--muted)' : won ? 'var(--win)' : 'var(--loss)';
  const meta = (m.metadata ?? null) as ShifumiMetadata | null;
  const condition = m.game === 'shifumi' ? meta?.condition : undefined;
  const date = m.finishedAt ?? m.createdAt;

  return (
    <div
      style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '10px 12px', borderRadius: 12, cursor: 'pointer' }}
      onClick={onOpen}
    >
      <span style={{
        width: 36, textAlign: 'center', fontFamily: 'var(--font-display)', fontWeight: 700,
        color: resultColor, fontSize: 18,
      }}>{result}</span>
      <button
        onClick={(e) => { e.stopPropagation(); opponent && onPlayer(opponent.pseudo); }}
        style={{ background: 'none', border: 'none', cursor: opponent ? 'pointer' : 'default', padding: 0 }}
      >
        <Avatar seed={opponent?.pseudo ?? '?'} size={36} imageUrl={absoluteAvatar(opponent?.avatarUrl)} />
      </button>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600, fontSize: 15 }}>
          <span style={{ color: 'var(--muted)' }}>vs </span>
          <span
            style={{ textDecoration: 'underline dotted', cursor: opponent ? 'pointer' : 'default' }}
            onClick={(e) => { e.stopPropagation(); opponent && onPlayer(opponent.pseudo); }}
          >{opponent?.pseudo ?? '—'}</span>
        </div>
        <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>
          {displayGame(m.game)} · {formatDate(date)}
          {condition ? <> · <span style={{ color: 'var(--accent)' }}>🎯 {condition}</span></> : null}
        </div>
      </div>
      <div className="tabular" style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 18 }}>
        {myScore} <span style={{ color: 'var(--muted)' }}>–</span> {oppScore}
      </div>
    </div>
  );
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function AvatarUpload({ onChange, hasAvatar }: { onChange: (u: import('../api/types').User) => void; hasAvatar: boolean }) {
  const ref = useRef<HTMLInputElement>(null);
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  const uploadMut = useMutation({
    mutationFn: (file: File) => api.uploadAvatar(file),
    onSuccess: (u) => { onChange(u); qc.invalidateQueries({ queryKey: ['leaderboard'] }); },
    onError: (e) => setError(humanize(e)),
  });
  const removeMut = useMutation({
    mutationFn: () => api.deleteAvatar(),
    onSuccess: (u) => { onChange(u); qc.invalidateQueries({ queryKey: ['leaderboard'] }); },
    onError: (e) => setError(humanize(e)),
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-end' }}>
      <input
        ref={ref}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        style={{ display: 'none' }}
        onChange={(e) => {
          setError(null);
          const f = e.target.files?.[0];
          if (!f) return;
          // Plus de check de taille côté client : le serveur acceptera.
          uploadMut.mutate(f);
          if (ref.current) ref.current.value = '';
        }}
      />
      <button className="btn btn-ghost btn-sm" disabled={uploadMut.isPending} onClick={() => ref.current?.click()}>
        {uploadMut.isPending ? 'Envoi…' : (hasAvatar ? 'Changer la photo' : 'Ajouter une photo')}
      </button>
      {hasAvatar && (
        <button className="btn btn-line btn-sm" disabled={removeMut.isPending} onClick={() => removeMut.mutate()}>
          {removeMut.isPending ? '…' : 'Retirer'}
        </button>
      )}
      {error && <span style={{ color: 'var(--loss)', fontSize: 12 }}>{error}</span>}
    </div>
  );
}

// Chip d'un badge. Couleurs via le `tone` : accent (jaune), win (vert), loss (rouge),
// gold (doré), muted (gris). Tooltip natif sur la description.
function BadgeChip({ badge }: { badge: Badge }) {
  const palette = badgeTonePalette(badge.tone);
  return (
    <div
      title={badge.description}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 8,
        padding: '8px 12px', borderRadius: 999,
        background: palette.bg, border: `1px solid ${palette.border}`,
        color: palette.fg, fontSize: 13, fontWeight: 600, fontFamily: 'var(--font-body)',
        whiteSpace: 'nowrap',
      }}
    >
      <span aria-hidden style={{ fontSize: 16, lineHeight: 1 }}>{badge.emoji}</span>
      <span>{badge.label}</span>
    </div>
  );
}

function badgeTonePalette(tone: Badge['tone']): { bg: string; border: string; fg: string } {
  switch (tone) {
    case 'accent': return { bg: 'color-mix(in oklab, var(--accent) 18%, var(--surface))', border: 'var(--accent)', fg: 'var(--text)' };
    case 'win': return { bg: 'color-mix(in oklab, var(--win) 18%, var(--surface))', border: 'var(--win)', fg: 'var(--text)' };
    case 'loss': return { bg: 'color-mix(in oklab, var(--loss) 18%, var(--surface))', border: 'var(--loss)', fg: 'var(--text)' };
    case 'gold': return { bg: 'color-mix(in oklab, #f5c542 20%, var(--surface))', border: '#f5c542', fg: 'var(--text)' };
    case 'muted':
    default: return { bg: 'var(--surface)', border: 'var(--line)', fg: 'var(--muted)' };
  }
}

function Stat({ label, value, color }: { label: string; value: number | string; color: string }) {
  return (
    <div className="panel">
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.6, color: 'var(--muted)', textTransform: 'uppercase' }}>{label}</div>
      <div className="tabular" style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 36, color, marginTop: 6 }}>{value}</div>
    </div>
  );
}

function humanize(e: unknown): string {
  if (e && typeof e === 'object' && 'message' in e) {
    const m = String((e as { message: string }).message);
    if (m === 'unsupported_image_type') return 'Format non supporté (PNG, JPG, WebP uniquement).';
    if (m === 'missing_file') return 'Aucun fichier sélectionné.';
    return m;
  }
  return 'Upload impossible.';
}
