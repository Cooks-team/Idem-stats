import { useEffect, useRef, useState } from 'react';
import { EMOTES } from '../lib/emotes';

// Bouton-toggle "😀" qui ouvre une grille d'emotes. Conçu pour s'intégrer
// dans n'importe quel jeu (overlay sur canvas ou inline dans un HUD React).
// Quand l'utilisateur clique sur un emote, onPick(key) est déclenché. C'est
// au jeu de l'afficher localement (via EmoteBubble) ET de le pousser via
// sendEmote() si on est en mode remote.

export function EmotePicker({ onPick, label = 'Emotes', size = 'md' }: {
  onPick: (key: string) => void;
  label?: string;
  size?: 'sm' | 'md';
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // Click outside → ferme
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [open]);

  const btnSize = size === 'sm' ? 30 : 38;

  return (
    <div ref={rootRef} style={{ position: 'relative', display: 'inline-block' }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={label}
        style={{
          width: btnSize, height: btnSize, borderRadius: 999,
          background: open ? 'var(--accent)' : 'rgba(0,0,0,0.55)',
          color: open ? 'var(--accent-ink)' : 'white',
          border: '1px solid rgba(255,255,255,0.18)',
          cursor: 'pointer', fontSize: size === 'sm' ? 16 : 19,
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          transition: 'background .15s ease',
        }}
      >
        😀
      </button>
      {open && (
        <div
          role="menu"
          style={{
            position: 'absolute',
            bottom: 'calc(100% + 8px)', right: 0, zIndex: 30,
            background: 'rgba(15,15,18,0.96)',
            border: '1px solid rgba(255,255,255,0.1)', borderRadius: 14,
            padding: 10, display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)', gap: 8,
            boxShadow: '0 16px 40px rgba(0,0,0,0.6)',
            minWidth: 200,
          }}
        >
          {EMOTES.map((e) => (
            <button
              key={e.key}
              type="button"
              onClick={() => { onPick(e.key); setOpen(false); }}
              title={e.label}
              style={{
                width: 56, height: 56, borderRadius: 10,
                background: e.bg, color: e.fg,
                border: 'none', cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 26, transition: 'transform .08s ease',
              }}
              onMouseEnter={(ev) => { (ev.currentTarget as HTMLButtonElement).style.transform = 'scale(1.08)'; }}
              onMouseLeave={(ev) => { (ev.currentTarget as HTMLButtonElement).style.transform = 'scale(1)'; }}
            >
              {e.emoji}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
