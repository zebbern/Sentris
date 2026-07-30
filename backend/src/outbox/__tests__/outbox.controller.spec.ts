import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, mock } from 'bun:test';
import { HTTP_CODE_METADATA } from '@nestjs/common/constants';
import { DECORATORS } from '@nestjs/swagger/dist/constants';

import type { AuditLogService } from '../../audit/audit-log.service';
import type { AuthContext } from '../../auth/types';
import type { OutboxEventRecord } from '../../database/schema';
import { OutboxController } from '../outbox.controller';
import { ListDeadLettersResponseDto, RequeueDeadLetterResponseDto } from '../outbox.dto';
import type { OutboxRepository } from '../outbox.repository';

const auth: AuthContext = {
  userId: 'admin-1',
  organizationId: 'org-1',
  roles: ['ADMIN'],
  isAuthenticated: true,
  provider: 'local',
};

const event: OutboxEventRecord = {
  id: '5b5879f4-6798-4027-92e6-56a863460098',
  eventType: 'human_input.resolution.signal.v1',
  organizationId: 'org-1',
  aggregateType: 'human_input',
  aggregateId: 'request-1',
  dedupeKey: 'human-input-resolution-signal:request-1',
  payload: { requestId: 'request-1' },
  status: 'dead',
  attempts: 8,
  maxAttempts: 8,
  availableAt: new Date('2026-07-26T12:00:00.000Z'),
  lockedAt: null,
  lockedBy: null,
  lastError: 'Temporal unavailable',
  processedAt: null,
  createdAt: new Date('2026-07-26T11:00:00.000Z'),
  updatedAt: new Date('2026-07-26T12:00:00.000Z'),
};

function setup() {
  const repository = {
    listDeadLetters: mock(async () => ({ items: [], nextCursor: null })),
    requeueDeadLetter: mock(async () => event),
  } as unknown as OutboxRepository;
  const auditLogService = {
    recordDurableWithExecutor: mock(async () => undefined),
  } as unknown as AuditLogService;
  return {
    repository,
    auditLogService,
    controller: new OutboxController(repository, auditLogService),
  };
}

describe('OutboxController', () => {
  it('lists only the authenticated organization dead letters', async () => {
    const { controller, repository } = setup();

    await controller.listDeadLetters(auth, { limit: 20 });

    expect(repository.listDeadLetters).toHaveBeenCalledWith('org-1', 20, undefined);
  });

  it('round-trips an opaque cursor so older dead letters remain discoverable', async () => {
    const { controller, repository } = setup();
    (repository.listDeadLetters as ReturnType<typeof mock>).mockResolvedValueOnce({
      items: [event],
      nextCursor: {
        createdAt: event.createdAt,
        id: event.id,
      },
    });

    const first = await controller.listDeadLetters(auth, { limit: 20 });
    expect(first.nextCursor).toBeString();

    await controller.listDeadLetters(auth, {
      limit: 20,
      cursor: first.nextCursor!,
    });
    expect(repository.listDeadLetters).toHaveBeenLastCalledWith('org-1', 20, {
      createdAt: event.createdAt,
      id: event.id,
    });
  });

  it('rejects malformed cursors before querying the repository', async () => {
    const { controller, repository } = setup();

    await expect(
      controller.listDeadLetters(auth, { limit: 20, cursor: 'not-a-cursor' }),
    ).rejects.toThrow(BadRequestException);
    expect(repository.listDeadLetters).toHaveBeenCalledTimes(0);
  });

  it('requeues by event id and organization with a durable audit in the same executor', async () => {
    const { controller, repository, auditLogService } = setup();
    const executor = { insert: mock(() => undefined) };
    (repository.requeueDeadLetter as ReturnType<typeof mock>).mockImplementationOnce(
      async (_eventId, _organizationId, onRequeued) => {
        await onRequeued(executor, event);
        return event;
      },
    );

    await controller.requeue(auth, event.id);

    expect(repository.requeueDeadLetter).toHaveBeenCalledWith(
      event.id,
      'org-1',
      expect.any(Function),
    );
    expect(auditLogService.recordDurableWithExecutor).toHaveBeenCalledWith(executor, auth, {
      action: 'outbox.dead_letter.requeue',
      resourceType: 'outbox_event',
      resourceId: event.id,
      resourceName: event.eventType,
      metadata: {
        aggregateType: event.aggregateType,
        aggregateId: event.aggregateId,
        attempts: event.attempts,
        dedupeKey: event.dedupeKey,
      },
    });
  });

  it('rejects malformed event ids before touching Postgres', async () => {
    const { controller, repository } = setup();

    await expect(controller.requeue(auth, 'not-a-uuid')).rejects.toThrow(BadRequestException);
    expect(repository.requeueDeadLetter).toHaveBeenCalledTimes(0);
  });

  it('publishes typed 200 response contracts and returns 200 for requeue at runtime', () => {
    const listResponses = Reflect.getMetadata(
      DECORATORS.API_RESPONSE,
      OutboxController.prototype.listDeadLetters,
    );
    const requeueResponses = Reflect.getMetadata(
      DECORATORS.API_RESPONSE,
      OutboxController.prototype.requeue,
    );

    expect(listResponses?.[200]?.type).toBe(ListDeadLettersResponseDto);
    expect(requeueResponses?.[200]?.type).toBe(RequeueDeadLetterResponseDto);
    expect(Reflect.getMetadata(HTTP_CODE_METADATA, OutboxController.prototype.requeue)).toBe(200);
  });
});
