// Emotes pour le kart racing — bullies, taunt, fun, branchés à l'identité
// visuelle de l'app (accent vert néon sur fond sombre). Affichage : sprite
// canvas au-dessus du kart, pop-in + secousse + fade.

export interface EmoteDef {
  key: string;        // identifiant stable
  emoji: string;      // glyphe principal
  label: string;      // texte affiché en dessous (court)
  bg: string;         // fond du bullet (CSS color)
  fg: string;         // couleur du texte
  shake: 'gentle' | 'mad' | 'flex' | 'cry' | 'spin';
}

// 8 emotes, accessibles via touches 1-8.
export const EMOTES: EmoteDef[] = [
  { key: 'rage',   emoji: '🤬', label: 'RAGE',       bg: '#c0392b', fg: '#ffffff', shake: 'mad' },
  { key: 'clown',  emoji: '🤡', label: 'CLOWN',      bg: '#ff5b9c', fg: '#ffffff', shake: 'spin' },
  { key: 'goat',   emoji: '🐐', label: 'GOAT',       bg: '#FFD23B', fg: '#1a1a1a', shake: 'flex' },
  { key: 'l',      emoji: '🅛',  label: 'PRENDS UN L', bg: '#1a1a1a', fg: '#3DD68C', shake: 'gentle' },
  { key: 'caca',   emoji: '💩', label: 'CACA',       bg: '#8B4513', fg: '#ffffff', shake: 'gentle' },
  { key: 'cry',    emoji: '😭', label: 'PLEURE',     bg: '#3498db', fg: '#ffffff', shake: 'cry' },
  { key: 'fire',   emoji: '🔥', label: 'EN FEU',     bg: '#FF6B57', fg: '#FFD23B', shake: 'mad' },
  { key: 'crown',  emoji: '👑', label: 'KING',       bg: '#3DD68C', fg: '#0d1f15', shake: 'flex' },
];

export function emoteByKey(key: string): EmoteDef | undefined {
  return EMOTES.find((e) => e.key === key);
}

// Génère la texture canvas pour un emote — appelée à la demande, mémoïsée
// pour ne pas recréer 60 fois par seconde.
const TEXTURE_CACHE = new Map<string, HTMLCanvasElement>();
export function emoteCanvasFor(e: EmoteDef): HTMLCanvasElement {
  const cached = TEXTURE_CACHE.get(e.key);
  if (cached) return cached;
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const ctx = c.getContext('2d')!;
  // Fond bullet arrondi
  ctx.fillStyle = e.bg;
  roundRect(ctx, 16, 16, 224, 224, 36);
  ctx.fill();
  // Halo intérieur
  ctx.strokeStyle = e.fg;
  ctx.lineWidth = 4;
  roundRect(ctx, 22, 22, 212, 212, 32);
  ctx.stroke();
  // Emoji centré (gros)
  ctx.font = '140px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(e.emoji, 128, 128);
  // Label en bas
  ctx.font = 'bold 28px "Inter",sans-serif';
  ctx.fillStyle = e.fg;
  ctx.fillText(e.label, 128, 215);
  TEXTURE_CACHE.set(e.key, c);
  return c;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y,     x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x,     y + h, r);
  ctx.arcTo(x,     y + h, x,     y,     r);
  ctx.arcTo(x,     y,     x + w, y,     r);
  ctx.closePath();
}
