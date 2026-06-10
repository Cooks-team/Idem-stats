// Émetteur global d'events de jeu temps réel (match.play.*).
// useEvents reçoit les SSE et émet ici les événements de play (input + state).
// Les composants de jeu s'abonnent via useRemoteGameSync.
//
// Pourquoi un émetteur global plutôt que React Context :
//  - Les events arrivent à très haute fréquence (jusqu'à 30/sec en state)
//  - Un Context provoquerait un re-render de tout l'arbre à chaque event
//  - Avec un émetteur, seul le subscriber concerné est notifié

export type PlayEventType = 'input' | 'state';

export interface PlayEvent {
  type: PlayEventType;
  matchId: string;
  payload: unknown;
}

type Listener = (e: PlayEvent) => void;

class PlayEmitter {
  private listeners = new Set<Listener>();
  on(l: Listener) {
    this.listeners.add(l);
    return () => { this.listeners.delete(l); };
  }
  emit(e: PlayEvent) {
    for (const l of this.listeners) {
      try { l(e); } catch { /* listener pété → on ignore et on continue */ }
    }
  }
}

export const playEmitter = new PlayEmitter();
