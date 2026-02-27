import { registerAs } from '@nestjs/config';

export interface IntegrationsEnvConfig {
  masterKey: string | undefined;
  internalServiceToken: string | undefined;
  github: {
    clientId: string | null;
    clientSecret: string | null;
    scopes: string | undefined;
  };
  zoom: {
    clientId: string | null;
    clientSecret: string | null;
    scopes: string | undefined;
  };
}

export const integrationsEnvConfig = registerAs<IntegrationsEnvConfig>('integrations', () => ({
  masterKey: process.env.INTEGRATION_STORE_MASTER_KEY,
  internalServiceToken: process.env.INTERNAL_SERVICE_TOKEN,
  github: {
    clientId: process.env.GITHUB_OAUTH_CLIENT_ID ?? null,
    clientSecret: process.env.GITHUB_OAUTH_CLIENT_SECRET ?? null,
    scopes: process.env.GITHUB_OAUTH_SCOPES,
  },
  zoom: {
    clientId: process.env.ZOOM_OAUTH_CLIENT_ID ?? null,
    clientSecret: process.env.ZOOM_OAUTH_CLIENT_SECRET ?? null,
    scopes: process.env.ZOOM_OAUTH_SCOPES,
  },
}));
