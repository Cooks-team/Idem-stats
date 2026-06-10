import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { absoluteAvatar, api } from '../api/client';
import { SHIFUMI_EMOJIS, SHIFUMI_LABELS, SHIFUMI_LOSES_TO, SHIFUMI_PICKS, type ShifumiPick } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { Shell } from '../ui/Shell';
import { Field } from '../ui/Field';
import { Icon } from '../ui/Icon';
import { Avatar } from '../ui/Avatar';
import { KNOWN_GAMES } from '../games/registry';

type Mode = 'create' | 'join';
type ShifumiMode = 'irl' | 'remote';

export function NewMatchPage() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const [params] = useSearchParams();
  const [mode, setMode] = useState<Mode>('create');
  const [game, setGame] = useState(params.get('game') ?? KNOWN_GAMES[0].apiId);
  const [opponent, setOpponent] = useState(params.get('opponent') ?? '');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  // Pour shifumi : IRL = saisir le résultat sur place / Distance = picks cachés + reveal "Shi-fu-mi"
  const [shifumiMode, setShifumiMode] = useState<ShifumiMode>(
    (params.get('mode') as ShifumiMode) ?? 'irl',
  );

  // /matches/new?game=shifumi&mode=remote&opponent=... → si l'URL spécifie un mode, on s'aligne
  useEffect(() => {
    const m = params.get('mode');
    if (m === 'irl' || m === 'remote') setShifumiMode(m);
    const g = params.get('game');
    if (g) setGame(g);
    const o = params.get('opponent');
    if (o) setOpponent(o);
    // une seule fois au mount, params est mémoïsé par le router
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Liste des amis affichée sous forme de cartes cliquables → remplit l'opponent
  // et bascule en mode invitation (remote).
  const { data: friendsData } = useQuery({ queryKey: ['friends'], queryFn: () => api.listFriends(), staleTime: 30_000 });
  const friends = friendsData?.friends ?? [];

  // Pour les jeux non-shifumi : 'local' (même appareil) ou 'remote' (invitation à un ami).
  // Quand on clique sur une carte d'ami, on passe en remote automatiquement.
  const [duelMode, setDuelMode] = useState<'local' | 'remote'>(
    (params.get('duelMode') as 'local' | 'remote') ?? 'local',
  );

  const createMut = useMutation({
    mutationFn: () => api.createMatch(game, opponent.trim() || undefined, duelMode),
    onSuccess: (m) => {
      qc.invalidateQueries({ queryKey: ['matches'] });
      // active = on a démarré une partie locale, on file
      // pending = invitation envoyée à un ami OU code à partager → on va au détail dans les 2 cas
      nav(`/matches/${m.id}`);
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
              {friends.length > 0 && !isShifumi && (
                <>
                  <div className="eyebrow" style={{ marginTop: 4 }}>
                    <span className="label">Inviter un ami</span>
                  </div>
                  <FriendStrip
                    friends={friends}
                    selectedPseudo={opponent.trim()}
                    onPick={(p) => { setOpponent(p); setDuelMode('remote'); setError(null); }}
                  />
                  <div style={{ color: 'var(--muted)', fontSize: 12.5 }}>
                    Clique sur un ami pour lui envoyer une invitation au duel. Il devra l'accepter
                    avant que la partie démarre.
                  </div>
                </>
              )}

              {isShifumi ? (
                <>
                  <div className="eyebrow" style={{ marginTop: 4 }}>
                    <span className="label">Mode de duel</span>
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button className={`chip ${shifumiMode === 'irl' ? 'active accent' : ''}`} onClick={() => setShifumiMode('irl')}>
                      🤝 IRL — saisir le résultat
                    </button>
                    <button className={`chip ${shifumiMode === 'remote' ? 'active accent' : ''}`} onClick={() => setShifumiMode('remote')}>
                      🛰️ Distance — Shi-fu-mi
                    </button>
                  </div>
                  {shifumiMode === 'irl' ? (
                    <ShifumiForm
                      opponent={opponent}
                      setOpponent={setOpponent}
                      onSuccess={(m) => { qc.invalidateQueries({ queryKey: ['matches'] }); qc.invalidateQueries({ queryKey: ['leaderboard'] }); nav(`/matches/${m.id}`); }}
                      setError={setError}
                      error={error}
                    />
                  ) : (
                    <ShifumiRemoteForm
                      opponent={opponent}
                      setOpponent={setOpponent}
                      onSuccess={(m) => { qc.invalidateQueries({ queryKey: ['matches'] }); nav(`/matches/${m.id}`); }}
                      setError={setError}
                      error={error}
                    />
                  )}
                </>
              ) : (
                <>
                  <Field
                    label="Adversaire (laisse vide pour un match avec code)"
                    placeholder="pseudo"
                    value={opponent}
                    onChange={(e) => { setOpponent(e.target.value); setError(null); }}
                  />
                  {opponent.trim().length > 0 && (
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button className={`chip ${duelMode === 'local' ? 'active accent' : ''}`} onClick={() => setDuelMode('local')}>
                        📱 Local — même appareil
                      </button>
                      <button className={`chip ${duelMode === 'remote' ? 'active accent' : ''}`} onClick={() => setDuelMode('remote')}>
                        ✉️ Invitation à distance
                      </button>
                    </div>
                  )}
                  <div style={{ color: 'var(--muted)', fontSize: 12.5 }}>
                    {opponent.trim().length === 0
                      ? "Sans adversaire, on te donne un code à partager (utile pour Basket Random + extension)."
                      : duelMode === 'local'
                        ? "Match local : démarre direct sur le même appareil."
                        : "Invitation : l'ami reçoit le défi, doit l'accepter pour démarrer."}
                  </div>
                  {error && <div style={{ color: 'var(--loss)', fontSize: 13 }}>{error}</div>}
                  <button
                    className="btn btn-accent btn-lg btn-full"
                    onClick={() => createMut.mutate()}
                    disabled={createMut.isPending}
                  >
                    {createMut.isPending ? '…' : (opponent.trim() && duelMode === 'remote' ? 'Envoyer l\'invitation' : 'Créer le match')}
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
  const [condition, setCondition] = useState('');
  // Le pick perdant n'a qu'une seule valeur possible une fois winnerPick choisi.
  const forcedLoserPick = useMemo(() => (winnerPick ? SHIFUMI_LOSES_TO[winnerPick] : null), [winnerPick]);

  const submitMut = useMutation({
    mutationFn: () => {
      if (!winnerPick || !forcedLoserPick) throw new Error('missing_pick');
      if (!whoWon) throw new Error('missing_winner');
      const opp = opponent.trim();
      if (!opp) throw new Error('opponent_required');
      const winnerPseudo = whoWon === 'me' ? user!.pseudo : opp;
      return api.createShifumi(opp, winnerPseudo, winnerPick, forcedLoserPick, condition.trim() || undefined);
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

      <div className="eyebrow" style={{ marginTop: 12 }}>
        <span className="label">Condition du duel (optionnel)</span>
      </div>
      <Field
        label="Enjeu"
        placeholder="ex : celui qui perd paye le café"
        value={condition}
        onChange={(e) => setCondition(e.target.value.slice(0, 200))}
      />
      <div style={{ color: 'var(--muted)', fontSize: 12 }}>
        Une phrase courte que les deux joueurs voient avant et après le duel ({condition.length}/200).
      </div>

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

// Distance : on commit son pick (secret) côté serveur, l'opponent fera sa pioche depuis son détail.
function ShifumiRemoteForm({
  opponent, setOpponent, onSuccess, setError, error,
}: {
  opponent: string;
  setOpponent: (v: string) => void;
  onSuccess: (m: import('../api/types').Match) => void;
  setError: (s: string | null) => void;
  error: string | null;
}) {
  const [myPick, setMyPick] = useState<ShifumiPick | null>(null);
  const [condition, setCondition] = useState('');
  const [bestOf, setBestOf] = useState<1 | 3 | 5>(1);
  const mut = useMutation({
    mutationFn: () => {
      if (!myPick) throw new Error('missing_pick');
      if (opponent.trim().length < 3) throw new Error('opponent_required');
      return api.createShifumiRemote(opponent.trim(), myPick, condition.trim() || undefined, bestOf);
    },
    onSuccess,
    onError: (e) => setError(humanize(e)),
  });
  return (
    <>
      <Field
        label="Adversaire"
        placeholder="pseudo (compte existant)"
        value={opponent}
        onChange={(e) => setOpponent(e.target.value)}
      />
      <div className="eyebrow"><span className="label">Format</span></div>
      <div style={{ display: 'flex', gap: 8 }}>
        {[1, 3, 5].map((n) => (
          <button
            key={n}
            type="button"
            className={`chip ${bestOf === n ? 'active accent' : ''}`}
            onClick={() => setBestOf(n as 1 | 3 | 5)}
          >{n === 1 ? '1 manche' : `BO${n}`}</button>
        ))}
      </div>
      <div style={{ color: 'var(--muted)', fontSize: 12 }}>
        {bestOf === 1 ? 'Une seule manche.' : `Premier à ${Math.ceil(bestOf / 2)} manches remporte la série.`}
      </div>
      <div className="eyebrow"><span className="label">Ton choix de la 1<sup>re</sup> manche (secret)</span></div>
      <PickRow value={myPick} onChange={setMyPick} />
      <div className="eyebrow" style={{ marginTop: 8 }}><span className="label">Condition du duel (optionnel)</span></div>
      <Field
        label="Enjeu"
        placeholder="ex : le perdant range la vaisselle"
        value={condition}
        onChange={(e) => setCondition(e.target.value.slice(0, 200))}
      />
      <div style={{ color: 'var(--muted)', fontSize: 12 }}>
        Cet enjeu sera visible des deux joueurs avant et après le reveal ({condition.length}/200).
      </div>
      {error && <div style={{ color: 'var(--loss)', fontSize: 13 }}>{error}</div>}
      <button
        className="btn btn-accent btn-lg btn-full"
        style={{ marginTop: 12 }}
        disabled={!myPick || opponent.trim().length < 3 || mut.isPending}
        onClick={() => mut.mutate()}
      >
        {mut.isPending ? '…' : 'Lancer le défi'}
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

// Petite grille d'amis avec avatars — pour piquer un opponent d'un clic.
function FriendStrip({
  friends, selectedPseudo, onPick,
}: {
  friends: import('../api/types').FriendshipRow[];
  selectedPseudo: string;
  onPick: (pseudo: string) => void;
}) {
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))',
      gap: 10,
    }}>
      {friends.map((f) => {
        const active = f.user.pseudo === selectedPseudo;
        return (
          <button
            key={f.id}
            onClick={() => onPick(f.user.pseudo)}
            style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
              padding: 10, borderRadius: 14,
              border: `1px solid ${active ? 'var(--accent)' : 'var(--line)'}`,
              background: active ? 'color-mix(in srgb, var(--accent) 14%, var(--surface))' : 'var(--surface)',
              color: 'var(--text)', cursor: 'pointer',
            }}
          >
            <Avatar seed={f.user.pseudo} size={42} imageUrl={absoluteAvatar(f.user.avatarUrl)} />
            <span style={{ fontWeight: 700, fontSize: 13 }}>{f.user.pseudo}</span>
          </button>
        );
      })}
    </div>
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
