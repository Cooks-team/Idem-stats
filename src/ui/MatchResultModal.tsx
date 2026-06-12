import { useEffect, useRef, useState } from 'react';
import type { Match, MatchRewards } from '../api/types';

// Modal affiché brièvement à la fin d'un match avant le redirect classement.
// Lit match.metadata.rewards (posé par le serveur) et affiche pour MOI :
//   - statut Victoire / Défaite / Match nul
//   - delta ELO (en gros, coloré)
//   - delta coins (toujours positif — on gagne toujours quelque chose,
//     même +10 sur une défaite)

export function MatchResultModal({ match, myUserId, onClose }: {
  match: Match;
  myUserId: string;
  onClose?: () => void;
}) {
  const rewards = (match.metadata as { rewards?: MatchRewards } | null)?.rewards;
  const [phase, setPhase] = useState<'enter' | 'exit'>('enter');
  const [mounted, setMounted] = useState(true);
  // Garde sur le timer pour ne pas le redéclencher au re-render. La modal est
  // affichée 2.4s puis enchaîne sur 220ms d'animation de sortie avant unmount —
  // sans cette sortie animée, on tombait sur un noir net entre la modal et
  // le redirect classement, particulièrement visible sur mobile.
  const armed = useRef(false);

  useEffect(() => {
    if (armed.current || !rewards) return;
    armed.current = true;
    const exit = window.setTimeout(() => setPhase('exit'), 2400);
    const unmount = window.setTimeout(() => {
      setMounted(false);
      onClose?.();
    }, 2620);
    return () => { clearTimeout(exit); clearTimeout(unmount); };
  }, [rewards, onClose]);

  if (!rewards || !mounted) return null;

  const iAmP1 = match.player1Id === myUserId;
  const iAmP2 = match.player2Id === myUserId;
  if (!iAmP1 && !iAmP2) return null;
  const myReward = iAmP1 ? rewards.p1 : rewards.p2;
  if (!myReward) return null;

  const drawn = rewards.winnerId == null;
  const iWon = rewards.winnerId != null && rewards.winnerId === myUserId;
  const status = drawn ? 'draw' : iWon ? 'win' : 'lose';

  const cfg = {
    win:  { label: 'VICTOIRE !', color: '#3DD68C', emoji: '🏆' },
    lose: { label: 'DÉFAITE',    color: '#FF6B57', emoji: '💔' },
    draw: { label: 'MATCH NUL',  color: '#FFD700', emoji: '🤝' },
  }[status];

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 200,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      // Background plus léger qu'avant + pas de backdrop-filter pour éviter le
      // "tout noir" observé sur certains navigateurs mobiles : Safari iOS rend
      // mal `backdrop-filter: blur` quand la modal est dans un sous-arbre avec
      // sticky/transform, et résultat = overlay 100% opaque noir.
      background: phase === 'exit' ? 'rgba(0,0,0,0)' : 'rgba(0,0,0,0.45)',
      transition: 'background 220ms ease-out',
      // Padding pour que la carte ne touche pas le bord de l'écran sur petit
      // viewport (avant : carte 280-380px collée aux bords sur 360px).
      padding: 20,
    }}>
      <div style={{
        background: 'var(--surface)',
        border: `3px solid ${cfg.color}`,
        borderRadius: 20, padding: '28px 36px',
        textAlign: 'center', minWidth: 0, maxWidth: 380, width: '100%',
        boxShadow: `0 16px 60px rgba(0,0,0,0.6), 0 0 60px color-mix(in oklab, ${cfg.color} 35%, transparent)`,
        animation: phase === 'exit'
          ? 'idemResultPopOut 0.22s ease-in both'
          : 'idemResultPopIn 0.45s cubic-bezier(0.16, 1, 0.3, 1) both',
      }}>
        <div style={{ fontSize: 64, lineHeight: 1 }}>{cfg.emoji}</div>
        <div style={{
          fontFamily: 'var(--font-display)', fontWeight: 900,
          fontSize: 28, letterSpacing: 2, color: cfg.color, marginTop: 6,
        }}>{cfg.label}</div>

        <div style={{ display: 'flex', gap: 16, justifyContent: 'center', marginTop: 20 }}>
          {/* ELO delta */}
          <DeltaBox
            label="ELO"
            value={myReward.eloDelta}
            after={myReward.eloAfter}
            color={myReward.eloDelta > 0 ? '#3DD68C' : myReward.eloDelta < 0 ? '#FF6B57' : '#cdcdcd'}
            icon="📈"
          />
          {/* Coins delta — toujours positif */}
          <DeltaBox
            label="JETONS"
            value={myReward.coinsDelta}
            color="#FFD700"
            icon="🪙"
            alwaysPlus
          />
        </div>

        <div style={{ marginTop: 18, color: 'var(--muted)', fontSize: 11 }}>
          Retour au classement…
        </div>
      </div>

      <style>{`
        @keyframes idemResultPopIn {
          0%   { transform: scale(0.7) translateY(20px); opacity: 0; }
          60%  { transform: scale(1.06) translateY(0); opacity: 1; }
          100% { transform: scale(1); }
        }
        @keyframes idemResultPopOut {
          0%   { transform: scale(1); opacity: 1; }
          100% { transform: scale(0.92) translateY(8px); opacity: 0; }
        }
      `}</style>
    </div>
  );
}

function DeltaBox({ label, value, after, color, icon, alwaysPlus }: {
  label: string; value: number; after?: number; color: string; icon: string; alwaysPlus?: boolean;
}) {
  const sign = alwaysPlus || value >= 0 ? '+' : '';
  return (
    <div style={{
      flex: 1, padding: '12px 14px', borderRadius: 12,
      background: `color-mix(in oklab, ${color} 14%, transparent)`,
      border: `1px solid ${color}`,
    }}>
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.8, color: 'var(--muted)' }}>
        {label}
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 4, justifyContent: 'center', marginTop: 4 }}>
        <span style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 28, color }}>
          {sign}{value}
        </span>
        <span style={{ fontSize: 16 }}>{icon}</span>
      </div>
      {typeof after === 'number' && (
        <div style={{ fontSize: 10.5, color: 'var(--muted)', marginTop: 2 }}>
          {after} au total
        </div>
      )}
    </div>
  );
}
