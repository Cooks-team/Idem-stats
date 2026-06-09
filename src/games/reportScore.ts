// Hook commun appelé par TOUS les mini-jeux à la fin de la partie :
// PATCH le score (source="web") puis termine. Comme demandé dans la spec.
import { api } from '../api/client';
import type { Match } from '../api/types';

export async function reportScore(matchId: string, scoreP1: number, scoreP2: number): Promise<Match> {
  await api.patchScore(matchId, scoreP1, scoreP2, 'web');
  return api.finishMatch(matchId);
}
