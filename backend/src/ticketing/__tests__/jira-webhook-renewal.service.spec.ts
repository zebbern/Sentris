import { describe, expect, it, mock } from 'bun:test';

import { JiraWebhookRenewalService } from '../jira-webhook-renewal.service';

describe('JiraWebhookRenewalService', () => {
  it('queues one bounded page with a ten-day retry window before Jira expiry', async () => {
    const repository = {
      queueDueJiraWebhookRenewals: mock(() => Promise.resolve(3)),
    };
    const service = new JiraWebhookRenewalService(repository as never);
    const now = new Date('2026-07-29T12:00:00.000Z');

    const queued = await service.renewOnce(now);

    expect(queued).toBe(3);
    expect(repository.queueDueJiraWebhookRenewals).toHaveBeenCalledWith(
      new Date('2026-07-09T12:00:00.000Z'),
      100,
    );
  });

  it('starts a renewal scan during bootstrap and releases its periodic timer on shutdown', async () => {
    const repository = {
      queueDueJiraWebhookRenewals: mock(() => Promise.resolve(0)),
    };
    const service = new JiraWebhookRenewalService(repository as never);

    service.onApplicationBootstrap();
    await Promise.resolve();
    await Promise.resolve();

    expect(repository.queueDueJiraWebhookRenewals).toHaveBeenCalledTimes(1);
    service.onModuleDestroy();
  });

  it('continues draining another bounded page on the next periodic tick', async () => {
    const repository = {
      queueDueJiraWebhookRenewals: mock().mockResolvedValueOnce(100).mockResolvedValueOnce(20),
    };
    const service = new JiraWebhookRenewalService(repository as never);
    const now = new Date('2026-07-29T12:00:00.000Z');

    expect(await service.renewOnce(now)).toBe(100);
    expect(await service.renewOnce(now)).toBe(20);

    expect(repository.queueDueJiraWebhookRenewals).toHaveBeenCalledTimes(2);
    expect(repository.queueDueJiraWebhookRenewals).toHaveBeenNthCalledWith(
      2,
      new Date('2026-07-09T12:00:00.000Z'),
      100,
    );
  });
});
