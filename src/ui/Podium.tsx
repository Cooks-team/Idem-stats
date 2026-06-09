import type { LeaderboardEntry } from '../api/types';
import { Avatar } from './Avatar';
import { Icon } from './Icon';
import { absoluteAvatar } from '../api/client';

// Podium qui rend 1, 2 ou 3 entrées (au lieu de tout cacher quand < 3 joueurs).
// Ordre visuel quand 3 entrées : [2, 1, 3] (le 1er au centre, plus haut).
// 2 entrées : [1, 2]. 1 entrée : juste le gagnant.
const HEIGHTS_3 = [120, 170, 96];
const HEIGHTS_2 = [170, 110];
const HEIGHTS_1 = [170];
const TINTS = ['var(--gold)', 'var(--silver)', 'var(--bronze)'];

export function Podium({ top3, onPlayerClick }: {
  top3: LeaderboardEntry[];
  onPlayerClick?: (pseudo: string) => void;
}) {
  if (top3.length === 0) {
    return <div style={{ color: 'var(--muted)', textAlign: 'center', padding: 20 }}>Pas encore de joueur classé.</div>;
  }

  let order: LeaderboardEntry[];
  let ranks: number[];
  let heights: number[];
  let tints: string[];

  if (top3.length >= 3) {
    order = [top3[1], top3[0], top3[2]];
    ranks = [2, 1, 3];
    heights = HEIGHTS_3;
    tints = [TINTS[1], TINTS[0], TINTS[2]];
  } else if (top3.length === 2) {
    order = [top3[0], top3[1]];
    ranks = [1, 2];
    heights = HEIGHTS_2;
    tints = [TINTS[0], TINTS[1]];
  } else {
    order = [top3[0]];
    ranks = [1];
    heights = HEIGHTS_1;
    tints = [TINTS[0]];
  }

  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 18, justifyContent: 'center', marginTop: 18 }}>
      {order.map((entry, i) => {
        const r = ranks[i];
        const tint = tints[i];
        const isWinner = r === 1;
        return (
          <div
            key={entry.user.id}
            onClick={() => onPlayerClick?.(entry.user.pseudo)}
            style={{ flex: 1, maxWidth: 220, display: 'flex', flexDirection: 'column', alignItems: 'center', cursor: onPlayerClick ? 'pointer' : 'default' }}
          >
            <div style={{ position: 'relative', marginBottom: 10 }}>
              {isWinner ? <Icon name="crown" size={28} color="var(--gold)" stroke={2.4} /> : <div style={{ height: 28 }} />}
              <Avatar seed={entry.user.pseudo} size={isWinner ? 84 : 70} ring ringColor={tint} imageUrl={absoluteAvatar(entry.user.avatarUrl)} />
            </div>
            <div style={{ fontWeight: 700, fontSize: 16, color: 'var(--text)' }}>{entry.user.pseudo}</div>
            <div className="tabular" style={{
              fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 22, color: tint,
            }}>
              {entry.wins} <span style={{ fontSize: 13, color: 'var(--muted)' }}>V</span>
            </div>
            <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>
              {Math.round(entry.winrate * 100)}% winrate
            </div>

            <div style={{
              width: '100%', height: heights[i], marginTop: 12,
              borderTopLeftRadius: 14, borderTopRightRadius: 14,
              background: `linear-gradient(180deg, color-mix(in srgb, ${tint} 22%, var(--surface)), var(--surface))`,
              border: '1px solid var(--line)', borderBottom: 'none',
              display: 'flex', justifyContent: 'center', paddingTop: 14,
            }}>
              <span style={{
                fontFamily: 'var(--font-display)', fontWeight: 700,
                fontSize: isWinner ? 44 : 34, color: tint,
              }}>{r}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
