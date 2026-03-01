import { registerAs } from '@nestjs/config';

export interface TemporalTaskConfig {
  address: string;
  namespace: string;
  taskQueue: string;
  bootstrapDemo: boolean;
}

export const temporalTaskConfig = registerAs<TemporalTaskConfig>('temporalTask', () => ({
  address: process.env.TEMPORAL_ADDRESS ?? 'localhost:7233',
  namespace: process.env.TEMPORAL_NAMESPACE ?? 'sentris-dev',
  taskQueue: process.env.TEMPORAL_TASK_QUEUE ?? 'sentris-default',
  bootstrapDemo: process.env.TEMPORAL_BOOTSTRAP_DEMO?.toLowerCase() === 'true',
}));
