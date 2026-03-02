import { describe, it, expect, beforeEach, mock, vi } from 'bun:test';
import type { TraceEvent } from '@sentris/component-sdk';

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

const { KafkaTraceAdapter } = await import('../kafka-trace.adapter');
const { ConfigurationError } = await import('@sentris/component-sdk');

describe('KafkaTraceAdapter', () => {
  const noopLogger = { log: () => {}, error: () => {} };

  const defaultConfig = {
    brokers: ['localhost:9092'],
    topic: 'trace-events',
  };

  beforeEach(() => {
    mockSend.mockClear();
    mockConnect.mockClear();
  });

  describe('constructor', () => {
    it('throws ConfigurationError when brokers array is empty', () => {
      expect(() => new KafkaTraceAdapter({ brokers: [], topic: 'test' }, noopLogger)).toThrow(
        ConfigurationError,
      );
    });

    it('creates successfully with valid config', () => {
      const adapter = new KafkaTraceAdapter(defaultConfig, noopLogger);
      expect(adapter).toBeDefined();
    });
  });

  describe('setRunMetadata / finalizeRun lifecycle', () => {
    it('metadata is available during the run and cleaned up after finalize', async () => {
      const adapter = new KafkaTraceAdapter(defaultConfig, noopLogger);

      adapter.setRunMetadata('run-meta-1', {
        workflowId: 'wf-1',
        organizationId: 'org-1',
      });

      const event: TraceEvent = {
        type: 'NODE_STARTED',
        runId: 'run-meta-1',
        nodeRef: 'node.a',
        timestamp: new Date().toISOString(),
        level: 'info',
      };

      adapter.record(event);

      // Allow the fire-and-forget promise chain to resolve
      await new Promise((r) => setTimeout(r, 10));

      expect(mockSend).toHaveBeenCalledTimes(1);
      const payload = JSON.parse(mockSend.mock.calls[0][0].messages[0].value);
      expect(payload.workflowId).toBe('wf-1');
      expect(payload.organizationId).toBe('org-1');

      // Finalize run
      adapter.finalizeRun('run-meta-1');

      // Record after finalize — metadata should be gone
      mockSend.mockClear();
      adapter.record({
        ...event,
        type: 'NODE_COMPLETED',
      });

      await new Promise((r) => setTimeout(r, 10));

      const postPayload = JSON.parse(mockSend.mock.calls[0][0].messages[0].value);
      expect(postPayload.workflowId).toBeUndefined();
      expect(postPayload.organizationId).toBeNull();
    });
  });

  describe('record', () => {
    it('serializes event with correct fields including metadata', async () => {
      const adapter = new KafkaTraceAdapter(defaultConfig, noopLogger);
      adapter.setRunMetadata('run-rec-1', {
        workflowId: 'wf-2',
        organizationId: 'org-2',
      });

      const timestamp = new Date().toISOString();
      adapter.record({
        type: 'NODE_STARTED',
        runId: 'run-rec-1',
        nodeRef: 'node.scanner',
        timestamp,
        level: 'info',
        message: 'Starting scan',
      });

      await new Promise((r) => setTimeout(r, 10));

      expect(mockSend).toHaveBeenCalledTimes(1);
      const sentPayload = mockSend.mock.calls[0][0];
      expect(sentPayload.topic).toBe('trace-events');

      const payload = JSON.parse(sentPayload.messages[0].value);
      expect(payload.runId).toBe('run-rec-1');
      expect(payload.type).toBe('NODE_STARTED');
      expect(payload.nodeRef).toBe('node.scanner');
      expect(payload.timestamp).toBe(timestamp);
      expect(payload.level).toBe('info');
      expect(payload.message).toBe('Starting scan');
      expect(payload.workflowId).toBe('wf-2');
      expect(payload.organizationId).toBe('org-2');
    });

    it('includes error and outputSummary fields when present', async () => {
      const adapter = new KafkaTraceAdapter(defaultConfig, noopLogger);

      adapter.record({
        type: 'NODE_FAILED',
        runId: 'run-err-1',
        nodeRef: 'node.http',
        timestamp: new Date().toISOString(),
        level: 'error',
        error: 'Connection refused',
      });

      await new Promise((r) => setTimeout(r, 10));

      const payload = JSON.parse(mockSend.mock.calls[0][0].messages[0].value);
      expect(payload.error).toBe('Connection refused');
    });
  });

  describe('sequence numbering', () => {
    it('assigns incrementing sequence numbers for the same runId', async () => {
      const adapter = new KafkaTraceAdapter(defaultConfig, noopLogger);

      const makeEvent = (type: TraceEvent['type']): TraceEvent => ({
        type,
        runId: 'run-seq-1',
        nodeRef: 'node.a',
        timestamp: new Date().toISOString(),
        level: 'info',
      });

      adapter.record(makeEvent('NODE_STARTED'));
      adapter.record(makeEvent('NODE_PROGRESS'));
      adapter.record(makeEvent('NODE_COMPLETED'));

      await new Promise((r) => setTimeout(r, 10));

      expect(mockSend).toHaveBeenCalledTimes(3);

      const seq1 = JSON.parse(mockSend.mock.calls[0][0].messages[0].value).sequence;
      const seq2 = JSON.parse(mockSend.mock.calls[1][0].messages[0].value).sequence;
      const seq3 = JSON.parse(mockSend.mock.calls[2][0].messages[0].value).sequence;

      expect(seq1).toBe(1);
      expect(seq2).toBe(2);
      expect(seq3).toBe(3);
    });

    it('maintains independent sequence counters for different runIds', async () => {
      const adapter = new KafkaTraceAdapter(defaultConfig, noopLogger);

      adapter.record({
        type: 'NODE_STARTED',
        runId: 'run-A',
        nodeRef: 'node.a',
        timestamp: new Date().toISOString(),
        level: 'info',
      });

      adapter.record({
        type: 'NODE_STARTED',
        runId: 'run-B',
        nodeRef: 'node.b',
        timestamp: new Date().toISOString(),
        level: 'info',
      });

      adapter.record({
        type: 'NODE_COMPLETED',
        runId: 'run-A',
        nodeRef: 'node.a',
        timestamp: new Date().toISOString(),
        level: 'info',
      });

      await new Promise((r) => setTimeout(r, 10));

      expect(mockSend).toHaveBeenCalledTimes(3);

      const seqA1 = JSON.parse(mockSend.mock.calls[0][0].messages[0].value).sequence;
      const seqB1 = JSON.parse(mockSend.mock.calls[1][0].messages[0].value).sequence;
      const seqA2 = JSON.parse(mockSend.mock.calls[2][0].messages[0].value).sequence;

      expect(seqA1).toBe(1);
      expect(seqB1).toBe(1); // Independent counter
      expect(seqA2).toBe(2);
    });

    it('resets sequence counter after finalizeRun', async () => {
      const adapter = new KafkaTraceAdapter(defaultConfig, noopLogger);

      adapter.record({
        type: 'NODE_STARTED',
        runId: 'run-reset',
        nodeRef: 'node.a',
        timestamp: new Date().toISOString(),
        level: 'info',
      });

      adapter.finalizeRun('run-reset');

      adapter.record({
        type: 'NODE_STARTED',
        runId: 'run-reset',
        nodeRef: 'node.a',
        timestamp: new Date().toISOString(),
        level: 'info',
      });

      await new Promise((r) => setTimeout(r, 10));

      const seq1 = JSON.parse(mockSend.mock.calls[0][0].messages[0].value).sequence;
      const seq2 = JSON.parse(mockSend.mock.calls[1][0].messages[0].value).sequence;

      expect(seq1).toBe(1);
      expect(seq2).toBe(1); // Reset after finalize
    });
  });

  describe('packData', () => {
    it('packs event.data under _payload and event.context under _metadata', async () => {
      const adapter = new KafkaTraceAdapter(defaultConfig, noopLogger);

      adapter.record({
        type: 'NODE_COMPLETED',
        runId: 'run-pack-1',
        nodeRef: 'node.a',
        timestamp: new Date().toISOString(),
        level: 'info',
        data: { key: 'value', count: 42 },
        context: { source: 'manual', userId: 'user-1' } as any,
      });

      await new Promise((r) => setTimeout(r, 10));

      const payload = JSON.parse(mockSend.mock.calls[0][0].messages[0].value);
      expect(payload.data._payload).toEqual({ key: 'value', count: 42 });
      expect(payload.data._metadata).toEqual({ source: 'manual', userId: 'user-1' });
    });

    it('returns null when both data and context are absent', async () => {
      const adapter = new KafkaTraceAdapter(defaultConfig, noopLogger);

      adapter.record({
        type: 'NODE_STARTED',
        runId: 'run-pack-2',
        nodeRef: 'node.a',
        timestamp: new Date().toISOString(),
        level: 'info',
      });

      await new Promise((r) => setTimeout(r, 10));

      const payload = JSON.parse(mockSend.mock.calls[0][0].messages[0].value);
      expect(payload.data).toBeNull();
    });

    it('packs only _payload when context is absent', async () => {
      const adapter = new KafkaTraceAdapter(defaultConfig, noopLogger);

      adapter.record({
        type: 'NODE_COMPLETED',
        runId: 'run-pack-3',
        nodeRef: 'node.a',
        timestamp: new Date().toISOString(),
        level: 'info',
        data: { result: 'ok' },
      });

      await new Promise((r) => setTimeout(r, 10));

      const payload = JSON.parse(mockSend.mock.calls[0][0].messages[0].value);
      expect(payload.data._payload).toEqual({ result: 'ok' });
      expect(payload.data._metadata).toBeUndefined();
    });

    it('packs only _metadata when data is absent', async () => {
      const adapter = new KafkaTraceAdapter(defaultConfig, noopLogger);

      adapter.record({
        type: 'NODE_STARTED',
        runId: 'run-pack-4',
        nodeRef: 'node.a',
        timestamp: new Date().toISOString(),
        level: 'info',
        context: { workerId: 'w-1' } as any,
      });

      await new Promise((r) => setTimeout(r, 10));

      const payload = JSON.parse(mockSend.mock.calls[0][0].messages[0].value);
      expect(payload.data._metadata).toEqual({ workerId: 'w-1' });
      expect(payload.data._payload).toBeUndefined();
    });
  });

  describe('error handling', () => {
    it('catches and logs CRITICAL send errors without re-throwing', async () => {
      const errorLogger = { log: () => {}, error: vi.fn() };
      const adapter = new KafkaTraceAdapter(defaultConfig, errorLogger);

      mockSend.mockRejectedValueOnce(new Error('Kafka down'));

      adapter.record({
        type: 'NODE_STARTED',
        runId: 'run-err',
        nodeRef: 'node.a',
        timestamp: new Date().toISOString(),
        level: 'info',
      });

      // Allow the fire-and-forget promise chain to resolve
      await new Promise((r) => setTimeout(r, 10));

      expect(errorLogger.error).toHaveBeenCalled();
      const errorMsg = errorLogger.error.mock.calls[0][0];
      expect(errorMsg).toContain('CRITICAL');
      expect(errorMsg).toContain('Failed to send trace event');
    });
  });
});
