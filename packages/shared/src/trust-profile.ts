export const SENTRIS_TRUST_PROFILES = ['trusted-local', 'hardened'] as const;

export type SentrisTrustProfile = (typeof SENTRIS_TRUST_PROFILES)[number];

export interface SentrisTrustProfileEnvironment {
  SENTRIS_TRUST_PROFILE?: unknown;
  NODE_ENV?: unknown;
}

export function resolveSentrisTrustProfile(
  environment: SentrisTrustProfileEnvironment,
): SentrisTrustProfile {
  const explicit =
    typeof environment.SENTRIS_TRUST_PROFILE === 'string'
      ? environment.SENTRIS_TRUST_PROFILE.trim().toLowerCase()
      : '';

  if (explicit) {
    if (explicit === 'trusted-local' || explicit === 'hardened') {
      return explicit;
    }
    throw new Error(
      `Unsupported SENTRIS_TRUST_PROFILE "${String(environment.SENTRIS_TRUST_PROFILE)}"`,
    );
  }

  return environment.NODE_ENV === 'production' ? 'hardened' : 'trusted-local';
}
