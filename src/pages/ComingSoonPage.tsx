import { useNavigate, useSearchParams } from 'react-router-dom';
import { FiClock, FiArrowLeft } from 'react-icons/fi';
import { Shell } from '../ui/Shell';
import { displayGame } from '../games/registry';

// Écran générique "Bientôt disponible". Atteint quand un user tente
// d'accéder à un jeu ou mode désactivé. Query params :
//   ?game=pong     → "Pong est bientôt disponible"
//   ?mode=remote   → "Le mode en ligne est bientôt disponible"
//   les deux       → "Pong en mode en ligne est bientôt disponible"
//   ni l'un ni l'autre → message générique
// On stocke l'info en query plutôt qu'en state pour que le lien soit
// partageable / le bouton retour navigateur fonctionne.
export function ComingSoonPage() {
  const nav = useNavigate();
  const [params] = useSearchParams();
  const game = params.get('game') ?? '';
  const mode = params.get('mode') ?? '';

  const gameName = game ? displayGame(game) : null;
  const modeLabel = mode === 'remote' ? 'le mode en ligne'
    : mode === 'local' ? 'le mode local'
    : null;

  const headline = gameName && modeLabel
    ? `${gameName} en ${modeLabel}`
    : gameName
    ? gameName
    : modeLabel
    ? `Ce ${modeLabel}`
    : 'Cette fonctionnalité';

  return (
    <Shell title="Bientôt disponible" onBack={() => nav(-1)}>
      <div className="panel" style={{
        padding: '48px 28px',
        textAlign: 'center',
        background: 'linear-gradient(160deg, color-mix(in oklab, var(--accent) 8%, var(--surface)), var(--surface))',
        border: '2px dashed color-mix(in oklab, var(--accent) 50%, var(--line))',
      }}>
        <div style={{
          width: 96, height: 96, borderRadius: '50%',
          background: 'color-mix(in oklab, var(--accent) 18%, transparent)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          margin: '0 auto 18px',
          color: 'var(--accent)', fontSize: 44,
        }}>
          <FiClock />
        </div>

        <h2 style={{
          fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 30,
          margin: '0 0 10px', color: 'var(--text)',
        }}>
          {headline} est bientôt disponible
        </h2>

        <p style={{
          color: 'var(--muted)', fontSize: 14.5, lineHeight: 1.6,
          maxWidth: 480, margin: '0 auto',
        }}>
          On est en train d'y bosser. Repasse dans quelques jours — en attendant
          tu peux toujours te défier sur les autres jeux disponibles.
        </p>

        <div style={{
          display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap',
          marginTop: 28,
        }}>
          <button className="btn btn-accent btn-lg" onClick={() => nav('/games')}>
            🎮 Voir les autres jeux
          </button>
          <button className="btn btn-line" onClick={() => nav('/')}>
            <FiArrowLeft style={{ verticalAlign: '-2px', marginRight: 6 }} />
            Retour au classement
          </button>
        </div>
      </div>
    </Shell>
  );
}
