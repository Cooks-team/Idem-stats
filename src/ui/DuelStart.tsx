import { Avatar } from './Avatar';

// Composant partagé "écran pré-match" — affiche les 2 joueurs avec leur
// pseudo et avatar, un bouton "Échanger côtés" (seulement en local), et un
// bouton "Démarrer". Utilisé par Pong/Babyfoot/Snake/Clicker/Darts pour
// remplacer le générique "Joueur 1 / Joueur 2".
//
// Convention de côtés :
//   leftPlayer  = celui qui jouera à gauche (paddle gauche, score à gauche)
//   rightPlayer = celui qui jouera à droite
// En remote, l'host (player1) est toujours à droite par convention (cf.
// existant Pong : "🔴 J1 droite"), donc swap désactivé. En local, le user
// peut basculer.

export interface DuelPlayer {
  pseudo?: string;
  avatarUrl?: string | null;
  /** Fallback si pseudo manquant — ex. "Joueur 1" ou "Bot 1". */
  fallback: string;
  /** Couleur d'accent (rouge p1 / bleu p2 par défaut). */
  color: string;
}

export function DuelStart({
  leftPlayer,
  rightPlayer,
  canSwap,
  onSwap,
  onStart,
  startLabel = 'Démarrer',
  title,
  subtitle,
  startDisabled,
  startLoading,
}: {
  leftPlayer: DuelPlayer;
  rightPlayer: DuelPlayer;
  /** Vrai en mode local — le user peut basculer les côtés. Faux en remote. */
  canSwap: boolean;
  onSwap: () => void;
  onStart: () => void;
  startLabel?: string;
  title?: string;
  subtitle?: string;
  startDisabled?: boolean;
  startLoading?: boolean;
}) {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      gap: 18, width: '100%', maxWidth: 520,
    }}>
      {title && (
        <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 22, textAlign: 'center' }}>
          {title}
        </div>
      )}

      {/* Les 2 cartes joueur */}
      <div style={{
        display: 'grid', gridTemplateColumns: '1fr auto 1fr', gap: 12,
        width: '100%', alignItems: 'center',
      }}>
        <PlayerCard player={leftPlayer} side="left" />
        <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 28, color: 'var(--muted)' }}>VS</div>
        <PlayerCard player={rightPlayer} side="right" />
      </div>

      {/* Échanger côtés (local uniquement) */}
      {canSwap && (
        <button
          type="button"
          className="btn btn-line btn-sm"
          onClick={onSwap}
        >
          ⇄ Échanger les côtés
        </button>
      )}

      {subtitle && (
        <div style={{ color: 'var(--muted)', fontSize: 13, textAlign: 'center', lineHeight: 1.5 }}>
          {subtitle}
        </div>
      )}

      <button
        className="btn btn-accent btn-lg btn-full"
        onClick={onStart}
        disabled={startDisabled || startLoading}
        style={{ maxWidth: 320 }}
      >
        {startLoading ? '…' : startLabel}
      </button>
    </div>
  );
}

function PlayerCard({ player, side }: { player: DuelPlayer; side: 'left' | 'right' }) {
  const label = player.pseudo || player.fallback;
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
      padding: '14px 10px', borderRadius: 14,
      background: 'var(--surface)',
      border: `2px solid ${player.color}`,
      boxShadow: `0 6px 24px color-mix(in oklab, ${player.color} 22%, transparent)`,
    }}>
      <Avatar seed={label} size={56} imageUrl={player.avatarUrl ?? null} />
      <div style={{
        fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 16,
        color: player.color, textAlign: 'center',
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        maxWidth: '100%',
      }}>
        {label}
      </div>
      <div style={{ fontSize: 10, color: 'var(--muted)', letterSpacing: 1, textTransform: 'uppercase' }}>
        {side === 'left' ? 'Gauche' : 'Droite'}
      </div>
    </div>
  );
}
