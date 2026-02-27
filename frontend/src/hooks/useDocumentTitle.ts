import { useEffect } from 'react';

const DEFAULT_TITLE = 'ShipSec Studio';

/**
 * Sets `document.title` to `"${title} | ShipSec Studio"` while the component
 * is mounted and resets to `"ShipSec Studio"` on unmount.
 */
export function useDocumentTitle(title: string): void {
  useEffect(() => {
    document.title = title ? `${title} | ${DEFAULT_TITLE}` : DEFAULT_TITLE;

    return () => {
      document.title = DEFAULT_TITLE;
    };
  }, [title]);
}
