import { registerAs } from '@nestjs/config';

export interface MinioEnvConfig {
  endpoint: string;
  port: string | undefined;
  useSsl: string | undefined;
  rootUser: string;
  rootPassword: string;
}

export const minioEnvConfig = registerAs<MinioEnvConfig>('minio', () => ({
  endpoint: process.env.MINIO_ENDPOINT ?? 'localhost',
  port: process.env.MINIO_PORT,
  useSsl: process.env.MINIO_USE_SSL,
  rootUser: process.env.MINIO_ROOT_USER ?? 'minioadmin',
  rootPassword: process.env.MINIO_ROOT_PASSWORD ?? 'minioadmin',
}));
