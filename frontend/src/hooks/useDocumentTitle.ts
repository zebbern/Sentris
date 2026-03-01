import { useEffect } from 'react';

const DEFAULT_TITLE = 'Sentris Flow';

/**
 * Sets `document.title` to `"${title} | Sentris Flow"` while the component
 * is mounted and resets to `"Sentris Flow"` on unmount.
 */
export function useDocumentTitle(title: string): void {
  useEffect(() => {
    document.title = title ? `${title} | ${DEFAULT_TITLE}` : DEFAULT_TITLE;

    return () => {
      document.title = DEFAULT_TITLE;
    };
  }, [title]);
}
