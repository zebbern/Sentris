import { describe, expect, it, mock } from 'bun:test';

import { OutboxReceiptCleanupService } from '../outbox-receipt-cleanup.service';
import type { OutboxRepository } from '../outbox.repository';
import type { ConfigService } from '@nestjs/config';

describe('OutboxReceiptCleanupService', () => {
  it('uses a controlled retention cutoff and bounded delete batch', async () => {
    const repository = {
      purgeKafkaReceiptsBefore: mock(async () => 3),
      purgeCompletedTelemetryPublicationsBefore: mock(async () => 4),
    } as unknown as OutboxRepository;
    const config = {
      get: mock((key: string) =>
        key === 'TELEMETRY_KAFKA_RECEIPT_RETENTION_DAYS' ? '30' : undefined,
      ),
    } as unknown as ConfigService;
    const service = new OutboxReceiptCleanupService(repository, config);

    const removed = await service.cleanupOnce(new Date('2026-07-26T00:00:00.000Z'));

    expect(removed).toBe(7);
    expect(repository.purgeKafkaReceiptsBefore).toHaveBeenCalledWith(
      new Date('2026-06-26T00:00:00.000Z'),
      10_000,
    );
    expect(repository.purgeCompletedTelemetryPublicationsBefore).toHaveBeenCalledWith(
      new Date('2026-06-26T00:00:00.000Z'),
      10_000,
    );
  });

  it('rejects a retention horizon shorter than the supported broker replay floor', () => {
    const repository = {
      purgeKafkaReceiptsBefore: mock(async () => 0),
      purgeCompletedTelemetryPublicationsBefore: mock(async () => 0),
    } as unknown as OutboxRepository;
    const config = {
      get: mock(() => '3'),
    } as unknown as ConfigService;

    expect(() => new OutboxReceiptCleanupService(repository, config)).toThrow(
      'must be at least 8 days',
    );
  });

  it('drains repeated bounded batches when an aged backlog exceeds one batch', async () => {
    const purgeKafkaReceiptsBefore = mock(async () => 0);
    purgeKafkaReceiptsBefore.mockResolvedValueOnce(10_000).mockResolvedValueOnce(2);
    const purgeCompletedTelemetryPublicationsBefore = mock(async () => 0);
    purgeCompletedTelemetryPublicationsBefore
      .mockResolvedValueOnce(10_000)
      .mockResolvedValueOnce(10_000)
      .mockResolvedValueOnce(4);
    const repository = {
      purgeKafkaReceiptsBefore,
      purgeCompletedTelemetryPublicationsBefore,
    } as unknown as OutboxRepository;
    const config = {
      get: mock(() => undefined),
    } as unknown as ConfigService;
    const service = new OutboxReceiptCleanupService(repository, config);

    const removed = await service.cleanupOnce(new Date('2026-07-26T00:00:00.000Z'));

    expect(removed).toBe(30_006);
    expect(repository.purgeKafkaReceiptsBefore).toHaveBeenCalledTimes(2);
    expect(repository.purgeCompletedTelemetryPublicationsBefore).toHaveBeenCalledTimes(3);
  });
});
