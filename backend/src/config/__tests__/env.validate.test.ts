import { describe, it, expect } from 'bun:test';
import { backendEnvSchema } from '../env.schema';

/** Minimal valid backend env config */
function validEnv(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
    SECRET_STORE_MASTER_KEY: 'a'.repeat(32),
    LOG_KAFKA_BROKERS: 'localhost:9092',
    ...overrides,
  };
}

describe('backendEnvSchema', () => {
  it('accepts a valid full config', () => {
    const result = backendEnvSchema.safeParse(validEnv());
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.FINDINGS_RECONCILIATION_SCHEDULE_ENABLED).toBe(true);
    }
  });

  it('accepts an explicit automatic findings reconciliation pause without disabling direct calls', () => {
    const result = backendEnvSchema.safeParse(
      validEnv({ FINDINGS_RECONCILIATION_SCHEDULE_ENABLED: 'false' }),
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.FINDINGS_RECONCILIATION_SCHEDULE_ENABLED).toBe(false);
    }
  });

  it('fails when DATABASE_URL is missing (normal mode)', () => {
    const { DATABASE_URL, ...rest } = validEnv();
    const result = backendEnvSchema.safeParse(rest);
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path.join('.'));
      expect(paths).toContain('DATABASE_URL');
    }
  });

  it('passes when SKIP_INGEST_SERVICES=true without DATABASE_URL and LOG_KAFKA_BROKERS', () => {
    const result = backendEnvSchema.safeParse({
      SECRET_STORE_MASTER_KEY: 'a'.repeat(32),
      SKIP_INGEST_SERVICES: 'true',
    });
    expect(result.success).toBe(true);
  });

  it('still requires DATABASE_URL when ENABLE_INGEST_SERVICES=false', () => {
    const result = backendEnvSchema.safeParse({
      SECRET_STORE_MASTER_KEY: 'a'.repeat(32),
      ENABLE_INGEST_SERVICES: 'false',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((issue) => issue.path.join('.'))).toContain('DATABASE_URL');
    }
  });

  it('allows ENABLE_INGEST_SERVICES=false without Kafka brokers when PostgreSQL is configured', () => {
    const result = backendEnvSchema.safeParse({
      DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
      SECRET_STORE_MASTER_KEY: 'a'.repeat(32),
      ENABLE_INGEST_SERVICES: 'false',
    });

    expect(result.success).toBe(true);
  });

  it('fails when AUTH_PROVIDER=clerk without CLERK keys', () => {
    const result = backendEnvSchema.safeParse(validEnv({ AUTH_PROVIDER: 'clerk' }));
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path.join('.'));
      expect(paths).toContain('CLERK_SECRET_KEY');
      expect(paths).toContain('CLERK_PUBLISHABLE_KEY');
    }
  });

  it('passes when AUTH_PROVIDER=clerk with both CLERK keys', () => {
    const result = backendEnvSchema.safeParse(
      validEnv({
        AUTH_PROVIDER: 'clerk',
        CLERK_SECRET_KEY: 'sk_test_xxx',
        CLERK_PUBLISHABLE_KEY: 'pk_test_xxx',
      }),
    );
    expect(result.success).toBe(true);
  });

  it('normalizes " LOCAL " to "local"', () => {
    const result = backendEnvSchema.safeParse(validEnv({ AUTH_PROVIDER: ' LOCAL ' }));
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.AUTH_PROVIDER).toBe('local');
    }
  });

  it('falls back unknown AUTH_PROVIDER to "local"', () => {
    const result = backendEnvSchema.safeParse(validEnv({ AUTH_PROVIDER: 'weird' }));
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.AUTH_PROVIDER).toBe('local');
    }
  });

  it('normalizes "Clerk" to "clerk"', () => {
    const result = backendEnvSchema.safeParse(
      validEnv({
        AUTH_PROVIDER: 'Clerk',
        CLERK_SECRET_KEY: 'sk_test_xxx',
        CLERK_PUBLISHABLE_KEY: 'pk_test_xxx',
      }),
    );
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.AUTH_PROVIDER).toBe('clerk');
    }
  });

  it('coerces PORT string to number', () => {
    const result = backendEnvSchema.safeParse(validEnv({ PORT: '3211' }));
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.PORT).toBe(3211);
    }
  });

  it('defaults PORT to 3211', () => {
    const result = backendEnvSchema.safeParse(validEnv());
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.PORT).toBe(3211);
    }
  });

  it('defaults production to hardened and development to trusted-local', () => {
    const development = backendEnvSchema.safeParse(validEnv({ NODE_ENV: 'development' }));
    const production = backendEnvSchema.safeParse(
      validEnv({
        NODE_ENV: 'production',
        AUTH_PROVIDER: 'clerk',
        CLERK_SECRET_KEY: 'sk_test_xxx',
        CLERK_PUBLISHABLE_KEY: 'pk_test_xxx',
      }),
    );

    expect(development.success).toBe(true);
    expect(production.success).toBe(true);
    if (development.success && production.success) {
      expect(development.data.SENTRIS_TRUST_PROFILE).toBe('trusted-local');
      expect(production.data.SENTRIS_TRUST_PROFILE).toBe('hardened');
    }
  });

  it('requires external organization auth for the hardened profile', () => {
    const result = backendEnvSchema.safeParse(
      validEnv({
        SENTRIS_TRUST_PROFILE: 'hardened',
        AUTH_PROVIDER: 'local',
      }),
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((issue) => issue.path.join('.'))).toContain('AUTH_PROVIDER');
    }
  });

  it('allows blank unused local credentials in a hardened Clerk deployment', () => {
    const result = backendEnvSchema.safeParse(
      validEnv({
        NODE_ENV: 'production',
        SENTRIS_TRUST_PROFILE: 'hardened',
        AUTH_PROVIDER: 'clerk',
        CLERK_SECRET_KEY: 'sk_test_xxx',
        CLERK_PUBLISHABLE_KEY: 'pk_test_xxx',
        ADMIN_USERNAME: '',
        ADMIN_PASSWORD: '',
      }),
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.ADMIN_USERNAME).toBeUndefined();
      expect(result.data.ADMIN_PASSWORD).toBeUndefined();
    }
  });

  it('allows an explicit trusted-local production profile', () => {
    const result = backendEnvSchema.safeParse(
      validEnv({
        NODE_ENV: 'production',
        SENTRIS_TRUST_PROFILE: 'trusted-local',
        AUTH_PROVIDER: 'local',
        ADMIN_USERNAME: 'sentris-admin',
        ADMIN_PASSWORD: 'explicit-local-password',
      }),
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.SENTRIS_TRUST_PROFILE).toBe('trusted-local');
    }
  });

  it('requires explicit local admin credentials in production', () => {
    const result = backendEnvSchema.safeParse(
      validEnv({
        NODE_ENV: 'production',
        SENTRIS_TRUST_PROFILE: 'trusted-local',
        AUTH_PROVIDER: 'local',
      }),
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((issue) => issue.path.join('.'))).toEqual(
        expect.arrayContaining(['ADMIN_USERNAME', 'ADMIN_PASSWORD']),
      );
    }
  });

  it('retains local credential defaults for development', () => {
    const result = backendEnvSchema.safeParse(
      validEnv({
        NODE_ENV: 'development',
        SENTRIS_TRUST_PROFILE: 'trusted-local',
        AUTH_PROVIDER: 'local',
      }),
    );

    expect(result.success).toBe(true);
  });

  it('accepts and preserves a complete Jira OAuth configuration', () => {
    const result = backendEnvSchema.safeParse(
      validEnv({
        JIRA_CLIENT_ID: 'jira-client-id',
        JIRA_CLIENT_SECRET: 'jira-client-secret',
        JIRA_CALLBACK_URL: 'https://sentris.example.com/settings/ticketing/callback',
      }),
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toMatchObject({
        JIRA_CLIENT_ID: 'jira-client-id',
        JIRA_CLIENT_SECRET: 'jira-client-secret',
        JIRA_CALLBACK_URL: 'https://sentris.example.com/settings/ticketing/callback',
      });
    }
  });

  it('requires all Jira OAuth settings when any one is configured', () => {
    const result = backendEnvSchema.safeParse(
      validEnv({
        JIRA_CLIENT_ID: 'jira-client-id',
      }),
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((issue) => issue.path.join('.'))).toEqual(
        expect.arrayContaining(['JIRA_CLIENT_SECRET', 'JIRA_CALLBACK_URL']),
      );
    }
  });

  it('rejects an invalid Jira callback URL', () => {
    const result = backendEnvSchema.safeParse(
      validEnv({
        JIRA_CLIENT_ID: 'jira-client-id',
        JIRA_CLIENT_SECRET: 'jira-client-secret',
        JIRA_CALLBACK_URL: 'not-a-url',
      }),
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((issue) => issue.path.join('.'))).toContain(
        'JIRA_CALLBACK_URL',
      );
    }
  });

  it('treats blank Jira OAuth settings as unconfigured', () => {
    const result = backendEnvSchema.safeParse(
      validEnv({
        JIRA_CLIENT_ID: '',
        JIRA_CLIENT_SECRET: '  ',
        JIRA_CALLBACK_URL: '',
      }),
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.JIRA_CLIENT_ID).toBeUndefined();
      expect(result.data.JIRA_CLIENT_SECRET).toBeUndefined();
      expect(result.data.JIRA_CALLBACK_URL).toBeUndefined();
    }
  });

  it('rejects an unknown trust profile', () => {
    const result = backendEnvSchema.safeParse(validEnv({ SENTRIS_TRUST_PROFILE: 'permissive' }));

    expect(result.success).toBe(false);
  });
});
