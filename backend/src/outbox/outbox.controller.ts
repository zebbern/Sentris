import {
  BadRequestException,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { ZodValidationPipe } from 'nestjs-zod';

import { CurrentAuth } from '../auth/auth-context.decorator';
import { AuditLogService } from '../audit/audit-log.service';
import { Roles } from '../auth/roles.decorator';
import type { AuthContext } from '../auth/types';
import { requireOrganizationId } from '../common/auth/require-organization-id';
import type { OutboxEventRecord } from '../database/schema';
import {
  ListDeadLettersQueryDto,
  ListDeadLettersQuerySchema,
  ListDeadLettersResponseDto,
  OutboxDeadLetterCursorPayloadSchema,
  OutboxDeadLetterDto,
  OutboxEventIdSchema,
  RequeueDeadLetterResponseDto,
} from './outbox.dto';
import { type DeadLetterCursor, OutboxRepository } from './outbox.repository';

@Controller('admin/outbox')
@Roles('ADMIN')
@ApiTags('Outbox')
export class OutboxController {
  constructor(
    private readonly repository: OutboxRepository,
    private readonly auditLogService: AuditLogService,
  ) {}

  @Get('dead-letters')
  @ApiOperation({ summary: 'List dead-lettered outbox events for the current organization' })
  @ApiOkResponse({ type: ListDeadLettersResponseDto })
  async listDeadLetters(
    @CurrentAuth() auth: AuthContext | null,
    @Query(new ZodValidationPipe(ListDeadLettersQuerySchema)) query: ListDeadLettersQueryDto,
  ): Promise<ListDeadLettersResponseDto> {
    const organizationId = requireOrganizationId(auth);
    const cursor = this.decodeCursor(query.cursor);
    const page = await this.repository.listDeadLetters(organizationId, query.limit, cursor);
    return {
      items: page.items.map((event) => this.toDeadLetterDto(event)),
      nextCursor: page.nextCursor ? this.encodeCursor(page.nextCursor) : null,
    };
  }

  @Post('dead-letters/:eventId/requeue')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Requeue one dead-lettered outbox event' })
  @ApiOkResponse({ type: RequeueDeadLetterResponseDto })
  @ApiBadRequestResponse({ description: 'Event ID must be a UUID' })
  @ApiNotFoundResponse({ description: 'Dead-lettered outbox event not found' })
  @ApiParam({ name: 'eventId', format: 'uuid' })
  async requeue(
    @CurrentAuth() auth: AuthContext | null,
    @Param('eventId') eventId: string,
  ): Promise<RequeueDeadLetterResponseDto> {
    const organizationId = requireOrganizationId(auth);
    const parsedEventId = OutboxEventIdSchema.safeParse(eventId);
    if (!parsedEventId.success) {
      throw new BadRequestException('Event ID must be a UUID');
    }
    const requeued = await this.repository.requeueDeadLetter(
      parsedEventId.data,
      organizationId,
      (executor, event) =>
        this.auditLogService.recordDurableWithExecutor(executor, auth, {
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
        }),
    );
    if (!requeued) {
      throw new NotFoundException('Dead-lettered outbox event not found');
    }
    return { eventId: parsedEventId.data, status: 'pending' as const };
  }

  private decodeCursor(cursor?: string): DeadLetterCursor | undefined {
    if (!cursor) {
      return undefined;
    }
    try {
      const decoded = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
      const parsed = OutboxDeadLetterCursorPayloadSchema.safeParse(decoded);
      if (!parsed.success) {
        throw new Error('Invalid cursor payload');
      }
      return {
        createdAt: new Date(parsed.data.createdAt),
        id: parsed.data.id,
      };
    } catch {
      throw new BadRequestException('Invalid dead-letter cursor');
    }
  }

  private encodeCursor(cursor: DeadLetterCursor): string {
    return Buffer.from(
      JSON.stringify({
        createdAt: cursor.createdAt.toISOString(),
        id: cursor.id,
      }),
      'utf8',
    ).toString('base64url');
  }

  private toDeadLetterDto(event: OutboxEventRecord): OutboxDeadLetterDto {
    return {
      id: event.id,
      eventType: event.eventType,
      organizationId: event.organizationId,
      aggregateType: event.aggregateType,
      aggregateId: event.aggregateId,
      dedupeKey: event.dedupeKey,
      payload: event.payload,
      status: 'dead',
      attempts: event.attempts,
      maxAttempts: event.maxAttempts,
      availableAt: event.availableAt.toISOString(),
      lockedAt: event.lockedAt?.toISOString() ?? null,
      lockedBy: event.lockedBy,
      lastError: event.lastError,
      processedAt: event.processedAt?.toISOString() ?? null,
      createdAt: event.createdAt.toISOString(),
      updatedAt: event.updatedAt.toISOString(),
    };
  }
}
