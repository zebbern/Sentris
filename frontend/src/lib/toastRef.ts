import type { ToastContextValue, ToastOptions } from '@/components/ui/toast-context';
import { logger } from '@/lib/logger';

/**
 * Module-level toast bridge.
 *
 * The `ToastProvider` registers its `toast` function into `toastRef.current`
 * on mount, enabling non-React code (e.g. TanStack Query's MutationCache
 * `onError`) to show toast notifications without access to React context.
 */
export const toastRef: { current: ToastContextValue['toast'] | null } = {
  current: null,
};

/** Show a toast via the bridge. Falls back to console.warn if the provider hasn't mounted yet. */
export function showToast(options: ToastOptions): void {
  if (toastRef.current) {
    toastRef.current(options);
  } else {
    logger.warn('[toastRef] Toast provider not mounted — could not show toast:', options.title);
  }
}
