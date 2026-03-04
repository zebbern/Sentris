import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  NotImplementedException,
} from '@nestjs/common';
import { beforeEach, describe, expect, it, mock } from 'bun:test';

import type { AuthContext } from '../../auth/types';
import type { NotificationChannelRecord, NotificationDeliveryRecord } from '../../database/schema';
import type { NotificationChannelRepository } from '../repository/notification-channel.repository';
import type { NotificationDeliveryRepository } from '../repository/notification-delivery.repository';
import type { SlackNotificationAdapter } from '../adapters/slack.adapter';
import { NotificationsService } from '../notifications.service';

// ---------------------------------------------------------------------------
// Auth fixtures
// ---------------------------------------------------------------------------

const authContext: AuthContext = {
  userId: 'user-1',
  organizationId: 'org-1',
  roles: ['ADMIN'],
  provider: 'local',
  isAuthenticated: true,
};

const authNoOrg: AuthContext = {
  userId: 'user-1',
  organizationId: null,
  roles: ['ADMIN'],
  provider: 'local',
  isAuthenticated: true,
};

// ---------------------------------------------------------------------------
// Record factories
// ---------------------------------------------------------------------------

function makeChannelRecord(
  overrides: Partial<NotificationChannelRecord> = {},
): NotificationChannelRecord {
  const now = new Date();
  return {
    id: overrides.id ?? 'ch-1',
    organizationId: overrides.organizationId ?? 'org-1',
    name: overrides.name ?? 'Slack Alerts',
    type: overrides.type ?? 'slack',
    config: overrides.config ?? { webhookUrl: 'https://hooks.slack.com/services/T00/B00/xxxx1234' },
    status: overrides.status ?? 'active',
    events: overrides.events ?? ['run.failed'],
    createdBy: overrides.createdBy ?? 'user-1',
    createdAt: overrides.createdAt ?? now,
    updatedAt: overrides.updatedAt ?? now,
  };
}

function makeDeliveryRecord(
  overrides: Partial<NotificationDeliveryRecord> = {},
): NotificationDeliveryRecord {
  const now = new Date();
  return {
    id: overrides.id ?? 'del-1',
    channelId: overrides.channelId ?? 'ch-1',
    runId: overrides.runId ?? 'run-1',
    eventType: overrides.eventType ?? 'run.failed',
    status: overrides.status ?? 'sent',
    payload: overrides.payload ?? {},
    errorMessage: overrides.errorMessage ?? null,
    createdAt: overrides.createdAt ?? now,
    sentAt: overrides.sentAt ?? now,
  };
}

// ---------------------------------------------------------------------------
// In-memory repositories
// ---------------------------------------------------------------------------

class InMemoryChannelRepository implements Partial<NotificationChannelRepository> {
  private records = new Map<string, NotificationChannelRecord>();
  private seq = 0;

  async create(values: Partial<NotificationChannelRecord>): Promise<NotificationChannelRecord> {
    this.seq += 1;
    const record = makeChannelRecord({
      ...values,
      id: values.id ?? `ch-${this.seq}`,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    this.records.set(record.id, record);
    return record;
  }

  async findById(
    id: string,
    options: { organizationId?: string } = {},
  ): Promise<NotificationChannelRecord | undefined> {
    const rec = this.records.get(id);
    if (!rec) return undefined;
    if (options.organizationId && rec.organizationId !== options.organizationId) return undefined;
    return rec;
  }

  async list(filters: { organizationId: string }): Promise<NotificationChannelRecord[]> {
    return Array.from(this.records.values()).filter(
      (r) => r.organizationId === filters.organizationId,
    );
  }

  async update(
    id: string,
    values: Partial<NotificationChannelRecord>,
    options: { organizationId?: string } = {},
  ): Promise<NotificationChannelRecord | undefined> {
    const existing = await this.findById(id, options);
    if (!existing) return undefined;
    const updated = { ...existing, ...values, updatedAt: new Date() };
    this.records.set(id, updated);
    return updated;
  }

  async delete(id: string, options: { organizationId?: string } = {}): Promise<void> {
    const rec = await this.findById(id, options);
    if (rec) this.records.delete(id);
  }

  async findActiveByEventType(
    organizationId: string,
    eventType: string,
  ): Promise<NotificationChannelRecord[]> {
    return Array.from(this.records.values()).filter(
      (r) =>
        r.organizationId === organizationId &&
        r.status === 'active' &&
        (r.events as string[]).includes(eventType),
    );
  }
}

class InMemoryDeliveryRepository implements Partial<NotificationDeliveryRepository> {
  private records = new Map<string, NotificationDeliveryRecord>();
  private seq = 0;

  async create(values: Partial<NotificationDeliveryRecord>): Promise<NotificationDeliveryRecord> {
    this.seq += 1;
    const record = makeDeliveryRecord({
      ...values,
      id: values.id ?? `del-${this.seq}`,
      createdAt: new Date(),
    });
    this.records.set(record.id, record);
    return record;
  }

  async listByChannelId(channelId: string): Promise<NotificationDeliveryRecord[]> {
    return Array.from(this.records.values())
      .filter((r) => r.channelId === channelId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }
}

// ---------------------------------------------------------------------------
// Tests — Part 1: list, get, create
// ---------------------------------------------------------------------------

describe('NotificationsService', () => {
  let channelRepo: InMemoryChannelRepository;
  let deliveryRepo: InMemoryDeliveryRepository;
  let service: NotificationsService;
  let slackAdapterSend: ReturnType<typeof mock>;
  let auditRecordCalls: unknown[][];

  beforeEach(() => {
    channelRepo = new InMemoryChannelRepository();
    deliveryRepo = new InMemoryDeliveryRepository();
    slackAdapterSend = mock(() => Promise.resolve({ success: true }));
    auditRecordCalls = [];

    const slackAdapter = { send: slackAdapterSend } as unknown as SlackNotificationAdapter;
    const auditLogService = {
      record: (...args: unknown[]) => {
        auditRecordCalls.push(args);
      },
    };

    service = new NotificationsService(
      channelRepo as unknown as NotificationChannelRepository,
      deliveryRepo as unknown as NotificationDeliveryRepository,
      slackAdapter,
      auditLogService as any,
    );
  });

  describe('list', () => {
    it('returns mapped channels for the organization', async () => {
      await channelRepo.create({
        organizationId: 'org-1',
        name: 'A',
        type: 'slack',
        config: { webhookUrl: 'https://hooks.slack.com/T/B/abcd1234' },
        events: ['run.failed'],
      });
      await channelRepo.create({
        organizationId: 'org-2',
        name: 'B',
        type: 'slack',
        config: { webhookUrl: 'https://hooks.slack.com/T/B/x' },
        events: ['run.completed'],
      });

      const results = await service.list(authContext);
      expect(results.length).toBe(1);
      expect(results[0]!.name).toBe('A');
    });

    it('masks webhookUrl in list responses', async () => {
      await channelRepo.create({
        organizationId: 'org-1',
        name: 'M',
        type: 'slack',
        config: { webhookUrl: 'https://hooks.slack.com/services/T/B/secret12' },
        events: ['run.failed'],
      });
      const results = await service.list(authContext);
      expect(results[0]!.config.webhookUrl).toBe('****secret12');
    });

    it('throws ForbiddenException without org context', async () => {
      await expect(service.list(authNoOrg)).rejects.toThrow(ForbiddenException);
    });
  });

  describe('get', () => {
    it('returns a channel by id', async () => {
      const rec = await channelRepo.create({
        organizationId: 'org-1',
        name: 'T',
        type: 'slack',
        config: { webhookUrl: 'https://hooks.slack.com/T/B/abcd1234' },
        events: ['run.failed'],
      });
      const result = await service.get(authContext, rec.id);
      expect(result.id).toBe(rec.id);
    });

    it('masks webhookUrl in get response', async () => {
      const rec = await channelRepo.create({
        organizationId: 'org-1',
        name: 'T',
        type: 'slack',
        config: { webhookUrl: 'https://hooks.slack.com/T/B/longurl1' },
        events: ['run.failed'],
      });
      const result = await service.get(authContext, rec.id);
      expect(result.config.webhookUrl).toBe('****longurl1');
    });

    it('throws NotFoundException for non-existent channel', async () => {
      await expect(service.get(authContext, 'non-existent')).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException for channel from different org', async () => {
      const rec = await channelRepo.create({
        organizationId: 'other-org',
        name: 'X',
        type: 'slack',
        config: { webhookUrl: 'https://hooks.slack.com/T/B/x' },
        events: ['run.failed'],
      });
      await expect(service.get(authContext, rec.id)).rejects.toThrow(NotFoundException);
    });
  });

  describe('create', () => {
    it('creates a channel with valid Slack config', async () => {
      const result = await service.create(authContext, {
        name: 'New',
        type: 'slack',
        config: { webhookUrl: 'https://hooks.slack.com/T/B/abcd1234' },
        events: ['run.failed', 'run.completed'],
      });
      expect(result).toBeDefined();
      expect(result.name).toBe('New');
      expect(result.type).toBe('slack');
      expect(result.status).toBe('active');
    });

    it('returns unmasked config on creation', async () => {
      const result = await service.create(authContext, {
        name: 'Full',
        type: 'slack',
        config: { webhookUrl: 'https://hooks.slack.com/T/B/fullurl1' },
        events: ['run.failed'],
      });
      expect(result.config.webhookUrl).toBe('https://hooks.slack.com/T/B/fullurl1');
    });

    it('records audit log on creation', async () => {
      await service.create(authContext, {
        name: 'Audit',
        type: 'slack',
        config: { webhookUrl: 'https://hooks.slack.com/T/B/audit123' },
        events: ['run.failed'],
      });
      expect(auditRecordCalls.length).toBe(1);
      expect((auditRecordCalls[0]![1] as any).action).toBe('notification_channel.create');
    });

    it('throws BadRequestException for missing webhookUrl', async () => {
      await expect(
        service.create(authContext, {
          name: 'Bad',
          type: 'slack',
          config: {},
          events: ['run.failed'],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException for invalid webhookUrl', async () => {
      await expect(
        service.create(authContext, {
          name: 'Bad',
          type: 'slack',
          config: { webhookUrl: 'not-a-url' },
          events: ['run.failed'],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws ForbiddenException without org context', async () => {
      await expect(
        service.create(authNoOrg, {
          name: 'No',
          type: 'slack',
          config: { webhookUrl: 'https://hooks.slack.com/T/B/x' },
          events: ['run.failed'],
        }),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('update', () => {
    it('updates channel name', async () => {
      const rec = await channelRepo.create({
        organizationId: 'org-1',
        name: 'Old',
        type: 'slack',
        config: { webhookUrl: 'https://hooks.slack.com/T/B/abcd1234' },
        events: ['run.failed'],
      });
      const result = await service.update(authContext, rec.id, { name: 'New' });
      expect(result.name).toBe('New');
    });

    it('updates channel status', async () => {
      const rec = await channelRepo.create({
        organizationId: 'org-1',
        name: 'T',
        type: 'slack',
        config: { webhookUrl: 'https://hooks.slack.com/T/B/abcd1234' },
        events: ['run.failed'],
      });
      const result = await service.update(authContext, rec.id, { status: 'inactive' });
      expect(result.status).toBe('inactive');
    });

    it('records audit log on update', async () => {
      const rec = await channelRepo.create({
        organizationId: 'org-1',
        name: 'A',
        type: 'slack',
        config: { webhookUrl: 'https://hooks.slack.com/T/B/x' },
        events: ['run.failed'],
      });
      await service.update(authContext, rec.id, { name: 'B' });
      const updateAudit = auditRecordCalls.find(
        ([, d]: unknown[]) => (d as any).action === 'notification_channel.update',
      );
      expect(updateAudit).toBeDefined();
    });

    it('throws NotFoundException for non-existent channel', async () => {
      await expect(service.update(authContext, 'nope', { name: 'x' })).rejects.toThrow(
        NotFoundException,
      );
    });

    it('validates config when provided', async () => {
      const rec = await channelRepo.create({
        organizationId: 'org-1',
        name: 'V',
        type: 'slack',
        config: { webhookUrl: 'https://hooks.slack.com/T/B/abcd1234' },
        events: ['run.failed'],
      });
      await expect(
        service.update(authContext, rec.id, { config: { webhookUrl: 'not-a-url' } }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('delete', () => {
    it('deletes an existing channel', async () => {
      const rec = await channelRepo.create({
        organizationId: 'org-1',
        name: 'Del',
        type: 'slack',
        config: { webhookUrl: 'https://hooks.slack.com/T/B/x' },
        events: ['run.failed'],
      });
      await service.delete(authContext, rec.id);
      expect(await channelRepo.findById(rec.id)).toBeUndefined();
    });

    it('records audit log on deletion', async () => {
      const rec = await channelRepo.create({
        organizationId: 'org-1',
        name: 'AD',
        type: 'slack',
        config: { webhookUrl: 'https://hooks.slack.com/T/B/x' },
        events: ['run.failed'],
      });
      await service.delete(authContext, rec.id);
      const delAudit = auditRecordCalls.find(
        ([, d]: unknown[]) => (d as any).action === 'notification_channel.delete',
      );
      expect(delAudit).toBeDefined();
    });

    it('throws NotFoundException for non-existent channel', async () => {
      await expect(service.delete(authContext, 'nope')).rejects.toThrow(NotFoundException);
    });
  });

  describe('testChannel', () => {
    it('calls Slack adapter and returns result', async () => {
      const rec = await channelRepo.create({
        organizationId: 'org-1',
        name: 'T',
        type: 'slack',
        config: { webhookUrl: 'https://hooks.slack.com/T/B/x' },
        events: ['run.failed'],
      });
      const result = await service.testChannel(authContext, rec.id);
      expect(result.success).toBe(true);
      expect(slackAdapterSend).toHaveBeenCalledTimes(1);
    });

    it('throws NotImplementedException for email type', async () => {
      const rec = await channelRepo.create({
        organizationId: 'org-1',
        name: 'E',
        type: 'email',
        config: { recipients: ['a@b.com'] },
        events: ['run.failed'],
      });
      await expect(service.testChannel(authContext, rec.id)).rejects.toThrow(
        NotImplementedException,
      );
    });

    it('throws NotImplementedException for pagerduty type', async () => {
      const rec = await channelRepo.create({
        organizationId: 'org-1',
        name: 'P',
        type: 'pagerduty',
        config: { routingKey: 'x' },
        events: ['run.failed'],
      });
      await expect(service.testChannel(authContext, rec.id)).rejects.toThrow(
        NotImplementedException,
      );
    });

    it('throws NotFoundException for non-existent channel', async () => {
      await expect(service.testChannel(authContext, 'nope')).rejects.toThrow(NotFoundException);
    });
  });

  describe('listDeliveries', () => {
    it('returns deliveries for a channel', async () => {
      const rec = await channelRepo.create({
        organizationId: 'org-1',
        name: 'D',
        type: 'slack',
        config: { webhookUrl: 'https://hooks.slack.com/T/B/x' },
        events: ['run.failed'],
      });
      await deliveryRepo.create({
        channelId: rec.id,
        runId: 'run-1',
        eventType: 'run.failed',
        status: 'sent',
        payload: {},
      });
      const results = await service.listDeliveries(authContext, rec.id);
      expect(results.length).toBe(1);
      expect(results[0]!.channelId).toBe(rec.id);
    });

    it('throws NotFoundException for non-existent channel', async () => {
      await expect(service.listDeliveries(authContext, 'nope')).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException for channel from different org', async () => {
      const rec = await channelRepo.create({
        organizationId: 'other-org',
        name: 'O',
        type: 'slack',
        config: { webhookUrl: 'https://hooks.slack.com/T/B/x' },
        events: ['run.failed'],
      });
      await expect(service.listDeliveries(authContext, rec.id)).rejects.toThrow(NotFoundException);
    });
  });
});
