import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { absoluteAvatar, api } from '../api/client';
import { Avatar } from './Avatar';
import { Icon } from './Icon';
import { displayGame } from '../games/registry';

// Bell + badge + dropdown listant les demandes d'amis, invitations de match,
// shifumi à pioche. Refetch via SSE invalidation (useEvents) + polling 30s
// en filet de sécurité si la connexion SSE coupe.
export function InboxBell() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  const { data } = useQuery({
    queryKey: ['inbox'],
    queryFn: () => api.inbox(),
    refetchInterval: 30_000,
  });
  const total = data?.total ?? 0;

  // Click outside closes
  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  const acceptFriendMut = useMutation({
    mutationFn: (id: string) => api.acceptFriend(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['inbox'] }); qc.invalidateQueries({ queryKey: ['friends'] }); },
  });
  const declineFriendMut = useMutation({
    mutationFn: (id: string) => api.removeFriend(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['inbox'] }); qc.invalidateQueries({ queryKey: ['friends'] }); },
  });
  const acceptMatchMut = useMutation({
    mutationFn: (id: string) => api.acceptInvitation(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['inbox'] }); qc.invalidateQueries({ queryKey: ['matches'] }); },
  });
  const declineMatchMut = useMutation({
    mutationFn: (id: string) => api.declineInvitation(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['inbox'] }); qc.invalidateQueries({ queryKey: ['matches'] }); },
  });

  return (
    <div ref={rootRef} style={{ position: 'relative' }}>
      <button
        className="icon-btn"
        onClick={() => setOpen((v) => !v)}
        aria-label={`Boîte de réception (${total})`}
        title="Boîte de réception"
        style={{ position: 'relative' }}
      >
        <Icon name="pulse" size={20} />
        {total > 0 && (
          <span style={{
            position: 'absolute', top: 4, right: 4, minWidth: 16, height: 16,
            padding: '0 4px', borderRadius: 9, background: 'var(--accent)',
            color: 'var(--accent-ink)', fontSize: 10, fontWeight: 800,
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          }}>{total}</span>
        )}
      </button>

      {open && (
        <div style={{
          position: 'absolute', top: 48, right: 0, zIndex: 50,
          width: 360, maxHeight: 440, overflowY: 'auto',
          background: 'var(--surface)', border: '1px solid var(--line)',
          borderRadius: 14, boxShadow: '0 12px 40px rgba(0,0,0,0.5)',
          padding: 10,
        }}>
          <div className="eyebrow" style={{ padding: '6px 8px' }}>
            <span className="label">Boîte de réception</span>
            <span style={{ color: 'var(--muted)', fontSize: 12 }}>{total} en attente</span>
          </div>

          {total === 0 && (
            <div style={{ padding: 24, textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>
              Rien pour l'instant. On te notifiera dès qu'un ami t'écrit ou te défie.
            </div>
          )}

          {data?.friendRequests.map((r) => (
            <Row key={`fr-${r.id}`}
              avatar={<Avatar seed={r.user.pseudo} size={36} imageUrl={absoluteAvatar(r.user.avatarUrl)} />}
              title={<><strong>{r.user.pseudo}</strong> veut être ton ami</>}
              sub="Demande d'amitié"
              actions={
                <>
                  <button className="btn btn-accent btn-sm" disabled={acceptFriendMut.isPending} onClick={() => acceptFriendMut.mutate(r.id)}>Accepter</button>
                  <button className="btn btn-line btn-sm" disabled={declineFriendMut.isPending} onClick={() => declineFriendMut.mutate(r.id)}>Refuser</button>
                </>
              }
            />
          ))}

          {data?.matchInvites.map((m) => {
            const other = m.player1;
            return (
              <Row key={`mi-${m.id}`}
                avatar={<Avatar seed={other?.pseudo ?? '?'} size={36} imageUrl={absoluteAvatar(other?.avatarUrl)} />}
                title={<><strong>{other?.pseudo}</strong> te défie</>}
                sub={`${displayGame(m.game)} · invitation`}
                actions={
                  <>
                    <button className="btn btn-accent btn-sm" disabled={acceptMatchMut.isPending} onClick={() => acceptMatchMut.mutate(m.id)}>Accepter</button>
                    <button className="btn btn-line btn-sm" disabled={declineMatchMut.isPending} onClick={() => declineMatchMut.mutate(m.id)}>Refuser</button>
                  </>
                }
              />
            );
          })}

          {data?.shifumiPendingPicks.map((m) => {
            const other = m.player1; // dans inbox, le challenge vient de player1
            return (
              <Row key={`sh-${m.id}`}
                avatar={<Avatar seed={other?.pseudo ?? '?'} size={36} imageUrl={absoluteAvatar(other?.avatarUrl)} />}
                title={<><strong>{other?.pseudo}</strong> attend ton choix</>}
                sub="🪨 Shifumi à distance"
                actions={
                  <button className="btn btn-accent btn-sm" onClick={() => { setOpen(false); nav(`/matches/${m.id}`); }}>
                    Pioche
                  </button>
                }
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

function Row({ avatar, title, sub, actions }: {
  avatar: React.ReactNode;
  title: React.ReactNode;
  sub: string;
  actions: React.ReactNode;
}) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10,
      padding: 10, borderRadius: 10,
    }}>
      {avatar}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 600 }}>{title}</div>
        <div style={{ fontSize: 12, color: 'var(--muted)' }}>{sub}</div>
      </div>
      <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>{actions}</div>
    </div>
  );
}
