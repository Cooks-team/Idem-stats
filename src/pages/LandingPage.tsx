import { useNavigate } from 'react-router-dom';
import { Wordmark } from '../ui/Wordmark';
import { useAuth } from '../auth/AuthContext';

// Landing publique : explique le concept et les règles. Accessible aussi quand
// on est connecté (clic sur le logo PODIUM dans la sidebar).
export function LandingPage() {
  const nav = useNavigate();
  const { user } = useAuth();

  return (
    <div className="landing">
      <div className="landing-glow" />

      <header className="landing-header">
        <Wordmark />
        <div className="landing-cta">
          {user ? (
            <button className="btn btn-accent btn-sm" onClick={() => nav('/')}>Voir le classement</button>
          ) : (
            <>
              <button className="btn btn-ghost btn-sm" onClick={() => nav('/login')}>Se connecter</button>
              <button className="btn btn-accent btn-sm" onClick={() => nav('/login')}>Rejoindre</button>
            </>
          )}
        </div>
      </header>

      <section className="landing-hero">
        <h1>
          Qui est<br />le <span className="accent">boss</span> ce soir ?
        </h1>
        <p>
          Le classement officiel de votre bande. Tu joues un 1v1, le score
          remonte, le PODIUM se met à jour. Pas de tableur Excel, pas de
          débat sur "qui a gagné la dernière fois".
        </p>
        <div className="landing-hero-cta">
          {user ? (
            <button className="btn btn-accent btn-lg" onClick={() => nav('/')}>Aller au classement →</button>
          ) : (
            <button className="btn btn-accent btn-lg" onClick={() => nav('/login')}>Commencer maintenant →</button>
          )}
        </div>
      </section>

      <section className="landing-section">
        <div className="eyebrow"><span className="label">Comment ça marche</span></div>
        <div className="landing-cards">
          <Card emoji="⚔️" title="1. Lance un duel">
            Choisis un jeu, défie un pote présent (même appareil) ou envoie
            une invitation à un ami à distance. Il accepte → la partie
            démarre.
          </Card>
          <Card emoji="🎯" title="2. Joue, marque, gagne">
            Sur le même écran ou chacun chez soi. Le score se saisit à la
            main.
          </Card>
          <Card emoji="🏆" title="3. Le PODIUM se met à jour">
            Le PODIUM est trié par ELO. Top 3 sur le
            podium, le reste en dessous. Filtrable par jeu.
          </Card>
        </div>
      </section>

      <section className="landing-section">
        <div className="eyebrow"><span className="label">Les jeux supportés</span></div>
        <div className="landing-games">
          <GameRow emoji="🏀" name="Basket Random" rule="Premier à 5. Se joue sur le même appareil." />
          <GameRow emoji="🎯" name="Fléchettes" rule="501 → 0, jouer sur mobile pour une meilleure expérience." />
          <GameRow emoji="⚽" name="Babyfoot" rule="5 buts. Score saisi automatiquement." />
          <GameRow emoji="🏓" name="Pong" rule="10 pts auto-fin." />
          <GameRow emoji="🖱️" name="Click Battle" rule="10 secondes pour cliquer le plus vite. Jouable sur deux écrans." />
          <GameRow emoji="🪨" name="Shifumi" rule="Pierre / Feuille / Ciseaux. En IRL ou Distance. Tu peux y mettre un enjeu : 'celui qui perd paye'." />
        </div>
      </section>

      <section className="landing-section">
        <div className="eyebrow"><span className="label">Les règles d'or</span></div>
        <ul className="landing-rules">
          <li><strong>Pas de revanche imposée.</strong> Une partie = un résultat enregistré.</li>
          <li><strong>Le créateur saisit le score.</strong> En cas de doute, on rejoue.</li>
          <li><strong>Le tricheur est connu.</strong> L'historique reste, le PODIUM se souvient.</li>
        </ul>
      </section>

      <footer className="landing-footer">
        <Wordmark />
        <span className="muted">Construit par Jayson Leducq et Julien Michaux.</span>
      </footer>
    </div>
  );
}

function Card({ emoji, title, children }: { emoji: string; title: string; children: React.ReactNode }) {
  return (
    <div className="landing-card panel">
      <div className="landing-card-emoji">{emoji}</div>
      <div className="landing-card-title">{title}</div>
      <p>{children}</p>
    </div>
  );
}

function GameRow({ emoji, name, rule }: { emoji: string; name: string; rule: string }) {
  return (
    <div className="landing-game">
      <div className="landing-game-emoji">{emoji}</div>
      <div>
        <div className="landing-game-name">{name}</div>
        <div className="landing-game-rule">{rule}</div>
      </div>
    </div>
  );
}
