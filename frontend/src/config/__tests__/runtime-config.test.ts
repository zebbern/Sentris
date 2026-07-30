import { describe, expect, it } from 'bun:test';
import { frontendEnvSchema } from '../env.schema';
import {
  mergeFrontendEnv,
  resolveApiBaseUrl,
  resolveApiUrl,
  selectPublicRuntimeConfig,
  serializeRuntimeConfig,
} from '../runtime-config';

describe('frontend runtime config', () => {
  it('gives an explicitly supplied runtime value precedence over the built bundle', () => {
    const merged = mergeFrontendEnv(
      {
        VITE_API_URL: 'https://build.example',
        VITE_AUTH_PROVIDER: 'local',
        VITE_CLERK_PUBLISHABLE_KEY: 'pk_build_stale',
        VITE_GIT_SHA: 'built-sha',
      },
      {
        VITE_API_URL: 'https://runtime.example',
        VITE_AUTH_PROVIDER: 'clerk',
        VITE_CLERK_PUBLISHABLE_KEY: 'pk_runtime',
      },
    );

    expect(merged).toMatchObject({
      VITE_API_URL: 'https://runtime.example',
      VITE_AUTH_PROVIDER: 'clerk',
      VITE_CLERK_PUBLISHABLE_KEY: 'pk_runtime',
      VITE_GIT_SHA: 'built-sha',
    });
  });

  it('uses the browser origin when no API URL is configured', () => {
    expect(resolveApiBaseUrl('', 'https://sentris.example')).toBe('https://sentris.example');
    expect(resolveApiBaseUrl(undefined, 'https://sentris.example/')).toBe(
      'https://sentris.example',
    );
  });

  it('routes API paths through the configured API origin with a same-origin fallback', () => {
    expect(
      resolveApiUrl('/api/v1/auth/login', 'https://api.example:4443/', 'https://app.example'),
    ).toBe('https://api.example:4443/api/v1/auth/login');
    expect(resolveApiUrl('api/v1/auth/logout', '', 'https://app.example/')).toBe(
      'https://app.example/api/v1/auth/logout',
    );
  });

  it('fails closed when runtime config selects Clerk but clears the required key', () => {
    const merged = mergeFrontendEnv(
      {
        VITE_AUTH_PROVIDER: 'local',
        VITE_CLERK_PUBLISHABLE_KEY: 'pk_build_stale',
      },
      {
        VITE_AUTH_PROVIDER: 'clerk',
        VITE_CLERK_PUBLISHABLE_KEY: '',
      },
    );

    const result = frontendEnvSchema.safeParse(merged);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((issue) => issue.path.join('.'))).toContain(
        'VITE_CLERK_PUBLISHABLE_KEY',
      );
    }
  });

  it('exports only the explicit public allowlist', () => {
    const selected = selectPublicRuntimeConfig({
      VITE_API_URL: 'https://api.example',
      VITE_CLERK_PUBLISHABLE_KEY: 'pk_public',
      VITE_UNREVIEWED_VALUE: 'must-not-leak',
      CLERK_SECRET_KEY: 'sk_secret',
      SESSION_SECRET: 'session-secret',
    });

    expect(selected).toEqual({
      VITE_API_URL: 'https://api.example',
      VITE_CLERK_PUBLISHABLE_KEY: 'pk_public',
    });
  });

  it('JSON-encodes script-breaking characters without changing their value', () => {
    const dangerousName = '</script><script>alert("runtime config")</script>\u2028\u2029';
    const script = serializeRuntimeConfig({ VITE_APP_NAME: dangerousName });

    expect(script).not.toContain('</script>');
    expect(script).not.toContain('\u2028');
    expect(script).not.toContain('\u2029');
    expect(script).toContain('\\u003c');

    const encodedObject = script
      .replace('globalThis.__SENTRIS_RUNTIME_CONFIG__ = Object.freeze(', '')
      .replace(');\n', '');
    expect(JSON.parse(encodedObject)).toEqual({ VITE_APP_NAME: dangerousName });
  });
});
