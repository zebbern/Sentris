import { z } from 'zod';
import {
  databaseUrlSchema,
  temporalConfigSchema,
  secretStoreKeySchema,
  integrationStoreKeySchema,
  resolveSentrisTrustProfile,
  stringToBoolean,
} from '@sentris/shared';

/**
 * AUTH_PROVIDER: trims, lowercases, and defaults unknown values to 'local'.
 * Preserves the tolerant normalization from auth.config.ts.
 */
const authProviderSchema = z
  .string()
  .optional()
  .default('local')
  .transform((v) => v.trim().toLowerCase())
  .pipe(z.enum(['local', 'clerk']).catch('local'));

const blankStringToUndefined = (value: unknown): unknown =>
  typeof value === 'string' && value.trim() === '' ? undefined : value;

const optionalTrimmedString = z.preprocess(
  blankStringToUndefined,
  z.string().trim().min(1).optional(),
);

const optionalSecretString = z.preprocess(blankStringToUndefined, z.string().min(1).optional());

const optionalHttpUrl = z.preprocess(
  blankStringToUndefined,
  z
    .string()
    .trim()
    .url()
    .refine(
      (value) => {
        try {
          return ['http:', 'https:'].includes(new URL(value).protocol);
        } catch {
          return false;
        }
      },
      {
        message: 'URL must use http or https',
      },
    )
    .optional(),
);

export const backendEnvSchema = z
  .object({
    // --- Conditionally required (depend on ingest-services flags) ---
    DATABASE_URL: z.string().optional(),
    LOG_KAFKA_BROKERS: z.string().optional(),

    // --- Required ---
    SECRET_STORE_MASTER_KEY: secretStoreKeySchema,
    INTEGRATION_STORE_MASTER_KEY: integrationStoreKeySchema,

    // --- With defaults ---
    PORT: z.coerce.number().optional().default(3211),
    HOST: z.string().optional().default('0.0.0.0'),
    SKIP_INGEST_SERVICES: stringToBoolean(false),
    ENABLE_INGEST_SERVICES: stringToBoolean(true),
    TELEMETRY_KAFKA_REPLAY_RETENTION_DAYS: z.coerce.number().int().min(1).optional().default(7),
    TELEMETRY_KAFKA_RECEIPT_RETENTION_DAYS: z.coerce.number().int().min(8).optional().default(30),
    NOTIFICATION_DELIVERY_RETENTION_DAYS: z.coerce
      .number()
      .int()
      .min(1)
      .max(3650)
      .optional()
      .default(90),

    // --- Auth ---
    AUTH_PROVIDER: authProviderSchema,
    CLERK_SECRET_KEY: z.string().optional(),
    CLERK_PUBLISHABLE_KEY: z.string().optional(),
    AUTH_LOCAL_ALLOW_UNAUTHENTICATED: stringToBoolean(true),
    AUTH_LOCAL_API_KEY: z.string().optional().default(''),
    ADMIN_USERNAME: optionalTrimmedString,
    ADMIN_PASSWORD: optionalSecretString,

    // --- Optional services ---
    REDIS_URL: z.string().optional(),
    SESSION_SECRET: z.string().optional().default(''),
    WEBHOOK_BASE_URL: z.string().optional(),

    // --- OpenSearch ---
    OPENSEARCH_URL: z.string().optional(),
    OPENSEARCH_USERNAME: z.string().optional(),
    OPENSEARCH_PASSWORD: z.string().optional(),
    OPENSEARCH_DASHBOARDS_URL: z.string().optional().default(''),
    OPENSEARCH_TENANT_FETCH_TIMEOUT_MS: z.coerce
      .number()
      .int()
      .min(100)
      .max(10_000)
      .optional()
      .default(5_000),

    // --- Loki ---
    LOKI_URL: z.string().optional(),
    LOKI_TENANT_ID: z.string().optional().default(''),
    LOKI_USERNAME: z.string().optional().default(''),
    LOKI_PASSWORD: z.string().optional().default(''),
    LOKI_PUSH_TIMEOUT_MS: z.coerce.number().int().positive().optional().default(10_000),

    // --- MinIO ---
    MINIO_ROOT_USER: z.string().optional(),
    MINIO_ROOT_PASSWORD: z.string().optional(),

    // --- GitHub OAuth ---
    GITHUB_OAUTH_CLIENT_ID: z.string().optional(),
    GITHUB_OAUTH_CLIENT_SECRET: z.string().optional(),

    // --- Zoom OAuth ---
    ZOOM_OAUTH_CLIENT_ID: z.string().optional(),
    ZOOM_OAUTH_CLIENT_SECRET: z.string().optional(),

    // --- Jira OAuth ---
    JIRA_CLIENT_ID: optionalTrimmedString,
    JIRA_CLIENT_SECRET: optionalSecretString,
    JIRA_CALLBACK_URL: optionalHttpUrl,

    // --- Platform ---
    PLATFORM_API_URL: z.string().optional().default(''),
    PLATFORM_SERVICE_TOKEN: z.string().optional().default(''),
    PLATFORM_API_TIMEOUT_MS: z.string().optional().default(''),

    // --- GitHub Template Library ---
    GITHUB_TEMPLATE_REPO: z
      .string()
      .optional()
      .default('zebbern/sentris-templates')
      .refine((v) => v.includes('/'), {
        message: 'GITHUB_TEMPLATE_REPO must be in owner/repo format',
      }),
    GITHUB_TEMPLATE_BRANCH: z.string().optional().default('main'),
    GITHUB_TEMPLATE_TOKEN: z.string().optional(),
    COMMUNITY_TEMPLATES_INDEX_URL: z
      .string()
      .url()
      .optional()
      .default(
        'https://raw.githubusercontent.com/zebbern/Sentris/main/community/template/index.json',
      ),

    // --- Version Check ---
    SENTRIS_VERSION_CHECK_URL: z.string().optional().default(''),
    SENTRIS_VERSION_CHECK_TIMEOUT_MS: z.coerce.number().optional().default(5000),
    SENTRIS_VERSION_CHECK_VERSION: z.string().optional(),
    SENTRIS_SKIP_MIGRATION_CHECK: stringToBoolean(false),
    SENTRIS_VERSION_CHECK_DISABLED: stringToBoolean(false),

    // --- Runtime ---
    NODE_ENV: z.string().optional().default('development'),
    SENTRIS_TRUST_PROFILE: z.string().optional(),
    FINDINGS_RECONCILIATION_SCHEDULE_ENABLED: stringToBoolean(true),
  })
  .merge(temporalConfigSchema)
  .superRefine((data, ctx) => {
    if (data.TELEMETRY_KAFKA_RECEIPT_RETENTION_DAYS <= data.TELEMETRY_KAFKA_REPLAY_RETENTION_DAYS) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['TELEMETRY_KAFKA_RECEIPT_RETENTION_DAYS'],
        message:
          'TELEMETRY_KAFKA_RECEIPT_RETENTION_DAYS must exceed TELEMETRY_KAFKA_REPLAY_RETENTION_DAYS',
      });
    }

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

    if (trustProfile === 'hardened' && data.AUTH_PROVIDER !== 'clerk') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['AUTH_PROVIDER'],
        message: 'AUTH_PROVIDER=clerk is required when SENTRIS_TRUST_PROFILE=hardened',
      });
    }

    if (data.NODE_ENV === 'production' && data.AUTH_PROVIDER === 'local') {
      if (!data.ADMIN_USERNAME) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['ADMIN_USERNAME'],
          message: 'ADMIN_USERNAME is required for local authentication in production',
        });
      }
      if (!data.ADMIN_PASSWORD) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['ADMIN_PASSWORD'],
          message: 'ADMIN_PASSWORD is required for local authentication in production',
        });
      }
    }

    // SKIP_INGEST_SERVICES is the explicit test/OpenAPI mode that replaces
    // persistence with a recursive mock. Disabling Kafka ingest alone keeps
    // the rest of the API backed by PostgreSQL.
    if (!data.SKIP_INGEST_SERVICES) {
      if (!data.DATABASE_URL) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['DATABASE_URL'],
          message: 'DATABASE_URL is required (set SKIP_INGEST_SERVICES=true to skip)',
        });
      } else {
        const parsed = databaseUrlSchema.safeParse(data.DATABASE_URL);
        if (!parsed.success) {
          for (const issue of parsed.error.issues) {
            ctx.addIssue({ ...issue, path: ['DATABASE_URL'] });
          }
        }
      }
    }

    const ingestRequired = data.ENABLE_INGEST_SERVICES && !data.SKIP_INGEST_SERVICES;
    if (ingestRequired) {
      if (!data.LOG_KAFKA_BROKERS) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['LOG_KAFKA_BROKERS'],
          message:
            'LOG_KAFKA_BROKERS is required (set SKIP_INGEST_SERVICES=true or ENABLE_INGEST_SERVICES=false to skip)',
        });
      }
    }

    // Clerk keys required when AUTH_PROVIDER is clerk
    if (data.AUTH_PROVIDER === 'clerk') {
      if (!data.CLERK_SECRET_KEY) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['CLERK_SECRET_KEY'],
          message: 'CLERK_SECRET_KEY is required when AUTH_PROVIDER=clerk',
        });
      }
      if (!data.CLERK_PUBLISHABLE_KEY) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['CLERK_PUBLISHABLE_KEY'],
          message: 'CLERK_PUBLISHABLE_KEY is required when AUTH_PROVIDER=clerk',
        });
      }
    }

    const jiraOAuthConfigured = Boolean(
      data.JIRA_CLIENT_ID || data.JIRA_CLIENT_SECRET || data.JIRA_CALLBACK_URL,
    );
    if (jiraOAuthConfigured) {
      const requiredJiraSettings = [
        ['JIRA_CLIENT_ID', data.JIRA_CLIENT_ID],
        ['JIRA_CLIENT_SECRET', data.JIRA_CLIENT_SECRET],
        ['JIRA_CALLBACK_URL', data.JIRA_CALLBACK_URL],
      ] as const;
      for (const [setting, value] of requiredJiraSettings) {
        if (!value) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [setting],
            message: `${setting} is required when Jira OAuth is configured`,
          });
        }
      }
    }
  })
  .transform((data) => ({
    ...data,
    SENTRIS_TRUST_PROFILE: resolveSentrisTrustProfile(data),
  }));

export type BackendEnvConfig = z.infer<typeof backendEnvSchema>;
