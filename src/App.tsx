import { Navigate, Route, Routes } from 'react-router-dom';
import { LoginPage } from './auth/LoginPage';
import { RequireAuth } from './auth/RequireAuth';
import { useAuth } from './auth/AuthContext';

// Placeholder Home en attendant la feature 03.
function HomePlaceholder() {
  const { user, logout } = useAuth();
  return (
    <div style={{ padding: 40 }}>
      <p style={{ color: 'var(--muted)' }}>Connecté en tant que <strong>{user?.pseudo}</strong></p>
      <button className="btn btn-ghost" onClick={logout}>Se déconnecter</button>
    </div>
  );
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/*"
        element={<RequireAuth><HomePlaceholder /></RequireAuth>}
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
