import { ForbiddenException } from '@nestjs/common';

import type { AuthContext } from '../../auth/types';

/**
 * Extracts the organization ID from an auth context without throwing.
 * Returns `null` when no organization context is available.
 */
export function resolveOrganizationId(auth?: AuthContext | null): string | null {
  return auth?.organizationId ?? null;
}

/**
 * Extracts the organization ID from an auth context, throwing if absent.
 * Use at service boundaries where an organization scope is mandatory.
 *
 * @throws {ForbiddenException} when `auth.organizationId` is missing
 */
export function requireOrganizationId(auth?: AuthContext | null): string {
  const organizationId = resolveOrganizationId(auth);
  if (!organizationId) {
    throw new ForbiddenException('Organization context is required');
  }
  return organizationId;
}
