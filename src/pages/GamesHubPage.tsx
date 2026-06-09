import { useNavigate } from 'react-router-dom';
import { Shell } from '../ui/Shell';
import { GAME_MODULES } from '../games/GameModule';

export function GamesHubPage() {
  const nav = useNavigate();
  return (
    <Shell title="Mini-jeux" subtitle="Duels rapides sur un seul écran — le résultat remonte au PODIUM.">
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 14 }}>
        {GAME_MODULES.map((m) => (
          <div key={m.id} className="panel" style={{ cursor: 'pointer' }} onClick={() => nav(`/games/${m.id}`)}>
            <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 22 }}>{m.name}</div>
            <div style={{ color: 'var(--muted)', marginTop: 6, fontSize: 13.5 }}>{m.description}</div>
            <div style={{ marginTop: 14 }}>
              <span className="tag tag-accent">JOUABLE ICI</span>
            </div>
          </div>
        ))}
      </div>
    </Shell>
  );
}
