// Avatar = cercle gradient déterministe par pseudo + initiale en Display.
// Si imageUrl est fournie ET non vide, on affiche l'image à la place — le gradient
// sert de fallback pendant le chargement.

const PAL: Array<[string, string]> = [
  ['#D6FF3D', '#7BB800'],
  ['#5B8CFF', '#2E4FCC'],
  ['#FF6B57', '#C2331F'],
  ['#36E0B0', '#0E9C77'],
  ['#FFCB45', '#D98A00'],
  ['#C77BFF', '#7B2FD1'],
  ['#4FD2FF', '#0E84C2'],
  ['#FF8AC2', '#D13E8E'],
];

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export function avatarPair(seed: string): [string, string] {
  return PAL[hash(seed) % PAL.length];
}

interface Props {
  seed: string;
  size?: number;
  ring?: boolean;
  ringColor?: string;
  imageUrl?: string | null;
  onClick?: () => void;
}

export function Avatar({ seed, size = 44, ring = false, ringColor, imageUrl, onClick }: Props) {
  const [c1, c2] = avatarPair(seed);
  const initial = seed.charAt(0).toUpperCase() || '?';
  return (
    <div
      onClick={onClick}
      className={`avatar${ring ? ' ring' : ''}`}
      style={{
        width: size,
        height: size,
        fontSize: size * 0.46,
        background: `linear-gradient(150deg, ${c1}, ${c2})`,
        ...(ringColor ? ({ ['--ring-color' as never]: ringColor } as never) : {}),
        cursor: onClick ? 'pointer' : 'default',
        overflow: 'hidden',
        position: 'relative',
      }}
    >
      {imageUrl ? (
        <img
          src={imageUrl}
          alt=""
          style={{
            position: 'absolute', inset: 0,
            width: '100%', height: '100%',
            objectFit: 'cover',
            // l'image est par-dessus le gradient (qui sert de fallback pendant le chargement)
          }}
          onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
        />
      ) : (
        initial
      )}
    </div>
  );
}
