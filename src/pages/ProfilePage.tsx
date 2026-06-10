import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { absoluteAvatar, api } from '../api/client';
import type { Match, ShifumiMetadata } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { Shell } from '../ui/Shell';
import { Avatar } from '../ui/Avatar';
import { displayGame } from '../games/registry';

export function ProfilePage() {
  const { user, logout, setUser } = useAuth();
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

  return (
    <Shell title={isMe ? 'Mon profil' : `Profil — ${target}`} onBack={requested ? () => nav(-1) : undefined}>
      <div style={{ display: 'flex', gap: 24, alignItems: 'center' }}>
        <Avatar seed={target ?? '?'} size={104} ring ringColor="var(--accent)" imageUrl={imageUrl} />
        <div style={{ flex: 1 }}>
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 36 }}>{target}</div>
          <div style={{ color: 'var(--muted)', marginTop: 4 }}>
            {rank >= 0 ? `Rang ${rank + 1} / ${entries.length}` : 'Pas encore classé'}
          </div>
        </div>
        {isMe && <AvatarUpload onChange={setUser} hasAvatar={!!user?.avatarUrl} />}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginTop: 28 }}>
        <Stat label="Victoires" value={entry?.wins ?? 0} color="var(--win)" />
        <Stat label="Défaites" value={entry?.losses ?? 0} color="var(--loss)" />
        <Stat label="Parties" value={entry?.played ?? 0} color="var(--text)" />
        <Stat label="Winrate" value={entry ? `${Math.round(entry.winrate * 100)}%` : '—'} color="var(--accent)" />
      </div>

      {/* Historique des duels */}
      <div style={{ marginTop: 32 }}>
        <div className="eyebrow"><span className="label">Historique des duels</span></div>
        {histLoading && history.length === 0 ? (
          <div className="panel" style={{ color: 'var(--muted)', textAlign: 'center' }}>Chargement…</div>
        ) : history.length === 0 ? (
          <div className="panel" style={{ color: 'var(--muted)', textAlign: 'center' }}>Aucun duel pour l'instant.</div>
        ) : (
          <div className="panel" style={{ padding: 6 }}>
            {history.filter((m) => m.status === 'finished').slice(0, 30).map((m) => (
              <HistoryRow key={m.id} match={m} viewedPseudo={target ?? ''} onPlayer={(p) => nav(`/profile?pseudo=${encodeURIComponent(p)}`)} onOpen={() => nav(`/matches/${m.id}`)} />
            ))}
            {history.filter((m) => m.status === 'finished').length === 0 && (
              <div style={{ padding: 16, textAlign: 'center', color: 'var(--muted)' }}>Pas encore de duel terminé.</div>
            )}
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
