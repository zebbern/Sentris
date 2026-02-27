import { registerAs } from '@nestjs/config';

export interface SecretsConfig {
  masterKey: string | undefined;
}

export const secretsConfig = registerAs<SecretsConfig>('secrets', () => ({
  masterKey: process.env.SECRET_STORE_MASTER_KEY,
}));
