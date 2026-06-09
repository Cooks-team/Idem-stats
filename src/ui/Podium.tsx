import type { LeaderboardEntry } from '../api/types';
import { Avatar } from './Avatar';
import { Icon } from './Icon';
import { absoluteAvatar } from '../api/client';

// Podium top 3 : ordre visuel [2, 1, 3], hauteurs 120/170/96, médailles or/argent/bronze.
// Comme la version mobile mais plus grand pour le desktop.
const HEIGHTS = [120, 170, 96];
const TINTS = ['var(--silver)', 'var(--gold)', 'var(--bronze)'];

export function Podium({ top3, onPlayerClick }: {
  top3: LeaderboardEntry[];
  onPlayerClick?: (pseudo: string) => void;
}) {
  if (top3.length < 3) return null;
  const order = [top3[1], top3[0], top3[2]];
  const ranks = [2, 1, 3];

  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 18, justifyContent: 'center', marginTop: 18 }}>
      {order.map((entry, i) => {
        const r = ranks[i];
        const tint = TINTS[i];
        return (
          <div
            key={entry.user.id}
            onClick={() => onPlayerClick?.(entry.user.pseudo)}
            style={{ flex: 1, maxWidth: 220, display: 'flex', flexDirection: 'column', alignItems: 'center', cursor: onPlayerClick ? 'pointer' : 'default' }}
          >
            <div style={{ position: 'relative', marginBottom: 10 }}>
              {r === 1 ? <Icon name="crown" size={28} color="var(--gold)" stroke={2.4} /> : <div style={{ height: 28 }} />}
              <Avatar seed={entry.user.pseudo} size={r === 1 ? 84 : 70} ring ringColor={tint} imageUrl={absoluteAvatar(entry.user.avatarUrl)} />
            </div>
            <div style={{ fontWeight: 700, fontSize: 16, color: 'var(--text)' }}>{entry.user.pseudo}</div>
            <div className="tabular" style={{
              fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 22, color: tint,
            }}>
              {entry.wins} <span style={{ fontSize: 13, color: 'var(--muted)' }}>V</span>
            </div>

            <div style={{
              width: '100%', height: HEIGHTS[i], marginTop: 12,
              borderTopLeftRadius: 14, borderTopRightRadius: 14,
              background: `linear-gradient(180deg, color-mix(in srgb, ${tint} 22%, var(--surface)), var(--surface))`,
              border: '1px solid var(--line)', borderBottom: 'none',
              display: 'flex', justifyContent: 'center', paddingTop: 14,
            }}>
              <span style={{
                fontFamily: 'var(--font-display)', fontWeight: 700,
                fontSize: r === 1 ? 44 : 34, color: tint,
              }}>{r}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
