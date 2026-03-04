import { BadRequestException, NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, mock } from 'bun:test';

import { NotificationsController } from '../notifications.controller';
import type { NotificationsService } from '../notifications.service';
import type { AuthContext } from '../../auth/types';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const AUTH: AuthContext = {
  userId: 'user-1',
  organizationId: 'org-1',
  roles: ['ADMIN'],
  isAuthenticated: true,
  provider: 'test',
};

const CHANNEL_ID = '550e8400-e29b-41d4-a716-446655440000';
const DELIVERY_ID = '660e8400-e29b-41d4-a716-446655440001';

const newDeliveryResponse = {
  id: '770e8400-e29b-41d4-a716-446655440002',
  channelId: CHANNEL_ID,
  runId: 'run-1',
  eventType: 'run.failed',
  status: 'sent' as const,
  payload: {},
  errorMessage: null,
  durationMs: 120,
  responseStatus: 200,
  responseBody: 'ok',
  createdAt: '2026-03-04T12:00:00.000Z',
  sentAt: '2026-03-04T12:00:00.150Z',
};

// ---------------------------------------------------------------------------
// Mock factory
// ---------------------------------------------------------------------------

function makeNotificationsService() {
  return {
    list: mock(() => Promise.resolve([])),
    get: mock(() => Promise.resolve({})),
    create: mock(() => Promise.resolve({})),
    update: mock(() => Promise.resolve({})),
    delete: mock(() => Promise.resolve()),
    testChannel: mock(() => Promise.resolve({ success: true })),
    listDeliveries: mock(() => Promise.resolve([])),
    resendDelivery: mock(() => Promise.resolve(newDeliveryResponse)),
  } as unknown as NotificationsService;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('NotificationsController — resendDelivery', () => {
  let controller: NotificationsController;
  let service: NotificationsService;

  beforeEach(() => {
    service = makeNotificationsService();
    controller = new NotificationsController(service);
  });

  it('returns new delivery on successful resend', async () => {
    const result = await controller.resendDelivery(AUTH, CHANNEL_ID, DELIVERY_ID);

    expect(service.resendDelivery).toHaveBeenCalledTimes(1);
    expect(service.resendDelivery).toHaveBeenCalledWith(AUTH, CHANNEL_ID, DELIVERY_ID);
    expect(result).toEqual(newDeliveryResponse);
  });

  it('propagates NotFoundException when channel is not found', async () => {
    (service.resendDelivery as any).mockReturnValue(
      Promise.reject(new NotFoundException('Notification channel not found')),
    );

    await expect(controller.resendDelivery(AUTH, CHANNEL_ID, DELIVERY_ID)).rejects.toThrow(
      NotFoundException,
    );
  });

  it('propagates NotFoundException when delivery is not found', async () => {
    (service.resendDelivery as any).mockReturnValue(
      Promise.reject(new NotFoundException('Delivery not found')),
    );

    await expect(controller.resendDelivery(AUTH, CHANNEL_ID, DELIVERY_ID)).rejects.toThrow(
      NotFoundException,
    );
  });

  it('propagates BadRequestException when delivery is not in failed status', async () => {
    (service.resendDelivery as any).mockReturnValue(
      Promise.reject(new BadRequestException('Only failed deliveries can be re-sent')),
    );

    await expect(controller.resendDelivery(AUTH, CHANNEL_ID, DELIVERY_ID)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('passes auth context to service method', async () => {
    await controller.resendDelivery(AUTH, CHANNEL_ID, DELIVERY_ID);

    const calledAuth = (service.resendDelivery as any).mock.calls[0][0];
    expect(calledAuth).toBe(AUTH);
  });

  it('passes channel ID and delivery ID to service method', async () => {
    await controller.resendDelivery(AUTH, CHANNEL_ID, DELIVERY_ID);

    const [, calledChannelId, calledDeliveryId] = (service.resendDelivery as any).mock.calls[0];
    expect(calledChannelId).toBe(CHANNEL_ID);
    expect(calledDeliveryId).toBe(DELIVERY_ID);
  });
});
