import { registerAs } from '@nestjs/config';

export interface TemporalTaskConfig {
  address: string;
  namespace: string;
  taskQueue: string;
  bootstrapDemo: boolean;
}

export const temporalTaskConfig = registerAs<TemporalTaskConfig>('temporalTask', () => ({
  address: process.env.TEMPORAL_ADDRESS ?? 'localhost:7233',
  namespace: process.env.TEMPORAL_NAMESPACE ?? 'shipsec-dev',
  taskQueue: process.env.TEMPORAL_TASK_QUEUE ?? 'shipsec-default',
  bootstrapDemo: process.env.TEMPORAL_BOOTSTRAP_DEMO?.toLowerCase() === 'true',
}));
