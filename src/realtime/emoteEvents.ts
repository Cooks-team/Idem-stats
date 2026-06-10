// Emetteur d'events emote temps réel. Recevoir un emote d'un adversaire
// est un signal léger (1 message → 1 affichage), ça ne mérite pas une
// query TanStack ; on passe par un mini event bus comme playEvents.

export interface EmoteEvent {
  matchId: string;
  from: string;   // userId de celui qui a déclenché
  key: string;    // clé de l'emote (cf. lib/emotes.EMOTES)
}

type Listener = (e: EmoteEvent) => void;

class EmoteEmitter {
  private listeners = new Set<Listener>();
  on(l: Listener) {
    this.listeners.add(l);
    return () => { this.listeners.delete(l); };
  }
  emit(e: EmoteEvent) {
    for (const l of this.listeners) {
      try { l(e); } catch { /* listener cassé → on ignore */ }
    }
  }
}

export const emoteEmitter = new EmoteEmitter();
