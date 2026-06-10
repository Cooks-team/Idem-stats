import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { API_BASE_URL, readPersistedToken } from '../api/client';
import { playEmitter } from './playEvents';
import { emoteEmitter } from './emoteEvents';

// EventSource sur /events?token=<JWT>. Reconnexion auto en cas de coupure
// (gérée nativement par EventSource via le header "retry"). Sur chaque event
// reçu, on invalide les queries impactées pour que TanStack Query refetch.
export function useEvents(enabled: boolean) {
  const qc = useQueryClient();

  useEffect(() => {
    if (!enabled) return;
    const token = readPersistedToken();
    if (!token) return;

    const url = `${API_BASE_URL}/events?token=${encodeURIComponent(token)}`;
    const es = new EventSource(url);

    // Tous les events impliquent un changement visible côté UI → on invalide
    // les queries qui s'y rapportent. TanStack Query refetch automatiquement.
    const handle = (type: string, data: unknown) => {
      // eslint-disable-next-line no-console
      if (typeof window !== 'undefined' && (window as { __idem_debug?: boolean }).__idem_debug) console.log('[sse]', type, data);
      qc.invalidateQueries({ queryKey: ['inbox'] });
      if (type.startsWith('friend.')) {
        qc.invalidateQueries({ queryKey: ['friends'] });
      }
      if (type.startsWith('message.')) {
        qc.invalidateQueries({ queryKey: ['conversations'] });
        qc.invalidateQueries({ queryKey: ['messages'] });
      }
      if (type.startsWith('match.') || type.startsWith('shifumi.')) {
        qc.invalidateQueries({ queryKey: ['matches'] });
        qc.invalidateQueries({ queryKey: ['history'] });
        qc.invalidateQueries({ queryKey: ['leaderboard'] });
        qc.invalidateQueries({ queryKey: ['badges'] });
        // Si le payload contient un match avec id, on met aussi à jour son cache détail
        const id = (data as { id?: string } | null)?.id;
        if (id) qc.invalidateQueries({ queryKey: ['match', id] });
      }
    };

    const onMessage = (e: MessageEvent) => handle('message', tryParse(e.data));
    es.addEventListener('message', onMessage);

    const named = ['friend.request', 'friend.accepted', 'match.invite', 'match.update', 'shifumi.challenge', 'message.new', 'shifumi.resolved'];
    const listeners = named.map((t) => {
      const fn = (e: MessageEvent) => handle(t, tryParse(e.data));
      es.addEventListener(t, fn as EventListener);
      return [t, fn] as const;
    });

    // Events temps réel des jeux remote (input du guest / state du host).
    // Ne pas passer par TanStack Query — on push directement à l'émetteur
    // global utilisé par useRemoteGameSync.
    const playInputFn = (ev: MessageEvent) => {
      const data = tryParse(ev.data) as { matchId?: string; payload?: unknown } | null;
      if (data?.matchId) playEmitter.emit({ type: 'input', matchId: data.matchId, payload: data.payload });
    };
    const playStateFn = (ev: MessageEvent) => {
      const data = tryParse(ev.data) as { matchId?: string; payload?: unknown } | null;
      if (data?.matchId) playEmitter.emit({ type: 'state', matchId: data.matchId, payload: data.payload });
    };
    es.addEventListener('match.play.input', playInputFn as EventListener);
    es.addEventListener('match.play.state', playStateFn as EventListener);

    // Emote d'adversaire : relay simple via emoteEmitter — pas d'invalidation
    // TanStack à faire (l'affichage est local et éphémère).
    const emoteFn = (ev: MessageEvent) => {
      const data = tryParse(ev.data) as { matchId?: string; from?: string; key?: string } | null;
      if (data?.matchId && data.from && data.key) {
        emoteEmitter.emit({ matchId: data.matchId, from: data.from, key: data.key });
      }
    };
    es.addEventListener('match.emote', emoteFn as EventListener);

    return () => {
      es.removeEventListener('message', onMessage);
      listeners.forEach(([t, fn]) => es.removeEventListener(t, fn as EventListener));
      es.removeEventListener('match.play.input', playInputFn as EventListener);
      es.removeEventListener('match.play.state', playStateFn as EventListener);
      es.removeEventListener('match.emote', emoteFn as EventListener);
      es.close();
    };
  }, [enabled, qc]);
}

function tryParse(s: unknown): unknown {
  if (typeof s !== 'string') return s;
  try { return JSON.parse(s); } catch { return s; }
}
