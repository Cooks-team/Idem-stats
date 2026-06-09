// Sous-ensemble des icônes du design (lucide-like), inline SVG pour éviter une dep.

type IconName =
  | 'trophy' | 'grid' | 'pulse' | 'user' | 'plus' | 'bolt'
  | 'chevron' | 'back' | 'close' | 'check' | 'copy' | 'crown';

interface Props { name: IconName; size?: number; color?: string; stroke?: number }

export function Icon({ name, size = 22, color = 'currentColor', stroke = 2 }: Props) {
  const c = { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: color, strokeWidth: stroke, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  switch (name) {
    case 'trophy':
      return (<svg {...c}><path d="M7 4h10v4a5 5 0 01-10 0V4z"/><path d="M7 5H4v1a3 3 0 003 3M17 5h3v1a3 3 0 01-3 3"/><path d="M12 13v3M9 20h6M10 20l.5-4h3l.5 4"/></svg>);
    case 'grid':
      return (<svg {...c}><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>);
    case 'pulse':
      return (<svg {...c}><path d="M3 12h4l2.5-6 4 14 2.5-8H21"/></svg>);
    case 'user':
      return (<svg {...c}><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.5-6 8-6s8 2 8 6"/></svg>);
    case 'plus':
      return (<svg {...c}><path d="M12 5v14M5 12h14"/></svg>);
    case 'bolt':
      return (<svg {...c}><path d="M13 3L5 13h5l-1 8 8-10h-5l1-8z"/></svg>);
    case 'chevron':
      return (<svg {...c}><path d="M9 5l7 7-7 7"/></svg>);
    case 'back':
      return (<svg {...c}><path d="M15 5l-7 7 7 7"/></svg>);
    case 'close':
      return (<svg {...c}><path d="M6 6l12 12M18 6L6 18"/></svg>);
    case 'check':
      return (<svg {...c}><path d="M5 12l5 5L20 6"/></svg>);
    case 'copy':
      return (<svg {...c}><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 012-2h10"/></svg>);
    case 'crown':
      return (<svg {...c}><path d="M4 8l3.5 3L12 5l4.5 6L20 8l-1.5 10h-13L4 8z"/></svg>);
  }
}
