import { describe, expect, it } from 'bun:test';

import { buildE2eHeaders } from '../e2e-config';

describe('E2E request headers', () => {
  it('prefers the release-only token override', () => {
    expect(
      buildE2eHeaders({
        E2E_INTERNAL_SERVICE_TOKEN: 'release-token',
        INTERNAL_SERVICE_TOKEN: 'worker-token',
      }),
    ).toEqual({
      'Content-Type': 'application/json',
      'x-internal-token': 'release-token',
    });
  });

  it('keeps the trusted development token as an explicit final fallback', () => {
    expect(buildE2eHeaders({})).toEqual({
      'Content-Type': 'application/json',
      'x-internal-token': 'local-internal-token',
    });
  });
});
