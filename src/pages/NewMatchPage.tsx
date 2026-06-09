import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import { SHIFUMI_EMOJIS, SHIFUMI_LABELS, SHIFUMI_LOSES_TO, SHIFUMI_PICKS, type ShifumiPick } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { Shell } from '../ui/Shell';
import { Field } from '../ui/Field';
import { Icon } from '../ui/Icon';
import { KNOWN_GAMES } from '../games/registry';

type Mode = 'create' | 'join';

export function NewMatchPage() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const [mode, setMode] = useState<Mode>('create');
  const [game, setGame] = useState(KNOWN_GAMES[0].apiId);
  const [opponent, setOpponent] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);

  const createMut = useMutation({
    mutationFn: () => api.createMatch(game, opponent.trim() || undefined),
    onSuccess: (m) => {
      qc.invalidateQueries({ queryKey: ['matches'] });
      if (m.status === 'active') nav(`/matches/${m.id}`);
    },
    onError: (e) => setError(humanize(e)),
  });

  const joinMut = useMutation({
    mutationFn: () => api.joinMatch(code.trim().toUpperCase()),
    onSuccess: (m) => {
      qc.invalidateQueries({ queryKey: ['matches'] });
      nav(`/matches/${m.id}`);
    },
    onError: (e) => setError(humanize(e)),
  });

  const created = createMut.data;
  const isShifumi = game === 'shifumi';

  return (
    <Shell title="Nouveau match" onBack={() => nav(-1)} action={<span />}>
      <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
        <button className={`chip ${mode === 'create' ? 'active accent' : ''}`} onClick={() => { setMode('create'); setError(null); }}>Créer</button>
        <button className={`chip ${mode === 'join' ? 'active' : ''}`} onClick={() => { setMode('join'); setError(null); }}>Rejoindre par code</button>
      </div>

      <div className="panel" style={{ maxWidth: 620 }}>
        {mode === 'create' ? (
          created ? (
            isShifumi
              ? <ShifumiCreated nav={nav} matchId={created.id} />
              : <CodeReveal code={created.code ?? '—'} />
          ) : (
            <div className="field-group">
              <div className="eyebrow"><span className="label">Jeu</span></div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {KNOWN_GAMES.map((g) => (
                  <button
                    key={g.apiId}
                    className={`chip ${game === g.apiId ? 'active' : ''}`}
                    onClick={() => setGame(g.apiId)}
                  >{g.display}</button>
                ))}
              </div>
              {isShifumi ? (
                <ShifumiForm
                  opponent={opponent}
                  setOpponent={setOpponent}
                  onSuccess={(m) => { qc.invalidateQueries({ queryKey: ['matches'] }); qc.invalidateQueries({ queryKey: ['leaderboard'] }); nav(`/matches/${m.id}`); }}
                  setError={setError}
                  error={error}
                />
              ) : (
                <>
                  <Field
                    label="Adversaire (laisse vide pour un match à distance)"
                    placeholder="pseudo"
                    value={opponent}
                    onChange={(e) => setOpponent(e.target.value)}
                  />
                  <div style={{ color: 'var(--muted)', fontSize: 12.5 }}>
                    Adversaire renseigné + compte existant → match démarre direct.
                    Sinon, on te donne un code à partager (ou à coller dans l'extension Chrome pour Basket Random).
                  </div>
                  {error && <div style={{ color: 'var(--loss)', fontSize: 13 }}>{error}</div>}
                  <button
                    className="btn btn-accent btn-lg btn-full"
                    onClick={() => createMut.mutate()}
                    disabled={createMut.isPending}
                  >
                    {createMut.isPending ? '…' : 'Créer le match'}
                  </button>
                </>
              )}
            </div>
          )
        ) : (
          <div className="field-group">
            <Field
              label="Code du match"
              placeholder="ABCD12"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase().slice(0, 8))}
              onKeyDown={(e) => e.key === 'Enter' && code.length >= 4 && joinMut.mutate()}
            />
            {error && <div style={{ color: 'var(--loss)', fontSize: 13 }}>{error}</div>}
            <button
              className="btn btn-accent btn-lg btn-full"
              disabled={code.length < 4 || joinMut.isPending}
              onClick={() => joinMut.mutate()}
            >{joinMut.isPending ? '…' : 'Rejoindre'}</button>
          </div>
        )}
      </div>
    </Shell>
  );
}

// ── Shifumi : flow "result-first" ───────────────────────────────────────────
function ShifumiForm({
  opponent, setOpponent, onSuccess, setError, error,
}: {
  opponent: string;
  setOpponent: (v: string) => void;
  onSuccess: (m: import('../api/types').Match) => void;
  setError: (s: string | null) => void;
  error: string | null;
}) {
  const { user } = useAuth();
  const [whoWon, setWhoWon] = useState<'me' | 'them' | null>(null);
  const [winnerPick, setWinnerPick] = useState<ShifumiPick | null>(null);
  // Le pick perdant n'a qu'une seule valeur possible une fois winnerPick choisi.
  const forcedLoserPick = useMemo(() => (winnerPick ? SHIFUMI_LOSES_TO[winnerPick] : null), [winnerPick]);

  const submitMut = useMutation({
    mutationFn: () => {
      if (!winnerPick || !forcedLoserPick) throw new Error('missing_pick');
      if (!whoWon) throw new Error('missing_winner');
      const opp = opponent.trim();
      if (!opp) throw new Error('opponent_required');
      const winnerPseudo = whoWon === 'me' ? user!.pseudo : opp;
      return api.createShifumi(opp, winnerPseudo, winnerPick, forcedLoserPick);
    },
    onSuccess,
    onError: (e) => setError(humanize(e)),
  });

  const canSubmit = !!(opponent.trim() && whoWon && winnerPick && !submitMut.isPending);

  return (
    <>
      <Field
        label="Adversaire"
        placeholder="pseudo (compte existant)"
        value={opponent}
        onChange={(e) => setOpponent(e.target.value)}
      />

      <div className="eyebrow" style={{ marginTop: 8 }}><span className="label">Qui a gagné ?</span></div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button className={`chip ${whoWon === 'me' ? 'active accent' : ''}`} onClick={() => setWhoWon('me')}>
          Moi · {user?.pseudo}
        </button>
        <button
          className={`chip ${whoWon === 'them' ? 'active' : ''}`}
          onClick={() => setWhoWon('them')}
          disabled={!opponent.trim()}
        >
          {opponent.trim() || 'L\'adversaire'}
        </button>
      </div>

      <div className="eyebrow" style={{ marginTop: 12 }}>
        <span className="label">Avec quoi le gagnant a-t-il joué ?</span>
      </div>
      <PickRow value={winnerPick} onChange={setWinnerPick} />

      {winnerPick && forcedLoserPick && (
        <>
          <div className="eyebrow" style={{ marginTop: 12 }}>
            <span className="label">Donc le perdant avait…</span>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <PickButton pick={forcedLoserPick} active disabled />
            <div style={{ color: 'var(--muted)', fontSize: 12.5, alignSelf: 'center' }}>
              (auto — c'est ce qui perd contre <strong>{SHIFUMI_LABELS[winnerPick]}</strong>)
            </div>
          </div>
        </>
      )}

      {error && <div style={{ color: 'var(--loss)', fontSize: 13, marginTop: 6 }}>{error}</div>}

      <button
        className="btn btn-accent btn-lg btn-full"
        style={{ marginTop: 12 }}
        disabled={!canSubmit}
        onClick={() => submitMut.mutate()}
      >
        {submitMut.isPending ? '…' : 'Enregistrer le duel'}
      </button>
    </>
  );
}

function PickRow({ value, onChange }: { value: ShifumiPick | null; onChange: (p: ShifumiPick) => void }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
      {SHIFUMI_PICKS.map((p) => (
        <PickButton key={p} pick={p} active={value === p} onClick={() => onChange(p)} />
      ))}
    </div>
  );
}

function PickButton({ pick, active, onClick, disabled }: { pick: ShifumiPick; active: boolean; onClick?: () => void; disabled?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        padding: 14,
        borderRadius: 14,
        border: `1px solid ${active ? 'var(--accent)' : 'var(--line)'}`,
        background: active ? 'color-mix(in srgb, var(--accent) 18%, var(--surface))' : 'var(--surface)',
        color: 'var(--text)',
        cursor: disabled ? 'default' : 'pointer',
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
      }}
    >
      <span style={{ fontSize: 36, lineHeight: 1 }}>{SHIFUMI_EMOJIS[pick]}</span>
      <span style={{ fontSize: 13, fontWeight: 700 }}>{SHIFUMI_LABELS[pick]}</span>
    </button>
  );
}

function ShifumiCreated({ nav, matchId }: { nav: ReturnType<typeof useNavigate>; matchId: string }) {
  return (
    <div style={{ textAlign: 'center', padding: 18 }}>
      <div style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 700 }}>Duel enregistré ✓</div>
      <p style={{ color: 'var(--muted)', marginTop: 6 }}>Visible dans tes matchs et dans le PODIUM.</p>
      <button className="btn btn-accent" onClick={() => nav(`/matches/${matchId}`)}>Voir le duel</button>
    </div>
  );
}

// ─── existant : code à partager pour les autres jeux ────────────────────────
function CodeReveal({ code }: { code: string }) {
  const copy = () => navigator.clipboard.writeText(code).catch(() => {});
  return (
    <div>
      <div className="eyebrow"><span className="label">Code à partager</span></div>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '18px 22px', borderRadius: 14, background: 'var(--surface-2)',
      }}>
        <div className="tabular" style={{
          fontFamily: 'var(--font-display)', fontWeight: 700,
          fontSize: 56, color: 'var(--accent)', letterSpacing: 8,
        }}>{code}</div>
        <button className="icon-btn" onClick={copy} title="Copier"><Icon name="copy" size={20} /></button>
      </div>
      <p style={{ color: 'var(--muted)', fontSize: 13, marginTop: 14 }}>
        Donne ce code à ton adversaire ou colle-le dans l'extension Chrome (Basket Random).
      </p>
    </div>
  );
}

function humanize(e: unknown): string {
  if (e && typeof e === 'object' && 'message' in e) {
    const m = String((e as { message: string }).message);
    if (m === 'opponent_not_found') return 'Cet adversaire n\'existe pas.';
    if (m === 'cannot_play_self') return 'Tu ne peux pas jouer contre toi-même.';
    if (m === 'match_not_found') return 'Code invalide.';
    if (m === 'match_not_pending') return 'Ce match a déjà commencé ou est terminé.';
    if (m === 'cannot_join_own_match') return 'Tu ne peux pas rejoindre ton propre match.';
    if (m === 'unknown_game') return 'Jeu inconnu.';
    if (m === 'invalid_shifumi_outcome') return 'La combinaison choisie ne donne pas ce gagnant.';
    if (m === 'winner_not_in_match') return 'Le gagnant doit être l\'un des deux joueurs.';
    if (m === 'opponent_required_for_shifumi') return 'Indique un adversaire.';
    if (m === 'shifumi_block_required') return 'Détails du duel manquants.';
    if (m === 'missing_pick') return 'Choisis la main du gagnant.';
    if (m === 'missing_winner') return 'Indique qui a gagné.';
    if (m === 'opponent_required') return 'Indique un adversaire.';
    return m;
  }
  return 'Action impossible.';
}
