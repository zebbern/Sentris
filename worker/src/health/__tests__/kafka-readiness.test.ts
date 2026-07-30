import { describe, expect, it, vi } from 'bun:test';

describe('Kafka readiness lifecycle', () => {
  it('connects once, checks the cluster on every probe, and closes the admin client', async () => {
    const kafkaReadiness = await import('../kafka-readiness').catch(() => undefined);
    const admin = {
      connect: vi.fn(async () => undefined),
      describeCluster: vi.fn(async () => ({
        brokers: [{ nodeId: 1, host: 'redpanda', port: 9092 }],
        controller: 1,
        clusterId: 'sentris',
      })),
      disconnect: vi.fn(async () => undefined),
    };
    const readiness = kafkaReadiness?.createKafkaReadiness(admin);

    await readiness?.check();
    await readiness?.check();
    await readiness?.close();

    expect(admin.connect).toHaveBeenCalledTimes(1);
    expect(admin.describeCluster).toHaveBeenCalledTimes(2);
    expect(admin.disconnect).toHaveBeenCalledTimes(1);
  });

  it('retries connection after a failed connect attempt', async () => {
    const kafkaReadiness = await import('../kafka-readiness').catch(() => undefined);
    let attempts = 0;
    const admin = {
      connect: vi.fn(async () => {
        attempts += 1;
        if (attempts === 1) throw new Error('broker unavailable');
      }),
      describeCluster: vi.fn(async () => ({
        brokers: [{ nodeId: 1, host: 'redpanda', port: 9092 }],
        controller: 1,
        clusterId: 'sentris',
      })),
      disconnect: vi.fn(async () => undefined),
    };
    const readiness = kafkaReadiness?.createKafkaReadiness(admin);

    await expect(readiness?.check()).rejects.toThrow('broker unavailable');
    await readiness?.check();

    expect(admin.connect).toHaveBeenCalledTimes(2);
    expect(admin.describeCluster).toHaveBeenCalledTimes(1);
  });
});
