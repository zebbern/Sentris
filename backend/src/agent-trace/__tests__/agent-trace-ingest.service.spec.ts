import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { AgentTraceIngestService } from '../agent-trace-ingest.service';
import type { AgentTraceRepository } from '../agent-trace.repository';
import type { ConfigService } from '@nestjs/config';
import type { KafkaConfig } from '../../config';

function createMockConfigService(overrides: Partial<KafkaConfig> = {}): ConfigService {
  const kafkaConfig: KafkaConfig = {
    brokers: process.env.LOG_KAFKA_BROKERS ?? '',
    instanceId: process.env.SHIPSEC_INSTANCE,
    agentTraceGroupId: process.env.AGENT_TRACE_KAFKA_GROUP_ID,
    agentTraceClientId: process.env.AGENT_TRACE_KAFKA_CLIENT_ID,
    nodeIoGroupId: undefined,
    nodeIoClientId: undefined,
    eventGroupId: undefined,
    eventClientId: undefined,
    logGroupId: undefined,
    logClientId: undefined,
    logTopic: 'telemetry.logs',
    eventTopic: 'telemetry.events',
    agentTraceTopic: 'telemetry.agent-trace',
    nodeIoTopic: 'telemetry.node-io',
    ...overrides,
  };
  return {
    get: (key: string) => {
      if (key === 'kafka') return kafkaConfig;
      return undefined;
    },
  } as unknown as ConfigService;
}

const ORIGINAL_ENV = { ...process.env };

function restoreEnv(): void {
  process.env = { ...ORIGINAL_ENV };
}

describe('AgentTraceIngestService', () => {
  beforeEach(() => {
    restoreEnv();
    process.env.LOG_KAFKA_BROKERS = 'localhost:19092';
    delete process.env.SHIPSEC_INSTANCE;
    delete process.env.AGENT_TRACE_KAFKA_GROUP_ID;
    delete process.env.AGENT_TRACE_KAFKA_CLIENT_ID;
  });

  afterEach(() => {
    restoreEnv();
  });

  test('uses legacy defaults when SHIPSEC_INSTANCE is unset', () => {
    const repository = { append: async () => undefined } as unknown as AgentTraceRepository;
    const service = new AgentTraceIngestService(
      repository,
      createMockConfigService(),
    ) as unknown as {
      kafkaGroupId: string;
      kafkaClientId: string;
    };

    expect(service.kafkaGroupId).toBe('shipsec-agent-trace-ingestor');
    expect(service.kafkaClientId).toBe('shipsec-backend-agent-trace');
  });

  test('uses instance-scoped defaults when SHIPSEC_INSTANCE is set', () => {
    process.env.SHIPSEC_INSTANCE = '7';
    const repository = { append: async () => undefined } as unknown as AgentTraceRepository;
    const service = new AgentTraceIngestService(
      repository,
      createMockConfigService(),
    ) as unknown as {
      kafkaGroupId: string;
      kafkaClientId: string;
    };

    expect(service.kafkaGroupId).toBe('shipsec-agent-trace-ingestor-7');
    expect(service.kafkaClientId).toBe('shipsec-backend-agent-trace-7');
  });

  test('prefers explicit env vars over defaults', () => {
    process.env.SHIPSEC_INSTANCE = '3';
    process.env.AGENT_TRACE_KAFKA_GROUP_ID = 'custom-agent-trace-group';
    process.env.AGENT_TRACE_KAFKA_CLIENT_ID = 'custom-agent-trace-client';
    const repository = { append: async () => undefined } as unknown as AgentTraceRepository;
    const service = new AgentTraceIngestService(
      repository,
      createMockConfigService(),
    ) as unknown as {
      kafkaGroupId: string;
      kafkaClientId: string;
    };

    expect(service.kafkaGroupId).toBe('custom-agent-trace-group');
    expect(service.kafkaClientId).toBe('custom-agent-trace-client');
  });
});
