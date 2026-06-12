import type { BlackjackRoom } from '../api/types';

// Petit emitter pour pousser le state d'une room blackjack depuis l'écoute
// SSE (useEvents) vers le composant BlackjackPage. Évite de passer par
// TanStack Query (le snapshot vient en push, pas pull).
type Listener = (room: BlackjackRoom) => void;

class BlackjackEmitter {
  private listeners = new Set<Listener>();
  on(fn: Listener) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit(room: BlackjackRoom) { this.listeners.forEach((fn) => fn(room)); }
}

export const blackjackEmitter = new BlackjackEmitter();
