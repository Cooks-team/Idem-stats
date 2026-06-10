import { useNavigate } from 'react-router-dom';

// Marque PODIUM : 3 barres (argent/accent/bronze) + texte.
// Cliquable par défaut → ouvre la landing /about (concept + règles).
export function Wordmark({ collapsed = false, clickable = true }: { collapsed?: boolean; clickable?: boolean }) {
  const nav = useNavigate();
  return (
    <div
      className={`wordmark${clickable ? ' clickable' : ''}`}
      onClick={clickable ? () => nav('/about') : undefined}
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      title={clickable ? 'À propos de PODIUM' : undefined}
    >
      <div className="wordmark-bars">
        <span className="b1" />
        <span className="b2" />
        <span className="b3" />
      </div>
      {!collapsed && <span className="wordmark-text">PODIUM</span>}
    </div>
  );
}
