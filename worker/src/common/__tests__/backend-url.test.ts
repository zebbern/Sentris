import { describe, expect, it } from 'bun:test';

describe('backend URL normalization', () => {
  it('uses BACKEND_URL when the legacy API aliases are absent', async () => {
    const backendUrl = await import('../backend-url').catch(() => undefined);

    expect(
      backendUrl?.buildBackendApiUrl('internal/runs', {
        BACKEND_URL: 'http://backend:3211/',
      }),
    ).toBe('http://backend:3211/api/v1/internal/runs');
  });

  it('normalizes already-versioned aliases without duplicating api/v1', async () => {
    const backendUrl = await import('../backend-url').catch(() => undefined);

    expect(
      backendUrl?.buildBackendApiUrl('/internal/mcp/cleanup', {
        SENTRIS_API_BASE_URL: 'http://backend:3211/api/v1/',
        API_BASE_URL: 'http://ignored:3211',
        BACKEND_URL: 'http://also-ignored:3211',
      }),
    ).toBe('http://backend:3211/api/v1/internal/mcp/cleanup');
  });

  it('returns an unversioned root URL for public URL consumers', async () => {
    const backendUrl = await import('../backend-url').catch(() => undefined);

    expect(
      backendUrl?.resolveBackendRootUrl({
        API_BASE_URL: 'http://backend:3211/api/v1/',
      }),
    ).toBe('http://backend:3211');
  });
});
