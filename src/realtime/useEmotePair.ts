import { useEffect, useRef, useState } from 'react';
import { api } from '../api/client';
import { emoteEmitter, type EmoteEvent } from './emoteEvents';

// Hook commun aux mini-jeux 1v1 : gère 2 slots d'emote (le mien + l'adversaire)
// + l'envoi via /matches/:id/emote en mode remote. En local, on n'envoie rien
// mais on permet quand même au "P1" et "P2" de poster une emote chacun.
//
// Le retour `triggerMine` / `triggerOpponent` est le seul handle dont le jeu
// a besoin — il met à jour la clé qui fera popper la EmoteBubble. Un nonce
// interne s'assure que cliquer 2 fois sur la même clé re-joue l'animation.

export interface EmotePairHook {
  myKey: string | null;
  opponentKey: string | null;
  /** Le joueur courant déclenche un emote (clic dans EmotePicker). */
  triggerMine: (key: string) => void;
  /** Pour les modes local-2p : le 2e joueur peut aussi poster une emote. */
  triggerOpponentLocal?: (key: string) => void;
}

export function useEmotePair(opts: {
  matchId?: string | null;
  /** 'local' | 'host' | 'guest' — mêmes valeurs que GameProps.mode. */
  mode?: 'local' | 'host' | 'guest';
}): EmotePairHook {
  const { matchId, mode } = opts;
  const [myKey, setMyKey] = useState<string | null>(null);
  const [opponentKey, setOpponentKey] = useState<string | null>(null);
  // Nonce versionne le state — sans ça, re-cliquer la même clé ne ré-affiche
  // pas la bulle (React voit le state identique → pas de re-render).
  const myNonceRef = useRef(0);
  const oppNonceRef = useRef(0);

  // Réception via SSE
  useEffect(() => {
    if (!matchId || mode === 'local') return;
    const off = emoteEmitter.on((e: EmoteEvent) => {
      if (e.matchId !== matchId) return;
      oppNonceRef.current += 1;
      // Suffixe la clé avec le nonce pour qu'un même emote consécutif rejoue
      setOpponentKey(`${e.key}#${oppNonceRef.current}`);
    });
    return off;
  }, [matchId, mode]);

  const triggerMine = (key: string) => {
    myNonceRef.current += 1;
    setMyKey(`${key}#${myNonceRef.current}`);
    if (matchId && (mode === 'host' || mode === 'guest')) {
      api.sendEmote(matchId, key).catch(() => { /* silent : un emote raté n'est pas critique */ });
    }
  };

  const triggerOpponentLocal = mode === 'local' ? (key: string) => {
    oppNonceRef.current += 1;
    setOpponentKey(`${key}#${oppNonceRef.current}`);
  } : undefined;

  return { myKey, opponentKey, triggerMine, triggerOpponentLocal };
}

// La EmoteBubble attend une clé d'emote (pas une clé suffixée par #nonce).
// Petit helper pour décoder.
export function stripNonce(keyWithNonce: string | null): string | null {
  if (!keyWithNonce) return null;
  const i = keyWithNonce.indexOf('#');
  return i < 0 ? keyWithNonce : keyWithNonce.slice(0, i);
}
