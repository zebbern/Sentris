import { registerAs } from '@nestjs/config';

export interface IngestConfig {
  enableIngestServices: boolean;
  skipIngestServices: boolean;
  mcpSyncTemplatesOnStartup: boolean;
}

export const ingestConfig = registerAs<IngestConfig>('ingest', () => ({
  enableIngestServices: (process.env.ENABLE_INGEST_SERVICES ?? 'true') === 'true',
  skipIngestServices: process.env.SKIP_INGEST_SERVICES === 'true',
  mcpSyncTemplatesOnStartup: process.env.MCP_SYNC_TEMPLATES_ON_STARTUP === 'true',
}));
