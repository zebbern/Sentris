import { describe, expect, it } from 'bun:test';

import { KafkaTopicResolver } from '../kafka-topic-resolver';

describe('worker KafkaTopicResolver identities', () => {
  it('scopes default producer identities with the active instance', () => {
    const resolver = new KafkaTopicResolver({ instanceId: '7' });

    expect(resolver.resolveClientId('sentris-worker-agent-trace')).toBe(
      'sentris-worker-agent-trace-7',
    );
    expect(resolver.resolveClientId('sentris-worker-node-io')).toBe('sentris-worker-node-io-7');
  });

  it('preserves legacy identities when instance isolation is disabled', () => {
    const resolver = new KafkaTopicResolver({ enableInstanceSuffix: false });

    expect(resolver.resolveClientId('sentris-worker')).toBe('sentris-worker');
  });
});
