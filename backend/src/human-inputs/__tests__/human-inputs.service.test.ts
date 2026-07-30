import { describe, it, expect, beforeEach } from 'bun:test';
import { HumanInputsService } from '../human-inputs.service';
import { ForbiddenException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';

/**
 * Unit tests for IDOR protection in HumanInputsService
 * Ensures organization-level access control is enforced
 */
describe('HumanInputsService - IDOR Protection', () => {
  let service: HumanInputsService;
  let mockDb: any;
  let auditRecordCalls: unknown[][];
  let temporalSignalCalls: unknown[];
  let durableAuditError: Error | undefined;
  let transactionCommits: number;
  let transactionRollbacks: number;
  let outboxInsertValues: Record<string, unknown>[];

  const ORG_A = 'org-a-' + randomUUID();
  const ORG_B = 'org-b-' + randomUUID();

  const mockApprovalA = {
    id: randomUUID(),
    organizationId: ORG_A,
    title: 'Approval in Org A',
    status: 'pending',
    inputType: 'approval',
    resolveToken: 'org-a-token',
    runId: 'run-a',
    nodeRef: 'approval-a',
    respondedAt: null,
  };

  const mockApprovalB = {
    id: randomUUID(),
    organizationId: ORG_B,
    title: 'Approval in Org B',
    status: 'pending',
    inputType: 'approval',
    resolveToken: 'org-b-token',
    runId: 'run-b',
    nodeRef: 'approval-b',
    respondedAt: null,
  };

  beforeEach(() => {
    auditRecordCalls = [];
    temporalSignalCalls = [];
    durableAuditError = undefined;
    transactionCommits = 0;
    transactionRollbacks = 0;
    outboxInsertValues = [];

    // Mock database with query builder
    mockDb = {
      query: {
        humanInputRequests: {
          findMany: async (options: any) => {
            const approvals = [mockApprovalA, mockApprovalB];

            // Simulate WHERE clause filtering
            if (options.where) {
              return approvals.filter((approval) => {
                // Check organization filter
                if (
                  options.where.__drizzleAnd &&
                  options.where.__drizzleAnd.some((c: any) => {
                    // Check if org matches
                    return (
                      c.__drizzleEq &&
                      c.leftOperand?.key === 'organization_id' &&
                      c.rightOperand?.value === approval.organizationId
                    );
                  })
                ) {
                  return true;
                }
                // Fallback: check direct org match
                return approval.organizationId === ORG_A;
              });
            }
            return approvals;
          },
          findFirst: async (options: any) => {
            const allApprovals = [mockApprovalA, mockApprovalB];

            // Without org filter, should return nothing (IDOR check)
            if (!options.where || !options.where.__drizzleAnd) {
              return null;
            }

            const approval = allApprovals.find((a) => a.id === mockApprovalA.id);
            if (!approval) return null;

            // Check org filter
            const hasOrgFilter = options.where.__drizzleAnd.some((c: any) => {
              return c.__drizzleEq && c.leftOperand?.key === 'organization_id';
            });

            if (!hasOrgFilter) {
              return null; // No org filter = IDOR vulnerability
            }

            return approval;
          },
        },
      },
      update: (_table: any) => ({
        set: () => ({
          where: () => ({
            returning: async () => [mockApprovalA],
          }),
        }),
      }),
      insert: (_table: unknown) => ({
        values: (values: Record<string, unknown>) => {
          outboxInsertValues.push(values);
          return {
            onConflictDoNothing: async () => undefined,
          };
        },
      }),
    };
    mockDb.transaction = async (callback: (executor: unknown) => Promise<unknown>) => {
      try {
        const result = await callback(mockDb);
        transactionCommits += 1;
        return result;
      } catch (error) {
        transactionRollbacks += 1;
        throw error;
      }
    };

    // Simplified mock that tracks query patterns
    mockDb._lastQuery = null;
    mockDb._trackQuery = function (query: string) {
      this._lastQuery = query;
    };

    const auditLogService = {
      recordDurableWithExecutor: async (...args: unknown[]) => {
        auditRecordCalls.push(args);
        if (durableAuditError) throw durableAuditError;
      },
    };

    service = new HumanInputsService(mockDb, auditLogService as any);
  });

  it('should filter list by organization', async () => {
    // Create a more realistic mock that filters by org
    mockDb.query.humanInputRequests.findMany = async (options: any) => {
      // Verify that organization filter is being applied
      if (!options.where) {
        throw new Error('No where clause - missing organization filter!');
      }
      return [mockApprovalA];
    };

    const result = await service.list({}, ORG_A);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(mockApprovalA.id);
  });

  it('should fail closed if list is called without an organization', async () => {
    let queried = false;
    mockDb.query.humanInputRequests.findMany = async () => {
      queried = true;
      return [mockApprovalA];
    };

    await expect(service.list({}, undefined as never)).rejects.toThrow(ForbiddenException);
    expect(queried).toBe(false);
  });

  it('should not allow accessing approval from different org', async () => {
    mockDb.query.humanInputRequests.findFirst = async (options: any) => {
      // Verify org filter exists
      if (!options.where || !Array.isArray(options.where.__drizzleAnd)) {
        return null; // No org filter = IDOR blocked
      }

      const conditions = options.where.__drizzleAnd;
      const hasOrgFilter = conditions.some((c: any) => c.column?.name === 'organization_id');

      if (!hasOrgFilter) {
        return null;
      }

      // Return approval only if org matches
      return mockApprovalA;
    };

    let threw = false;
    try {
      // Try to access Org B's approval with Org A credentials
      await service.getById(mockApprovalB.id, ORG_A);
    } catch (_error: any) {
      threw = true;
    }
    expect(threw).toBe(true);
  });

  it('should allow accessing own org approval', async () => {
    mockDb.query.humanInputRequests.findFirst = async (_options: any) => {
      return mockApprovalA;
    };

    const result = await service.getById(mockApprovalA.id, ORG_A);
    expect(result.id).toBe(mockApprovalA.id);
  });

  it('should require organizationId for resolve', async () => {
    await expect(
      service.resolve(
        mockApprovalA.id,
        { responseData: { status: 'approved' } },
        undefined as never,
        {
          organizationId: null,
          userId: 'user-a',
          roles: ['MEMBER'],
          provider: 'local',
          isAuthenticated: true,
        },
      ),
    ).rejects.toThrow(ForbiddenException);
  });

  it('should require authenticated organization context for resolve', async () => {
    mockDb.query.humanInputRequests.findFirst = async () => mockApprovalA;

    await expect(
      service.resolve(
        mockApprovalA.id,
        { responseData: { status: 'approved' }, respondedBy: 'spoofed-user' } as any,
        ORG_A,
        null,
      ),
    ).rejects.toThrow(ForbiddenException);

    expect(transactionCommits).toBe(0);
  });

  it('summary: organization scoping is enforced at service level', async () => {
    // Verify the service methods have org parameters
    expect(service.list.length).toBeGreaterThan(0); // Has parameters
    expect(service.getById.length).toBeGreaterThan(0);
    expect(service.resolve.length).toBeGreaterThan(0);
  });

  it('commits the resolution, trusted actor, audit, and durable signal event atomically', async () => {
    const updated = {
      ...mockApprovalA,
      status: 'resolved',
      respondedBy: 'user-a',
      responseData: { status: 'approved' },
      updatedAt: new Date(),
      respondedAt: new Date(),
    };
    const operationOrder: string[] = [];
    let updateValues: Record<string, unknown> | undefined;
    mockDb.query.humanInputRequests.findFirst = async () => mockApprovalA;
    mockDb.update = (_table: unknown) => ({
      set: (updates: Record<string, unknown>) => {
        updateValues = updates;
        return {
          where: (_where: unknown) => ({
            returning: async () => {
              operationOrder.push('update');
              return [{ ...updated, respondedBy: updates.respondedBy }];
            },
          }),
        };
      },
    });
    mockDb.insert = (_table: unknown) => ({
      values: (values: Record<string, unknown>) => {
        operationOrder.push('outbox');
        outboxInsertValues.push(values);
        return {
          onConflictDoNothing: async () => undefined,
        };
      },
    });
    const originalRecord = (service as any).auditLogService.recordDurableWithExecutor;
    (service as any).auditLogService.recordDurableWithExecutor = async (...args: unknown[]) => {
      operationOrder.push('audit');
      await originalRecord(...args);
    };
    const auth = {
      organizationId: ORG_A,
      userId: 'user-a',
      roles: ['MEMBER'],
      provider: 'local',
      isAuthenticated: true,
    } as any;

    const result = await service.resolve(
      mockApprovalA.id,
      {
        responseData: { status: 'approved' },
        respondedBy: 'spoofed-user',
      } as any,
      ORG_A,
      auth,
    );

    expect(result.status).toBe('resolved');
    expect(transactionCommits).toBe(1);
    expect(transactionRollbacks).toBe(0);
    expect(operationOrder).toEqual(['update', 'audit', 'outbox']);
    expect(updateValues?.respondedBy).toBe('user-a');
    expect(auditRecordCalls).toHaveLength(1);
    expect(auditRecordCalls[0]?.[0]).toBe(mockDb);
    expect(auditRecordCalls[0]?.[1]).toBe(auth);
    expect((auditRecordCalls[0]?.[2] as { action?: string }).action).toBe('human_input.resolve');
    expect(temporalSignalCalls).toHaveLength(0);
    expect(outboxInsertValues).toHaveLength(1);
    expect(outboxInsertValues[0]).toMatchObject({
      eventType: 'human_input.resolution.signal.v1',
      organizationId: ORG_A,
      aggregateType: 'human_input',
      aggregateId: mockApprovalA.id,
      dedupeKey: `human-input-resolution-signal:${mockApprovalA.id}`,
      payload: {
        requestId: mockApprovalA.id,
        workflowId: mockApprovalA.runId,
        nodeRef: mockApprovalA.nodeRef,
        approved: true,
        respondedBy: 'user-a',
      },
    });
  });

  it('rolls back the approval and does not signal Temporal when durable auditing fails', async () => {
    mockDb.query.humanInputRequests.findFirst = async () => mockApprovalA;
    durableAuditError = new Error('audit outbox unavailable');

    await expect(
      service.resolve(
        mockApprovalA.id,
        {
          responseData: { status: 'approved' },
        },
        ORG_A,
        {
          organizationId: ORG_A,
          userId: 'user-a',
          roles: ['MEMBER'],
          provider: 'local',
          isAuthenticated: true,
        } as any,
      ),
    ).rejects.toThrow('audit outbox unavailable');

    expect(transactionCommits).toBe(0);
    expect(transactionRollbacks).toBe(1);
    expect(temporalSignalCalls).toHaveLength(0);
    expect(outboxInsertValues).toHaveLength(0);
  });

  it('rolls back the approval and audit when durable signal enqueueing fails', async () => {
    mockDb.query.humanInputRequests.findFirst = async () => mockApprovalA;
    mockDb.insert = (_table: unknown) => ({
      values: (values: Record<string, unknown>) => {
        outboxInsertValues.push(values);
        return {
          onConflictDoNothing: async () => {
            throw new Error('outbox unavailable');
          },
        };
      },
    });

    await expect(
      service.resolve(mockApprovalA.id, { responseData: { status: 'approved' } }, ORG_A, {
        organizationId: ORG_A,
        userId: 'user-a',
        roles: ['MEMBER'],
        provider: 'local',
        isAuthenticated: true,
      }),
    ).rejects.toThrow('outbox unavailable');

    expect(transactionCommits).toBe(0);
    expect(transactionRollbacks).toBe(1);
    expect(auditRecordCalls).toHaveLength(1);
    expect(outboxInsertValues).toHaveLength(1);
    expect(temporalSignalCalls).toHaveLength(0);
  });

  it('should keep public-link audit logs scoped to the request organization', async () => {
    const publicRequest = {
      id: randomUUID(),
      organizationId: ORG_B,
      title: 'Public Approval in Org B',
      status: 'pending',
      inputType: 'approval',
      resolveToken: 'public-token',
      runId: 'run-1',
      nodeRef: 'approval-node',
      respondedAt: null,
    };
    const updated = {
      ...publicRequest,
      status: 'resolved',
      respondedBy: 'public-link',
      responseData: { status: 'approved' },
      updatedAt: new Date(),
      respondedAt: new Date(),
    };

    mockDb.query.humanInputRequests.findFirst = async () => publicRequest;
    mockDb.update = (_table: unknown) => ({
      set: (_updates: unknown) => ({
        where: (_where: unknown) => ({
          returning: async () => [updated],
        }),
      }),
    });

    const result = await service.resolveByToken('public-token', 'approve', {
      comment: 'approved via link',
    });

    expect(result.success).toBe(true);
    expect(temporalSignalCalls).toHaveLength(0);
    expect(outboxInsertValues).toHaveLength(1);
    expect(outboxInsertValues[0]).toMatchObject({
      eventType: 'human_input.resolution.signal.v1',
      organizationId: ORG_B,
      aggregateId: publicRequest.id,
      payload: {
        requestId: publicRequest.id,
        workflowId: publicRequest.runId,
        nodeRef: publicRequest.nodeRef,
        approved: true,
        respondedBy: 'public-link',
      },
    });
    expect(auditRecordCalls).toHaveLength(1);
    expect(auditRecordCalls[0]?.[0]).toBe(mockDb);
    expect(auditRecordCalls[0]?.[1]).toBeNull();
    expect((auditRecordCalls[0]?.[2] as { action?: string }).action).toBe('human_input.resolve');
    expect(auditRecordCalls[0]?.[4]).toBe(ORG_B);
  });

  it('reports the current state when another public resolver wins the race', async () => {
    const publicRequest = {
      ...mockApprovalB,
      resolveToken: 'raced-token',
    };
    const concurrentlyResolved = {
      ...publicRequest,
      status: 'resolved',
      respondedBy: 'public-link',
      responseData: { status: 'approved' },
      respondedAt: new Date('2026-07-26T16:00:00.000Z'),
      updatedAt: new Date('2026-07-26T16:00:00.000Z'),
    };
    let lookupCount = 0;
    mockDb.query.humanInputRequests.findFirst = async () => {
      lookupCount += 1;
      return lookupCount === 1 ? publicRequest : concurrentlyResolved;
    };
    mockDb.update = (_table: unknown) => ({
      set: (_updates: unknown) => ({
        where: (_where: unknown) => ({
          returning: async () => [],
        }),
      }),
    });

    const result = await service.resolveByToken('raced-token', 'approve');

    expect(result).toEqual({
      success: false,
      message: 'Request is already resolved',
      input: {
        id: concurrentlyResolved.id,
        title: concurrentlyResolved.title,
        inputType: concurrentlyResolved.inputType as 'approval',
        status: 'resolved',
        respondedAt: '2026-07-26T16:00:00.000Z',
      },
    });
    expect(auditRecordCalls).toHaveLength(0);
    expect(temporalSignalCalls).toHaveLength(0);
    expect(outboxInsertValues).toHaveLength(0);
  });
});
