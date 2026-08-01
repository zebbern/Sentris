import { isDeepStrictEqual } from 'node:util';
import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq, inArray, isNull, or } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import {
  CapabilityGrantSchema,
  InvocationManifestEntrySchema,
  InvocationManifestSchema,
  ClaimMcpOperationDispatchRequestSchema,
  McpOperationInvocationRequestSchema,
  McpOperationDispatchPlanSchema,
  McpOperationManifestEntrySchema,
  McpOperationSchema,
  McpOperationResultSchema,
  ReconcileMcpOperationDispatchRequestSchema,
  McpRuntimeFenceSchema,
  SettleMcpOperationAttemptRequestSchema,
  McpSnapshotRuntimeBindingSchema,
  PreparedMcpOperationRefSchema,
  PrepareMcpOperationOutcomeSchema,
  McpCapabilityCatalogSnapshotSchema,
  PreparedInvocationRefSchema,
  ToolInvocationRequestSchema,
  ToolInvocationResultSchema,
  assertCapabilityGrantApplies,
  resolveMcpOperationManifestEntry,
  type CapabilityGrant,
  type InvocationManifest,
  type InvocationManifestEntry,
  type ClaimMcpOperationDispatchRequest,
  type McpCapabilityCatalogSnapshot,
  type McpOperation,
  type McpOperationDispatchPlan,
  type McpOperationInvocationRequest,
  type McpOperationManifestEntry,
  type McpOperationResult,
  type McpRuntimeFence,
  type McpSnapshotRuntimeBinding,
  type PreparedMcpOperationRef,
  type PrepareMcpOperationOutcome,
  type ReconcileMcpOperationDispatchRequest,
  type SettleMcpOperationAttemptRequest,
  type PreparedInvocationRef,
  type PrepareToolInvocationOutcome,
  type ToolInvocationRequest,
  type ToolInvocationResult,
} from '@sentris/shared';
import { DRIZZLE_TOKEN } from '../database/database.module';
import {
  mcpCapabilityGrantsTable,
  mcpCapabilitySnapshotsTable,
  mcpInvocationAttemptsTable,
  mcpInvocationsTable,
  type McpCapabilityGrantRecord,
  type McpCapabilitySnapshotRecord,
  type McpInvocationAttemptRecord,
  type McpInvocationRecord,
  type McpInvocationOperationKind,
  type McpInvocationStatus,
} from '../database/schema';

const LOWERCASE_SHA256 = /^[a-f0-9]{64}$/;
const GRANT_ID_SENTINEL = '<capability-grant-id>';
const SNAPSHOT_ID_SENTINEL = '<capability-snapshot-id>';
const TERMINAL_STATUSES = new Set(['completed', 'failed', 'ambiguous', 'cancelled']);

function runSubjectId(grant: CapabilityGrant): string {
  if (grant.subject.kind !== 'run') {
    throw new ConflictException('MCP durable authority must be run-scoped');
  }
  return grant.subject.runId;
}

export interface StoredMcpAuthority {
  grant: CapabilityGrant;
  snapshot: McpCapabilityCatalogSnapshot;
  manifest: InvocationManifest;
}

export type ClaimAttemptOutcome =
  | { kind: 'claimed' }
  | { kind: 'terminal'; result: ToolInvocationResult }
  | { kind: 'ambiguous'; result: ToolInvocationResult };

export interface InvocationForDispatch {
  request: ToolInvocationRequest;
  ref: PreparedInvocationRef;
  status: McpInvocationStatus;
  result: ToolInvocationResult | null;
}

interface StoredAuthorityRows {
  grant: McpCapabilityGrantRecord;
  snapshot: McpCapabilitySnapshotRecord;
}

interface StoredInvocationRows {
  invocation: McpInvocationRecord;
  attempt: McpInvocationAttemptRecord;
}

interface ParsedInvocationRows extends StoredInvocationRows {
  request: ToolInvocationRequest;
  result: ToolInvocationResult | null;
}

interface ParsedMcpOperationRows {
  invocation: Omit<McpInvocationRecord, 'operationKind' | 'operationTarget'> & {
    operationKind: McpInvocationOperationKind;
    operationTarget: string;
  };
  attempt: McpInvocationAttemptRecord;
  request: McpOperationInvocationRequest;
  result: McpOperationResult | null;
}

export type ClaimMcpOperationAttemptOutcome =
  | { kind: 'claimed' }
  | { kind: 'terminal'; result: McpOperationResult }
  | { kind: 'ambiguous'; result: McpOperationResult };

export interface McpOperationForDispatch {
  request: McpOperationInvocationRequest;
  ref: PreparedMcpOperationRef;
  status: McpInvocationStatus;
  result: McpOperationResult | null;
  fence: McpRuntimeFence | null;
}

function stableJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stableJsonValue);
  }
  if (value === null || typeof value !== 'object') {
    return value;
  }

  const record = value as Record<string, unknown>;
  return Object.fromEntries(
    Object.keys(record)
      .sort()
      .map((key) => [key, stableJsonValue(record[key])]),
  );
}

function semanticAuthorityProjection(authority: StoredMcpAuthority): string {
  const { createdAt: _grantCreatedAt, ...grantWithoutCreatedAt } = authority.grant;
  const { createdAt: _snapshotCreatedAt, ...snapshotWithoutCreatedAt } = authority.snapshot;

  return JSON.stringify(
    stableJsonValue({
      grant: {
        ...grantWithoutCreatedAt,
        id: GRANT_ID_SENTINEL,
      },
      snapshot: {
        ...snapshotWithoutCreatedAt,
        id: SNAPSHOT_ID_SENTINEL,
        scope: {
          ...snapshotWithoutCreatedAt.scope,
          capabilityGrantId: GRANT_ID_SENTINEL,
        },
      },
      manifest: {
        ...authority.manifest,
        capabilityGrantId: GRANT_ID_SENTINEL,
        capabilitySnapshotId: SNAPSHOT_ID_SENTINEL,
      },
    }),
  );
}

@Injectable()
export class McpRuntimeRepository {
  constructor(
    @Inject(DRIZZLE_TOKEN)
    private readonly db: NodePgDatabase,
  ) {}

  async createOrReadRunAuthority(input: {
    authorityKey: string;
    grant: CapabilityGrant;
    snapshot: McpCapabilityCatalogSnapshot;
    manifest: InvocationManifest;
  }): Promise<StoredMcpAuthority> {
    if (!LOWERCASE_SHA256.test(input.authorityKey)) {
      throw new Error('MCP authority key must be a lowercase SHA-256 digest');
    }

    const requested = this.parseRunAuthority(input);
    return this.db.transaction(async (transaction) => {
      const tx = transaction as unknown as NodePgDatabase;
      const [insertedGrant] = await tx
        .insert(mcpCapabilityGrantsTable)
        .values({
          id: requested.grant.id,
          authorityKey: input.authorityKey,
          organizationId: requested.grant.organizationId,
          subjectKind: requested.grant.subject.kind,
          subjectId: runSubjectId(requested.grant),
          grant: requested.grant,
          createdAt: new Date(requested.grant.createdAt),
        })
        .onConflictDoNothing({ target: mcpCapabilityGrantsTable.authorityKey })
        .returning();

      if (insertedGrant) {
        const [insertedSnapshot] = await tx
          .insert(mcpCapabilitySnapshotsTable)
          .values({
            id: requested.snapshot.id,
            capabilityGrantId: requested.grant.id,
            configFingerprint: requested.snapshot.configFingerprint,
            snapshot: requested.snapshot,
            invocationManifest: requested.manifest,
            createdAt: new Date(requested.snapshot.createdAt),
          })
          .returning();
        if (!insertedSnapshot) {
          throw new Error('Unable to persist MCP capability snapshot');
        }
        return this.parseStoredAuthority({
          grant: insertedGrant,
          snapshot: insertedSnapshot,
        });
      }

      const existing = await this.readAuthorityByKey(tx, input.authorityKey);
      if (!existing) {
        throw new ConflictException('MCP authority key was claimed without readable authority');
      }
      if (semanticAuthorityProjection(existing) !== semanticAuthorityProjection(requested)) {
        throw new ConflictException(
          'MCP authority key was already used for different immutable authority',
        );
      }
      return existing;
    });
  }

  async getAuthority(input: {
    capabilityGrantId: string;
    capabilitySnapshotId: string;
    runId: string;
    organizationId: string | null;
  }): Promise<StoredMcpAuthority | null> {
    const organizationMatches =
      input.organizationId === null
        ? isNull(mcpCapabilityGrantsTable.organizationId)
        : eq(mcpCapabilityGrantsTable.organizationId, input.organizationId);
    const [rows] = await this.db
      .select({
        grant: mcpCapabilityGrantsTable,
        snapshot: mcpCapabilitySnapshotsTable,
      })
      .from(mcpCapabilityGrantsTable)
      .innerJoin(
        mcpCapabilitySnapshotsTable,
        eq(mcpCapabilitySnapshotsTable.capabilityGrantId, mcpCapabilityGrantsTable.id),
      )
      .where(
        and(
          eq(mcpCapabilityGrantsTable.id, input.capabilityGrantId),
          eq(mcpCapabilitySnapshotsTable.id, input.capabilitySnapshotId),
          eq(mcpCapabilityGrantsTable.subjectKind, 'run'),
          eq(mcpCapabilityGrantsTable.subjectId, input.runId),
          organizationMatches,
        ),
      )
      .limit(1);

    return rows ? this.parseStoredAuthority(rows) : null;
  }

  async prepareOperation(input: {
    request: McpOperationInvocationRequest;
    dispatchOperation: McpOperation;
    requestHash: string;
    entry: McpOperationManifestEntry;
    runtimeBinding?: McpSnapshotRuntimeBinding;
    manifest: InvocationManifest;
  }): Promise<PrepareMcpOperationOutcome> {
    const prepared = this.parseMcpOperationPreparation(input);
    return this.db.transaction(async (transaction) => {
      const tx = transaction as unknown as NodePgDatabase;
      const preparedAt = new Date();
      const [insertedInvocation] = await tx
        .insert(mcpInvocationsTable)
        .values({
          invocationId: prepared.request.invocationId,
          runId: prepared.request.scope.runId,
          organizationId: prepared.request.scope.organizationId,
          capabilityGrantId: prepared.request.scope.capabilityGrantId,
          capabilitySnapshotId: prepared.request.capabilitySnapshotId,
          operationKind: prepared.entry.operationKind,
          operationTarget: prepared.entry.operationTarget,
          toolName:
            prepared.entry.operationKind === 'tool-call' ? prepared.entry.operationTarget : null,
          requestHash: input.requestHash,
          request: prepared.request,
          status: 'prepared',
          currentAttemptNumber: 1,
          result: null,
          createdAt: preparedAt,
          updatedAt: preparedAt,
          terminalAt: null,
        })
        .onConflictDoNothing({ target: mcpInvocationsTable.invocationId })
        .returning();

      if (insertedInvocation) {
        const [insertedAttempt] = await tx
          .insert(mcpInvocationAttemptsTable)
          .values({
            invocationId: prepared.request.invocationId,
            attemptNumber: 1,
            sourceId: prepared.entry.sourceId,
            destination: prepared.entry.destination,
            retryPolicy: prepared.entry.retryPolicy,
            runtimeId: null,
            ownerId: null,
            ownerEpoch: null,
            leaseGeneration: null,
            status: 'prepared',
            preparedAt,
            dispatchedAt: null,
            completedAt: null,
          })
          .returning();
        if (!insertedAttempt) {
          throw new Error('Unable to persist MCP operation attempt');
        }
        const rows = this.parseStoredMcpOperation({
          invocation: insertedInvocation,
          attempt: insertedAttempt,
        });
        return PrepareMcpOperationOutcomeSchema.parse({
          kind: 'prepared',
          plan: this.mcpOperationPlan(
            rows,
            prepared.entry,
            prepared.dispatchOperation,
            prepared.runtimeBinding,
          ),
          manifest: prepared.manifest,
        });
      }

      const existing = await this.readMcpOperation(tx, prepared.request.invocationId);
      if (!existing) {
        throw new ConflictException(
          'MCP operation invocation ID was claimed without a readable invocation',
        );
      }
      this.assertMcpOperationReplay(existing, prepared.request, input.requestHash);
      if (TERMINAL_STATUSES.has(existing.invocation.status)) {
        return {
          kind: 'terminal',
          result: this.requireMcpOperationResult(existing),
        };
      }
      if (
        existing.invocation.status !== 'prepared' &&
        existing.invocation.status !== 'dispatched'
      ) {
        throw new ConflictException('MCP operation is not reusable from its current state');
      }
      return PrepareMcpOperationOutcomeSchema.parse({
        kind: 'prepared',
        plan: this.mcpOperationPlan(
          existing,
          prepared.entry,
          prepared.dispatchOperation,
          prepared.runtimeBinding,
        ),
        manifest: prepared.manifest,
      });
    });
  }

  async claimOperationAttempt(
    input: ClaimMcpOperationDispatchRequest,
  ): Promise<ClaimMcpOperationAttemptOutcome> {
    const claimed = ClaimMcpOperationDispatchRequestSchema.parse(input);
    const { ref } = claimed.plan;
    const fence = claimed.runtimeRef?.fence ?? null;
    return this.db.transaction(async (transaction) => {
      const tx = transaction as unknown as NodePgDatabase;
      const dispatchedAt = new Date();
      const [claimedInvocation] = await tx
        .update(mcpInvocationsTable)
        .set({ status: 'dispatched', updatedAt: dispatchedAt })
        .where(
          and(
            eq(mcpInvocationsTable.invocationId, ref.invocationId),
            eq(mcpInvocationsTable.currentAttemptNumber, ref.attemptNumber),
            eq(mcpInvocationsTable.capabilityGrantId, ref.capabilityGrantId),
            eq(mcpInvocationsTable.capabilitySnapshotId, ref.capabilitySnapshotId),
            this.mcpOperationIdentityMatches(ref),
            eq(mcpInvocationsTable.status, 'prepared'),
          ),
        )
        .returning();

      if (claimedInvocation) {
        const [claimedAttempt] = await tx
          .update(mcpInvocationAttemptsTable)
          .set({
            status: 'dispatched',
            runtimeId: fence?.runtimeId ?? null,
            ownerId: fence?.ownerId ?? null,
            ownerEpoch: fence?.ownerEpoch ?? null,
            leaseGeneration: fence?.leaseGeneration ?? null,
            dispatchedAt,
          })
          .where(
            and(
              eq(mcpInvocationAttemptsTable.id, ref.attemptId),
              eq(mcpInvocationAttemptsTable.invocationId, ref.invocationId),
              eq(mcpInvocationAttemptsTable.attemptNumber, ref.attemptNumber),
              eq(mcpInvocationAttemptsTable.preparedAt, new Date(ref.preparedAt)),
              eq(mcpInvocationAttemptsTable.sourceId, ref.sourceId),
              eq(mcpInvocationAttemptsTable.destination, ref.destination),
              eq(mcpInvocationAttemptsTable.retryPolicy, ref.retryPolicy),
              isNull(mcpInvocationAttemptsTable.runtimeId),
              isNull(mcpInvocationAttemptsTable.ownerId),
              isNull(mcpInvocationAttemptsTable.ownerEpoch),
              isNull(mcpInvocationAttemptsTable.leaseGeneration),
              eq(mcpInvocationAttemptsTable.status, 'prepared'),
            ),
          )
          .returning();
        if (!claimedAttempt) {
          throw new ConflictException('Prepared MCP operation attempt could not be claimed');
        }
        return { kind: 'claimed' };
      }

      const existing = await this.readMcpOperation(tx, ref.invocationId);
      if (!existing) {
        throw new NotFoundException('MCP operation attempt was not found');
      }
      this.assertMcpOperationReference(existing, ref);
      if (TERMINAL_STATUSES.has(existing.invocation.status)) {
        const result = this.requireMcpOperationResult(existing);
        return result.kind === 'ambiguous'
          ? { kind: 'ambiguous', result }
          : { kind: 'terminal', result };
      }
      if (existing.invocation.status !== 'dispatched') {
        throw new ConflictException(
          'MCP operation attempt cannot be claimed from its current state',
        );
      }
      const capturedFence = this.capturedFence(existing);
      const result = McpOperationResultSchema.parse({
        operationId: ref.invocationId,
        kind: 'ambiguous',
        message: 'MCP operation attempt was already dispatched',
        completedAt: new Date().toISOString(),
      });
      if (await this.transitionMcpOperationTerminal(tx, ref, capturedFence, result, 'dispatched')) {
        return { kind: 'ambiguous', result };
      }
      const concurrent = await this.requireCurrentMcpOperation(tx, ref);
      const concurrentResult = this.requireMcpOperationResult(concurrent);
      return concurrentResult.kind === 'ambiguous'
        ? { kind: 'ambiguous', result: concurrentResult }
        : { kind: 'terminal', result: concurrentResult };
    });
  }

  async getMcpOperationForDispatch(
    reference: PreparedMcpOperationRef,
  ): Promise<McpOperationForDispatch> {
    const ref = PreparedMcpOperationRefSchema.parse(reference);
    const existing = await this.readMcpOperation(this.db, ref.invocationId);
    if (!existing) {
      throw new ConflictException('MCP operation attempt was not found');
    }
    this.assertMcpOperationReference(existing, ref);
    return {
      request: existing.request,
      ref: this.preparedMcpOperationReference(existing),
      status: existing.invocation.status,
      result: existing.result,
      fence: this.capturedFence(existing),
    };
  }

  async settleMcpOperationAttempt(
    input: SettleMcpOperationAttemptRequest,
  ): Promise<McpOperationResult> {
    const { ref, fence, result } = SettleMcpOperationAttemptRequestSchema.parse(input);
    if (result.operationId !== ref.invocationId) {
      throw new ConflictException('MCP operation result belongs to a different invocation');
    }
    return this.settleMcpOperationTerminal(ref, fence, result);
  }

  async reconcileMcpOperationDispatchFailure(
    input: ReconcileMcpOperationDispatchRequest,
  ): Promise<McpOperationResult> {
    const parsed = ReconcileMcpOperationDispatchRequestSchema.parse(input);
    return this.db.transaction(async (transaction) => {
      const tx = transaction as unknown as NodePgDatabase;
      let existing = await this.readMcpOperation(tx, parsed.ref.invocationId);
      if (!existing) {
        throw new ConflictException('MCP operation reconciliation reference was not found');
      }
      for (let transitionAttempt = 0; transitionAttempt < 2; transitionAttempt += 1) {
        this.assertMcpOperationReference(existing, parsed.ref);
        if (TERMINAL_STATUSES.has(existing.invocation.status)) {
          return this.requireMcpOperationResult(existing);
        }
        if (
          existing.invocation.status !== 'prepared' &&
          existing.invocation.status !== 'dispatched'
        ) {
          throw new ConflictException('MCP operation cannot be reconciled from its current state');
        }
        const result = this.mcpOperationReconciliationResult(
          parsed.ref.invocationId,
          existing.invocation.status,
          parsed,
        );
        const fence = this.capturedFence(existing);
        if (
          await this.transitionMcpOperationTerminal(
            tx,
            parsed.ref,
            fence,
            result,
            existing.invocation.status,
          )
        ) {
          return result;
        }
        const concurrent = await this.readMcpOperation(tx, parsed.ref.invocationId);
        if (!concurrent) {
          throw new ConflictException('MCP operation disappeared during reconciliation');
        }
        existing = concurrent;
      }
      this.assertMcpOperationReference(existing, parsed.ref);
      if (!TERMINAL_STATUSES.has(existing.invocation.status)) {
        throw new ConflictException('MCP operation reconciliation lost its state transition');
      }
      return this.requireMcpOperationResult(existing);
    });
  }

  async prepareInvocation(input: {
    request: ToolInvocationRequest;
    requestHash: string;
    entry: InvocationManifestEntry;
    manifest: InvocationManifest;
  }): Promise<PrepareToolInvocationOutcome> {
    const prepared = this.parseInvocationPreparation(input);
    return this.db.transaction(async (transaction) => {
      const tx = transaction as unknown as NodePgDatabase;
      const preparedAt = new Date();
      const [insertedInvocation] = await tx
        .insert(mcpInvocationsTable)
        .values({
          invocationId: prepared.request.invocationId,
          runId: prepared.request.scope.runId,
          organizationId: prepared.request.scope.organizationId,
          capabilityGrantId: prepared.request.scope.capabilityGrantId,
          capabilitySnapshotId: prepared.request.capabilitySnapshotId,
          operationKind: 'tool-call',
          operationTarget: prepared.request.toolName,
          toolName: prepared.request.toolName,
          requestHash: input.requestHash,
          request: prepared.request,
          status: 'prepared',
          currentAttemptNumber: 1,
          result: null,
          createdAt: preparedAt,
          updatedAt: preparedAt,
          terminalAt: null,
        })
        .onConflictDoNothing({ target: mcpInvocationsTable.invocationId })
        .returning();

      if (insertedInvocation) {
        const [insertedAttempt] = await tx
          .insert(mcpInvocationAttemptsTable)
          .values({
            invocationId: prepared.request.invocationId,
            attemptNumber: 1,
            sourceId: prepared.entry.sourceId,
            destination: prepared.entry.destination,
            retryPolicy: prepared.entry.retryPolicy,
            runtimeId: null,
            ownerId: null,
            ownerEpoch: null,
            leaseGeneration: null,
            status: 'prepared',
            preparedAt,
            dispatchedAt: null,
            completedAt: null,
          })
          .returning();
        if (!insertedAttempt) {
          throw new Error('Unable to persist MCP invocation attempt');
        }

        const parsedRows = this.parseStoredInvocation({
          invocation: insertedInvocation,
          attempt: insertedAttempt,
        });
        return {
          kind: 'prepared',
          ref: this.preparedReference(parsedRows),
          manifest: prepared.manifest,
        };
      }

      const existing = await this.readInvocation(tx, prepared.request.invocationId);
      if (!existing) {
        throw new ConflictException('MCP invocation ID was claimed without a readable invocation');
      }
      this.assertInvocationReplay(existing, prepared.request, input.requestHash);
      if (TERMINAL_STATUSES.has(existing.invocation.status)) {
        return { kind: 'terminal', result: this.requireTerminalResult(existing) };
      }
      if (
        existing.invocation.status !== 'prepared' &&
        existing.invocation.status !== 'dispatched'
      ) {
        throw new ConflictException('MCP invocation is not reusable from its current state');
      }
      return {
        kind: 'prepared',
        ref: this.preparedReference(existing),
        manifest: prepared.manifest,
      };
    });
  }

  async claimAttempt(reference: PreparedInvocationRef): Promise<ClaimAttemptOutcome> {
    const ref = PreparedInvocationRefSchema.parse(reference);
    return this.db.transaction(async (transaction) => {
      const tx = transaction as unknown as NodePgDatabase;
      const dispatchedAt = new Date();
      const [claimedInvocation] = await tx
        .update(mcpInvocationsTable)
        .set({ status: 'dispatched', updatedAt: dispatchedAt })
        .where(
          and(
            eq(mcpInvocationsTable.invocationId, ref.invocationId),
            eq(mcpInvocationsTable.currentAttemptNumber, ref.attemptNumber),
            eq(mcpInvocationsTable.capabilityGrantId, ref.capabilityGrantId),
            eq(mcpInvocationsTable.capabilitySnapshotId, ref.capabilitySnapshotId),
            eq(mcpInvocationsTable.toolName, ref.toolName),
            eq(mcpInvocationsTable.status, 'prepared'),
          ),
        )
        .returning();

      if (claimedInvocation) {
        const [claimedAttempt] = await tx
          .update(mcpInvocationAttemptsTable)
          .set({ status: 'dispatched', dispatchedAt })
          .where(
            and(
              eq(mcpInvocationAttemptsTable.id, ref.attemptId),
              eq(mcpInvocationAttemptsTable.invocationId, ref.invocationId),
              eq(mcpInvocationAttemptsTable.attemptNumber, ref.attemptNumber),
              eq(mcpInvocationAttemptsTable.preparedAt, new Date(ref.preparedAt)),
              eq(mcpInvocationAttemptsTable.sourceId, ref.sourceId),
              eq(mcpInvocationAttemptsTable.destination, ref.destination),
              eq(mcpInvocationAttemptsTable.retryPolicy, ref.retryPolicy),
              eq(mcpInvocationAttemptsTable.status, 'prepared'),
            ),
          )
          .returning();
        if (!claimedAttempt) {
          throw new ConflictException('Prepared MCP invocation attempt could not be claimed');
        }
        return { kind: 'claimed' };
      }

      const existing = await this.readInvocation(tx, ref.invocationId);
      if (!existing) {
        throw new NotFoundException('MCP invocation attempt was not found');
      }
      this.assertReferenceMatches(existing, ref);

      if (existing.invocation.status === 'dispatched') {
        const ambiguousResult = ToolInvocationResultSchema.parse({
          invocationId: ref.invocationId,
          status: 'ambiguous',
          error: {
            class: 'ambiguous-after-dispatch',
            message: 'Invocation attempt was already dispatched',
            retryable: false,
          },
          completedAt: new Date().toISOString(),
        });
        if (await this.transitionTerminal(tx, ref, ambiguousResult, 'dispatched')) {
          return { kind: 'ambiguous', result: ambiguousResult };
        }
        const concurrent = await this.requireCurrentInvocation(tx, ref);
        return this.claimReplayOutcome(concurrent);
      }

      return this.claimReplayOutcome(existing);
    });
  }

  async getInvocationForDispatch(reference: PreparedInvocationRef): Promise<InvocationForDispatch> {
    const ref = PreparedInvocationRefSchema.parse(reference);
    const existing = await this.readInvocation(this.db, ref.invocationId);
    if (!existing) {
      throw new ConflictException('MCP invocation attempt was not found');
    }
    this.assertReferenceMatches(existing, ref);
    return {
      request: existing.request,
      ref: this.preparedReference(existing),
      status: existing.invocation.status,
      result: existing.result,
    };
  }

  async settleAttempt(input: {
    ref: PreparedInvocationRef;
    result: ToolInvocationResult;
  }): Promise<ToolInvocationResult> {
    const ref = PreparedInvocationRefSchema.parse(input.ref);
    const result = ToolInvocationResultSchema.parse(input.result);
    if (result.invocationId !== ref.invocationId) {
      throw new ConflictException('MCP invocation result belongs to a different invocation');
    }
    if (result.status !== 'completed' && result.status !== 'failed') {
      throw new ConflictException('MCP invocation settlement must be completed or failed');
    }
    return this.settleTerminal(ref, result);
  }

  async markAttemptAmbiguous(input: {
    ref: PreparedInvocationRef;
    message: string;
    completedAt: string;
  }): Promise<ToolInvocationResult> {
    const ref = PreparedInvocationRefSchema.parse(input.ref);
    const result = ToolInvocationResultSchema.parse({
      invocationId: ref.invocationId,
      status: 'ambiguous',
      error: {
        class: 'ambiguous-after-dispatch',
        message: input.message,
        retryable: false,
      },
      completedAt: input.completedAt,
    });
    return this.settleTerminal(ref, result);
  }

  async reconcileDispatchFailure(input: {
    ref: PreparedInvocationRef;
    cause: 'failure' | 'deadline' | 'cancelled';
    message: string;
    completedAt: string;
  }): Promise<ToolInvocationResult> {
    const ref = PreparedInvocationRefSchema.parse(input.ref);
    return this.db.transaction(async (transaction) => {
      const tx = transaction as unknown as NodePgDatabase;
      let existing = await this.readInvocation(tx, ref.invocationId);
      if (!existing) {
        throw new ConflictException('MCP invocation reconciliation reference was not found');
      }
      for (let transitionAttempt = 0; transitionAttempt < 2; transitionAttempt += 1) {
        this.assertReferenceMatches(existing, ref);
        if (TERMINAL_STATUSES.has(existing.invocation.status)) {
          return this.requireTerminalResult(existing);
        }
        if (
          existing.invocation.status !== 'prepared' &&
          existing.invocation.status !== 'dispatched'
        ) {
          throw new ConflictException('MCP invocation cannot be reconciled from its current state');
        }

        const result = this.reconciliationResult(
          ref.invocationId,
          existing.invocation.status,
          input,
        );
        if (await this.transitionTerminal(tx, ref, result, existing.invocation.status)) {
          return result;
        }

        const concurrent = await this.readInvocation(tx, ref.invocationId);
        if (!concurrent) {
          throw new ConflictException('MCP invocation disappeared during reconciliation');
        }
        existing = concurrent;
      }

      this.assertReferenceMatches(existing, ref);
      if (!TERMINAL_STATUSES.has(existing.invocation.status)) {
        throw new ConflictException('MCP invocation reconciliation lost its state transition');
      }
      return this.requireTerminalResult(existing);
    });
  }

  async reconcileRunInvocations(input: {
    runId: string;
    message: string;
    completedAt: string;
  }): Promise<void> {
    if (!input.runId.trim()) {
      throw new ConflictException('MCP invocation run ID is required for reconciliation');
    }
    const rows = await this.db
      .select({
        invocation: mcpInvocationsTable,
        attempt: mcpInvocationAttemptsTable,
      })
      .from(mcpInvocationsTable)
      .innerJoin(
        mcpInvocationAttemptsTable,
        and(
          eq(mcpInvocationAttemptsTable.invocationId, mcpInvocationsTable.invocationId),
          eq(mcpInvocationAttemptsTable.attemptNumber, mcpInvocationsTable.currentAttemptNumber),
        ),
      )
      .where(
        and(
          eq(mcpInvocationsTable.runId, input.runId),
          inArray(mcpInvocationsTable.status, ['prepared', 'dispatched']),
        ),
      );

    let firstError: unknown;
    for (const row of rows) {
      try {
        if (isMcpOperationRequestJson(row.invocation.request)) {
          const existing = this.parseStoredMcpOperation(row);
          await this.reconcileMcpOperationDispatchFailure({
            ref: this.preparedMcpOperationReference(existing),
            cause: 'cancelled',
            message: input.message,
            completedAt: input.completedAt,
          });
        } else {
          const existing = this.parseStoredInvocation(row);
          await this.reconcileDispatchFailure({
            ref: this.preparedReference(existing),
            cause: 'cancelled',
            message: input.message,
            completedAt: input.completedAt,
          });
        }
      } catch (error) {
        firstError ??= error;
      }
    }
    if (firstError) {
      throw firstError;
    }
  }

  private parseRunAuthority(input: {
    grant: CapabilityGrant;
    snapshot: McpCapabilityCatalogSnapshot;
    manifest: InvocationManifest;
  }): StoredMcpAuthority {
    const authority: StoredMcpAuthority = {
      grant: CapabilityGrantSchema.parse(input.grant),
      snapshot: McpCapabilityCatalogSnapshotSchema.parse(input.snapshot),
      manifest: InvocationManifestSchema.parse(input.manifest),
    };
    this.assertRunAuthorityRelations(authority);
    return authority;
  }

  private assertRunAuthorityRelations(authority: StoredMcpAuthority): void {
    if (authority.grant.subject.kind !== 'run' || authority.snapshot.scope.kind !== 'run') {
      throw new ConflictException('MCP durable authority must be run-scoped');
    }
    assertCapabilityGrantApplies(authority.snapshot.scope, authority.grant);
    if (
      authority.manifest.capabilityGrantId !== authority.grant.id ||
      authority.manifest.capabilitySnapshotId !== authority.snapshot.id
    ) {
      throw new ConflictException('MCP invocation manifest does not match durable authority');
    }
  }

  private parseStoredAuthority(rows: StoredAuthorityRows): StoredMcpAuthority {
    const authority = this.parseRunAuthority({
      grant: CapabilityGrantSchema.parse(rows.grant.grant),
      snapshot: McpCapabilityCatalogSnapshotSchema.parse(rows.snapshot.snapshot),
      manifest: InvocationManifestSchema.parse(rows.snapshot.invocationManifest),
    });
    if (
      rows.grant.id !== authority.grant.id ||
      rows.grant.organizationId !== authority.grant.organizationId ||
      rows.grant.subjectKind !== authority.grant.subject.kind ||
      rows.grant.subjectId !== runSubjectId(authority.grant) ||
      rows.grant.createdAt.getTime() !== new Date(authority.grant.createdAt).getTime() ||
      rows.snapshot.id !== authority.snapshot.id ||
      rows.snapshot.capabilityGrantId !== authority.grant.id ||
      rows.snapshot.configFingerprint !== authority.snapshot.configFingerprint ||
      rows.snapshot.createdAt.getTime() !== new Date(authority.snapshot.createdAt).getTime()
    ) {
      throw new ConflictException('Persisted MCP authority columns do not match immutable JSON');
    }
    return authority;
  }

  private async readAuthorityByKey(
    executor: NodePgDatabase,
    authorityKey: string,
  ): Promise<StoredMcpAuthority | null> {
    const [rows] = await executor
      .select({
        grant: mcpCapabilityGrantsTable,
        snapshot: mcpCapabilitySnapshotsTable,
      })
      .from(mcpCapabilityGrantsTable)
      .innerJoin(
        mcpCapabilitySnapshotsTable,
        eq(mcpCapabilitySnapshotsTable.capabilityGrantId, mcpCapabilityGrantsTable.id),
      )
      .where(eq(mcpCapabilityGrantsTable.authorityKey, authorityKey))
      .limit(1);
    return rows ? this.parseStoredAuthority(rows) : null;
  }

  private parseMcpOperationPreparation(input: {
    request: McpOperationInvocationRequest;
    dispatchOperation: McpOperation;
    requestHash: string;
    entry: McpOperationManifestEntry;
    runtimeBinding?: McpSnapshotRuntimeBinding;
    manifest: InvocationManifest;
  }): {
    request: McpOperationInvocationRequest & {
      scope: Extract<McpOperationInvocationRequest['scope'], { kind: 'run' }>;
    };
    dispatchOperation: McpOperation;
    entry: McpOperationManifestEntry;
    runtimeBinding?: McpSnapshotRuntimeBinding;
    manifest: InvocationManifest;
  } {
    if (!LOWERCASE_SHA256.test(input.requestHash)) {
      throw new Error('MCP operation request hash must be a lowercase SHA-256 digest');
    }
    const request = McpOperationInvocationRequestSchema.parse(input.request);
    const dispatchOperation = McpOperationSchema.parse(input.dispatchOperation);
    const entry = McpOperationManifestEntrySchema.parse(input.entry);
    const manifest = InvocationManifestSchema.parse(input.manifest);
    const runtimeBinding =
      input.runtimeBinding === undefined
        ? undefined
        : McpSnapshotRuntimeBindingSchema.parse(input.runtimeBinding);
    if (request.scope.kind !== 'run') {
      throw new ConflictException('MCP durable operations must be run-scoped');
    }
    const authorized = resolveMcpOperationManifestEntry(manifest, request);
    if (
      !isDeepStrictEqual(authorized, entry) ||
      dispatchOperation.kind !== request.operation.kind
    ) {
      throw new ConflictException('MCP operation does not match its invocation manifest');
    }
    if (entry.destination === 'mcp-activity' && !runtimeBinding) {
      throw new ConflictException('Outbound MCP operation has no immutable runtime binding');
    }
    if (entry.destination === 'component-activity' && runtimeBinding) {
      throw new ConflictException('Component operation cannot claim an MCP runtime binding');
    }
    return {
      request: request as McpOperationInvocationRequest & {
        scope: Extract<McpOperationInvocationRequest['scope'], { kind: 'run' }>;
      },
      dispatchOperation,
      entry,
      ...(runtimeBinding !== undefined && { runtimeBinding }),
      manifest,
    };
  }

  private async readMcpOperation(
    executor: NodePgDatabase,
    invocationId: string,
  ): Promise<ParsedMcpOperationRows | null> {
    const [rows] = await executor
      .select({
        invocation: mcpInvocationsTable,
        attempt: mcpInvocationAttemptsTable,
      })
      .from(mcpInvocationsTable)
      .innerJoin(
        mcpInvocationAttemptsTable,
        and(
          eq(mcpInvocationAttemptsTable.invocationId, mcpInvocationsTable.invocationId),
          eq(mcpInvocationAttemptsTable.attemptNumber, mcpInvocationsTable.currentAttemptNumber),
        ),
      )
      .where(eq(mcpInvocationsTable.invocationId, invocationId))
      .limit(1);
    return rows ? this.parseStoredMcpOperation(rows) : null;
  }

  private parseStoredMcpOperation(rows: StoredInvocationRows): ParsedMcpOperationRows {
    const operationIdentity = this.normalizeMcpOperationIdentity(rows.invocation);
    const invocation = { ...rows.invocation, ...operationIdentity };
    const genericRequest = McpOperationInvocationRequestSchema.safeParse(invocation.request);
    const request = genericRequest.success
      ? genericRequest.data
      : this.projectLegacyToolRequest(invocation.request, rows.attempt.sourceId);
    const result = this.parseMcpOperationResult(invocation.result);
    const expectedToolName =
      invocation.operationKind === 'tool-call' ? invocation.operationTarget : null;
    if (
      request.invocationId !== invocation.invocationId ||
      request.scope.kind !== 'run' ||
      request.scope.runId !== invocation.runId ||
      request.scope.organizationId !== invocation.organizationId ||
      request.scope.capabilityGrantId !== invocation.capabilityGrantId ||
      request.capabilitySnapshotId !== invocation.capabilitySnapshotId ||
      request.operation.kind !== invocation.operationKind ||
      request.authorizationTarget !== invocation.operationTarget ||
      invocation.toolName !== expectedToolName
    ) {
      throw new ConflictException('Persisted MCP operation columns do not match request JSON');
    }
    if (
      rows.attempt.invocationId !== invocation.invocationId ||
      rows.attempt.attemptNumber !== invocation.currentAttemptNumber ||
      rows.attempt.status !== invocation.status
    ) {
      throw new ConflictException('Persisted MCP operation current-attempt projection diverged');
    }
    const fenceValues = [
      rows.attempt.runtimeId,
      rows.attempt.ownerId,
      rows.attempt.ownerEpoch,
      rows.attempt.leaseGeneration,
    ];
    const hasFence = fenceValues.every((value) => value !== null);
    if (!hasFence && fenceValues.some((value) => value !== null)) {
      throw new ConflictException(
        'Persisted MCP operation attempt has an incomplete runtime fence',
      );
    }
    if (
      invocation.status === 'dispatched' &&
      rows.attempt.destination === 'mcp-activity' &&
      !hasFence
    ) {
      throw new ConflictException('Dispatched MCP operation attempt has no captured runtime fence');
    }
    if (rows.attempt.destination === 'component-activity' && hasFence) {
      throw new ConflictException('Component MCP operation attempt cannot capture a runtime fence');
    }
    if (
      TERMINAL_STATUSES.has(invocation.status) !== (result !== null) ||
      (result &&
        (mcpOperationResultStatus(result) !== invocation.status ||
          result.operationId !== invocation.invocationId))
    ) {
      throw new ConflictException('Persisted MCP operation terminal result is inconsistent');
    }
    return { invocation, attempt: rows.attempt, request, result };
  }

  private normalizeMcpOperationIdentity(invocation: McpInvocationRecord): {
    operationKind: McpInvocationOperationKind;
    operationTarget: string;
  } {
    if (invocation.operationKind === null && invocation.operationTarget === null) {
      if (invocation.toolName === null) {
        throw new ConflictException('Legacy MCP invocation has no tool projection');
      }
      return { operationKind: 'tool-call', operationTarget: invocation.toolName };
    }
    if (invocation.operationKind === null || invocation.operationTarget === null) {
      throw new ConflictException('Persisted MCP operation identity is incomplete');
    }
    return {
      operationKind: invocation.operationKind,
      operationTarget: invocation.operationTarget,
    };
  }

  private projectLegacyToolRequest(
    rawRequest: unknown,
    sourceId: string,
  ): McpOperationInvocationRequest {
    const request = ToolInvocationRequestSchema.parse(rawRequest);
    return McpOperationInvocationRequestSchema.parse({
      invocationId: request.invocationId,
      scope: request.scope,
      capabilitySnapshotId: request.capabilitySnapshotId,
      sourceId,
      authorizationTarget: request.toolName,
      operation: { kind: 'tool-call', name: request.toolName, arguments: request.input },
      requestedAt: request.requestedAt,
      deadlineAt: request.deadlineAt,
    });
  }

  private parseMcpOperationResult(rawResult: unknown): McpOperationResult | null {
    if (rawResult === null) return null;
    const genericResult = McpOperationResultSchema.safeParse(rawResult);
    if (genericResult.success) return genericResult.data;
    const legacyResult = ToolInvocationResultSchema.parse(rawResult);
    if (legacyResult.status === 'completed') {
      return McpOperationResultSchema.parse({
        operationId: legacyResult.invocationId,
        kind: 'completed',
        output: legacyResult.output,
        completedAt: legacyResult.completedAt,
      });
    }
    const error = legacyResult.error;
    if (!error) {
      throw new ConflictException('Legacy MCP invocation terminal result has no error');
    }
    const kind =
      legacyResult.status === 'ambiguous'
        ? 'ambiguous'
        : legacyResult.status === 'cancelled'
          ? 'cancelled'
          : 'remote-failure';
    return McpOperationResultSchema.parse({
      operationId: legacyResult.invocationId,
      kind,
      message: error.message,
      ...(kind === 'remote-failure' && { retryable: error.retryable }),
      completedAt: legacyResult.completedAt,
    });
  }

  private mcpOperationIdentityMatches(ref: PreparedMcpOperationRef) {
    const generalized = and(
      eq(mcpInvocationsTable.operationKind, ref.operationKind),
      eq(mcpInvocationsTable.operationTarget, ref.operationTarget),
      ref.toolName === null
        ? isNull(mcpInvocationsTable.toolName)
        : eq(mcpInvocationsTable.toolName, ref.toolName),
    );
    if (ref.operationKind !== 'tool-call' || ref.toolName === null) return generalized;
    return or(
      generalized,
      and(
        isNull(mcpInvocationsTable.operationKind),
        isNull(mcpInvocationsTable.operationTarget),
        eq(mcpInvocationsTable.toolName, ref.toolName),
      ),
    );
  }

  private preparedMcpOperationReference(rows: ParsedMcpOperationRows): PreparedMcpOperationRef {
    if (!rows.attempt.preparedAt) {
      throw new ConflictException('MCP operation attempt has no preparation timestamp');
    }
    return PreparedMcpOperationRefSchema.parse({
      invocationId: rows.invocation.invocationId,
      attemptId: rows.attempt.id,
      attemptNumber: rows.attempt.attemptNumber,
      capabilitySnapshotId: rows.invocation.capabilitySnapshotId,
      capabilityGrantId: rows.invocation.capabilityGrantId,
      operationKind: rows.invocation.operationKind,
      operationTarget: rows.invocation.operationTarget,
      toolName: rows.invocation.toolName,
      sourceId: rows.attempt.sourceId,
      destination: rows.attempt.destination,
      retryPolicy: rows.attempt.retryPolicy,
      preparedAt: rows.attempt.preparedAt.toISOString(),
    });
  }

  private mcpOperationPlan(
    rows: ParsedMcpOperationRows,
    manifestEntry: McpOperationManifestEntry,
    operation: McpOperation,
    runtimeBinding?: McpSnapshotRuntimeBinding,
  ): McpOperationDispatchPlan {
    return McpOperationDispatchPlanSchema.parse({
      ref: this.preparedMcpOperationReference(rows),
      manifestEntry,
      operation,
      requestedAt: rows.request.requestedAt,
      deadlineAt: rows.request.deadlineAt,
      ...(runtimeBinding !== undefined && { runtimeBinding }),
    });
  }

  private assertMcpOperationReplay(
    rows: ParsedMcpOperationRows,
    request: McpOperationInvocationRequest,
    requestHash: string,
  ): void {
    if (rows.invocation.requestHash !== requestHash) {
      throw new ConflictException(
        'MCP operation invocation ID was already used for a different request hash',
      );
    }
    if (
      rows.invocation.invocationId !== request.invocationId ||
      request.scope.kind !== 'run' ||
      rows.invocation.runId !== request.scope.runId ||
      rows.invocation.organizationId !== request.scope.organizationId ||
      rows.invocation.capabilityGrantId !== request.scope.capabilityGrantId ||
      rows.invocation.capabilitySnapshotId !== request.capabilitySnapshotId ||
      rows.invocation.operationKind !== request.operation.kind ||
      rows.invocation.operationTarget !== request.authorizationTarget
    ) {
      throw new ConflictException('MCP operation replay crossed its persisted run authority');
    }
  }

  private assertMcpOperationReference(
    rows: ParsedMcpOperationRows,
    ref: PreparedMcpOperationRef,
  ): void {
    if (
      rows.invocation.currentAttemptNumber !== ref.attemptNumber ||
      rows.attempt.attemptNumber !== ref.attemptNumber ||
      rows.attempt.id !== ref.attemptId
    ) {
      throw new ConflictException('Prepared MCP operation reference is not the current attempt');
    }
    if (
      rows.invocation.invocationId !== ref.invocationId ||
      rows.invocation.capabilityGrantId !== ref.capabilityGrantId ||
      rows.invocation.capabilitySnapshotId !== ref.capabilitySnapshotId ||
      rows.invocation.operationKind !== ref.operationKind ||
      rows.invocation.operationTarget !== ref.operationTarget ||
      rows.invocation.toolName !== ref.toolName ||
      rows.attempt.invocationId !== ref.invocationId ||
      rows.attempt.preparedAt?.toISOString() !== ref.preparedAt ||
      rows.attempt.sourceId !== ref.sourceId ||
      rows.attempt.destination !== ref.destination ||
      rows.attempt.retryPolicy !== ref.retryPolicy
    ) {
      throw new ConflictException('Prepared MCP operation reference does not match persistence');
    }
  }

  private requireMcpOperationResult(rows: ParsedMcpOperationRows): McpOperationResult {
    if (!rows.result) {
      throw new ConflictException('Terminal MCP operation has no validated result');
    }
    return rows.result;
  }

  private capturedFence(rows: ParsedMcpOperationRows): McpRuntimeFence | null {
    if (
      rows.attempt.runtimeId === null &&
      rows.attempt.ownerId === null &&
      rows.attempt.ownerEpoch === null &&
      rows.attempt.leaseGeneration === null
    ) {
      return null;
    }
    return McpRuntimeFenceSchema.parse({
      runtimeId: rows.attempt.runtimeId,
      ownerId: rows.attempt.ownerId,
      ownerEpoch: rows.attempt.ownerEpoch,
      leaseGeneration: rows.attempt.leaseGeneration,
    });
  }

  private async transitionMcpOperationTerminal(
    executor: NodePgDatabase,
    ref: PreparedMcpOperationRef,
    fence: McpRuntimeFence | null,
    result: McpOperationResult,
    fromStatus: 'prepared' | 'dispatched',
  ): Promise<boolean> {
    const completedAt = new Date(result.completedAt);
    const status = mcpOperationResultStatus(result);
    const [settledInvocation] = await executor
      .update(mcpInvocationsTable)
      .set({ status, result, updatedAt: completedAt, terminalAt: completedAt })
      .where(
        and(
          eq(mcpInvocationsTable.invocationId, ref.invocationId),
          eq(mcpInvocationsTable.currentAttemptNumber, ref.attemptNumber),
          eq(mcpInvocationsTable.capabilityGrantId, ref.capabilityGrantId),
          eq(mcpInvocationsTable.capabilitySnapshotId, ref.capabilitySnapshotId),
          this.mcpOperationIdentityMatches(ref),
          eq(mcpInvocationsTable.status, fromStatus),
        ),
      )
      .returning();
    if (!settledInvocation) return false;

    const [settledAttempt] = await executor
      .update(mcpInvocationAttemptsTable)
      .set({ status, completedAt })
      .where(
        and(
          eq(mcpInvocationAttemptsTable.id, ref.attemptId),
          eq(mcpInvocationAttemptsTable.invocationId, ref.invocationId),
          eq(mcpInvocationAttemptsTable.attemptNumber, ref.attemptNumber),
          eq(mcpInvocationAttemptsTable.preparedAt, new Date(ref.preparedAt)),
          eq(mcpInvocationAttemptsTable.sourceId, ref.sourceId),
          eq(mcpInvocationAttemptsTable.destination, ref.destination),
          eq(mcpInvocationAttemptsTable.retryPolicy, ref.retryPolicy),
          fence === null
            ? isNull(mcpInvocationAttemptsTable.runtimeId)
            : eq(mcpInvocationAttemptsTable.runtimeId, fence.runtimeId),
          fence === null
            ? isNull(mcpInvocationAttemptsTable.ownerId)
            : eq(mcpInvocationAttemptsTable.ownerId, fence.ownerId),
          fence === null
            ? isNull(mcpInvocationAttemptsTable.ownerEpoch)
            : eq(mcpInvocationAttemptsTable.ownerEpoch, fence.ownerEpoch),
          fence === null
            ? isNull(mcpInvocationAttemptsTable.leaseGeneration)
            : eq(mcpInvocationAttemptsTable.leaseGeneration, fence.leaseGeneration),
          eq(mcpInvocationAttemptsTable.status, fromStatus),
        ),
      )
      .returning();
    if (!settledAttempt) {
      throw new ConflictException('MCP operation attempt could not be settled');
    }
    return true;
  }

  private async settleMcpOperationTerminal(
    ref: PreparedMcpOperationRef,
    fence: McpRuntimeFence | null,
    result: McpOperationResult,
  ): Promise<McpOperationResult> {
    return this.db.transaction(async (transaction) => {
      const tx = transaction as unknown as NodePgDatabase;
      const existing = await this.requireCurrentMcpOperation(tx, ref);
      this.assertMcpOperationSettlementFence(existing, fence);
      if (existing.invocation.status === 'dispatched') {
        if (await this.transitionMcpOperationTerminal(tx, ref, fence, result, 'dispatched')) {
          return result;
        }
        const concurrent = await this.requireCurrentMcpOperation(tx, ref);
        this.assertMcpOperationSettlementFence(concurrent, fence);
        const storedResult = this.requireMcpOperationResult(concurrent);
        if (!isDeepStrictEqual(storedResult, result)) {
          throw new ConflictException('MCP operation terminal replay conflicts with stored result');
        }
        return storedResult;
      }
      if (!TERMINAL_STATUSES.has(existing.invocation.status)) {
        throw new ConflictException('MCP operation attempt can only settle from dispatched state');
      }
      const storedResult = this.requireMcpOperationResult(existing);
      if (!isDeepStrictEqual(storedResult, result)) {
        throw new ConflictException('MCP operation terminal replay conflicts with stored result');
      }
      return storedResult;
    });
  }

  private assertMcpOperationSettlementFence(
    rows: ParsedMcpOperationRows,
    fence: McpRuntimeFence | null,
  ): void {
    if (!isDeepStrictEqual(this.capturedFence(rows), fence)) {
      throw new ConflictException('MCP operation settlement used a stale runtime fence');
    }
  }

  private mcpOperationReconciliationResult(
    operationId: string,
    state: McpInvocationStatus,
    input: ReconcileMcpOperationDispatchRequest,
  ): McpOperationResult {
    if (state === 'dispatched') {
      return McpOperationResultSchema.parse({
        operationId,
        kind: 'ambiguous',
        message: input.message,
        completedAt: input.completedAt,
      });
    }
    if (state !== 'prepared') {
      throw new ConflictException('MCP operation is not reconcilable from its current state');
    }
    if (input.cause === 'cancelled') {
      return McpOperationResultSchema.parse({
        operationId,
        kind: 'cancelled',
        message: input.message,
        completedAt: input.completedAt,
      });
    }
    return McpOperationResultSchema.parse({
      operationId,
      kind: 'remote-failure',
      message: input.message,
      retryable: input.cause === 'failure',
      completedAt: input.completedAt,
    });
  }

  private async requireCurrentMcpOperation(
    executor: NodePgDatabase,
    ref: PreparedMcpOperationRef,
  ): Promise<ParsedMcpOperationRows> {
    const existing = await this.readMcpOperation(executor, ref.invocationId);
    if (!existing) throw new NotFoundException('MCP operation attempt was not found');
    this.assertMcpOperationReference(existing, ref);
    return existing;
  }

  private parseInvocationPreparation(input: {
    request: ToolInvocationRequest;
    requestHash: string;
    entry: InvocationManifestEntry;
    manifest: InvocationManifest;
  }): {
    request: ToolInvocationRequest & {
      scope: Extract<ToolInvocationRequest['scope'], { kind: 'run' }>;
    };
    entry: InvocationManifestEntry;
    manifest: InvocationManifest;
  } {
    if (!LOWERCASE_SHA256.test(input.requestHash)) {
      throw new Error('MCP invocation request hash must be a lowercase SHA-256 digest');
    }
    const request = ToolInvocationRequestSchema.parse(input.request);
    const entry = InvocationManifestEntrySchema.parse(input.entry);
    const manifest = InvocationManifestSchema.parse(input.manifest);
    if (request.scope.kind !== 'run') {
      throw new ConflictException('MCP durable invocations must be run-scoped');
    }
    const legacyEntry =
      'toolName' in entry
        ? entry
        : {
            toolName: entry.operationTarget,
            sourceId: entry.sourceId,
            destination: entry.destination,
            retryPolicy: entry.retryPolicy,
          };
    if (
      manifest.capabilityGrantId !== request.scope.capabilityGrantId ||
      manifest.capabilitySnapshotId !== request.capabilitySnapshotId ||
      legacyEntry.toolName !== request.toolName ||
      !manifest.entries.some((candidate) => isDeepStrictEqual(candidate, entry))
    ) {
      throw new ConflictException('MCP invocation does not match its invocation manifest');
    }
    return {
      request: request as ToolInvocationRequest & {
        scope: Extract<ToolInvocationRequest['scope'], { kind: 'run' }>;
      },
      entry: legacyEntry,
      manifest,
    };
  }

  private async readInvocation(
    executor: NodePgDatabase,
    invocationId: string,
  ): Promise<ParsedInvocationRows | null> {
    const [rows] = await executor
      .select({
        invocation: mcpInvocationsTable,
        attempt: mcpInvocationAttemptsTable,
      })
      .from(mcpInvocationsTable)
      .innerJoin(
        mcpInvocationAttemptsTable,
        and(
          eq(mcpInvocationAttemptsTable.invocationId, mcpInvocationsTable.invocationId),
          eq(mcpInvocationAttemptsTable.attemptNumber, mcpInvocationsTable.currentAttemptNumber),
        ),
      )
      .where(eq(mcpInvocationsTable.invocationId, invocationId))
      .limit(1);
    return rows ? this.parseStoredInvocation(rows) : null;
  }

  private parseStoredInvocation(rows: StoredInvocationRows): ParsedInvocationRows {
    const request = ToolInvocationRequestSchema.parse(rows.invocation.request);
    const result =
      rows.invocation.result === null
        ? null
        : ToolInvocationResultSchema.parse(rows.invocation.result);
    if (
      request.invocationId !== rows.invocation.invocationId ||
      request.scope.kind !== 'run' ||
      request.scope.runId !== rows.invocation.runId ||
      request.scope.organizationId !== rows.invocation.organizationId ||
      request.scope.capabilityGrantId !== rows.invocation.capabilityGrantId ||
      request.capabilitySnapshotId !== rows.invocation.capabilitySnapshotId ||
      request.toolName !== rows.invocation.toolName
    ) {
      throw new ConflictException('Persisted MCP invocation columns do not match request JSON');
    }
    if (
      rows.attempt.invocationId !== rows.invocation.invocationId ||
      rows.attempt.attemptNumber !== rows.invocation.currentAttemptNumber
    ) {
      throw new ConflictException(
        'Persisted MCP invocation does not reference its current attempt',
      );
    }
    if (rows.attempt.status !== rows.invocation.status) {
      throw new ConflictException('MCP invocation and current-attempt status projection diverged');
    }
    if (
      TERMINAL_STATUSES.has(rows.invocation.status) !== (result !== null) ||
      (result &&
        (result.status !== rows.invocation.status ||
          result.invocationId !== rows.invocation.invocationId))
    ) {
      throw new ConflictException('Persisted MCP invocation terminal result is inconsistent');
    }
    return { ...rows, request, result };
  }

  private preparedReference(rows: ParsedInvocationRows): PreparedInvocationRef {
    if (!rows.attempt.preparedAt) {
      throw new ConflictException('MCP invocation attempt has no preparation timestamp');
    }
    return PreparedInvocationRefSchema.parse({
      invocationId: rows.invocation.invocationId,
      attemptId: rows.attempt.id,
      attemptNumber: rows.attempt.attemptNumber,
      capabilitySnapshotId: rows.invocation.capabilitySnapshotId,
      capabilityGrantId: rows.invocation.capabilityGrantId,
      toolName: rows.invocation.toolName,
      sourceId: rows.attempt.sourceId,
      destination: rows.attempt.destination,
      retryPolicy: rows.attempt.retryPolicy,
      preparedAt: rows.attempt.preparedAt.toISOString(),
    });
  }

  private assertInvocationReplay(
    rows: ParsedInvocationRows,
    request: ToolInvocationRequest,
    requestHash: string,
  ): void {
    if (rows.invocation.requestHash !== requestHash) {
      throw new ConflictException(
        'MCP invocation ID was already used for a different request hash',
      );
    }
    if (
      rows.invocation.invocationId !== request.invocationId ||
      request.scope.kind !== 'run' ||
      rows.invocation.runId !== request.scope.runId ||
      rows.invocation.organizationId !== request.scope.organizationId ||
      rows.invocation.capabilityGrantId !== request.scope.capabilityGrantId ||
      rows.invocation.capabilitySnapshotId !== request.capabilitySnapshotId ||
      rows.invocation.toolName !== request.toolName
    ) {
      throw new ConflictException('MCP invocation replay crossed its persisted run authority');
    }
  }

  private assertReferenceMatches(rows: ParsedInvocationRows, ref: PreparedInvocationRef): void {
    if (
      rows.invocation.currentAttemptNumber !== ref.attemptNumber ||
      rows.attempt.attemptNumber !== ref.attemptNumber ||
      rows.attempt.id !== ref.attemptId
    ) {
      throw new ConflictException('Prepared MCP invocation reference is not the current attempt');
    }
    if (
      rows.invocation.invocationId !== ref.invocationId ||
      rows.invocation.capabilityGrantId !== ref.capabilityGrantId ||
      rows.invocation.capabilitySnapshotId !== ref.capabilitySnapshotId ||
      rows.invocation.toolName !== ref.toolName ||
      rows.attempt.invocationId !== ref.invocationId ||
      rows.attempt.preparedAt?.toISOString() !== ref.preparedAt ||
      rows.attempt.sourceId !== ref.sourceId ||
      rows.attempt.destination !== ref.destination ||
      rows.attempt.retryPolicy !== ref.retryPolicy
    ) {
      throw new ConflictException('Prepared MCP invocation reference does not match persistence');
    }
  }

  private requireTerminalResult(rows: ParsedInvocationRows): ToolInvocationResult {
    if (!rows.result) {
      throw new ConflictException('Terminal MCP invocation has no validated result');
    }
    return rows.result;
  }

  private claimReplayOutcome(rows: ParsedInvocationRows): ClaimAttemptOutcome {
    if (!TERMINAL_STATUSES.has(rows.invocation.status)) {
      throw new ConflictException(
        'MCP invocation attempt cannot be claimed from its current state',
      );
    }
    const result = this.requireTerminalResult(rows);
    return result.status === 'ambiguous'
      ? { kind: 'ambiguous', result }
      : { kind: 'terminal', result };
  }

  private async settleTerminal(
    ref: PreparedInvocationRef,
    result: ToolInvocationResult,
  ): Promise<ToolInvocationResult> {
    return this.db.transaction(async (transaction) => {
      const tx = transaction as unknown as NodePgDatabase;
      if (await this.transitionTerminal(tx, ref, result, 'dispatched')) {
        return result;
      }

      const existing = await this.requireCurrentInvocation(tx, ref);
      if (!TERMINAL_STATUSES.has(existing.invocation.status)) {
        throw new ConflictException('MCP invocation attempt can only settle from dispatched state');
      }
      const storedResult = this.requireTerminalResult(existing);
      if (!isDeepStrictEqual(storedResult, result)) {
        throw new ConflictException('MCP invocation terminal replay conflicts with stored result');
      }
      return storedResult;
    });
  }

  private async transitionTerminal(
    executor: NodePgDatabase,
    ref: PreparedInvocationRef,
    result: ToolInvocationResult,
    fromStatus: 'prepared' | 'dispatched',
  ): Promise<boolean> {
    const completedAt = new Date(result.completedAt);
    const [settledInvocation] = await executor
      .update(mcpInvocationsTable)
      .set({
        status: result.status,
        result,
        updatedAt: completedAt,
        terminalAt: completedAt,
      })
      .where(
        and(
          eq(mcpInvocationsTable.invocationId, ref.invocationId),
          eq(mcpInvocationsTable.currentAttemptNumber, ref.attemptNumber),
          eq(mcpInvocationsTable.capabilityGrantId, ref.capabilityGrantId),
          eq(mcpInvocationsTable.capabilitySnapshotId, ref.capabilitySnapshotId),
          eq(mcpInvocationsTable.toolName, ref.toolName),
          eq(mcpInvocationsTable.status, fromStatus),
        ),
      )
      .returning();
    if (!settledInvocation) {
      return false;
    }

    const [settledAttempt] = await executor
      .update(mcpInvocationAttemptsTable)
      .set({ status: result.status, completedAt })
      .where(
        and(
          eq(mcpInvocationAttemptsTable.id, ref.attemptId),
          eq(mcpInvocationAttemptsTable.invocationId, ref.invocationId),
          eq(mcpInvocationAttemptsTable.attemptNumber, ref.attemptNumber),
          eq(mcpInvocationAttemptsTable.preparedAt, new Date(ref.preparedAt)),
          eq(mcpInvocationAttemptsTable.sourceId, ref.sourceId),
          eq(mcpInvocationAttemptsTable.destination, ref.destination),
          eq(mcpInvocationAttemptsTable.retryPolicy, ref.retryPolicy),
          eq(mcpInvocationAttemptsTable.status, fromStatus),
        ),
      )
      .returning();
    if (!settledAttempt) {
      throw new ConflictException('MCP invocation attempt could not be settled');
    }
    return true;
  }

  private reconciliationResult(
    invocationId: string,
    state: McpInvocationStatus,
    input: {
      cause: 'failure' | 'deadline' | 'cancelled';
      message: string;
      completedAt: string;
    },
  ): ToolInvocationResult {
    if (state === 'dispatched') {
      return ToolInvocationResultSchema.parse({
        invocationId,
        status: 'ambiguous',
        error: {
          class: 'ambiguous-after-dispatch',
          message: input.message,
          retryable: false,
        },
        completedAt: input.completedAt,
      });
    }
    if (state !== 'prepared') {
      throw new ConflictException('MCP invocation is not reconcilable from its current state');
    }
    const status = input.cause === 'cancelled' ? 'cancelled' : 'failed';
    const failureClass =
      input.cause === 'deadline'
        ? 'deadline-before-dispatch'
        : input.cause === 'cancelled'
          ? 'cancelled'
          : 'pre-dispatch';
    return ToolInvocationResultSchema.parse({
      invocationId,
      status,
      error: {
        class: failureClass,
        message: input.message,
        retryable: input.cause === 'failure',
      },
      completedAt: input.completedAt,
    });
  }

  private async requireCurrentInvocation(
    executor: NodePgDatabase,
    ref: PreparedInvocationRef,
  ): Promise<ParsedInvocationRows> {
    const existing = await this.readInvocation(executor, ref.invocationId);
    if (!existing) {
      throw new NotFoundException('MCP invocation attempt was not found');
    }
    this.assertReferenceMatches(existing, ref);
    return existing;
  }
}

function isMcpOperationRequestJson(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    'operation' in value &&
    'authorizationTarget' in value &&
    'sourceId' in value
  );
}

function mcpOperationResultStatus(result: McpOperationResult): McpInvocationStatus {
  switch (result.kind) {
    case 'completed':
      return 'completed';
    case 'remote-failure':
    case 'input-required-unsupported':
      return 'failed';
    case 'cancelled':
      return 'cancelled';
    case 'ambiguous':
      return 'ambiguous';
  }
}
