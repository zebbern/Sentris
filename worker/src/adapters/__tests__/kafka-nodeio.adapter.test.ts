import { describe, it, expect, beforeEach, mock, vi } from 'bun:test';
import {
  KAFKA_SPILL_THRESHOLD_BYTES,
  MAX_KAFKA_MESSAGE_BYTES,
  type IFileStorageService,
  type NodeIOStartEvent,
  type NodeIOCompletionEvent,
} from '@sentris/component-sdk';

const mockSend = vi.fn().mockResolvedValue(undefined);
const mockConnect = vi.fn().mockResolvedValue(undefined);

mock.module('kafkajs', () => ({
  Kafka: vi.fn(() => ({
    producer: vi.fn(() => ({
      connect: mockConnect,
      send: mockSend,
      disconnect: vi.fn(),
    })),
  })),
  logLevel: {
    NOTHING: 0,
    ERROR: 1,
    WARN: 2,
    INFO: 4,
    DEBUG: 5,
  },
}));

// Stable UUID for spill tests
mock.module('node:crypto', () => ({
  randomUUID: vi.fn(() => 'test-uuid-1234'),
}));

const { KafkaNodeIOAdapter } = await import('../kafka-nodeio.adapter');
const { ConfigurationError } = await import('@sentris/component-sdk');

describe('KafkaNodeIOAdapter', () => {
  const noopLogger = { log: () => {}, error: () => {} };

  const defaultConfig = {
    brokers: ['localhost:9092'],
    topic: 'node-io-events',
  };

  function createStorageMock(): IFileStorageService {
    return {
      uploadFile: vi.fn().mockResolvedValue(undefined),
      downloadFile: vi.fn(),
      deleteFile: vi.fn(),
      getFileUrl: vi.fn(),
    } as unknown as IFileStorageService;
  }

  beforeEach(() => {
    mockSend.mockClear();
    mockConnect.mockClear();
  });

  describe('constructor', () => {
    it('throws ConfigurationError when brokers array is empty', () => {
      expect(
        () => new KafkaNodeIOAdapter({ brokers: [], topic: 'test' }, undefined, noopLogger),
      ).toThrow(ConfigurationError);
    });

    it('creates successfully with valid config', () => {
      const adapter = new KafkaNodeIOAdapter(defaultConfig, undefined, noopLogger);
      expect(adapter).toBeDefined();
    });
  });

  describe('recordStart', () => {
    it('serializes a NODE_IO_START event with correct fields', async () => {
      const adapter = new KafkaNodeIOAdapter(defaultConfig, undefined, noopLogger);

      const data: NodeIOStartEvent = {
        runId: 'run-1',
        nodeRef: 'node.http',
        workflowId: 'wf-1',
        organizationId: 'org-1',
        componentId: 'core.http',
        inputs: { url: 'https://example.com' },
      };

      await adapter.recordStart(data);

      expect(mockSend).toHaveBeenCalledTimes(1);
      const sentMessage = mockSend.mock.calls[0][0];
      expect(sentMessage.topic).toBe('node-io-events');
      expect(sentMessage.messages[0].key).toBe('run-1');

      const payload = JSON.parse(sentMessage.messages[0].value);
      expect(payload.type).toBe('NODE_IO_START');
      expect(payload.runId).toBe('run-1');
      expect(payload.nodeRef).toBe('node.http');
      expect(payload.workflowId).toBe('wf-1');
      expect(payload.organizationId).toBe('org-1');
      expect(payload.componentId).toBe('core.http');
      expect(payload.inputs).toEqual({ url: 'https://example.com' });
      expect(payload.timestamp).toBeDefined();
    });

    it('sets organizationId to null when not provided', async () => {
      const adapter = new KafkaNodeIOAdapter(defaultConfig, undefined, noopLogger);

      await adapter.recordStart({
        runId: 'run-2',
        nodeRef: 'node.a',
        componentId: 'core.a',
      });

      const payload = JSON.parse(mockSend.mock.calls[0][0].messages[0].value);
      expect(payload.organizationId).toBeNull();
    });
  });

  describe('recordCompletion', () => {
    it('serializes a NODE_IO_COMPLETION event with correct fields', async () => {
      const adapter = new KafkaNodeIOAdapter(defaultConfig, undefined, noopLogger);

      const data: NodeIOCompletionEvent = {
        runId: 'run-3',
        nodeRef: 'node.http',
        componentId: 'core.http',
        outputs: { statusCode: 200, body: 'OK' },
        status: 'completed',
      };

      await adapter.recordCompletion(data);

      expect(mockSend).toHaveBeenCalledTimes(1);
      const payload = JSON.parse(mockSend.mock.calls[0][0].messages[0].value);
      expect(payload.type).toBe('NODE_IO_COMPLETION');
      expect(payload.runId).toBe('run-3');
      expect(payload.nodeRef).toBe('node.http');
      expect(payload.componentId).toBe('core.http');
      expect(payload.outputs).toEqual({ statusCode: 200, body: 'OK' });
      expect(payload.status).toBe('completed');
    });

    it('includes errorMessage for failed completions', async () => {
      const adapter = new KafkaNodeIOAdapter(defaultConfig, undefined, noopLogger);

      const data: NodeIOCompletionEvent = {
        runId: 'run-4',
        nodeRef: 'node.http',
        outputs: {},
        status: 'failed',
        errorMessage: 'Connection timeout',
      };

      await adapter.recordCompletion(data);

      const payload = JSON.parse(mockSend.mock.calls[0][0].messages[0].value);
      expect(payload.status).toBe('failed');
      expect(payload.errorMessage).toBe('Connection timeout');
    });
  });

  describe('spill-to-storage for inputs', () => {
    it('spills inputs to storage when they exceed KAFKA_SPILL_THRESHOLD_BYTES', async () => {
      const storage = createStorageMock();
      const adapter = new KafkaNodeIOAdapter(defaultConfig, storage, noopLogger);

      // Create input data that exceeds the spill threshold
      const largeValue = 'x'.repeat(KAFKA_SPILL_THRESHOLD_BYTES + 1000);
      const inputs = { data: largeValue };

      await adapter.recordStart({
        runId: 'run-spill-1',
        nodeRef: 'node.a',
        componentId: 'core.a',
        inputs,
      });

      expect(storage.uploadFile).toHaveBeenCalledTimes(1);
      const uploadCall = (storage.uploadFile as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(uploadCall[0]).toBe('test-uuid-1234'); // fileId from mocked randomUUID
      expect(uploadCall[1]).toBe('inputs.json');
      expect(uploadCall[3]).toBe('application/json');

      const payload = JSON.parse(mockSend.mock.calls[0][0].messages[0].value);
      expect(payload.inputsSpilled).toBe(true);
      expect(payload.inputsStorageRef).toBe('test-uuid-1234');
      expect(payload.inputs.__spilled__).toBe(true);
      expect(payload.inputs.storageRef).toBe('test-uuid-1234');
    });

    it('does not spill inputs below the threshold', async () => {
      const storage = createStorageMock();
      const adapter = new KafkaNodeIOAdapter(defaultConfig, storage, noopLogger);

      await adapter.recordStart({
        runId: 'run-spill-2',
        nodeRef: 'node.a',
        componentId: 'core.a',
        inputs: { small: 'value' },
      });

      expect(storage.uploadFile).not.toHaveBeenCalled();
      const payload = JSON.parse(mockSend.mock.calls[0][0].messages[0].value);
      expect(payload.inputsSpilled).toBeUndefined();
      expect(payload.inputs).toEqual({ small: 'value' });
    });
  });

  describe('spill-to-storage for outputs', () => {
    it('spills outputs to storage when they exceed KAFKA_SPILL_THRESHOLD_BYTES', async () => {
      const storage = createStorageMock();
      const adapter = new KafkaNodeIOAdapter(defaultConfig, storage, noopLogger);

      const largeValue = 'y'.repeat(KAFKA_SPILL_THRESHOLD_BYTES + 1000);
      const outputs = { result: largeValue };

      await adapter.recordCompletion({
        runId: 'run-spill-3',
        nodeRef: 'node.a',
        outputs,
        status: 'completed',
      });

      expect(storage.uploadFile).toHaveBeenCalledTimes(1);
      const payload = JSON.parse(mockSend.mock.calls[0][0].messages[0].value);
      expect(payload.outputsSpilled).toBe(true);
      expect(payload.outputsStorageRef).toBe('test-uuid-1234');
      expect(payload.outputs.__spilled__).toBe(true);
    });
  });

  describe('pre-spilled output detection', () => {
    it('detects outputs with __sentris_spilled__ marker without re-uploading', async () => {
      const storage = createStorageMock();
      const adapter = new KafkaNodeIOAdapter(defaultConfig, storage, noopLogger);

      const preSpilledOutputs = {
        __sentris_spilled__: true,
        storageRef: 'existing-file-id',
        originalSize: 500000,
      };

      await adapter.recordCompletion({
        runId: 'run-prespill-1',
        nodeRef: 'node.a',
        outputs: preSpilledOutputs as Record<string, unknown>,
        status: 'completed',
      });

      // Should NOT upload to storage
      expect(storage.uploadFile).not.toHaveBeenCalled();

      const payload = JSON.parse(mockSend.mock.calls[0][0].messages[0].value);
      expect(payload.outputsSpilled).toBe(true);
      expect(payload.outputsStorageRef).toBe('existing-file-id');
      expect(payload.outputsSize).toBe(500000);
    });

    it('detects outputs with __spilled__ marker from isSpilledDataMarker', async () => {
      const storage = createStorageMock();
      const adapter = new KafkaNodeIOAdapter(defaultConfig, storage, noopLogger);

      const preSpilledOutputs = {
        __spilled__: true,
        storageRef: 'spilled-file-id',
        originalSize: 300000,
      };

      await adapter.recordCompletion({
        runId: 'run-prespill-2',
        nodeRef: 'node.a',
        outputs: preSpilledOutputs as Record<string, unknown>,
        status: 'completed',
      });

      expect(storage.uploadFile).not.toHaveBeenCalled();

      const payload = JSON.parse(mockSend.mock.calls[0][0].messages[0].value);
      expect(payload.outputsSpilled).toBe(true);
      expect(payload.outputsStorageRef).toBe('spilled-file-id');
    });
  });

  describe('final safety check (MAX_KAFKA_MESSAGE_BYTES)', () => {
    it('truncates payload with _truncated marker when serialized message exceeds max', async () => {
      const errorLogger = { log: () => {}, error: vi.fn() };
      // Create adapter without storage so spilling won't happen
      const adapter = new KafkaNodeIOAdapter(defaultConfig, undefined, errorLogger);

      // Create a payload large enough to exceed MAX_KAFKA_MESSAGE_BYTES
      // Without storage, inputs won't be spilled, so the message can grow very large
      const hugeValue = 'z'.repeat(MAX_KAFKA_MESSAGE_BYTES + 1000);

      await adapter.recordStart({
        runId: 'run-truncate',
        nodeRef: 'node.huge',
        componentId: 'core.huge',
        inputs: { massive: hugeValue },
      });

      expect(mockSend).toHaveBeenCalledTimes(1);
      const payload = JSON.parse(mockSend.mock.calls[0][0].messages[0].value);
      expect(payload.inputs._truncated).toBe(true);
      expect(payload.inputs._originalSize).toBeDefined();

      // Should log the error about the oversized payload
      expect(errorLogger.error).toHaveBeenCalled();
      const errorCall = errorLogger.error.mock.calls[0][0];
      expect(errorCall).toContain('payload too large');
    });
  });

  describe('message key', () => {
    it('sets message key to runId', async () => {
      const adapter = new KafkaNodeIOAdapter(defaultConfig, undefined, noopLogger);

      await adapter.recordStart({
        runId: 'run-key-test',
        nodeRef: 'node.a',
        componentId: 'core.a',
      });

      expect(mockSend.mock.calls[0][0].messages[0].key).toBe('run-key-test');
    });
  });

  describe('error handling', () => {
    it('logs critical errors but does not throw', async () => {
      const errorLogger = { log: () => {}, error: vi.fn() };
      const adapter = new KafkaNodeIOAdapter(defaultConfig, undefined, errorLogger);

      mockSend.mockRejectedValueOnce(new Error('Kafka broker down'));

      // Should NOT throw
      await adapter.recordStart({
        runId: 'run-err',
        nodeRef: 'node.a',
        componentId: 'core.a',
        inputs: { test: true },
      });

      expect(errorLogger.error).toHaveBeenCalled();
      const errorMsg = errorLogger.error.mock.calls[0][0];
      expect(errorMsg).toContain('CRITICAL');
    });
  });
});
