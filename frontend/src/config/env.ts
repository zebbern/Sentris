import { frontendEnvSchema } from './env.schema';
import { logger } from '@/lib/logger';

const result = frontendEnvSchema.safeParse(import.meta.env);
if (!result.success) {
  const msg = '❌ Frontend env validation failed';
  logger.error(msg, result.error.issues);
  throw new Error(msg);
}
export const env = result.data;
