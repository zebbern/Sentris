import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { NodeIOIngestService } from '../node-io-ingest.service';
import type { NodeIORepository } from '../node-io.repository';
import type { ConfigService } from '@nestjs/config';
import type { KafkaConfig } from '../../config';

function createMockConfigService(): ConfigService {
  const kafkaConfig: KafkaConfig = {
    brokers: process.env.LOG_KAFKA_BROKERS ?? '',
    instanceId: process.env.SENTRIS_INSTANCE,
    nodeIoGroupId: process.env.NODE_IO_KAFKA_GROUP_ID,
    nodeIoClientId: process.env.NODE_IO_KAFKA_CLIENT_ID,
    eventGroupId: undefined,
    eventClientId: undefined,
    agentTraceGroupId: undefined,
    agentTraceClientId: undefined,
    logGroupId: undefined,
    logClientId: undefined,
    logTopic: 'telemetry.logs',
    eventTopic: 'telemetry.events',
    agentTraceTopic: 'telemetry.agent-trace',
    nodeIoTopic: 'telemetry.node-io',
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

describe('NodeIOIngestService', () => {
  beforeEach(() => {
    restoreEnv();
    process.env.LOG_KAFKA_BROKERS = 'localhost:19092';
    delete process.env.SENTRIS_INSTANCE;
    delete process.env.NODE_IO_KAFKA_GROUP_ID;
    delete process.env.NODE_IO_KAFKA_CLIENT_ID;
  });

  afterEach(() => {
    restoreEnv();
  });

  test('uses legacy defaults when SENTRIS_INSTANCE is unset', () => {
    const repository = {
      recordStart: async () => undefined,
      recordCompletion: async () => undefined,
    } as unknown as NodeIORepository;
    const service = new NodeIOIngestService(repository, createMockConfigService()) as unknown as {
      kafkaGroupId: string;
      kafkaClientId: string;
    };

    expect(service.kafkaGroupId).toBe('sentris-node-io-ingestor');
    expect(service.kafkaClientId).toBe('sentris-backend-node-io');
  });

  test('uses instance-scoped defaults when SENTRIS_INSTANCE is set', () => {
    process.env.SENTRIS_INSTANCE = '4';
    const repository = {
      recordStart: async () => undefined,
      recordCompletion: async () => undefined,
    } as unknown as NodeIORepository;
    const service = new NodeIOIngestService(repository, createMockConfigService()) as unknown as {
      kafkaGroupId: string;
      kafkaClientId: string;
    };

    expect(service.kafkaGroupId).toBe('sentris-node-io-ingestor-4');
    expect(service.kafkaClientId).toBe('sentris-backend-node-io-4');
  });

  test('prefers explicit env vars over defaults', () => {
    process.env.SENTRIS_INSTANCE = '9';
    process.env.NODE_IO_KAFKA_GROUP_ID = 'custom-node-io-group';
    process.env.NODE_IO_KAFKA_CLIENT_ID = 'custom-node-io-client';
    const repository = {
      recordStart: async () => undefined,
      recordCompletion: async () => undefined,
    } as unknown as NodeIORepository;
    const service = new NodeIOIngestService(repository, createMockConfigService()) as unknown as {
      kafkaGroupId: string;
      kafkaClientId: string;
    };

    expect(service.kafkaGroupId).toBe('custom-node-io-group');
    expect(service.kafkaClientId).toBe('custom-node-io-client');
  });
});
