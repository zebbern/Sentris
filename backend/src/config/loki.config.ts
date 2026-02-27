import { registerAs } from '@nestjs/config';

export interface LokiConfig {
  url: string | undefined;
  tenantId: string | undefined;
  username: string | undefined;
  password: string | undefined;
}

export const lokiConfig = registerAs<LokiConfig>('loki', () => ({
  url: process.env.LOKI_URL,
  tenantId: process.env.LOKI_TENANT_ID,
  username: process.env.LOKI_USERNAME,
  password: process.env.LOKI_PASSWORD,
}));
