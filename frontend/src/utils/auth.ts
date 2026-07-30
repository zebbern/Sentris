/**
 * Normalize a role name by removing common prefixes (ORG:, ORG_, etc.)
 */
export function normalizeRole(role: string): string {
  let normalized = role.toUpperCase();
  // Remove "ORG:" prefix if present
  if (normalized.startsWith('ORG:')) {
    normalized = normalized.substring(4);
  }
  // Remove "ORG_" prefix if present
  if (normalized.startsWith('ORG_')) {
    normalized = normalized.substring(4);
  }
  return normalized;
}

export type SupportedRole = 'ADMIN' | 'MEMBER';

export function toSupportedRole(role: string | null | undefined): SupportedRole | null {
  if (!role) {
    return null;
  }

  const normalized = normalizeRole(role);
  return normalized === 'ADMIN' || normalized === 'MEMBER' ? normalized : null;
}

/**
 * Check if a user has admin role
 */
export function hasAdminRole(roles: string[]): boolean {
  return roles.some((role) => normalizeRole(role) === 'ADMIN');
}
