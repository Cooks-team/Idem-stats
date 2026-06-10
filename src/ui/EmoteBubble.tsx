import { useEffect, useState } from 'react';
import { emoteByKey } from '../lib/emotes';
import { stripNonce } from '../realtime/useEmotePair';

// Bulle d'emote affichée à côté du pseudo d'un joueur dans n'importe quel jeu.
// Réagit aux changements de `emoteKey` : à chaque nouvelle clé reçue, la
// bulle remonte (key prop) → l'animation CSS re-joue + un timer interne
// efface la bulle après le TTL.
//
// Utilisable en overlay DOM par-dessus un canvas (les jeux 2D) ou à côté
// d'un nom dans un HUD React (les jeux full-React).

const TTL_MS = 2500;

export function EmoteBubble({ emoteKey, side = 'right' }: {
  emoteKey: string | null | undefined;
  // De quel côté du pseudo on s'attache. side='right' → la bulle est à
  // droite du nom et part vers la droite ; 'left' → symétrique.
  side?: 'left' | 'right';
}) {
  // Tick interne : chaque nouvelle clé crée une "instance" qu'on auto-clear
  // après TTL_MS. Permet à un emote envoyé deux fois de suite (même clé) de
  // bien se rejouer.
  const [active, setActive] = useState<{ key: string; nonce: number } | null>(null);
  useEffect(() => {
    if (!emoteKey) return;
    const clean = stripNonce(emoteKey);
    if (!clean) return;
    setActive((prev) => ({ key: clean, nonce: (prev?.nonce ?? 0) + 1 }));
    const t = window.setTimeout(() => setActive(null), TTL_MS);
    return () => clearTimeout(t);
  }, [emoteKey]);

  if (!active) return null;
  const def = emoteByKey(active.key);
  if (!def) return null;

  const anim = shakeToAnim(def.shake);

  return (
    <span
      key={active.nonce}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 4,
        verticalAlign: 'middle',
        marginLeft: side === 'right' ? 6 : 0,
        marginRight: side === 'left' ? 6 : 0,
        padding: '2px 8px', borderRadius: 12,
        background: def.bg, color: def.fg,
        fontSize: 16, fontWeight: 800, lineHeight: 1.1,
        boxShadow: '0 3px 10px rgba(0,0,0,0.45)',
        animation: `idemEmoteBubble 2.5s cubic-bezier(0.16, 1, 0.3, 1) both, ${anim}`,
        transformOrigin: side === 'right' ? 'left center' : 'right center',
      }}
    >
      <span style={{ fontSize: 18, lineHeight: 1 }}>{def.emoji}</span>
      <span style={{ fontSize: 10, letterSpacing: 0.5, textTransform: 'uppercase' }}>{def.label}</span>
      <style>{`
        @keyframes idemEmoteBubble {
          0%   { transform: scale(0.2) translateY(6px); opacity: 0; }
          12%  { transform: scale(1.25) translateY(-4px); opacity: 1; }
          22%  { transform: scale(1.0)  translateY(0);    opacity: 1; }
          82%  { transform: scale(1.0)  translateY(0);    opacity: 1; }
          100% { transform: scale(0.6)  translateY(-12px); opacity: 0; }
        }
        @keyframes idemEmoteMad     { 0%,100% { transform: rotate(-3deg); } 50% { transform: rotate(3deg); } }
        @keyframes idemEmoteFlex    { 0%,100% { transform: scale(1); }    50% { transform: scale(1.06); } }
        @keyframes idemEmoteSpin    { 0% { transform: rotate(0); } 100% { transform: rotate(360deg); } }
        @keyframes idemEmoteBounce  { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-3px); } }
        @keyframes idemEmotePulse   { 0%,100% { transform: scale(1); } 50% { transform: scale(1.1); } }
        @keyframes idemEmoteCry     { 0%,100% { transform: translateY(0); } 50% { transform: translateY(2px); } }
      `}</style>
    </span>
  );
}

function shakeToAnim(shake: string): string {
  switch (shake) {
    case 'mad':    return 'idemEmoteMad    .35s ease-in-out 0.25s 4';
    case 'flex':   return 'idemEmoteFlex   .55s ease-in-out 0.25s 3';
    case 'spin':   return 'idemEmoteSpin   1.0s linear      0.25s 2';
    case 'bounce': return 'idemEmoteBounce .42s ease-in-out 0.25s 4';
    case 'pulse':  return 'idemEmotePulse  .55s ease-in-out 0.25s 3';
    case 'cry':    return 'idemEmoteCry    .50s ease-in-out 0.25s 4';
    default:       return 'idemEmoteFlex   .60s ease-in-out 0.25s 2';
  }
}
