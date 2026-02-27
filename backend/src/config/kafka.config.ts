import { registerAs } from '@nestjs/config';

export interface KafkaConfig {
  brokers: string;
  instanceId: string | undefined;
  nodeIoGroupId: string | undefined;
  nodeIoClientId: string | undefined;
  eventGroupId: string | undefined;
  eventClientId: string | undefined;
  agentTraceGroupId: string | undefined;
  agentTraceClientId: string | undefined;
  logGroupId: string | undefined;
  logClientId: string | undefined;
  logTopic: string;
  eventTopic: string;
  agentTraceTopic: string;
  nodeIoTopic: string;
}

export const kafkaConfig = registerAs<KafkaConfig>('kafka', () => ({
  brokers: process.env.LOG_KAFKA_BROKERS ?? '',
  instanceId: process.env.SHIPSEC_INSTANCE,
  nodeIoGroupId: process.env.NODE_IO_KAFKA_GROUP_ID,
  nodeIoClientId: process.env.NODE_IO_KAFKA_CLIENT_ID,
  eventGroupId: process.env.EVENT_KAFKA_GROUP_ID,
  eventClientId: process.env.EVENT_KAFKA_CLIENT_ID,
  agentTraceGroupId: process.env.AGENT_TRACE_KAFKA_GROUP_ID,
  agentTraceClientId: process.env.AGENT_TRACE_KAFKA_CLIENT_ID,
  logGroupId: process.env.LOG_KAFKA_GROUP_ID,
  logClientId: process.env.LOG_KAFKA_CLIENT_ID,
  logTopic: process.env.LOG_KAFKA_TOPIC ?? 'telemetry.logs',
  eventTopic: process.env.EVENT_KAFKA_TOPIC ?? 'telemetry.events',
  agentTraceTopic: process.env.AGENT_TRACE_KAFKA_TOPIC ?? 'telemetry.agent-trace',
  nodeIoTopic: process.env.NODE_IO_KAFKA_TOPIC ?? 'telemetry.node-io',
}));
