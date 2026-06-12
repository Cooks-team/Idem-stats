import { useEffect, useState } from 'react';

// Hook simple — true si la viewport fait moins que `breakpoint` (768 par
// défaut). On utilise window.matchMedia plutôt que innerWidth direct pour
// que ça re-render automatiquement à la rotation/resize sans listener
// manuel sur 'resize' (matchMedia.change est notifié plus tôt et au bon
// moment, sans throttling à faire).
//
// Utilisation typique côté jeu :
//   const isMobile = useIsMobile();
//   ...
//   {isMobile && <TouchOverlay onUp={...} onDown={...} />}
//
// Le SSR/static export ne s'applique pas ici (Vite SPA), mais on garde un
// fallback `false` si jamais window n'existe pas pour ne pas planter.
export function useIsMobile(breakpoint: number = 768): boolean {
  const get = () => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia(`(max-width: ${breakpoint - 1}px)`).matches;
  };
  const [isMobile, setIsMobile] = useState<boolean>(get);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mql = window.matchMedia(`(max-width: ${breakpoint - 1}px)`);
    const onChange = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    // Safari < 14 expose addListener, browsers modernes addEventListener.
    if (mql.addEventListener) mql.addEventListener('change', onChange);
    else mql.addListener(onChange);
    return () => {
      if (mql.removeEventListener) mql.removeEventListener('change', onChange);
      else mql.removeListener(onChange);
    };
  }, [breakpoint]);

  return isMobile;
}
