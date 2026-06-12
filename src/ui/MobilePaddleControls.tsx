import { useRef, type CSSProperties } from 'react';

// Deux grands boutons tactiles (haut/bas) à utiliser dans les jeux qui
// dépendent du clavier (Pong, Babyfoot) pour les rendre jouables sur
// mobile. Ne se montre qu'avec `visible` (en pratique : useIsMobile()).
//
// Les callbacks `onPressUp` / `onPressDown` sont appelés au pointerdown
// avec une référence ref vers une fonction "release" — le composant
// garde la touche "down" tant que le doigt est sur le bouton, et
// déclenche release() au pointerup / pointercancel / touchcancel /
// pointerleave. Ça permet à l'appelant d'utiliser le même contrat que
// keydown/keyup et d'éviter les paddles bloqués si on slide le doigt
// hors du bouton.

interface Props {
  visible: boolean;
  onUpDown: () => void;
  onUpUp: () => void;
  onDownDown: () => void;
  onDownUp: () => void;
  label?: string;
  /** Position : 'bottom' (sous le jeu) ou 'overlay' (sur le canvas).
   *  Par défaut 'bottom'. */
  position?: 'bottom' | 'overlay';
}

const BTN_BASE: CSSProperties = {
  // Touch-friendly : 70px haut/large minimum, plein pouce confortable.
  width: '40%',
  minHeight: 86,
  borderRadius: 18,
  background: 'color-mix(in oklab, var(--accent) 24%, var(--surface))',
  border: '2px solid var(--accent)',
  color: 'var(--text)',
  fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 38,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  // Empêche le double-tap zoom iOS et les surlignages de sélection.
  userSelect: 'none', WebkitUserSelect: 'none', touchAction: 'none',
  WebkitTapHighlightColor: 'transparent',
  cursor: 'pointer',
};

export function MobilePaddleControls({
  visible, onUpDown, onUpUp, onDownDown, onDownUp, label, position = 'bottom',
}: Props) {
  // Garde l'état "pressé" par bouton pour ne déclencher onXxUp qu'une seule fois
  // même si l'utilisateur fait pointerleave sans pointerup.
  const upPressed = useRef(false);
  const downPressed = useRef(false);

  const wrap = (which: 'up' | 'down', kind: 'down' | 'up') => {
    if (which === 'up') {
      if (kind === 'down' && !upPressed.current) { upPressed.current = true; onUpDown(); }
      if (kind === 'up'   &&  upPressed.current) { upPressed.current = false; onUpUp();   }
    } else {
      if (kind === 'down' && !downPressed.current) { downPressed.current = true; onDownDown(); }
      if (kind === 'up'   &&  downPressed.current) { downPressed.current = false; onDownUp();   }
    }
  };

  if (!visible) return null;

  const containerStyle: CSSProperties = position === 'overlay'
    ? {
        position: 'absolute', left: 0, right: 0, bottom: 10, zIndex: 4,
        display: 'flex', gap: 14, justifyContent: 'space-around',
        padding: '0 12px', pointerEvents: 'auto',
      }
    : {
        display: 'flex', gap: 14, justifyContent: 'space-around',
        padding: '8px 12px 0',
      };

  return (
    <div style={containerStyle} aria-label={label ?? 'Contrôles tactiles'}>
      <button
        type="button"
        style={BTN_BASE}
        onPointerDown={(e) => { e.preventDefault(); wrap('up', 'down'); }}
        onPointerUp={() => wrap('up', 'up')}
        onPointerCancel={() => wrap('up', 'up')}
        onPointerLeave={() => wrap('up', 'up')}
      >
        ▲
      </button>
      <button
        type="button"
        style={BTN_BASE}
        onPointerDown={(e) => { e.preventDefault(); wrap('down', 'down'); }}
        onPointerUp={() => wrap('down', 'up')}
        onPointerCancel={() => wrap('down', 'up')}
        onPointerLeave={() => wrap('down', 'up')}
      >
        ▼
      </button>
    </div>
  );
}
