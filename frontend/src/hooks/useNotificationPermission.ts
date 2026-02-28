import { useState, useEffect, useCallback } from 'react';

type BrowserPermission = NotificationPermission | 'unsupported';

interface NotificationPermissionResult {
  /** Current browser notification permission state, or 'unsupported' if the API is unavailable. */
  permission: BrowserPermission;
  /** Request browser notification permission. Returns the resulting permission state. */
  requestPermission: () => Promise<BrowserPermission>;
  /** Whether the Notification API is available in this browser. */
  isSupported: boolean;
}

function getPermission(): BrowserPermission {
  if (typeof Notification === 'undefined') return 'unsupported';
  return Notification.permission;
}

/**
 * Hook that wraps the Browser Notification API permission lifecycle.
 *
 * - Returns live `permission` state (re-synced on `visibilitychange`)
 * - Provides a `requestPermission()` function for prompting the user
 * - Gracefully degrades to `'unsupported'` when the Notification API is unavailable
 */
export function useNotificationPermission(): NotificationPermissionResult {
  const [permission, setPermission] = useState<BrowserPermission>(getPermission);

  const isSupported = permission !== 'unsupported';

  // Re-sync permission when user returns to tab (they may have changed it in browser settings)
  useEffect(() => {
    if (!isSupported) return;

    const syncPermission = () => {
      setPermission(getPermission());
    };

    document.addEventListener('visibilitychange', syncPermission);
    return () => {
      document.removeEventListener('visibilitychange', syncPermission);
    };
  }, [isSupported]);

  const requestPermission = useCallback(async (): Promise<BrowserPermission> => {
    if (!isSupported) return 'unsupported';

    try {
      const result = await Notification.requestPermission();
      setPermission(result);
      return result;
    } catch {
      // Some older browsers throw on requestPermission
      const current = getPermission();
      setPermission(current);
      return current;
    }
  }, [isSupported]);

  return { permission, requestPermission, isSupported };
}
