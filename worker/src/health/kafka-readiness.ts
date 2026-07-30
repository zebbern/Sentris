import type { Admin } from 'kafkajs';

import type { KafkaReadiness } from './readiness-checks';

type KafkaAdmin = Pick<Admin, 'connect' | 'describeCluster' | 'disconnect'>;

export function createKafkaReadiness(admin: KafkaAdmin): Required<KafkaReadiness> {
  let connected = false;
  let connectPromise: Promise<void> | undefined;

  const ensureConnected = async () => {
    if (connected) return;
    if (!connectPromise) {
      connectPromise = admin
        .connect()
        .then(() => {
          connected = true;
        })
        .finally(() => {
          connectPromise = undefined;
        });
    }
    await connectPromise;
  };

  return {
    async check() {
      await ensureConnected();
      const cluster = await admin.describeCluster();
      if (cluster.brokers.length === 0) {
        throw new Error('Kafka cluster returned no brokers');
      }
    },
    async close() {
      if (connectPromise) {
        await connectPromise.catch(() => undefined);
      }
      if (!connected) return;
      connected = false;
      await admin.disconnect();
    },
  };
}
