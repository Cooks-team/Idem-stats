import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { Dir } from './MobileDPad';

// Joystick analogique tactile : un cercle externe (base) + un cercle interne
// (thumb) qui suit le doigt dans la zone. À chaque mouvement on calcule
// quelles directions sont "actives" (up/down/left/right) en fonction du
// vecteur (dx, dy) depuis le centre. Le joystick émet des transitions
// `dir → down` quand une direction devient active et `dir → up` quand elle
// le devient plus.
//
// Permet à un même geste continu (faire un cercle avec le pouce) de générer
// des changements de direction sans relever le doigt — c'est ce qu'on attend
// d'un stick analogique vs un d-pad de boutons séparés.
//
// L'API `onPress(dir, state)` est volontairement IDENTIQUE à MobileDPad pour
// que les jeux qui consomment l'un puissent passer à l'autre sans toucher
// au reste de leur logique d'input.

export interface MobileJoystickProps {
  visible: boolean;
  onPress: (dir: Dir, state: 'down' | 'up') => void;
  /** Bouton boost optionnel à droite du stick (cas Babyfoot). */
  onBoost?: (state: 'down' | 'up') => void;
  boostLabel?: string;
  /** Seuil normalisé (0-1) au-delà duquel une composante devient active. */
  threshold?: number;
}

const SIZE = 140;
const THUMB = 56;

export function MobileJoystick({
  visible, onPress, onBoost, boostLabel = '⚡', threshold = 0.35,
}: MobileJoystickProps) {
  const baseRef = useRef<HTMLDivElement | null>(null);
  const activeRef = useRef<Record<Dir, boolean>>({ up: false, down: false, left: false, right: false });
  const pointerIdRef = useRef<number | null>(null);
  const boostPressedRef = useRef(false);
  const [thumbPos, setThumbPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  function updateFromPointer(e: ReactPointerEvent<HTMLDivElement>) {
    const base = baseRef.current;
    if (!base) return;
    const rect = base.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const dx = (e.clientX - cx) / (rect.width / 2);
    const dy = (e.clientY - cy) / (rect.height / 2);
    // Clamp dans le cercle unité — le thumb ne sort pas de la base.
    const mag = Math.sqrt(dx * dx + dy * dy);
    const clampedDx = mag > 1 ? dx / mag : dx;
    const clampedDy = mag > 1 ? dy / mag : dy;
    setThumbPos({
      x: clampedDx * (rect.width / 2 - THUMB / 2),
      y: clampedDy * (rect.height / 2 - THUMB / 2),
    });
    // Calcule les directions actives et émet les transitions.
    const next: Record<Dir, boolean> = {
      up: dy < -threshold,
      down: dy > threshold,
      left: dx < -threshold,
      right: dx > threshold,
    };
    (['up', 'down', 'left', 'right'] as Dir[]).forEach((d) => {
      if (next[d] && !activeRef.current[d]) onPress(d, 'down');
      if (!next[d] && activeRef.current[d]) onPress(d, 'up');
    });
    activeRef.current = next;
  }

  function releaseAll() {
    (['up', 'down', 'left', 'right'] as Dir[]).forEach((d) => {
      if (activeRef.current[d]) onPress(d, 'up');
    });
    activeRef.current = { up: false, down: false, left: false, right: false };
    setThumbPos({ x: 0, y: 0 });
    pointerIdRef.current = null;
  }

  if (!visible) return null;

  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-around',
      padding: '12px 16px 0', gap: 20, flexWrap: 'wrap',
    }}>
      {/* Base du joystick */}
      <div
        ref={baseRef}
        style={{
          position: 'relative',
          width: SIZE, height: SIZE, borderRadius: '50%',
          background: 'radial-gradient(circle at 50% 50%, color-mix(in oklab, var(--accent) 14%, var(--surface)), var(--surface) 70%)',
          border: '2px solid color-mix(in oklab, var(--accent) 45%, var(--line))',
          touchAction: 'none',
          userSelect: 'none', WebkitUserSelect: 'none',
          WebkitTapHighlightColor: 'transparent',
        }}
        onPointerDown={(e) => {
          if (pointerIdRef.current !== null) return;
          pointerIdRef.current = e.pointerId;
          e.currentTarget.setPointerCapture(e.pointerId);
          updateFromPointer(e);
        }}
        onPointerMove={(e) => {
          if (e.pointerId !== pointerIdRef.current) return;
          updateFromPointer(e);
        }}
        onPointerUp={(e) => {
          if (e.pointerId !== pointerIdRef.current) return;
          releaseAll();
        }}
        onPointerCancel={(e) => {
          if (e.pointerId !== pointerIdRef.current) return;
          releaseAll();
        }}
        onLostPointerCapture={() => releaseAll()}
      >
        {/* Thumb (cercle interne qui suit le doigt) */}
        <div style={{
          position: 'absolute', top: '50%', left: '50%',
          width: THUMB, height: THUMB, borderRadius: '50%',
          background: 'color-mix(in oklab, var(--accent) 35%, var(--surface))',
          border: '2px solid var(--accent)',
          transform: `translate(calc(-50% + ${thumbPos.x}px), calc(-50% + ${thumbPos.y}px))`,
          transition: pointerIdRef.current === null ? 'transform 0.18s ease-out' : 'none',
          pointerEvents: 'none',
        }} />
      </div>

      {/* Boost optionnel */}
      {onBoost && (
        <button
          type="button"
          style={{
            width: 76, height: 76, borderRadius: '50%',
            background: 'color-mix(in oklab, #FFD700 32%, var(--surface))',
            border: '2px solid #FFD700',
            color: 'var(--text)',
            fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 22,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            userSelect: 'none', WebkitUserSelect: 'none', touchAction: 'none',
            WebkitTapHighlightColor: 'transparent',
          }}
          onPointerDown={(e) => {
            e.preventDefault();
            if (!boostPressedRef.current) { boostPressedRef.current = true; onBoost('down'); }
          }}
          onPointerUp={() => { if (boostPressedRef.current) { boostPressedRef.current = false; onBoost('up'); } }}
          onPointerCancel={() => { if (boostPressedRef.current) { boostPressedRef.current = false; onBoost('up'); } }}
          onPointerLeave={() => { if (boostPressedRef.current) { boostPressedRef.current = false; onBoost('up'); } }}
        >
          {boostLabel}
        </button>
      )}
    </div>
  );
}
