import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { absoluteAvatar, api } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { Shell } from '../ui/Shell';
import { Avatar } from '../ui/Avatar';

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

      {isMe && (
        <div style={{ marginTop: 32 }}>
          <button className="btn btn-ghost" onClick={() => { logout(); nav('/login'); }}>Se déconnecter</button>
        </div>
      )}
    </Shell>
  );
}

// Bouton "Changer la photo" + DELETE. Invalide leaderboard pour rafraîchir les
// avatars partout (podium + RankRow + Shell).
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
          if (f.size > 2 * 1024 * 1024) { setError('Image > 2 Mo'); return; }
          uploadMut.mutate(f);
          // reset pour pouvoir re-uploader le même fichier
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
