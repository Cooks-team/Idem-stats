import { useAuth } from './auth/AuthContext';
import { Wordmark } from './ui/Wordmark';

// Placeholder — la vraie navigation est branchée à la feature 02 (auth) et au-delà.
export function App() {
  const { ready, user } = useAuth();
  return (
    <div style={{ padding: 40 }}>
      <Wordmark />
      <p style={{ color: 'var(--muted)', marginTop: 24 }}>
        {!ready ? 'Chargement…' : user ? `Connecté en tant que ${user.pseudo}` : 'Pas connecté'}
      </p>
    </div>
  );
}
