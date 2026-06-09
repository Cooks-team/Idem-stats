import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
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
      // Si on a un opponent direct → match active → on bascule sur le détail.
      // Sinon (pending + code) → on reste pour afficher le code.
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

  return (
    <Shell title="Nouveau match" onBack={() => nav(-1)} action={<span />}>
      <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
        <button className={`chip ${mode === 'create' ? 'active accent' : ''}`} onClick={() => { setMode('create'); setError(null); }}>Créer</button>
        <button className={`chip ${mode === 'join' ? 'active' : ''}`} onClick={() => { setMode('join'); setError(null); }}>Rejoindre par code</button>
      </div>

      <div className="panel" style={{ maxWidth: 560 }}>
        {mode === 'create' ? (
          created ? (
            <CodeReveal code={created.code ?? '—'} />
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
    return m;
  }
  return 'Action impossible.';
}
