import { describe, it, expect, beforeEach, mock, vi } from 'bun:test';
import type { AgentTraceEvent } from '@sentris/component-sdk';

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

// Import after mock.module so the mock is applied
const { KafkaAgentTracePublisher } = await import('../kafka-agent-trace.adapter');
const { ConfigurationError } = await import('@sentris/component-sdk');

describe('KafkaAgentTracePublisher', () => {
  const noopLogger = { log: () => {}, error: () => {} };

  const defaultConfig = {
    brokers: ['localhost:9092'],
    topic: 'agent-trace-events',
  };

  beforeEach(() => {
    mockSend.mockClear();
    mockConnect.mockClear();
    mockDisconnect.mockClear();
  });

  describe('constructor', () => {
    it('throws ConfigurationError when brokers array is empty', () => {
      expect(
        () => new KafkaAgentTracePublisher({ brokers: [], topic: 'test' }, noopLogger),
      ).toThrow(ConfigurationError);
    });

    it('creates successfully with valid config', () => {
      const publisher = new KafkaAgentTracePublisher(defaultConfig, noopLogger);
      expect(publisher).toBeDefined();
    });
  });

  describe('publish', () => {
    it('sends a JSON-serialized message to the configured topic', async () => {
      const publisher = new KafkaAgentTracePublisher(defaultConfig, noopLogger);

      const event: AgentTraceEvent = {
        agentRunId: 'agent-run-1',
        workflowRunId: 'wf-run-1',
        nodeRef: 'node.agent',
        sequence: 1,
        timestamp: new Date().toISOString(),
        part: { type: 'text', content: 'Hello' },
      };

      await publisher.publish(event);

      expect(mockSend).toHaveBeenCalledTimes(1);
      const sendCall = mockSend.mock.calls[0][0];
      expect(sendCall.topic).toBe('agent-trace-events');
      expect(sendCall.messages).toHaveLength(1);

      const parsed = JSON.parse(sendCall.messages[0].value);
      expect(parsed.agentRunId).toBe('agent-run-1');
      expect(parsed.workflowRunId).toBe('wf-run-1');
      expect(parsed.nodeRef).toBe('node.agent');
      expect(parsed.sequence).toBe(1);
      expect(parsed.part).toEqual({ type: 'text', content: 'Hello' });
    });

    it('awaits the connect promise before sending', async () => {
      const callOrder: string[] = [];

      mockConnect.mockImplementation(async () => {
        callOrder.push('connect');
      });
      mockSend.mockImplementation(async () => {
        callOrder.push('send');
      });

      const publisher = new KafkaAgentTracePublisher(defaultConfig, noopLogger);

      const event: AgentTraceEvent = {
        agentRunId: 'agent-run-2',
        workflowRunId: 'wf-run-2',
        nodeRef: 'node.agent',
        sequence: 1,
        timestamp: new Date().toISOString(),
        part: { type: 'text', content: 'Test' },
      };

      await publisher.publish(event);

      expect(callOrder).toEqual(['connect', 'send']);
    });

    it('catches and logs send errors without re-throwing', async () => {
      const errorLogger = { log: () => {}, error: vi.fn() };
      const publisher = new KafkaAgentTracePublisher(defaultConfig, errorLogger);

      mockSend.mockRejectedValueOnce(new Error('Kafka broker unavailable'));

      const event: AgentTraceEvent = {
        agentRunId: 'agent-run-3',
        workflowRunId: 'wf-run-3',
        nodeRef: 'node.agent',
        sequence: 1,
        timestamp: new Date().toISOString(),
        part: { type: 'text', content: 'Failing' },
      };

      // Should NOT throw
      await publisher.publish(event);

      expect(errorLogger.error).toHaveBeenCalledTimes(1);
      expect(errorLogger.error.mock.calls[0][0]).toContain('Failed to send agent trace event');
    });
  });
});
