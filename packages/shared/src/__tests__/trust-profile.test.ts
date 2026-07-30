import { describe, expect, it } from 'bun:test';

import { resolveSentrisTrustProfile } from '../trust-profile.js';

describe('resolveSentrisTrustProfile', () => {
  it('honors an explicit supported profile', () => {
    expect(
      resolveSentrisTrustProfile({
        SENTRIS_TRUST_PROFILE: 'trusted-local',
        NODE_ENV: 'production',
      }),
    ).toBe('trusted-local');
    expect(
      resolveSentrisTrustProfile({
        SENTRIS_TRUST_PROFILE: 'hardened',
        NODE_ENV: 'development',
      }),
    ).toBe('hardened');
  });

  it('defaults production to hardened and non-production to trusted-local', () => {
    expect(resolveSentrisTrustProfile({ NODE_ENV: 'production' })).toBe('hardened');
    expect(resolveSentrisTrustProfile({ NODE_ENV: 'development' })).toBe('trusted-local');
    expect(resolveSentrisTrustProfile({ NODE_ENV: 'test' })).toBe('trusted-local');
  });

  it('rejects unknown profiles instead of silently widening authority', () => {
    expect(() =>
      resolveSentrisTrustProfile({
        SENTRIS_TRUST_PROFILE: 'permissive',
        NODE_ENV: 'production',
      }),
    ).toThrow('Unsupported SENTRIS_TRUST_PROFILE');
  });
});
