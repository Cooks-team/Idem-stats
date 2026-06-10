import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../api/client';
import { Shell } from '../ui/Shell';

// /join/:code — lien d'invitation partageable.
// On tente joinMatch(code) une seule fois. Cas :
//   - Succès → on file dans /matches/:id
//   - "match_not_pending" → souvent on est l'inviteur déjà ou le match a déjà démarré.
//      On retombe alors sur /matches/:id si on connaît l'id (404 sinon)
//   - "cannot_join_own_match" → c'est ton propre code, va voir le match.
//   - Autre erreur → message + lien retour vers /
//
// Pas connecté : RequireAuth (couche AppRouter) renvoie sur /login avec
// returnTo, donc on n'a pas besoin de gérer ce cas ici.
export function JoinByCodePage() {
  const { code = '' } = useParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  // useRef pour éviter le double-join en StrictMode (le useEffect tire 2 fois en dev)
  const triedRef = useRef(false);

  useEffect(() => {
    if (triedRef.current) return;
    triedRef.current = true;
    api.joinMatch(code).then((m) => {
      qc.invalidateQueries({ queryKey: ['matches'] });
      nav(`/matches/${m.id}`, { replace: true });
    }).catch(async (e: unknown) => {
      const code405 = (e as ApiError)?.message;
      if (code405 === 'cannot_join_own_match') {
        // C'est ton match. Essaie de retrouver l'id via la liste perso pour rediriger.
        try {
          const mine = await api.listMatches('me');
          const found = mine.find((m) => m.code === code.toUpperCase());
          if (found) { nav(`/matches/${found.id}`, { replace: true }); return; }
        } catch { /* tombe en erreur générique */ }
        setError("C'est ton propre code — tu es déjà dans ce match.");
      } else if (code405 === 'match_not_pending') {
        setError("Ce match n'est plus en attente (déjà rejoint ou annulé).");
      } else if (code405 === 'match_not_found') {
        setError("Code inconnu — vérifie le lien.");
      } else {
        setError(humanize(e));
      }
    });
  }, [code, nav, qc]);

  return (
    <Shell title="Rejoindre un match" onBack={() => nav('/')}>
      <div className="panel" style={{ padding: 40, textAlign: 'center' }}>
        {error ? (
          <>
            <div style={{ fontSize: 60 }}>🤔</div>
            <div style={{ marginTop: 14, color: 'var(--loss)' }}>{error}</div>
            <button className="btn btn-accent" style={{ marginTop: 18 }} onClick={() => nav('/', { replace: true })}>
              Retour au classement
            </button>
          </>
        ) : (
          <>
            <div style={{ fontSize: 60 }}>⚔️</div>
            <div style={{ marginTop: 14, color: 'var(--muted)' }}>
              Connexion au match avec le code <strong style={{ color: 'var(--accent)' }}>{code}</strong>…
            </div>
          </>
        )}
      </div>
    </Shell>
  );
}

function humanize(e: unknown): string {
  const msg = (e as { message?: string })?.message;
  if (msg) return msg;
  return 'Impossible de rejoindre le match.';
}
