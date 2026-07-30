import { Fragment, type ReactNode } from 'react';

import { useAuthStore } from '@/store/authStore';

/**
 * Remounts authenticated application state when the active identity scope changes.
 * Query keys read the same store scope, so mounted observers cannot retain data
 * from a previous user or organization while waiting for an incidental render.
 */
export function AuthScopeBoundary({ children }: { children: ReactNode }) {
  const organizationId = useAuthStore((state) => state.organizationId);
  const userId = useAuthStore((state) => state.userId);
  const provider = useAuthStore((state) => state.provider);
  const scopeKey = `${provider}:${userId ?? '__no-user__'}:${organizationId || '__no-org__'}`;

  return <Fragment key={scopeKey}>{children}</Fragment>;
}
