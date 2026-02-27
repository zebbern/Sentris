import { Logger } from '@nestjs/common';
import { formatEnvErrors } from '@shipsec/shared';
import { backendEnvSchema, type BackendEnvConfig } from './env.schema';

export function validateBackendEnv(config: Record<string, unknown>): BackendEnvConfig {
  const result = backendEnvSchema.safeParse(config);
  if (!result.success) {
    const logger = new Logger('EnvValidation');
    logger.error('Backend environment validation failed:');
    logger.error(formatEnvErrors(result.error));
    logger.error('See backend/.env.example for reference.');
    throw new Error('Invalid backend environment configuration');
  }
  return result.data;
}
