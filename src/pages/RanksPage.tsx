import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { FiTrendingUp, FiArrowDown, FiArrowUp, FiZap } from 'react-icons/fi';
import { api } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { Shell } from '../ui/Shell';
import type { EloTier } from '../api/types';

// Page d'explication du barème ELO. Atteignable en cliquant sur n'importe
// quel chiffre d'ELO (MyRankCard sur la home, badge du profil, etc.).
// La source de vérité est le serveur (/leaderboard/tiers) — on ne hardcode
// jamais les seuils ici pour ne pas désynchroniser front et back.
export function RanksPage() {
  const nav = useNavigate();
  const { user } = useAuth();
  const { data, isLoading } = useQuery({
    queryKey: ['elo-tiers'],
    queryFn: () => api.eloTiers(),
    // Le barème ne change quasiment jamais — staleTime généreux.
    staleTime: 5 * 60 * 1000,
  });

  // ELO global de l'utilisateur connecté pour highlight le tier courant.
  const { data: lb } = useQuery({
    queryKey: ['leaderboard'],
    queryFn: () => api.leaderboard(),
  });
  const myElo = user
    ? lb?.find((e) => e.user.pseudo === user.pseudo)?.elo ?? null
    : null;
  const myTier = myElo !== null && data?.tiers
    ? data.tiers.find((t) => myElo >= t.min && (t.max === null || myElo <= t.max))
    : null;

  return (
    <Shell title="Système de ranks" subtitle="Comment fonctionne l'ELO" onBack={() => nav(-1)}>
      {/* En-tête explicatif */}
      <div className="panel" style={{ padding: 22 }}>
        <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 22, margin: '0 0 8px' }}>
          <FiTrendingUp style={{ verticalAlign: '-3px', marginRight: 8 }} />
          Ton ELO grimpe à chaque victoire
        </h2>
        <p style={{ color: 'var(--muted)', fontSize: 14, lineHeight: 1.6, margin: 0 }}>
          Tu démarres à <strong style={{ color: 'var(--text)' }}>{data?.initialElo ?? 1300}</strong> sur
          chaque jeu. À chaque duel terminé, tu gagnes ou perds des points en fonction
          de l'écart de niveau avec ton adversaire. Plus l'écart est grand,
          plus le gain (ou la perte) est marqué — battre plus fort que toi rapporte
          énormément, se faire éliminer par plus faible coûte cher.
        </p>

        {/* Asymétrie : récompense le grind */}
        <div style={{
          marginTop: 16, padding: '12px 14px',
          background: 'color-mix(in oklab, var(--accent) 12%, transparent)',
          border: '1px solid color-mix(in oklab, var(--accent) 40%, var(--line))',
          borderRadius: 12,
          display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap',
        }}>
          <FiZap size={22} style={{ color: 'var(--accent)', flexShrink: 0 }} />
          <div style={{ flex: 1, minWidth: 220 }}>
            <div style={{ fontWeight: 700, fontSize: 14 }}>L'ELO récompense les actifs</div>
            <div style={{ color: 'var(--muted)', fontSize: 12.5, marginTop: 2 }}>
              Les victoires rapportent un peu plus que ce que coûtent les défaites.
              Sur une série équilibrée, ton ELO grimpe doucement — tu es payé pour jouer.
            </div>
          </div>
          <div style={{ display: 'flex', gap: 14, fontFamily: 'var(--font-display)', fontWeight: 800 }}>
            <span style={{ color: 'var(--win)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <FiArrowUp /> Win
            </span>
            <span style={{ color: 'var(--loss)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <FiArrowDown /> Loss
            </span>
          </div>
        </div>
      </div>

      {/* Bandeau "ton rank actuel" */}
      {myTier && myElo !== null && (
        <div className="panel" style={{
          padding: 18, marginTop: 16,
          background: `color-mix(in oklab, ${myTier.color} 12%, var(--surface))`,
          border: `2px solid ${myTier.color}`,
          display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap',
        }}>
          <div style={{ fontSize: 56, lineHeight: 1 }}>{myTier.emoji}</div>
          <div style={{ flex: 1, minWidth: 200 }}>
            <div style={{ fontSize: 11.5, letterSpacing: 1.4, color: 'var(--muted)', fontWeight: 800 }}>
              TON RANK ACTUEL
            </div>
            <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 28, color: myTier.color, lineHeight: 1.1 }}>
              {myTier.name}
            </div>
            <div style={{ color: 'var(--muted)', fontSize: 13, marginTop: 4 }}>
              {myElo} ELO
              {myTier.max !== null && (
                <> · {myTier.max - myElo + 1} points pour passer au tier suivant</>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Liste des tiers */}
      <div style={{ marginTop: 24 }}>
        <div className="eyebrow">
          <span className="label">Tous les ranks</span>
        </div>
        {isLoading && !data && (
          <div className="panel" style={{ textAlign: 'center', color: 'var(--muted)' }}>Chargement…</div>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {data?.tiers.map((t) => (
            <TierRow key={t.name} tier={t} isCurrent={myTier?.name === t.name} />
          ))}
        </div>
      </div>
    </Shell>
  );
}

function TierRow({ tier, isCurrent }: { tier: EloTier; isCurrent: boolean }) {
  const range = tier.max === null
    ? `${tier.min}+`
    : `${tier.min} – ${tier.max}`;
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 14,
      padding: '14px 16px', borderRadius: 14,
      background: isCurrent
        ? `color-mix(in oklab, ${tier.color} 14%, var(--surface))`
        : 'var(--surface)',
      border: `${isCurrent ? 2 : 1}px solid ${isCurrent ? tier.color : 'var(--line)'}`,
    }}>
      <div style={{ fontSize: 32, lineHeight: 1, flexShrink: 0 }}>{tier.emoji}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 18,
          color: tier.color,
        }}>
          {tier.name}
        </div>
        <div className="tabular" style={{ color: 'var(--muted)', fontSize: 12.5, marginTop: 2 }}>
          {range} ELO
        </div>
      </div>
      {isCurrent && (
        <div style={{
          padding: '4px 10px', borderRadius: 999,
          background: tier.color, color: 'var(--bg)',
          fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 11, letterSpacing: 1,
        }}>
          VOUS
        </div>
      )}
    </div>
  );
}
