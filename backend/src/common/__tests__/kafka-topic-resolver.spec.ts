import { beforeEach, describe, expect, it } from 'bun:test';

import { getTopicResolver, KafkaTopicResolver, resetTopicResolver } from '../kafka-topic-resolver';

describe('KafkaTopicResolver', () => {
  beforeEach(() => {
    resetTopicResolver();
  });

  // ── Default topic names ─────────────────────────────────────────
  describe('default topics (no config)', () => {
    it('uses default topic names when no config is provided', () => {
      const resolver = new KafkaTopicResolver();

      expect(resolver.getLogsTopic()).toBe('telemetry.logs');
      expect(resolver.getEventsTopic()).toBe('telemetry.events');
      expect(resolver.getAgentTraceTopic()).toBe('telemetry.agent-trace');
      expect(resolver.getNodeIOTopic()).toBe('telemetry.node-io');
    });
  });

  // ── Custom topic names ──────────────────────────────────────────
  describe('custom topics', () => {
    it('uses custom topic names from config', () => {
      const resolver = new KafkaTopicResolver({
        topics: {
          logs: 'custom.logs',
          events: 'custom.events',
          agentTrace: 'custom.agent-trace',
          nodeIo: 'custom.node-io',
        },
      });

      expect(resolver.getLogsTopic()).toBe('custom.logs');
      expect(resolver.getEventsTopic()).toBe('custom.events');
      expect(resolver.getAgentTraceTopic()).toBe('custom.agent-trace');
      expect(resolver.getNodeIOTopic()).toBe('custom.node-io');
    });

    it('falls back to defaults for unspecified custom topics', () => {
      const resolver = new KafkaTopicResolver({
        topics: { logs: 'custom.logs' },
      });

      expect(resolver.getLogsTopic()).toBe('custom.logs');
      expect(resolver.getEventsTopic()).toBe('telemetry.events');
    });
  });

  // ── resolveTopic ────────────────────────────────────────────────
  describe('resolveTopic', () => {
    it('returns the base topic name when enableInstanceSuffix is false', () => {
      const resolver = new KafkaTopicResolver({ enableInstanceSuffix: false });

      expect(resolver.resolveTopic('my.topic')).toBe('my.topic');
    });

    it('returns the base topic name when instanceId is not set', () => {
      const resolver = new KafkaTopicResolver({ enableInstanceSuffix: true });

      expect(resolver.resolveTopic('my.topic')).toBe('my.topic');
    });

    it('appends .instance-{id} when both enableInstanceSuffix and instanceId are set', () => {
      const resolver = new KafkaTopicResolver({
        instanceId: '42',
        enableInstanceSuffix: true,
      });

      expect(resolver.resolveTopic('my.topic')).toBe('my.topic.instance-42');
    });

    it('auto-enables instance suffix when instanceId is provided and enableInstanceSuffix is not specified', () => {
      const resolver = new KafkaTopicResolver({ instanceId: '7' });

      expect(resolver.resolveTopic('my.topic')).toBe('my.topic.instance-7');
    });
  });

  // ── Getter methods with instance suffix ─────────────────────────
  describe('getter methods with instance suffix', () => {
    it('appends instance suffix to all getter results', () => {
      const resolver = new KafkaTopicResolver({
        instanceId: '3',
        enableInstanceSuffix: true,
      });

      expect(resolver.getLogsTopic()).toBe('telemetry.logs.instance-3');
      expect(resolver.getEventsTopic()).toBe('telemetry.events.instance-3');
      expect(resolver.getAgentTraceTopic()).toBe('telemetry.agent-trace.instance-3');
      expect(resolver.getNodeIOTopic()).toBe('telemetry.node-io.instance-3');
    });
  });

  // ── isInstanceIsolated ──────────────────────────────────────────
  describe('isInstanceIsolated', () => {
    it('returns true when instance suffix is enabled', () => {
      const resolver = new KafkaTopicResolver({
        instanceId: '1',
        enableInstanceSuffix: true,
      });

      expect(resolver.isInstanceIsolated()).toBe(true);
    });

    it('returns false when instance suffix is disabled', () => {
      const resolver = new KafkaTopicResolver({ enableInstanceSuffix: false });

      expect(resolver.isInstanceIsolated()).toBe(false);
    });

    it('returns false with default config (no instanceId)', () => {
      const resolver = new KafkaTopicResolver();

      expect(resolver.isInstanceIsolated()).toBe(false);
    });
  });

  // ── getInstanceId ───────────────────────────────────────────────
  describe('getInstanceId', () => {
    it('returns the configured instanceId', () => {
      const resolver = new KafkaTopicResolver({ instanceId: '99' });

      expect(resolver.getInstanceId()).toBe('99');
    });

    it('returns undefined when no instanceId is configured', () => {
      const resolver = new KafkaTopicResolver();

      expect(resolver.getInstanceId()).toBeUndefined();
    });
  });

  // ── Singleton pattern ───────────────────────────────────────────
  describe('singleton (getTopicResolver / resetTopicResolver)', () => {
    it('returns the same instance on repeated calls', () => {
      const first = getTopicResolver({ instanceId: '1' });
      const second = getTopicResolver({ instanceId: '2' });

      expect(first).toBe(second);
      // The second config is ignored because the singleton already exists
      expect(second.getInstanceId()).toBe('1');
    });

    it('creates a new instance after resetTopicResolver()', () => {
      const first = getTopicResolver({ instanceId: '1' });
      resetTopicResolver();
      const second = getTopicResolver({ instanceId: '2' });

      expect(first).not.toBe(second);
      expect(second.getInstanceId()).toBe('2');
    });

    it('creates resolver with default config when no config is passed', () => {
      const resolver = getTopicResolver();

      expect(resolver.getLogsTopic()).toBe('telemetry.logs');
      expect(resolver.isInstanceIsolated()).toBe(false);
    });
  });
});
