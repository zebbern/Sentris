import { describe, it, expect } from 'bun:test';
import { workerEnvSchema } from '../env.schema';

/** Minimal valid worker env config */
function validEnv(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
    SECRET_STORE_MASTER_KEY: 'a'.repeat(32),
    LOG_KAFKA_BROKERS: 'localhost:9092',
    SENTRIS_PUBLIC_API_BASE_URL: 'https://sentris.example',
    MCP_DOCKER_PROXY_PUBLIC_BASE_URL: 'http://worker:9101',
    ...overrides,
  };
}

describe('workerEnvSchema', () => {
  it('accepts a valid config', () => {
    const result = workerEnvSchema.safeParse(validEnv());
    expect(result.success).toBe(true);
  });

  it('fails when DATABASE_URL is missing', () => {
    const { DATABASE_URL, ...rest } = validEnv();
    const result = workerEnvSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it('fails when SECRET_STORE_MASTER_KEY is missing', () => {
    const { SECRET_STORE_MASTER_KEY, ...rest } = validEnv();
    const result = workerEnvSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it('fails when LOG_KAFKA_BROKERS is missing', () => {
    const { LOG_KAFKA_BROKERS, ...rest } = validEnv();
    const result = workerEnvSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it('defaults MINIO_ENDPOINT to localhost', () => {
    const result = workerEnvSchema.safeParse(validEnv());
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.MINIO_ENDPOINT).toBe('localhost');
    }
  });

  it('defaults BACKEND_URL to http://localhost:3211', () => {
    const result = workerEnvSchema.safeParse(validEnv());
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.BACKEND_URL).toBe('http://localhost:3211');
    }
  });

  it('defaults orphan reconciliation to bounded production-safe values', () => {
    const result = workerEnvSchema.safeParse(validEnv());
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.WORKER_ORPHAN_MIN_AGE_MS).toBe(60 * 60 * 1_000);
      expect(result.data.WORKER_ORPHAN_INTERVAL_MS).toBe(15 * 60 * 1_000);
      expect(result.data.WORKER_ORPHAN_MAX_RESOURCES).toBe(100);
      expect(result.data.WORKER_ORPHAN_MAX_INVENTORY).toBe(500);
      expect(result.data.WORKER_ORPHAN_DOCKER_TIMEOUT_MS).toBe(10_000);
      expect(result.data.WORKER_ORPHAN_RUN_STATE_TIMEOUT_MS).toBe(3_000);
      expect(result.data.MCP_DOCKER_PROXY_PORT).toBe(9101);
    }
  });

  it('defaults the MCP runtime lease timings without requiring runtime ownership', () => {
    const result = workerEnvSchema.safeParse(validEnv());

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.MCP_RUNTIME_REDIS_COMMAND_TIMEOUT_MS).toBe(5_000);
      expect(result.data.MCP_RUNTIME_STARTING_TTL_MS).toBe(180_000);
      expect(result.data.MCP_RUNTIME_LEASE_TTL_MS).toBe(60_000);
      expect(result.data.MCP_RUNTIME_RENEWAL_INTERVAL_MS).toBe(15_000);
      expect(result.data.MCP_RUNTIME_REDIS_URL).toBeUndefined();
      expect(result.data.MCP_RUNTIME_OWNER_ID).toBeUndefined();
      expect(result.data.MCP_RUNTIME_OWNER_URL).toBeUndefined();
    }
  });

  it('accepts dedicated Redis and direct HTTP endpoints for the MCP runtime', () => {
    const result = workerEnvSchema.safeParse(
      validEnv({
        MCP_RUNTIME_REDIS_URL: 'rediss://redis.internal:6380/2',
        MCP_RUNTIME_OWNER_ID: 'worker-instance-7',
        MCP_RUNTIME_OWNER_URL: 'https://worker-7.internal:9301',
        INTERNAL_SERVICE_TOKEN: 'internal-service-token',
      }),
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.MCP_RUNTIME_REDIS_URL).toBe('rediss://redis.internal:6380/2');
      expect(result.data.MCP_RUNTIME_OWNER_ID).toBe('worker-instance-7');
      expect(result.data.MCP_RUNTIME_OWNER_URL).toBe('https://worker-7.internal:9301');
    }
  });

  it('rejects non-Redis runtime storage URLs and invalid owner URLs', () => {
    expect(
      workerEnvSchema.safeParse(validEnv({ MCP_RUNTIME_REDIS_URL: 'https://redis.internal:6379' }))
        .success,
    ).toBe(false);
    expect(
      workerEnvSchema.safeParse(
        validEnv({ MCP_RUNTIME_OWNER_URL: 'redis://worker-7.internal:9301' }),
      ).success,
    ).toBe(false);
    expect(
      workerEnvSchema.safeParse(
        validEnv({ MCP_RUNTIME_OWNER_URL: 'https://user:secret@worker-7.internal:9301' }),
      ).success,
    ).toBe(false);
    expect(
      workerEnvSchema.safeParse(
        validEnv({ MCP_RUNTIME_OWNER_URL: 'https://worker-7.internal:9301/runtime?token=x' }),
      ).success,
    ).toBe(false);
  });

  it('rejects MCP runtime timings outside their operational bounds', () => {
    expect(
      workerEnvSchema.safeParse(validEnv({ MCP_RUNTIME_REDIS_COMMAND_TIMEOUT_MS: '60001' }))
        .success,
    ).toBe(false);
    expect(
      workerEnvSchema.safeParse(validEnv({ MCP_RUNTIME_STARTING_TTL_MS: '86400001' })).success,
    ).toBe(false);
    expect(workerEnvSchema.safeParse(validEnv({ MCP_RUNTIME_LEASE_TTL_MS: '0' })).success).toBe(
      false,
    );
    expect(
      workerEnvSchema.safeParse(validEnv({ MCP_RUNTIME_RENEWAL_INTERVAL_MS: '-1' })).success,
    ).toBe(false);
  });

  it('requires three renewal intervals to fit within the ready lease TTL', () => {
    expect(
      workerEnvSchema.safeParse(
        validEnv({
          MCP_RUNTIME_LEASE_TTL_MS: '60000',
          MCP_RUNTIME_RENEWAL_INTERVAL_MS: '20000',
        }),
      ).success,
    ).toBe(true);
    expect(
      workerEnvSchema.safeParse(
        validEnv({
          MCP_RUNTIME_LEASE_TTL_MS: '60000',
          MCP_RUNTIME_RENEWAL_INTERVAL_MS: '20001',
        }),
      ).success,
    ).toBe(false);
  });

  it('requires the starting lease to outlive the complete startup budget and Redis margin', () => {
    expect(
      workerEnvSchema.safeParse(
        validEnv({
          MCP_RUNTIME_CONNECT_TIMEOUT_MS: '30000',
          MCP_RUNTIME_DISCOVERY_TOTAL_TIMEOUT_MS: '120000',
          MCP_RUNTIME_REDIS_COMMAND_TIMEOUT_MS: '5000',
          MCP_RUNTIME_STARTING_TTL_MS: '154999',
        }),
      ).success,
    ).toBe(false);
    expect(
      workerEnvSchema.safeParse(
        validEnv({
          MCP_RUNTIME_CONNECT_TIMEOUT_MS: '30000',
          MCP_RUNTIME_DISCOVERY_TOTAL_TIMEOUT_MS: '120000',
          MCP_RUNTIME_REDIS_COMMAND_TIMEOUT_MS: '5000',
          MCP_RUNTIME_STARTING_TTL_MS: '155000',
        }),
      ).success,
    ).toBe(true);
  });

  it('keeps the reconciliation bound within the Docker driver inventory ceiling', () => {
    expect(
      workerEnvSchema.safeParse(validEnv({ MCP_RUNTIME_RECONCILE_MAX_RESOURCES: '1024' })).success,
    ).toBe(true);
    expect(
      workerEnvSchema.safeParse(validEnv({ MCP_RUNTIME_RECONCILE_MAX_RESOURCES: '1025' })).success,
    ).toBe(false);
  });

  it('rejects a runtime budget that cannot finish within saved-discovery activity ownership', () => {
    expect(
      workerEnvSchema.safeParse(
        validEnv({
          MCP_RUNTIME_CONNECT_TIMEOUT_MS: '900000',
          MCP_RUNTIME_DISCOVERY_TOTAL_TIMEOUT_MS: '800000',
          MCP_RUNTIME_STARTING_TTL_MS: '1710000',
          MCP_RUNTIME_DRAIN_TIMEOUT_MS: '100000',
        }),
      ).success,
    ).toBe(false);
    expect(
      workerEnvSchema.safeParse(
        validEnv({
          MCP_RUNTIME_CONNECT_TIMEOUT_MS: '800000',
          MCP_RUNTIME_DISCOVERY_TOTAL_TIMEOUT_MS: '800000',
          MCP_RUNTIME_STARTING_TTL_MS: '1610000',
          MCP_RUNTIME_DRAIN_TIMEOUT_MS: '100000',
        }),
      ).success,
    ).toBe(true);
  });

  it('rejects zero or negative orphan reconciliation bounds', () => {
    expect(
      workerEnvSchema.safeParse(
        validEnv({
          WORKER_ORPHAN_INTERVAL_MS: '0',
        }),
      ).success,
    ).toBe(false);
    expect(
      workerEnvSchema.safeParse(
        validEnv({
          WORKER_ORPHAN_MAX_RESOURCES: '-1',
        }),
      ).success,
    ).toBe(false);
    expect(
      workerEnvSchema.safeParse(
        validEnv({
          WORKER_ORPHAN_RUN_STATE_TIMEOUT_MS: '0',
        }),
      ).success,
    ).toBe(false);
  });

  it('keeps same-worker loopback stdio discovery disabled unless explicitly enabled', () => {
    const result = workerEnvSchema.safeParse(validEnv());
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.MCP_DISCOVERY_TRUSTED_LOCAL_STDIO).toBe('false');
    }
  });

  it('accepts explicit trusted-local stdio discovery opt-in', () => {
    const result = workerEnvSchema.safeParse(
      validEnv({ MCP_DISCOVERY_TRUSTED_LOCAL_STDIO: 'true' }),
    );
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.MCP_DISCOVERY_TRUSTED_LOCAL_STDIO).toBe('true');
    }
  });

  it('rejects invalid trusted-local stdio discovery values', () => {
    const result = workerEnvSchema.safeParse(
      validEnv({ MCP_DISCOVERY_TRUSTED_LOCAL_STDIO: 'yes' }),
    );
    expect(result.success).toBe(false);
  });

  it('parses LOG_KAFKA_BROKERS into array', () => {
    const result = workerEnvSchema.safeParse(validEnv({ LOG_KAFKA_BROKERS: 'a:9092,b:9092' }));
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.LOG_KAFKA_BROKERS).toEqual(['a:9092', 'b:9092']);
    }
  });

  it('defaults production to hardened and development to trusted-local', () => {
    const development = workerEnvSchema.safeParse(validEnv({ NODE_ENV: 'development' }));
    const production = workerEnvSchema.safeParse(validEnv({ NODE_ENV: 'production' }));

    expect(development.success).toBe(true);
    expect(production.success).toBe(true);
    if (development.success && production.success) {
      expect(development.data.SENTRIS_TRUST_PROFILE).toBe('trusted-local');
      expect(production.data.SENTRIS_TRUST_PROFILE).toBe('hardened');
    }
  });

  it('treats a blank optional Docker MCP proxy token as generated-at-startup', () => {
    const result = workerEnvSchema.safeParse(
      validEnv({
        MCP_DOCKER_PROXY_TOKEN: '',
      }),
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.MCP_DOCKER_PROXY_TOKEN).toBeUndefined();
    }
  });

  it('requires a browser-reachable public API origin in production', () => {
    const env = validEnv({ NODE_ENV: 'production' });
    delete env.SENTRIS_PUBLIC_API_BASE_URL;

    const result = workerEnvSchema.safeParse(env);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toContainEqual(
        expect.objectContaining({
          path: ['SENTRIS_PUBLIC_API_BASE_URL'],
        }),
      );
    }
  });

  it('requires a backend-reachable worker MCP proxy origin in production', () => {
    const env = validEnv({ NODE_ENV: 'production' });
    delete env.MCP_DOCKER_PROXY_PUBLIC_BASE_URL;

    const result = workerEnvSchema.safeParse(env);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toContainEqual(
        expect.objectContaining({
          path: ['MCP_DOCKER_PROXY_PUBLIC_BASE_URL'],
        }),
      );
    }
  });

  it('rejects same-worker stdio discovery in the hardened profile', () => {
    const result = workerEnvSchema.safeParse(
      validEnv({
        SENTRIS_TRUST_PROFILE: 'hardened',
        MCP_DISCOVERY_TRUSTED_LOCAL_STDIO: 'true',
      }),
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((issue) => issue.path.join('.'))).toContain(
        'MCP_DISCOVERY_TRUSTED_LOCAL_STDIO',
      );
    }
  });

  it('allows same-worker stdio discovery in an explicit trusted-local profile', () => {
    const result = workerEnvSchema.safeParse(
      validEnv({
        NODE_ENV: 'production',
        SENTRIS_TRUST_PROFILE: 'trusted-local',
        MCP_DISCOVERY_TRUSTED_LOCAL_STDIO: 'true',
      }),
    );

    expect(result.success).toBe(true);
  });

  it('rejects an unknown trust profile', () => {
    const result = workerEnvSchema.safeParse(validEnv({ SENTRIS_TRUST_PROFILE: 'permissive' }));

    expect(result.success).toBe(false);
  });
});
