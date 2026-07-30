import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { DRIZZLE_TOKEN } from '../database/database.module';
import * as schema from '../database/schema';
import { humanInputRequests as humanInputRequestsTable } from '../database/schema';
import { eq, and, desc } from 'drizzle-orm';
import { type NodePgDatabase } from 'drizzle-orm/node-postgres';
import {
  ResolveHumanInputDto,
  ListHumanInputsQueryDto,
  HumanInputResponseDto,
  PublicResolveResultDto,
} from './dto/human-inputs.dto';
import { AuditLogService } from '../audit/audit-log.service';
import type { AuthContext } from '../auth/types';
import { enqueueOutboxEvent, type OutboxExecutor } from '../outbox/enqueue-outbox-event';
import { HUMAN_INPUT_RESOLUTION_SIGNAL_EVENT } from './human-input.events';

@Injectable()
export class HumanInputsService {
  private readonly logger = new Logger(HumanInputsService.name);

  constructor(
    @Inject(DRIZZLE_TOKEN) private readonly db: NodePgDatabase<typeof schema>,
    private readonly auditLogService: AuditLogService,
  ) {}

  async list(
    query?: ListHumanInputsQueryDto,
    organizationId?: string,
  ): Promise<HumanInputResponseDto[]> {
    const scopedOrganizationId = this.requireOrganizationId(organizationId);
    const conditions = [];

    conditions.push(eq(humanInputRequestsTable.organizationId, scopedOrganizationId));

    if (query?.status) {
      conditions.push(eq(humanInputRequestsTable.status, query.status));
    }

    if (query?.inputType) {
      conditions.push(eq(humanInputRequestsTable.inputType, query.inputType));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const results = await this.db.query.humanInputRequests.findMany({
      where: whereClause,
      orderBy: [desc(humanInputRequestsTable.createdAt)],
    });

    return results as unknown as HumanInputResponseDto[];
  }

  async getById(id: string, organizationId?: string): Promise<HumanInputResponseDto> {
    const scopedOrganizationId = this.requireOrganizationId(organizationId);
    const conditions = [
      eq(humanInputRequestsTable.id, id),
      eq(humanInputRequestsTable.organizationId, scopedOrganizationId),
    ];

    const request = await this.db.query.humanInputRequests.findFirst({
      where: and(...conditions),
    });

    if (!request) {
      throw new NotFoundException(`Human input request with ID ${id} not found`);
    }

    return request as unknown as HumanInputResponseDto;
  }

  async resolve(
    id: string,
    dto: ResolveHumanInputDto,
    organizationId?: string,
    auth?: AuthContext | null,
  ): Promise<HumanInputResponseDto> {
    const scopedOrganizationId = this.requireAuthenticatedOrganization(organizationId, auth);
    const respondedBy = (auth!.userId ?? auth!.provider) || 'authenticated';
    const request = await this.getById(id, scopedOrganizationId);

    if (request.status !== 'pending') {
      throw new Error(`Human input request is ${request.status}, cannot resolve`);
    }

    // Determine if approved based on responseData
    const isApproved = dto.responseData?.status !== 'rejected';
    const respondedAt = new Date();

    const updated = await this.db.transaction(async (tx) => {
      const conditions = [
        eq(humanInputRequestsTable.id, id),
        eq(humanInputRequestsTable.status, 'pending'),
      ];
      conditions.push(eq(humanInputRequestsTable.organizationId, scopedOrganizationId));

      const [resolved] = await tx
        .update(humanInputRequestsTable)
        .set({
          status: 'resolved',
          responseData: dto.responseData,
          respondedBy,
          respondedAt,
          updatedAt: new Date(),
        })
        .where(and(...conditions))
        .returning();

      if (!resolved) {
        throw new ConflictException('Human input request is no longer pending');
      }

      await this.auditLogService.recordDurableWithExecutor(tx, auth ?? null, {
        action: 'human_input.resolve',
        resourceType: 'human_input',
        resourceId: resolved.id,
        resourceName: resolved.title,
        metadata: {
          approved: isApproved,
          respondedBy,
          inputType: resolved.inputType,
        },
      });

      await this.enqueueResolutionSignal(tx, resolved, {
        approved: isApproved,
        respondedBy,
        respondedAt,
        responseData: dto.responseData,
      });

      return resolved;
    });

    return updated as unknown as HumanInputResponseDto;
  }

  // Public resolution using token
  async resolveByToken(
    token: string,
    action: 'approve' | 'reject' | 'resolve',
    data?: Record<string, unknown>,
  ): Promise<PublicResolveResultDto> {
    const request = await this.db.query.humanInputRequests.findFirst({
      where: eq(humanInputRequestsTable.resolveToken, token),
    });

    if (!request) {
      return {
        success: false,
        message: 'Invalid or expired token',
        input: {
          id: '',
          title: '',
          inputType: 'approval',
          status: 'expired',
          respondedAt: null,
        },
      };
    }

    if (request.status !== 'pending') {
      return {
        success: false,
        message: `Request is already ${request.status}`,
        input: {
          id: request.id,
          title: request.title,
          inputType: request.inputType,
          status: request.status,
          respondedAt: request.respondedAt?.toISOString() ?? null,
        },
      };
    }

    const isApproved = action !== 'reject';
    let responseData = data || {};
    responseData = { ...responseData, status: isApproved ? 'approved' : 'rejected' };
    const respondedAt = new Date();

    const updated = await this.db.transaction(async (tx) => {
      const [resolved] = await tx
        .update(humanInputRequestsTable)
        .set({
          status: 'resolved',
          responseData: responseData,
          respondedAt,
          respondedBy: 'public-link',
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(humanInputRequestsTable.id, request.id),
            eq(humanInputRequestsTable.resolveToken, token),
            eq(humanInputRequestsTable.status, 'pending'),
          ),
        )
        .returning();

      if (!resolved) {
        return null;
      }

      await this.auditLogService.recordDurableWithExecutor(
        tx,
        null,
        {
          action: 'human_input.resolve',
          resourceType: 'human_input',
          resourceId: resolved.id,
          resourceName: resolved.title,
          metadata: {
            approved: isApproved,
            respondedBy: 'public-link',
            inputType: resolved.inputType,
          },
        },
        undefined,
        request.organizationId,
      );

      await this.enqueueResolutionSignal(tx, resolved, {
        approved: isApproved,
        respondedBy: 'public-link',
        respondedAt,
        responseData,
      });

      return resolved;
    });

    if (!updated) {
      const current =
        (await this.db.query.humanInputRequests.findFirst({
          where: eq(humanInputRequestsTable.resolveToken, token),
        })) ?? request;
      return {
        success: false,
        message: `Request is already ${current.status}`,
        input: {
          id: current.id,
          title: current.title,
          inputType: current.inputType,
          status: current.status,
          respondedAt: current.respondedAt?.toISOString() ?? null,
        },
      };
    }

    return {
      success: true,
      message: 'Input received successfully',
      input: {
        id: updated.id,
        title: updated.title,
        inputType: updated.inputType,
        status: updated.status,
        respondedAt: updated.respondedAt?.toISOString() ?? null,
      },
    };
  }

  private requireOrganizationId(organizationId?: string): string {
    if (!organizationId) {
      throw new ForbiddenException('Organization context is required');
    }
    return organizationId;
  }

  private requireAuthenticatedOrganization(
    organizationId: string | undefined,
    auth: AuthContext | null | undefined,
  ): string {
    const scopedOrganizationId = this.requireOrganizationId(organizationId);
    if (
      !auth?.isAuthenticated ||
      !auth.organizationId ||
      auth.organizationId !== scopedOrganizationId
    ) {
      throw new ForbiddenException('Authenticated organization context is required');
    }
    return scopedOrganizationId;
  }

  private async enqueueResolutionSignal(
    executor: OutboxExecutor,
    request: typeof humanInputRequestsTable.$inferSelect,
    resolution: {
      approved: boolean;
      respondedBy: string;
      respondedAt: Date;
      responseData?: Record<string, unknown>;
    },
  ): Promise<void> {
    await enqueueOutboxEvent(executor, {
      eventType: HUMAN_INPUT_RESOLUTION_SIGNAL_EVENT,
      organizationId: request.organizationId,
      aggregateType: 'human_input',
      aggregateId: request.id,
      dedupeKey: `human-input-resolution-signal:${request.id}`,
      maxAttempts: 12,
      payload: {
        requestId: request.id,
        workflowId: request.runId,
        nodeRef: request.nodeRef,
        approved: resolution.approved,
        respondedBy: resolution.respondedBy,
        responseNote:
          typeof resolution.responseData?.comment === 'string'
            ? resolution.responseData.comment
            : undefined,
        respondedAt: resolution.respondedAt.toISOString(),
        responseData: resolution.responseData,
      },
    });
  }
}
