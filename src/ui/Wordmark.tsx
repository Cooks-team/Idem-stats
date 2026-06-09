// Marque PODIUM : 3 barres (argent/accent/bronze) + texte.

export function Wordmark({ collapsed = false }: { collapsed?: boolean }) {
  return (
    <div className="wordmark">
      <div className="wordmark-bars">
        <span className="b1" />
        <span className="b2" />
        <span className="b3" />
      </div>
      {!collapsed && <span className="wordmark-text">PODIUM</span>}
    </div>
  );
}
