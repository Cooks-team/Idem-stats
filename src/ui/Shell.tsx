import { useEffect, useState, type ReactNode } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { Wordmark } from './Wordmark';
import { Icon } from './Icon';
import { Avatar } from './Avatar';
import { useAuth } from '../auth/AuthContext';
import { absoluteAvatar } from '../api/client';
import { InboxBell } from './InboxBell';
import { BreakingNewsTicker } from './BreakingNewsTicker';
import { useEvents } from '../realtime/useEvents';

const ADMIN_PSEUDOS = ['Mulien', 'Canigwestre'];

// Shell desktop + mobile : Sidebar (drawer sur mobile) + Topbar + Content.
export function Shell({ title, subtitle, children, onBack, action }: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  onBack?: () => void;
  action?: ReactNode;
}) {
  const { user } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Connexion SSE temps réel — invalide les queries impactées à chaque event reçu.
  useEvents(!!user);

  // Ferme le drawer à chaque changement de route
  useEffect(() => { setDrawerOpen(false); }, [loc.pathname]);

  const items: Array<{ to: string; icon: 'trophy' | 'grid' | 'pulse' | 'user' | 'users' | 'chat' | 'bolt' | 'crown'; label: string; end?: boolean }> = [
    { to: '/', icon: 'trophy', label: 'Classement', end: true },
    { to: '/games', icon: 'grid', label: 'Jeux' },
    { to: '/blackjack', icon: 'bolt', label: 'Casino 🪙' },
    { to: '/matches', icon: 'pulse', label: 'Activité' },
    { to: '/friends', icon: 'users', label: 'Amis' },
    { to: '/messages', icon: 'chat', label: 'Messages' },
    { to: '/profile', icon: 'user', label: 'Profil' },
  ];
  if (user && ADMIN_PSEUDOS.includes(user.pseudo)) {
    items.push({ to: '/admin', icon: 'crown', label: 'Admin' });
  }

  return (
    <div className="shell">
      <aside className={`sidebar${drawerOpen ? ' open' : ''}`}>
        <div style={{ padding: '6px 10px 22px' }}><Wordmark /></div>
        <nav className="sidebar-nav">
          {items.map((it) => (
            <NavLink
              key={it.to}
              to={it.to}
              end={it.end}
              className={({ isActive }) => 'nav-item' + (isActive ? ' active' : '')}
            >
              <span className="icon"><Icon name={it.icon} size={20} /></span>
              {it.label}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-footer">
          {user && (
            <button className="me-button" onClick={() => nav('/profile')}>
              <Avatar seed={user.pseudo} size={36} imageUrl={absoluteAvatar(user.avatarUrl)} />
              <div className="who">
                <div className="name">{user.pseudo}</div>
                <div className="sub">connecté</div>
              </div>
              <Icon name="chevron" size={16} color="var(--muted)" />
            </button>
          )}
        </div>
      </aside>

      {/* Backdrop drawer mobile */}
      <div
        className={`shell-backdrop${drawerOpen ? ' show' : ''}`}
        onClick={() => setDrawerOpen(false)}
      />

      <main style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        {/* Ticker breaking-news global : sticky top, visible sur toutes les pages.
            Se masque tout seul s'il n'y a pas de 5-0 dans la dernière heure. */}
        <BreakingNewsTicker />
        <header className="topbar">
          <button className="burger" onClick={() => setDrawerOpen((v) => !v)} aria-label="Menu">
            <Icon name="grid" size={20} />
          </button>
          {onBack && (
            <button className="icon-btn" onClick={onBack}>
              <Icon name="back" size={20} />
            </button>
          )}
          <div style={{ flex: 1, minWidth: 0 }}>
            <h1>{title}</h1>
            {subtitle && <div className="subtitle">{subtitle}</div>}
          </div>
          {/* Solde de jetons — visible sur toutes les pages, clickable vers le casino */}
          {user && typeof user.coins === 'number' && (
            <button
              onClick={() => nav('/blackjack')}
              title="Casino — Blackjack"
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                padding: '6px 12px', borderRadius: 999,
                background: 'color-mix(in oklab, #FFD700 22%, var(--surface))',
                border: '1px solid #FFD700',
                fontFamily: 'var(--font-display)', fontWeight: 700,
                color: 'var(--text)', cursor: 'pointer', whiteSpace: 'nowrap',
              }}
            >
              <span style={{ fontSize: 16 }}>🪙</span>
              <span>{user.coins}</span>
            </button>
          )}
          <InboxBell />
          {action ?? (
            <button className="btn btn-accent btn-sm" onClick={() => nav('/matches/new')}>
              <Icon name="bolt" size={18} /> Nouveau match
            </button>
          )}
        </header>
        <div className="content-scroll">
          <div className="content-inner">{children}</div>
        </div>
      </main>
    </div>
  );
}
