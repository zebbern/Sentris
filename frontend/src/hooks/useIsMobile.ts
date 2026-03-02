import { useState, useEffect } from 'react';

export function useIsMobile(breakpoint = 768) {
  const query = `(max-width: ${breakpoint - 1}px)`;

  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia(query).matches : false,
  );

  useEffect(() => {
    const mql = window.matchMedia(query);
    setIsMobile(mql.matches);

    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, [query]);

  return isMobile;
}

/**
 * Returns true when the viewport is in tablet range (768px–1023px).
 * Tablet gets a collapsed (icon-only) sidebar by default with hover-to-expand.
 */
export function useIsTablet() {
  const [isTablet, setIsTablet] = useState(() =>
    typeof window !== 'undefined'
      ? window.matchMedia('(min-width: 768px) and (max-width: 1023px)').matches
      : false,
  );

  useEffect(() => {
    const minMql = window.matchMedia('(min-width: 768px)');
    const maxMql = window.matchMedia('(max-width: 1023px)');

    const update = () => setIsTablet(minMql.matches && maxMql.matches);
    update();

    minMql.addEventListener('change', update);
    maxMql.addEventListener('change', update);
    return () => {
      minMql.removeEventListener('change', update);
      maxMql.removeEventListener('change', update);
    };
  }, []);

  return isTablet;
}
