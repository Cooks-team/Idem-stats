import { useRef, type CSSProperties } from 'react';

// Pad directionnel tactile pour les jeux qui demandent up/down/left/right
// (et optionnellement boost). Babyfoot, Snake (variante grosse), etc.
//
// Layout :
//             [▲]
//        [◀]       [▶]      [BOOST]
//             [▼]
//
// Les boutons gardent leur état "pressé" avec un ref interne pour ne pas
// déclencher deux fois onUp si le doigt glisse hors du bouton.

export type Dir = 'up' | 'down' | 'left' | 'right';

interface Props {
  visible: boolean;
  onPress: (dir: Dir, state: 'down' | 'up') => void;
  /** Si fourni, on ajoute un bouton BOOST à droite du pad. */
  onBoost?: (state: 'down' | 'up') => void;
  boostLabel?: string;
}

const DIR_BTN: CSSProperties = {
  width: 64, height: 64, borderRadius: 14,
  background: 'color-mix(in oklab, var(--accent) 20%, var(--surface))',
  border: '2px solid var(--accent)',
  color: 'var(--text)',
  fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 26,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  userSelect: 'none', WebkitUserSelect: 'none', touchAction: 'none',
  WebkitTapHighlightColor: 'transparent',
};
const BOOST_BTN: CSSProperties = {
  width: 76, height: 76, borderRadius: '50%',
  background: 'color-mix(in oklab, #FFD700 30%, var(--surface))',
  border: '2px solid #FFD700',
  color: 'var(--text)',
  fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 13, letterSpacing: 1,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  userSelect: 'none', WebkitUserSelect: 'none', touchAction: 'none',
  WebkitTapHighlightColor: 'transparent',
};

export function MobileDPad({ visible, onPress, onBoost, boostLabel = '⚡' }: Props) {
  // État pressé par direction — évite les doubles up.
  const pressed = useRef<Record<string, boolean>>({});

  const wrap = (key: string, kind: 'down' | 'up', emit: () => void) => {
    if (kind === 'down' && !pressed.current[key]) { pressed.current[key] = true; emit(); }
    if (kind === 'up'   &&  pressed.current[key]) { pressed.current[key] = false; emit(); }
  };

  if (!visible) return null;

  const dirBtn = (dir: Dir, label: string) => (
    <button
      type="button"
      style={DIR_BTN}
      onPointerDown={(e) => { e.preventDefault(); wrap(dir, 'down', () => onPress(dir, 'down')); }}
      onPointerUp={()    => wrap(dir, 'up',   () => onPress(dir, 'up'))}
      onPointerCancel={() => wrap(dir, 'up',  () => onPress(dir, 'up'))}
      onPointerLeave={()  => wrap(dir, 'up',  () => onPress(dir, 'up'))}
    >{label}</button>
  );

  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-around',
      padding: '10px 12px 0', gap: 18, flexWrap: 'wrap',
    }}>
      {/* Croix directionnelle 3×3 minimaliste */}
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(3, 64px)', gridTemplateRows: 'repeat(3, 64px)',
        gap: 6, justifyContent: 'center',
      }}>
        <div />
        {dirBtn('up', '▲')}
        <div />
        {dirBtn('left', '◀')}
        <div />
        {dirBtn('right', '▶')}
        <div />
        {dirBtn('down', '▼')}
        <div />
      </div>
      {onBoost && (
        <button
          type="button"
          style={BOOST_BTN}
          onPointerDown={(e) => { e.preventDefault(); wrap('boost', 'down', () => onBoost('down')); }}
          onPointerUp={()    => wrap('boost', 'up',   () => onBoost('up'))}
          onPointerCancel={() => wrap('boost', 'up',  () => onBoost('up'))}
          onPointerLeave={()  => wrap('boost', 'up',  () => onBoost('up'))}
        >{boostLabel}</button>
      )}
    </div>
  );
}
