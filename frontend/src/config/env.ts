import { frontendEnvSchema } from './env.schema';
import { mergeFrontendEnv, readRuntimeConfig } from './runtime-config';
import { logger } from '@/lib/logger';

const mergedConfig = mergeFrontendEnv(
  import.meta.env as unknown as Record<string, unknown>,
  readRuntimeConfig(),
);
const result = frontendEnvSchema.safeParse(mergedConfig);
if (!result.success) {
  const msg = '❌ Frontend env validation failed';
  logger.error(msg, result.error.issues);
  throw new Error(msg);
}
export const env = result.data;
