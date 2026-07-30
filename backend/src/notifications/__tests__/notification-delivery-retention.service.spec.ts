import { describe, expect, it, mock } from 'bun:test';
import { ConfigService } from '@nestjs/config';

import type { NotificationDeliveryRepository } from '../repository/notification-delivery.repository';
import { NotificationDeliveryRetentionService } from '../notification-delivery-retention.service';

describe('NotificationDeliveryRetentionService', () => {
  it('uses the configured horizon and bounded cleanup batches', async () => {
    const purgeResolvedBefore = mock().mockResolvedValueOnce(1_000).mockResolvedValueOnce(25);
    const repository = {
      purgeResolvedBefore,
    } as unknown as NotificationDeliveryRepository;
    const config = new ConfigService({
      NOTIFICATION_DELIVERY_RETENTION_DAYS: 30,
    });
    const service = new NotificationDeliveryRetentionService(repository, config);
    const now = new Date('2026-07-29T00:00:00.000Z');

    await expect(service.cleanupOnce(now)).resolves.toBe(1_025);
    expect(purgeResolvedBefore).toHaveBeenCalledTimes(2);
    expect(purgeResolvedBefore).toHaveBeenNthCalledWith(
      1,
      new Date('2026-06-29T00:00:00.000Z'),
      1_000,
    );
    expect(purgeResolvedBefore).toHaveBeenNthCalledWith(
      2,
      new Date('2026-06-29T00:00:00.000Z'),
      1_000,
    );
  });

  it('caps each scheduled pass so cleanup cannot monopolize the database', async () => {
    const purgeResolvedBefore = mock(() => Promise.resolve(1_000));
    const repository = {
      purgeResolvedBefore,
    } as unknown as NotificationDeliveryRepository;
    const service = new NotificationDeliveryRetentionService(
      repository,
      new ConfigService({ NOTIFICATION_DELIVERY_RETENTION_DAYS: 90 }),
    );

    await expect(service.cleanupOnce(new Date('2026-07-29T00:00:00.000Z'))).resolves.toBe(10_000);
    expect(purgeResolvedBefore).toHaveBeenCalledTimes(10);
  });
});
