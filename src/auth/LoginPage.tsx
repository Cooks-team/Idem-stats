import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from './AuthContext';
import { Wordmark } from '../ui/Wordmark';
import { Field } from '../ui/Field';

type Mode = 'in' | 'up';

// Reproduit l'accroche du design (mobile) : "Qui est le boss ce soir ?".
// Pseudo + mot de passe uniquement (pas d'email, pas d'Apple SSO).
export function LoginPage() {
  const { login, register } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const redirectTo = (loc.state as { from?: string } | null)?.from ?? '/';

  const [mode, setMode] = useState<Mode>('in');
  const [pseudo, setPseudo] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const canSubmit = !loading && pseudo.trim().length >= 3 && password.length >= 6;

  const submit = async () => {
    if (!canSubmit) return;
    setLoading(true); setError(null);
    try {
      if (mode === 'in') await login(pseudo.trim(), password);
      else await register(pseudo.trim(), password);
      nav(redirectTo, { replace: true });
    } catch (e) {
      setError(humanize(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative' }}>
      {/* Halo accent — mime la radial-gradient du design */}
      <div style={{
        position: 'absolute', top: -160, left: '50%', transform: 'translateX(-50%)',
        width: 520, height: 520, borderRadius: '50%', pointerEvents: 'none',
        background: 'radial-gradient(circle, color-mix(in srgb, var(--accent) 30%, transparent), transparent 65%)',
        filter: 'blur(20px)',
      }} />

      <div style={{ position: 'relative', width: 420, padding: 28, display: 'flex', flexDirection: 'column', gap: 22 }}>
        <Wordmark />

        <div>
          <h1 style={{
            fontFamily: 'var(--font-display)', fontWeight: 700,
            fontSize: 44, lineHeight: '46px', letterSpacing: -0.5, margin: 0,
          }}>
            Qui est<br />le <span style={{ color: 'var(--accent)' }}>boss</span> ce soir&nbsp;?
          </h1>
          <p style={{ color: 'var(--muted)', fontSize: 15.5, lineHeight: 1.5, marginTop: 14 }}>
            Le classement officiel de votre bande. Fléchettes, babyfoot, Plato…
            chaque partie compte.
          </p>
        </div>

        <div className="field-group">
          <Field
            label="Pseudo"
            placeholder="tom"
            autoComplete="username"
            value={pseudo}
            onChange={(e) => { setPseudo(e.target.value); setError(null); }}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
          />
          <Field
            label="Mot de passe"
            type="password"
            placeholder="••••••••"
            autoComplete={mode === 'in' ? 'current-password' : 'new-password'}
            value={password}
            onChange={(e) => { setPassword(e.target.value); setError(null); }}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
          />
          {error && <div style={{ color: 'var(--loss)', fontSize: 13 }}>{error}</div>}
          <button
            className="btn btn-accent btn-lg btn-full"
            disabled={!canSubmit}
            onClick={submit}
          >
            {loading ? '…' : mode === 'in' ? 'Entrer dans l’arène' : 'Créer mon compte'}
          </button>
        </div>

        <div style={{ textAlign: 'center', color: 'var(--muted)', fontSize: 14 }}>
          {mode === 'in' ? 'Pas encore de compte ? ' : 'Déjà inscrit ? '}
          <button
            onClick={() => { setMode(mode === 'in' ? 'up' : 'in'); setError(null); }}
            style={{ background: 'none', border: 'none', color: 'var(--accent)', fontWeight: 700, fontSize: 14, cursor: 'pointer' }}
          >
            {mode === 'in' ? 'Rejoindre' : 'Se connecter'}
          </button>
        </div>
      </div>
    </div>
  );
}

function humanize(e: unknown): string {
  if (e && typeof e === 'object' && 'message' in e) {
    const m = String((e as { message: string }).message);
    if (m === 'validation_error') return 'Pseudo invalide (3-24 chars) ou mot de passe trop court (6+).';
    if (m === 'invalid_credentials') return 'Identifiants incorrects.';
    if (m === 'conflict') return 'Ce pseudo est déjà pris.';
    return m;
  }
  return 'Connexion impossible.';
}
