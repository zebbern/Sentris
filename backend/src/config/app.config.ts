import { registerAs } from '@nestjs/config';

export interface AppConfig {
  port: number;
  host: string;
  nodeEnv: string;
  webhookBaseUrl: string;
  versionCheckUrl: string;
  versionCheckTimeoutMs: number;
  versionCheckVersion: string | undefined;
  skipMigrationCheck: boolean;
}

export const appConfig = registerAs<AppConfig>('app', () => ({
  port: Number(process.env.PORT ?? 3211),
  host: process.env.HOST ?? '0.0.0.0',
  nodeEnv: process.env.NODE_ENV ?? 'development',
  webhookBaseUrl: process.env.WEBHOOK_BASE_URL || 'http://localhost:3211',
  versionCheckUrl: process.env.SENTRIS_VERSION_CHECK_URL ?? '',
  versionCheckTimeoutMs: Number(process.env.SENTRIS_VERSION_CHECK_TIMEOUT_MS ?? '5000'),
  versionCheckVersion: process.env.SENTRIS_VERSION_CHECK_VERSION,
  skipMigrationCheck: process.env.SENTRIS_SKIP_MIGRATION_CHECK === 'true',
}));
