import { describe, it, expect, beforeEach, mock, vi } from 'bun:test';
import { LOG_CHUNK_SIZE_CHARS } from '@sentris/component-sdk';
import type { WorkflowLogEntry } from '../../temporal/types';

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

const { KafkaLogAdapter } = await import('../kafka-log.adapter');
const { ConfigurationError } = await import('@sentris/component-sdk');

describe('KafkaLogAdapter', () => {
  const defaultConfig = {
    brokers: ['localhost:9092'],
    topic: 'workflow-logs',
  };

  beforeEach(() => {
    mockSend.mockClear();
    mockConnect.mockClear();
  });

  describe('constructor', () => {
    it('throws ConfigurationError when brokers array is empty', () => {
      expect(() => new KafkaLogAdapter({ brokers: [], topic: 'test' })).toThrow(ConfigurationError);
    });

    it('creates successfully with valid config', () => {
      const adapter = new KafkaLogAdapter(defaultConfig);
      expect(adapter).toBeDefined();
    });
  });

  describe('append', () => {
    it('sends a single message for short log entries', async () => {
      const adapter = new KafkaLogAdapter(defaultConfig);
      const entry: WorkflowLogEntry = {
        runId: 'run-1',
        nodeRef: 'node.http',
        stream: 'stdout',
        message: 'Request completed successfully',
        level: 'info',
        timestamp: new Date('2026-01-15T10:00:00.000Z'),
      };

      await adapter.append(entry);

      expect(mockSend).toHaveBeenCalledTimes(1);
      const payload = JSON.parse(mockSend.mock.calls[0][0].messages[0].value);
      expect(payload.runId).toBe('run-1');
      expect(payload.nodeRef).toBe('node.http');
      expect(payload.stream).toBe('stdout');
      expect(payload.message).toBe('Request completed successfully');
      expect(payload.level).toBe('info');
    });

    it('skips sending when message is empty', async () => {
      const adapter = new KafkaLogAdapter(defaultConfig);
      const entry: WorkflowLogEntry = {
        runId: 'run-2',
        nodeRef: 'node.http',
        stream: 'stdout',
        message: '',
      };

      await adapter.append(entry);

      expect(mockSend).not.toHaveBeenCalled();
    });

    it('skips sending when message is whitespace-only', async () => {
      const adapter = new KafkaLogAdapter(defaultConfig);
      const entry: WorkflowLogEntry = {
        runId: 'run-3',
        nodeRef: 'node.http',
        stream: 'stdout',
        message: '   \t\n  ',
      };

      await adapter.append(entry);

      expect(mockSend).not.toHaveBeenCalled();
    });

    it('chunks messages exceeding LOG_CHUNK_SIZE_CHARS with indicators', async () => {
      const adapter = new KafkaLogAdapter(defaultConfig);
      // Create a message exactly 2.5x the chunk size to get 3 chunks
      const longMessage = 'x'.repeat(
        LOG_CHUNK_SIZE_CHARS * 2 + Math.floor(LOG_CHUNK_SIZE_CHARS / 2),
      );

      const entry: WorkflowLogEntry = {
        runId: 'run-4',
        nodeRef: 'node.script',
        stream: 'stdout',
        message: longMessage,
        timestamp: new Date('2026-01-15T10:00:00.000Z'),
      };

      await adapter.append(entry);

      // Should send 3 chunks
      expect(mockSend).toHaveBeenCalledTimes(3);

      const chunk1 = JSON.parse(mockSend.mock.calls[0][0].messages[0].value);
      const chunk2 = JSON.parse(mockSend.mock.calls[1][0].messages[0].value);
      const chunk3 = JSON.parse(mockSend.mock.calls[2][0].messages[0].value);

      expect(chunk1.message).toContain('[Chunk 1/3]');
      expect(chunk2.message).toContain('[Chunk 2/3]');
      expect(chunk3.message).toContain('[Chunk 3/3]');

      // Each chunk content should be LOG_CHUNK_SIZE_CHARS long (except possibly the last)
      // The first chunk: LOG_CHUNK_SIZE_CHARS chars of 'x' + ' [Chunk 1/3]'
      expect(chunk1.message.startsWith('x'.repeat(LOG_CHUNK_SIZE_CHARS))).toBe(true);
    });

    it('serializes timestamp to ISO string format', async () => {
      const adapter = new KafkaLogAdapter(defaultConfig);
      const fixedDate = new Date('2026-03-01T12:30:00.000Z');

      const entry: WorkflowLogEntry = {
        runId: 'run-5',
        nodeRef: 'node.http',
        stream: 'stdout',
        message: 'test message',
        timestamp: fixedDate,
      };

      await adapter.append(entry);

      const payload = JSON.parse(mockSend.mock.calls[0][0].messages[0].value);
      expect(payload.timestamp).toBe('2026-03-01T12:30:00.000Z');
    });

    it('sends to the configured topic', async () => {
      const adapter = new KafkaLogAdapter({ brokers: ['b:9092'], topic: 'custom-topic' });

      const entry: WorkflowLogEntry = {
        runId: 'run-6',
        nodeRef: 'node.a',
        stream: 'stdout',
        message: 'hello',
        timestamp: new Date('2026-01-01T00:00:00.000Z'),
      };

      await adapter.append(entry);

      expect(mockSend.mock.calls[0][0].topic).toBe('custom-topic');
    });

    it('catches and logs send errors without re-throwing', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      try {
        const adapter = new KafkaLogAdapter(defaultConfig);
        mockSend.mockRejectedValueOnce(new Error('Kafka unavailable'));

        const entry: WorkflowLogEntry = {
          runId: 'run-7',
          nodeRef: 'node.a',
          stream: 'stdout',
          message: 'should not throw',
          timestamp: new Date('2026-01-01T00:00:00.000Z'),
        };

        // Should NOT throw
        await adapter.append(entry);

        expect(consoleErrorSpy).toHaveBeenCalled();
        const errorMsg = consoleErrorSpy.mock.calls.find((c) =>
          String(c[0]).includes('Failed to send log entry'),
        );
        expect(errorMsg).toBeDefined();
      } finally {
        consoleErrorSpy.mockRestore();
      }
    });
  });
});
