import { useMemo } from 'react';

/**
 * Returns `true` when the user is on macOS, `false` otherwise.
 *
 * The result is memoized because the platform never changes at runtime.
 */
export function useIsMac(): boolean {
  return useMemo(() => {
    if (typeof navigator === 'undefined') return false;

    // navigator.platform is deprecated but still widely supported and accurate.
    // Fall back to navigator.userAgent for newer browsers that may remove platform.
    const platform = navigator.userAgentData?.platform ?? navigator.platform ?? '';

    if (/mac/i.test(platform)) return true;

    return /macintosh|mac os x/i.test(navigator.userAgent);
  }, []);
}
