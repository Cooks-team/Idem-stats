import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import { absoluteAvatar, api } from '../api/client';
import { Shell } from '../ui/Shell';
import { Avatar } from '../ui/Avatar';
import { displayGame } from '../games/registry';
import type { Match } from '../api/types';

export function MatchDetailPage() {
  const { id = '' } = useParams();
  const nav = useNavigate();
  const qc = useQueryClient();

  const { data: m } = useQuery({
    queryKey: ['match', id],
    queryFn: () => api.getMatch(id),
    // Polling ~2s tant que le match n'est pas terminé.
    refetchInterval: (q) => {
      const cur = q.state.data as Match | undefined;
      if (!cur) return 2_000;
      return cur.status === 'finished' || cur.status === 'cancelled' ? false : 2_000;
    },
  });

  const patchMut = useMutation({
    mutationFn: ({ p1, p2 }: { p1: number; p2: number }) =>
      api.patchScore(id, p1, p2, 'manual'),
    onSuccess: (updated) => qc.setQueryData(['match', id], updated),
  });

  const finishMut = useMutation({
    mutationFn: () => api.finishMatch(id),
    onSuccess: (updated) => qc.setQueryData(['match', id], updated),
  });

  if (!m) return <Shell title="Match" onBack={() => nav(-1)}>…</Shell>;

  const bumpP1 = (d: number) => patchMut.mutate({ p1: Math.max(0, m.scoreP1 + d), p2: m.scoreP2 });
  const bumpP2 = (d: number) => patchMut.mutate({ p1: m.scoreP1, p2: Math.max(0, m.scoreP2 + d) });

  if (m.status === 'pending') {
    return (
      <Shell title={displayGame(m.game)} onBack={() => nav(-1)} action={<StatusBadge status={m.status} />}>
        <div className="panel" style={{ textAlign: 'center', padding: 50 }}>
          <div style={{ color: 'var(--muted)', marginBottom: 12 }}>En attente d'un adversaire…</div>
          <div className="tabular" style={{
            fontFamily: 'var(--font-display)', fontWeight: 700,
            fontSize: 88, color: 'var(--accent)', letterSpacing: 12,
          }}>{m.code ?? '—'}</div>
          <p style={{ color: 'var(--muted)', marginTop: 12 }}>
            Partage ce code (à coller dans l'extension Chrome pour Basket Random).
          </p>
        </div>
      </Shell>
    );
  }

  return (
    <Shell title={displayGame(m.game)} onBack={() => nav(-1)} action={<StatusBadge status={m.status} />}>
      <div className="panel" style={{ padding: '40px 30px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-around', gap: 30 }}>
          <PlayerSide
            pseudo={m.player1?.pseudo ?? 'P1'}
            avatarUrl={m.player1?.avatarUrl}
            tone="var(--loss)"
            score={m.scoreP1}
            editable={m.status === 'active'}
            onPlus={() => bumpP1(+1)}
            onMinus={() => bumpP1(-1)}
          />
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 60, color: 'var(--muted)' }}>–</div>
          <PlayerSide
            pseudo={m.player2?.pseudo ?? 'P2'}
            avatarUrl={m.player2?.avatarUrl}
            tone="var(--blue)"
            score={m.scoreP2}
            editable={m.status === 'active'}
            onPlus={() => bumpP2(+1)}
            onMinus={() => bumpP2(-1)}
          />
        </div>
        {m.game === 'basket_random' && (
          <div style={{ textAlign: 'center', color: 'var(--muted)', marginTop: 18, fontSize: 13 }}>
            Basket Random — premier à 5. Mise à jour auto par l'extension, ou saisie manuelle ici.
          </div>
        )}
      </div>

      <div style={{ marginTop: 18, display: 'flex', gap: 10 }}>
        {m.status === 'active' && (
          <button className="btn btn-accent" onClick={() => finishMut.mutate()} disabled={finishMut.isPending}>
            Terminer le match
          </button>
        )}
        {m.status === 'finished' && (
          <div style={{ color: 'var(--win)', fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 20 }}>
            Victoire : {m.winnerId === m.player1Id ? m.player1?.pseudo : m.winnerId === m.player2Id ? m.player2?.pseudo : 'match nul'}
          </div>
        )}
      </div>
    </Shell>
  );
}

function PlayerSide({ pseudo, tone, score, editable, onPlus, onMinus, avatarUrl }: {
  pseudo: string; tone: string; score: number; editable: boolean;
  onPlus: () => void; onMinus: () => void;
  avatarUrl?: string | null;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
      <Avatar seed={pseudo} size={88} ring ringColor={tone} imageUrl={absoluteAvatar(avatarUrl ?? null)} />
      <div style={{ fontWeight: 700, fontSize: 18 }}>{pseudo}</div>
      <div className="tabular" style={{
        fontFamily: 'var(--font-display)', fontWeight: 700,
        fontSize: 136, color: tone, lineHeight: 1,
      }}>{score}</div>
      {editable && (
        <div style={{ display: 'flex', gap: 10 }}>
          <button className="btn btn-ghost btn-sm" onClick={onMinus}>−</button>
          <button className="btn btn-accent btn-sm" onClick={onPlus}>+1</button>
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: Match['status'] }) {
  const [color, label] = (() => {
    switch (status) {
      case 'pending': return ['var(--muted)', 'En attente'];
      case 'active': return ['var(--accent)', 'EN DIRECT'];
      case 'finished': return ['var(--win)', 'Terminé'];
      case 'cancelled': return ['var(--loss)', 'Annulé'];
    }
  })();
  return (
    <div style={{
      display: 'inline-flex', alignItems: 'center', gap: 8,
      padding: '6px 12px', borderRadius: 999,
      background: `color-mix(in srgb, ${color} 18%, transparent)`,
      color, fontSize: 11, fontWeight: 700, letterSpacing: 0.5,
    }}>
      <span style={{ width: 6, height: 6, borderRadius: 9, background: color }} />
      {label}
    </div>
  );
}
