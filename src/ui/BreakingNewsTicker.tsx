import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import type { WallOfShameLatest } from '../api/types';

// Ticker breaking-news qui défile en haut de TOUT le site.
// - Liste tous les 5-0 Basket Random datant de moins d'1h (renvoyés par
//   /wall-of-shame.recent).
// - Si la liste est vide → ticker masqué (return null).
// - Animation marquee CSS : le contenu interne est dupliqué et translaté
//   de 0 à -50% pour créer une boucle infinie sans saut visible.
// - Click n'importe où → file sur la page d'accueil avec l'onglet Wall of
//   shame ouvert (?tab=shame, consommé par HomePage).
// - Refetch toutes les 20s pour propager les nouveaux 5-0 en quasi-direct.
export function BreakingNewsTicker() {
  const nav = useNavigate();
  const { data } = useQuery({
    queryKey: ['wall-of-shame'],
    queryFn: () => api.wallOfShame(),
    refetchInterval: 20_000,
  });
  const recent: WallOfShameLatest[] = data?.recent ?? [];
  if (recent.length === 0) return null;

  // On double la liste pour que l'animation translateX(-50%) revienne sur
  // un duplicata identique, donnant un défilement infini fluide.
  const looped = [...recent, ...recent];
  // Durée d'un cycle : ~10s par item, plancher 18s pour éviter qu'1 seul item
  // ne tourne trop vite.
  const durationS = Math.max(18, recent.length * 10);

  return (
    <div
      onClick={() => nav('/?tab=shame')}
      title="Voir le Wall of shame"
      style={{
        // Position sticky retirée — le wrapper dans Shell.tsx gère le sticky
        // pour ticker + topbar ensemble, pour qu'ils ne se chevauchent plus.
        display: 'flex', alignItems: 'center', gap: 0,
        background: 'linear-gradient(90deg, var(--loss), #8a1a0d 60%, var(--loss))',
        color: 'white', cursor: 'pointer',
        boxShadow: '0 2px 12px rgba(180, 30, 0, 0.45)',
        borderBottom: '1px solid rgba(255,255,255,0.18)',
      }}
    >
      <span style={{
        fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 11,
        letterSpacing: 1.4, background: 'rgba(0,0,0,0.35)',
        padding: '8px 14px', whiteSpace: 'nowrap', flexShrink: 0,
        display: 'flex', alignItems: 'center', gap: 6,
      }}>
        <span style={{
          display: 'inline-block', width: 8, height: 8,
          borderRadius: '50%', background: '#ff5544',
          boxShadow: '0 0 8px #ff5544',
          animation: 'idemBlink 1s ease-in-out infinite',
        }} />
        BREAKING · {recent.length} 5-0 dans la dernière heure
      </span>
      <div style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
        <div
          style={{
            display: 'inline-flex', whiteSpace: 'nowrap',
            animation: `idemMarquee ${durationS}s linear infinite`,
            padding: '8px 0',
            // Une fois la souris dessus, on fige pour laisser lire l'item complet
            // (CSS hover via inline style → pas possible directement, mais c'est
            // optionnel — le clic file sur le wall of shame quoi qu'il arrive).
          }}
        >
          {looped.map((e, i) => (
            <span key={i} style={{
              display: 'inline-flex', alignItems: 'center', gap: 10,
              padding: '0 26px', fontSize: 14, lineHeight: 1.2,
              borderRight: i < looped.length - 1 ? '1px solid rgba(255,255,255,0.18)' : 'none',
            }}>
              <span style={{ fontSize: 16 }}>🔞</span>
              <span>
                <strong>{e.loser.pseudo}</strong> s'est fait mangeave le cul par{' '}
                <strong>{e.winner.pseudo}</strong> au Basket Random (5-0)
              </span>
              <span style={{ opacity: 0.8, fontSize: 12 }}>{timeAgo(e.match.finishedAt)}</span>
            </span>
          ))}
        </div>
      </div>
      <style>{`
        @keyframes idemMarquee {
          0%   { transform: translateX(0); }
          100% { transform: translateX(-50%); }
        }
        @keyframes idemBlink {
          0%, 100% { opacity: 1; }
          50%      { opacity: 0.35; }
        }
      `}</style>
    </div>
  );
}

function timeAgo(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const sec = Math.max(0, Math.floor((Date.now() - d.getTime()) / 1000));
  if (sec < 60) return "à l'instant";
  return `il y a ${Math.floor(sec / 60)} min`;
}
