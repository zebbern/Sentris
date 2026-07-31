import { isDeepStrictEqual } from 'node:util';
import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import {
  CapabilityGrantSchema,
  InvocationManifestEntrySchema,
  InvocationManifestSchema,
  McpCapabilityCatalogSnapshotSchema,
  PreparedInvocationRefSchema,
  ToolInvocationRequestSchema,
  ToolInvocationResultSchema,
  assertCapabilityGrantApplies,
  type CapabilityGrant,
  type InvocationManifest,
  type InvocationManifestEntry,
  type McpCapabilityCatalogSnapshot,
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
        if (await this.transitionTerminal(tx, ref, ambiguousResult)) {
          return { kind: 'ambiguous', result: ambiguousResult };
        }
        const concurrent = await this.requireCurrentInvocation(tx, ref);
        return this.claimReplayOutcome(concurrent);
      }

      return this.claimReplayOutcome(existing);
    });
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
    if (
      manifest.capabilityGrantId !== request.scope.capabilityGrantId ||
      manifest.capabilitySnapshotId !== request.capabilitySnapshotId ||
      entry.toolName !== request.toolName ||
      !manifest.entries.some((candidate) => isDeepStrictEqual(candidate, entry))
    ) {
      throw new ConflictException('MCP invocation does not match its invocation manifest');
    }
    return {
      request: request as ToolInvocationRequest & {
        scope: Extract<ToolInvocationRequest['scope'], { kind: 'run' }>;
      },
      entry,
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
      if (await this.transitionTerminal(tx, ref, result)) {
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
          eq(mcpInvocationsTable.status, 'dispatched'),
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
          eq(mcpInvocationAttemptsTable.status, 'dispatched'),
        ),
      )
      .returning();
    if (!settledAttempt) {
      throw new ConflictException('Dispatched MCP invocation attempt could not be settled');
    }
    return true;
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
