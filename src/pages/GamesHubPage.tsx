import { useNavigate } from 'react-router-dom';
import { FiClock } from 'react-icons/fi';
import { Shell } from '../ui/Shell';
import { GAME_MODULES } from '../games/GameModule';
import { isGameDisabled } from '../games/registry';

export function GamesHubPage() {
  const nav = useNavigate();
  return (
    <Shell title="Mini-jeux" subtitle="Duels rapides sur un seul écran — le résultat remonte au PODIUM.">
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 14 }}>
        {GAME_MODULES.map((m) => {
          // Désactivé en maintenance ? La card devient ternie et redirige
          // vers /coming-soon au lieu d'ouvrir le jeu.
          const disabled = isGameDisabled(m.id);
          const onClick = () => {
            if (disabled) nav(`/coming-soon?game=${encodeURIComponent(m.id)}`);
            else nav(`/games/${m.id}`);
          };
          return (
            <div
              key={m.id}
              className="panel"
              onClick={onClick}
              style={{
                cursor: 'pointer',
                opacity: disabled ? 0.55 : 1,
                position: 'relative',
                transition: 'opacity 0.15s',
              }}
              aria-disabled={disabled}
            >
              <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 22 }}>
                {m.name}
              </div>
              <div style={{ color: 'var(--muted)', marginTop: 6, fontSize: 13.5 }}>
                {m.description}
              </div>
              <div style={{ marginTop: 14 }}>
                {disabled ? (
                  <span style={{
                    display: 'inline-flex', alignItems: 'center', gap: 6,
                    padding: '4px 10px', borderRadius: 999,
                    background: 'color-mix(in oklab, var(--muted) 30%, transparent)',
                    color: 'var(--muted)',
                    fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 11,
                    letterSpacing: 1,
                  }}>
                    <FiClock /> BIENTÔT
                  </span>
                ) : (
                  <span className="tag tag-accent">JOUABLE ICI</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </Shell>
  );
}
