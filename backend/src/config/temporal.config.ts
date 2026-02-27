import { registerAs } from '@nestjs/config';

export interface TemporalTaskConfig {
  taskQueue: string;
  bootstrapDemo: boolean;
}

export const temporalTaskConfig = registerAs<TemporalTaskConfig>('temporalTask', () => ({
  taskQueue: process.env.TEMPORAL_TASK_QUEUE ?? 'shipsec-default',
  bootstrapDemo: process.env.TEMPORAL_BOOTSTRAP_DEMO?.toLowerCase() === 'true',
}));
