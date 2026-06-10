import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { API_BASE_URL, readPersistedToken } from '../api/client';

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

    const named = ['friend.request', 'friend.accepted', 'match.invite', 'match.update', 'shifumi.challenge', 'shifumi.resolved'];
    const listeners = named.map((t) => {
      const fn = (e: MessageEvent) => handle(t, tryParse(e.data));
      es.addEventListener(t, fn as EventListener);
      return [t, fn] as const;
    });

    return () => {
      es.removeEventListener('message', onMessage);
      listeners.forEach(([t, fn]) => es.removeEventListener(t, fn as EventListener));
      es.close();
    };
  }, [enabled, qc]);
}

function tryParse(s: unknown): unknown {
  if (typeof s !== 'string') return s;
  try { return JSON.parse(s); } catch { return s; }
}
