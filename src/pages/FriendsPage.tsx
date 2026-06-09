import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { absoluteAvatar, api } from '../api/client';
import { Shell } from '../ui/Shell';
import { Avatar } from '../ui/Avatar';
import { Field } from '../ui/Field';
import type { FriendshipRow } from '../api/types';

export function FriendsPage() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['friends'],
    queryFn: () => api.listFriends(),
    // poll modéré pour voir une demande arriver
    refetchInterval: 8_000,
  });

  const [pseudo, setPseudo] = useState('');
  const [error, setError] = useState<string | null>(null);

  const sendMut = useMutation({
    mutationFn: () => api.sendFriendRequest(pseudo.trim()),
    onSuccess: () => { setPseudo(''); qc.invalidateQueries({ queryKey: ['friends'] }); },
    onError: (e) => setError(humanize(e)),
  });
  const acceptMut = useMutation({
    mutationFn: (id: string) => api.acceptFriend(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['friends'] }),
  });
  const removeMut = useMutation({
    mutationFn: (id: string) => api.removeFriend(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['friends'] }),
  });

  return (
    <Shell title="Amis" subtitle="Demandes, acceptations et duels rapides">
      <div className="panel field-group" style={{ maxWidth: 560, marginBottom: 24 }}>
        <div className="eyebrow"><span className="label">Ajouter un ami</span></div>
        <Field
          label="Pseudo"
          placeholder="ex: tom"
          value={pseudo}
          onChange={(e) => { setPseudo(e.target.value); setError(null); }}
          onKeyDown={(e) => e.key === 'Enter' && pseudo.trim().length >= 3 && sendMut.mutate()}
        />
        {error && <div style={{ color: 'var(--loss)', fontSize: 13 }}>{error}</div>}
        <button
          className="btn btn-accent"
          style={{ alignSelf: 'flex-start' }}
          onClick={() => sendMut.mutate()}
          disabled={pseudo.trim().length < 3 || sendMut.isPending}
        >
          {sendMut.isPending ? '…' : 'Envoyer la demande'}
        </button>
      </div>

      {isLoading ? (
        <div className="panel" style={{ color: 'var(--muted)', textAlign: 'center' }}>Chargement…</div>
      ) : (
        <>
          {data?.incoming.length ? (
            <Section title={`Demandes reçues (${data.incoming.length})`}>
              {data.incoming.map((r) => (
                <FriendRow
                  key={r.id} row={r}
                  rightSlot={
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button className="btn btn-accent btn-sm" disabled={acceptMut.isPending} onClick={() => acceptMut.mutate(r.id)}>Accepter</button>
                      <button className="btn btn-line btn-sm" disabled={removeMut.isPending} onClick={() => removeMut.mutate(r.id)}>Refuser</button>
                    </div>
                  }
                />
              ))}
            </Section>
          ) : null}

          <Section title={`Amis (${data?.friends.length ?? 0})`}>
            {data?.friends.length ? data.friends.map((r) => (
              <FriendRow
                key={r.id} row={r}
                rightSlot={
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={() => nav(`/matches/new?opponent=${encodeURIComponent(r.user.pseudo)}&duelMode=remote`)}
                    >⚔️ Duel rapide</button>
                    <button
                      className="btn btn-line btn-sm"
                      onClick={() => removeMut.mutate(r.id)}
                    >Supprimer</button>
                  </div>
                }
              />
            )) : (
              <div style={{ padding: 16, textAlign: 'center', color: 'var(--muted)' }}>Pas encore d'amis. Envoie une demande ci-dessus.</div>
            )}
          </Section>

          {data?.outgoing.length ? (
            <Section title={`Demandes envoyées (${data.outgoing.length})`}>
              {data.outgoing.map((r) => (
                <FriendRow
                  key={r.id} row={r}
                  rightSlot={
                    <>
                      <span className="tag">EN ATTENTE</span>
                      <button className="btn btn-line btn-sm" style={{ marginLeft: 8 }} onClick={() => removeMut.mutate(r.id)}>Annuler</button>
                    </>
                  }
                />
              ))}
            </Section>
          ) : null}
        </>
      )}
    </Shell>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 22 }}>
      <div className="eyebrow"><span className="label">{title}</span></div>
      <div className="panel" style={{ padding: 6 }}>{children}</div>
    </div>
  );
}

function FriendRow({ row, rightSlot }: { row: FriendshipRow; rightSlot: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '10px 12px' }}>
      <Avatar seed={row.user.pseudo} size={40} imageUrl={absoluteAvatar(row.user.avatarUrl)} />
      <div style={{ flex: 1 }}>
        <div style={{ fontWeight: 700 }}>{row.user.pseudo}</div>
        <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>
          {row.status === 'accepted' ? 'Ami' : row.direction === 'incoming' ? 'A demandé à être ami' : 'En attente de réponse'}
        </div>
      </div>
      {rightSlot}
    </div>
  );
}

function humanize(e: unknown): string {
  if (e && typeof e === 'object' && 'message' in e) {
    const m = String((e as { message: string }).message);
    if (m === 'user_not_found') return 'Aucun utilisateur avec ce pseudo.';
    if (m === 'cannot_friend_self') return 'Tu ne peux pas t\'ajouter toi-même.';
    if (m === 'friend_request_already_sent') return 'Demande déjà envoyée.';
    return m;
  }
  return 'Impossible.';
}
