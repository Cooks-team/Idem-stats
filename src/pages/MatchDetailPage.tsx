import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import { absoluteAvatar, api } from '../api/client';
import { Shell } from '../ui/Shell';
import { Avatar } from '../ui/Avatar';
import { displayGame } from '../games/registry';
import type { Match, ShifumiMetadata, ShifumiPick } from '../api/types';
import { SHIFUMI_EMOJIS, SHIFUMI_LABELS, SHIFUMI_PICKS } from '../api/types';
import { useAuth } from '../auth/AuthContext';

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

  // Shifumi : layout dédié. En remote pending → pioche secrète, en finished → reveal animé.
  if (m.game === 'shifumi') {
    return (
      <Shell title={displayGame(m.game)} onBack={() => nav(-1)} action={<StatusBadge status={m.status} />}>
        <ShifumiView match={m} />
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

// Dispatcher shifumi : remote pending → pioche/wait, finished → reveal (animé en remote).
function ShifumiView({ match: m }: { match: Match }) {
  const meta = (m.metadata ?? {}) as ShifumiMetadata;
  if (m.status === 'pending' && meta.mode === 'remote') return <ShifumiRemotePending match={m} />;
  if (m.status === 'finished') return <ShifumiResult match={m} animate={meta.mode === 'remote'} />;
  return <div className="panel" style={{ color: 'var(--muted)', textAlign: 'center' }}>État inattendu pour un shifumi.</div>;
}

function ShifumiRemotePending({ match: m }: { match: Match }) {
  const meta = (m.metadata ?? {}) as ShifumiMetadata;
  const { user } = useAuth();
  const qc = useQueryClient();
  const isCreator = m.player1Id === user?.id;

  const pickMut = useMutation({
    mutationFn: (p: ShifumiPick) => api.shifumiPick(m.id, p),
    onSuccess: (updated) => qc.setQueryData(['match', m.id], updated),
  });
  const [chosen, setChosen] = useState<ShifumiPick | null>(null);

  // Creator : son pick lui est renvoyé par l'API (creatorPick visible côté lui).
  if (isCreator) {
    return (
      <div className="panel" style={{ padding: 40, textAlign: 'center' }}>
        <div style={{ color: 'var(--muted)', fontSize: 13 }}>Ton choix (secret)</div>
        <div style={{ fontSize: 96, lineHeight: 1, marginTop: 6 }}>{meta.creatorPick ? SHIFUMI_EMOJIS[meta.creatorPick] : '🤐'}</div>
        <div style={{ marginTop: 16, fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 24 }}>
          En attente de {m.player2?.pseudo ?? 'l\'adversaire'}…
        </div>
        <div style={{ color: 'var(--muted)', fontSize: 13, marginTop: 6 }}>
          On rafraîchit toutes les 2 secondes. Tu seras notifié quand il/elle aura répondu.
        </div>
      </div>
    );
  }

  // Opponent : doit choisir, son choix déclenche le reveal.
  return (
    <div className="panel" style={{ padding: 40, textAlign: 'center' }}>
      <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 26 }}>
        {m.player1?.pseudo ?? 'L\'adversaire'} te défie au Shifumi
      </div>
      <p style={{ color: 'var(--muted)', marginTop: 6 }}>Choisis ta main. Le reveal se déclenchera dès que tu valides.</p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginTop: 18 }}>
        {SHIFUMI_PICKS.map((p) => (
          <button
            key={p}
            onClick={() => setChosen(p)}
            style={{
              padding: 20, borderRadius: 16,
              border: `2px solid ${chosen === p ? 'var(--accent)' : 'var(--line)'}`,
              background: chosen === p ? 'color-mix(in srgb, var(--accent) 18%, var(--surface))' : 'var(--surface)',
              color: 'var(--text)', cursor: 'pointer',
            }}
          >
            <div style={{ fontSize: 48, lineHeight: 1 }}>{SHIFUMI_EMOJIS[p]}</div>
            <div style={{ fontSize: 14, fontWeight: 700, marginTop: 6 }}>{SHIFUMI_LABELS[p]}</div>
          </button>
        ))}
      </div>
      <button
        className="btn btn-accent btn-lg"
        style={{ marginTop: 20 }}
        disabled={!chosen || pickMut.isPending}
        onClick={() => chosen && pickMut.mutate(chosen)}
      >
        {pickMut.isPending ? 'Reveal en cours…' : '🪨📄✂️ Valider et révéler'}
      </button>
    </div>
  );
}

// Reveal : si animate=true, on joue le countdown "Shi-fu-mi" avant d'afficher les mains.
function ShifumiResult({ match: m, animate }: { match: Match; animate: boolean }) {
  const meta = (m.metadata ?? {}) as ShifumiMetadata;
  // Cherche les deux picks. Pour une remote, on a creatorPick + opponentPick.
  // Pour une IRL, on a winnerPick + loserPick.
  const p1Pick: ShifumiPick | undefined = (meta.creatorPick as ShifumiPick | undefined)
    ?? (meta.winnerPseudo === m.player1?.pseudo ? meta.winnerPick : meta.loserPick);
  const p2Pick: ShifumiPick | undefined = (meta.opponentPick as ShifumiPick | undefined)
    ?? (meta.winnerPseudo === m.player2?.pseudo ? meta.winnerPick : meta.loserPick);

  // Animation "Shi-fu-mi" — 3 mots successifs (300ms chacun), puis reveal.
  const [phase, setPhase] = useState<0 | 1 | 2 | 3>(animate ? 0 : 3);
  useEffect(() => {
    if (!animate) return;
    const t1 = setTimeout(() => setPhase(1), 350);
    const t2 = setTimeout(() => setPhase(2), 700);
    const t3 = setTimeout(() => setPhase(3), 1050);
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
  }, [animate]);

  if (animate && phase < 3) {
    const words = ['SHI', 'FU', 'MI'];
    return (
      <div className="panel" style={{ padding: 60, textAlign: 'center', minHeight: 320 }}>
        <div style={{ color: 'var(--muted)' }}>Reveal dans…</div>
        <div style={{
          marginTop: 12, fontFamily: 'var(--font-display)', fontWeight: 700,
          fontSize: 140, color: 'var(--accent)', letterSpacing: 8,
          animation: 'pulse 0.35s ease-in-out',
        }}>{words[phase]}</div>
        <style>{`@keyframes pulse { 0%{transform:scale(0.6);opacity:0} 50%{transform:scale(1.15);opacity:1} 100%{transform:scale(1);opacity:1} }`}</style>
      </div>
    );
  }

  const winnerPseudo = meta.winnerPseudo;
  const reason = (meta.winnerPick && meta.loserPick)
    ? `${SHIFUMI_LABELS[meta.winnerPick]} bat ${SHIFUMI_LABELS[meta.loserPick]}`
    : meta.tie ? 'Égalité' : '';

  return (
    <div className="panel" style={{ padding: '40px 30px', textAlign: 'center' }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', alignItems: 'center', gap: 24 }}>
        <PickColumn pseudo={m.player1?.pseudo ?? 'P1'} pick={p1Pick} won={winnerPseudo === m.player1?.pseudo} />
        <div style={{ fontFamily: 'var(--font-display)', fontSize: 36, color: 'var(--muted)' }}>vs</div>
        <PickColumn pseudo={m.player2?.pseudo ?? 'P2'} pick={p2Pick} won={winnerPseudo === m.player2?.pseudo} />
      </div>
      <div style={{
        marginTop: 28, display: 'inline-block',
        padding: '10px 18px', borderRadius: 999,
        background: meta.tie
          ? 'color-mix(in srgb, var(--muted) 16%, transparent)'
          : 'color-mix(in srgb, var(--win) 16%, transparent)',
        color: meta.tie ? 'var(--muted)' : 'var(--win)',
        fontWeight: 700, fontSize: 14,
      }}>
        {meta.tie ? '⚖️ Match nul' : `🏆 ${winnerPseudo} gagne — ${reason}`}
      </div>
    </div>
  );
}

function PickColumn({ pseudo, pick, won }: { pseudo: string; pick?: ShifumiPick; won: boolean }) {
  return (
    <div style={{ opacity: won ? 1 : 0.55 }}>
      <div style={{ fontSize: 96, lineHeight: 1 }}>{pick ? SHIFUMI_EMOJIS[pick] : '❔'}</div>
      <div style={{ fontWeight: 700, marginTop: 8 }}>{pseudo}</div>
      <div style={{ color: 'var(--muted)', fontSize: 13 }}>{pick ? SHIFUMI_LABELS[pick] : '—'}</div>
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
