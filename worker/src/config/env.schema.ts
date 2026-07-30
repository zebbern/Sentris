import { z } from 'zod';
import {
  databaseUrlSchema,
  temporalConfigSchema,
  minioConfigSchema,
  secretStoreKeySchema,
  kafkaBrokersSchema,
  resolveSentrisTrustProfile,
} from '@sentris/shared';

export const workerEnvSchema = z
  .object({
    // --- Required ---
    DATABASE_URL: databaseUrlSchema,
    SECRET_STORE_MASTER_KEY: secretStoreKeySchema,
    LOG_KAFKA_BROKERS: kafkaBrokersSchema,

    // --- With defaults ---
    BACKEND_URL: z.string().optional().default('http://localhost:3211'),
    SENTRIS_PUBLIC_API_BASE_URL: z.url().optional(),
    NODE_ENV: z.string().optional().default('development'),
    SENTRIS_TRUST_PROFILE: z.string().optional(),

    // Same-worker loopback stdio discovery is an explicit trusted-local capability.
    MCP_DISCOVERY_TRUSTED_LOCAL_STDIO: z.enum(['true', 'false']).optional().default('false'),

    // --- Optional Kafka client IDs ---
    EVENT_KAFKA_CLIENT_ID: z.string().optional().default('sentris-worker-events'),
    AGENT_TRACE_KAFKA_CLIENT_ID: z.string().optional().default('sentris-worker-agent-trace'),
    NODE_IO_KAFKA_CLIENT_ID: z.string().optional().default('sentris-worker-node-io'),
    LOG_KAFKA_CLIENT_ID: z.string().optional().default('sentris-worker'),

    // --- Terminal Redis ---
    TERMINAL_REDIS_URL: z.string().optional(),
    TERMINAL_REDIS_MAXLEN: z.coerce.number().optional().default(5000),
    TERMINAL_REDIS_COMMAND_TIMEOUT_MS: z.coerce
      .number()
      .int()
      .positive()
      .optional()
      .default(10_000),

    // --- Worker PostgreSQL liveness ---
    WORKER_DATABASE_CONNECTION_TIMEOUT_MS: z.coerce
      .number()
      .int()
      .positive()
      .optional()
      .default(10_000),
    WORKER_DATABASE_QUERY_TIMEOUT_MS: z.coerce.number().int().positive().optional().default(30_000),

    // --- Loki ---
    LOKI_URL: z.string().optional(),
    LOKI_TENANT_ID: z.string().optional().default(''),
    LOKI_USERNAME: z.string().optional().default(''),
    LOKI_PASSWORD: z.string().optional().default(''),

    // --- OpenSearch ---
    OPENSEARCH_URL: z.string().optional(),
    OPENSEARCH_USERNAME: z.string().optional(),
    OPENSEARCH_PASSWORD: z.string().optional(),
    OPENSEARCH_DASHBOARDS_URL: z.string().optional().default(''),

    // --- Health server ---
    WORKER_HEALTH_PORT: z.coerce.number().optional(),
    MCP_DOCKER_PROXY_PORT: z.coerce.number().int().nonnegative().optional().default(9101),
    MCP_DOCKER_PROXY_PUBLIC_BASE_URL: z.url().optional(),
    MCP_DOCKER_PROXY_TOKEN: z.preprocess(
      (value) => (value === '' ? undefined : value),
      z.string().min(16).optional(),
    ),
    SENTRIS_DIND_HOST: z.string().optional().default('dind'),

    // --- Docker resource reconciliation ---
    SENTRIS_DOCKER_SHARED_IO_ROOT: z.string().optional(),
    WORKER_ORPHAN_MIN_AGE_MS: z.coerce.number().int().nonnegative().optional().default(3_600_000),
    WORKER_ORPHAN_INTERVAL_MS: z.coerce.number().int().positive().optional().default(900_000),
    WORKER_ORPHAN_MAX_RESOURCES: z.coerce.number().int().positive().optional().default(100),
    WORKER_ORPHAN_MAX_INVENTORY: z.coerce.number().int().positive().optional().default(500),
    WORKER_ORPHAN_DOCKER_TIMEOUT_MS: z.coerce.number().int().positive().optional().default(10_000),
    WORKER_ORPHAN_RUN_STATE_TIMEOUT_MS: z.coerce
      .number()
      .int()
      .positive()
      .optional()
      .default(3_000),

    // --- AI provider keys (all optional) ---
    OPENAI_API_KEY: z.string().optional(),
    ANTHROPIC_API_KEY: z.string().optional(),
  })
  .merge(temporalConfigSchema)
  .merge(minioConfigSchema)
  .superRefine((data, ctx) => {
    let trustProfile: ReturnType<typeof resolveSentrisTrustProfile> | undefined;
    try {
      trustProfile = resolveSentrisTrustProfile(data);
    } catch (error: unknown) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['SENTRIS_TRUST_PROFILE'],
        message: error instanceof Error ? error.message : String(error),
      });
    }

    if (trustProfile === 'hardened' && data.MCP_DISCOVERY_TRUSTED_LOCAL_STDIO === 'true') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['MCP_DISCOVERY_TRUSTED_LOCAL_STDIO'],
        message:
          'MCP_DISCOVERY_TRUSTED_LOCAL_STDIO cannot be enabled when SENTRIS_TRUST_PROFILE=hardened',
      });
    }

    if (data.NODE_ENV === 'production' && !data.SENTRIS_PUBLIC_API_BASE_URL) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['SENTRIS_PUBLIC_API_BASE_URL'],
        message:
          'SENTRIS_PUBLIC_API_BASE_URL is required in production and must be reachable by human-input recipients',
      });
    }
    if (data.NODE_ENV === 'production' && !data.MCP_DOCKER_PROXY_PUBLIC_BASE_URL) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['MCP_DOCKER_PROXY_PUBLIC_BASE_URL'],
        message:
          'MCP_DOCKER_PROXY_PUBLIC_BASE_URL is required in production and must be reachable from the backend app network',
      });
    }
  })
  .transform((data) => ({
    ...data,
    SENTRIS_TRUST_PROFILE: resolveSentrisTrustProfile(data),
  }));

export type WorkerEnvConfig = z.infer<typeof workerEnvSchema>;
