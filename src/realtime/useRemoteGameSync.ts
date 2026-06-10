import { useEffect, useRef } from 'react';
import { api } from '../api/client';
import { playEmitter, type PlayEvent } from './playEvents';

// Sync temps réel pour les jeux remote, modèle host-authoritative :
//   - HOST  : runs simulation, broadcast state à 30Hz, écoute les inputs du guest
//   - GUEST : envoie ses inputs au host, écoute le state pour rendre
//
// L'envoi POST a une latence (HTTP + SSE) ~50-150ms aller simple. Acceptable
// pour les jeux casual entre potes. À comparer avec WebSocket : c'est moins
// performant mais 0 nouvelle dépendance, infra SSE déjà en place.

export type SyncRole = 'host' | 'guest' | 'local';

export interface UseRemoteGameSyncOpts<TInput, TState> {
  /** id du match en cours. null désactive le sync (mode local). */
  matchId: string | null;
  /** Role du joueur courant : host (player1), guest (player2), ou local. */
  role: SyncRole;
  /** [host] Appelé quand le guest envoie un input. Pas appelé en guest. */
  onInput?: (input: TInput) => void;
  /** [guest] Appelé quand le host envoie un state. Pas appelé en host. */
  onState?: (state: TState) => void;
}

export function useRemoteGameSync<TInput, TState>(opts: UseRemoteGameSyncOpts<TInput, TState>) {
  const { matchId, role, onInput, onState } = opts;

  // On garde les derniers callbacks dans des refs pour ne pas re-subscribe à chaque render
  const onInputRef = useRef(onInput);
  const onStateRef = useRef(onState);
  onInputRef.current = onInput;
  onStateRef.current = onState;

  // Subscribe à l'émetteur global. Filtre sur matchId + type selon le rôle.
  useEffect(() => {
    if (!matchId || role === 'local') return;
    const off = playEmitter.on((e: PlayEvent) => {
      if (e.matchId !== matchId) return;
      if (role === 'host' && e.type === 'input') {
        try { onInputRef.current?.(e.payload as TInput); } catch { /* ignore */ }
      } else if (role === 'guest' && e.type === 'state') {
        try { onStateRef.current?.(e.payload as TState); } catch { /* ignore */ }
      }
    });
    return off;
  }, [matchId, role]);

  // Send helpers — silencieux en local (matchId=null).
  // On no-op les promesses rejected pour ne pas spammer la console quand le
  // réseau hoquette ; la prochaine émission corrige naturellement.
  const sendInput = (payload: TInput) => {
    if (!matchId || role !== 'guest') return;
    api.sendPlayInput(matchId, payload).catch(() => {});
  };
  const sendState = (payload: TState) => {
    if (!matchId || role !== 'host') return;
    api.sendPlayState(matchId, payload).catch(() => {});
  };

  return { sendInput, sendState };
}
