import { describe, it, expect, beforeEach, mock, vi } from 'bun:test';
import { MAX_KAFKA_MESSAGE_BYTES, type TraceEvent } from '@sentris/component-sdk';

const mockSend = vi.fn().mockResolvedValue(undefined);
const mockConnect = vi.fn().mockResolvedValue(undefined);
const mockDisconnect = vi.fn().mockResolvedValue(undefined);

mock.module('kafkajs', () => ({
  Kafka: vi.fn(() => ({
    producer: vi.fn(() => ({
      connect: mockConnect,
      send: mockSend,
      disconnect: mockDisconnect,
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
    mockDisconnect.mockClear();
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
    it('does not rely on process-local run metadata for tenant identity', async () => {
      const adapter = new KafkaTraceAdapter(defaultConfig, noopLogger);

      adapter.setRunMetadata('run-meta-1', {
        workflowId: 'stale-workflow',
        organizationId: 'stale-organization',
      });

      const event: TraceEvent = {
        type: 'NODE_STARTED',
        runId: 'run-meta-1',
        nodeRef: 'node.a',
        timestamp: new Date().toISOString(),
        level: 'info',
      };

      await adapter.record(event);

      expect(mockSend).toHaveBeenCalledTimes(1);
      const payload = JSON.parse(mockSend.mock.calls[0][0].messages[0].value);
      expect(payload.workflowId).toBeNull();
      expect(payload.organizationId).toBeNull();

      adapter.finalizeRun('run-meta-1');

      mockSend.mockClear();
      await adapter.record({
        ...event,
        type: 'NODE_COMPLETED',
        workflowId: 'wf-1',
        organizationId: 'org-1',
      });

      const postPayload = JSON.parse(mockSend.mock.calls[0][0].messages[0].value);
      expect(postPayload.workflowId).toBe('wf-1');
      expect(postPayload.organizationId).toBe('org-1');
    });
  });

  describe('shutdown', () => {
    it('disconnects a producer that was connected by the fast path', async () => {
      const adapter = new KafkaTraceAdapter(defaultConfig, noopLogger);

      await adapter.record({
        type: 'NODE_STARTED',
        runId: 'run-shutdown',
        nodeRef: 'node.a',
        timestamp: '2026-07-29T10:00:00.000Z',
        level: 'info',
      });
      await adapter.close();

      expect(mockDisconnect).toHaveBeenCalledTimes(1);
    });
  });

  describe('record', () => {
    it('does not resolve durable publication until Kafka acknowledges the event', async () => {
      let releaseSend: (() => void) | undefined;
      const sendGate = new Promise<void>((resolve) => {
        releaseSend = resolve;
      });
      mockSend.mockImplementationOnce(async () => sendGate);
      const adapter = new KafkaTraceAdapter(defaultConfig, noopLogger);
      let settled = false;

      const publication = Promise.resolve(
        adapter.record({
          type: 'NODE_STARTED',
          runId: 'run-durable-1',
          workflowId: 'wf-1',
          organizationId: 'org-1',
          eventId: 'trace:run-durable-1:activity-7:1',
          sequence: 70_001,
          nodeRef: 'node.scanner',
          timestamp: '2026-07-26T12:00:00.000Z',
          level: 'info',
        } as TraceEvent),
      ).then(() => {
        settled = true;
      });

      await Promise.resolve();
      expect(settled).toBe(false);
      releaseSend?.();
      await publication;

      expect(mockSend).toHaveBeenCalledWith({
        topic: 'trace-events',
        messages: [
          expect.objectContaining({
            key: 'run-durable-1',
            value: expect.any(String),
          }),
        ],
      });
      const payload = JSON.parse(mockSend.mock.calls[0][0].messages[0].value);
      expect(payload).toMatchObject({
        workflowId: 'wf-1',
        organizationId: 'org-1',
        eventId: 'trace:run-durable-1:activity-7:1',
        sequence: 70_001,
      });
    });

    it('derives the same fallback identity without relying on process-local counters', async () => {
      const first = new KafkaTraceAdapter(defaultConfig, noopLogger);
      const second = new KafkaTraceAdapter(defaultConfig, noopLogger);
      const event: TraceEvent = {
        type: 'NODE_STARTED',
        runId: 'run-restarted',
        nodeRef: 'node.scanner',
        timestamp: '2026-07-26T12:00:00.000Z',
        level: 'info',
        context: { runId: 'run-restarted', componentRef: 'node.scanner', activityId: '17' },
      };

      await Promise.resolve(first.record(event));
      await Promise.resolve(second.record(event));

      const firstPayload = JSON.parse(mockSend.mock.calls[0][0].messages[0].value);
      const secondPayload = JSON.parse(mockSend.mock.calls[1][0].messages[0].value);
      expect(firstPayload.eventId).toBeString();
      expect(secondPayload.eventId).toBe(firstPayload.eventId);
      expect(secondPayload.sequence).toBe(firstPayload.sequence);
    });

    it('serializes event with correct fields including metadata', async () => {
      const adapter = new KafkaTraceAdapter(defaultConfig, noopLogger);

      const timestamp = new Date().toISOString();
      await adapter.record({
        type: 'NODE_STARTED',
        runId: 'run-rec-1',
        workflowId: 'wf-2',
        organizationId: 'org-2',
        nodeRef: 'node.scanner',
        timestamp,
        level: 'info',
        message: 'Starting scan',
      });

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

    it('truncates oversized trace payloads before sending to Kafka', async () => {
      const adapter = new KafkaTraceAdapter(defaultConfig, noopLogger);

      adapter.record({
        type: 'NODE_COMPLETED',
        runId: 'run-large-trace',
        nodeRef: 'node.ai',
        timestamp: new Date().toISOString(),
        level: 'info',
        message: 'Agent completed',
        outputSummary: {
          report: 'x'.repeat(MAX_KAFKA_MESSAGE_BYTES),
        },
        data: {
          report: 'y'.repeat(MAX_KAFKA_MESSAGE_BYTES),
        },
        sequence: 1,
      });

      await new Promise((r) => setTimeout(r, 10));

      expect(mockSend).toHaveBeenCalledTimes(1);
      const value = mockSend.mock.calls[0][0].messages[0].value;
      expect(Buffer.byteLength(value, 'utf8')).toBeLessThan(MAX_KAFKA_MESSAGE_BYTES);

      const payload = JSON.parse(value);
      expect(payload.outputSummary._truncated).toBe(true);
      expect(payload.data._truncated).toBe(true);
      expect(payload.data._originalSize).toBeGreaterThan(MAX_KAFKA_MESSAGE_BYTES);
      expect(payload.runId).toBe('run-large-trace');
      expect(payload.sequence).toBe(1);
    });
  });

  describe('sequence numbering', () => {
    it('preserves stable producer-supplied sequence numbers', async () => {
      const adapter = new KafkaTraceAdapter(defaultConfig, noopLogger);

      const makeEvent = (type: TraceEvent['type'], sequence: number): TraceEvent => ({
        type,
        runId: 'run-seq-1',
        nodeRef: 'node.a',
        timestamp: new Date().toISOString(),
        level: 'info',
        sequence,
      });

      adapter.record(makeEvent('NODE_STARTED', 10_001));
      adapter.record(makeEvent('NODE_PROGRESS', 10_002));
      adapter.record(makeEvent('NODE_COMPLETED', 10_003));

      await new Promise((r) => setTimeout(r, 10));

      expect(mockSend).toHaveBeenCalledTimes(3);

      const seq1 = JSON.parse(mockSend.mock.calls[0][0].messages[0].value).sequence;
      const seq2 = JSON.parse(mockSend.mock.calls[1][0].messages[0].value).sequence;
      const seq3 = JSON.parse(mockSend.mock.calls[2][0].messages[0].value).sequence;

      expect(seq1).toBe(10_001);
      expect(seq2).toBe(10_002);
      expect(seq3).toBe(10_003);
    });

    it('derives positive fallback sequences for legacy events', async () => {
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

      expect(seqA1).toBeGreaterThan(0);
      expect(seqB1).toBeGreaterThan(0);
      expect(seqA2).toBeGreaterThan(0);
      expect(seqA2).not.toBe(seqA1);
    });

    it('keeps fallback identity stable across metadata finalization', async () => {
      const adapter = new KafkaTraceAdapter(defaultConfig, noopLogger);
      const timestamp = '2026-07-26T12:00:00.000Z';

      adapter.record({
        type: 'NODE_STARTED',
        runId: 'run-reset',
        nodeRef: 'node.a',
        timestamp,
        level: 'info',
      });

      adapter.finalizeRun('run-reset');

      adapter.record({
        type: 'NODE_STARTED',
        runId: 'run-reset',
        nodeRef: 'node.a',
        timestamp,
        level: 'info',
      });

      await new Promise((r) => setTimeout(r, 10));

      const seq1 = JSON.parse(mockSend.mock.calls[0][0].messages[0].value).sequence;
      const seq2 = JSON.parse(mockSend.mock.calls[1][0].messages[0].value).sequence;

      expect(seq2).toBe(seq1);
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
    it('queues the stable trace envelope when Kafka retries are exhausted', async () => {
      const fallback = { enqueue: vi.fn(async () => undefined) };
      const adapter = new KafkaTraceAdapter(defaultConfig, noopLogger, fallback);
      mockSend.mockRejectedValueOnce(new Error('Kafka broker unavailable'));

      await expect(
        adapter.record({
          type: 'NODE_COMPLETED',
          runId: 'run-fallback',
          workflowId: 'workflow-1',
          organizationId: 'org-1',
          eventId: 'trace:run-fallback:node-1:completed',
          sequence: 7,
          nodeRef: 'node-1',
          timestamp: '2026-07-29T10:00:00.000Z',
          level: 'info',
        }),
      ).resolves.toBeUndefined();

      expect(fallback.enqueue).toHaveBeenCalledWith({
        topic: 'trace-events',
        key: 'run-fallback',
        value: expect.stringContaining('"eventId":"trace:run-fallback:node-1:completed"'),
        organizationId: 'org-1',
      });
    });

    it('logs and propagates exhausted send errors to durable activity callers', async () => {
      const errorLogger = { log: () => {}, error: vi.fn() };
      const adapter = new KafkaTraceAdapter(defaultConfig, errorLogger);

      mockSend.mockRejectedValueOnce(new Error('Kafka down'));

      await expect(
        Promise.resolve(
          adapter.record({
            type: 'NODE_STARTED',
            runId: 'run-err',
            nodeRef: 'node.a',
            timestamp: new Date().toISOString(),
            level: 'info',
          }),
        ),
      ).rejects.toThrow('Kafka down');

      expect(errorLogger.error).toHaveBeenCalled();
      const errorMsg = errorLogger.error.mock.calls[0][0];
      expect(errorMsg).toContain('CRITICAL');
      expect(errorMsg).toContain('Failed to send trace event');
    });
  });
});
