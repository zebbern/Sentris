import { ConflictException } from '@nestjs/common';
import { describe, expect, it } from 'bun:test';

import type {
  CapabilityGrant,
  ExecutionScope,
  InvocationManifest,
  InvocationManifestEntry,
  McpCapabilityCatalogSnapshot,
  McpOperationInvocationRequest,
  McpOperationManifestEntry,
  McpOperationResult,
  McpReadyRuntimeRef,
  McpSnapshotRuntimeBinding,
  PreparedMcpOperationRef,
  PreparedInvocationRef,
  ToolInvocationRequest,
  ToolInvocationResult,
} from '@sentris/shared';
import type { McpInvocationAttemptInsert } from '../../database/schema';
import { McpRuntimeRepository } from '../mcp-runtime.repository';

const AUTHORITY_KEY = 'd'.repeat(64);
const REQUEST_HASH = 'e'.repeat(64);
const GRANT_ID = '11111111-1111-4111-8111-111111111111';
const SNAPSHOT_ID = '22222222-2222-4222-8222-222222222222';
const INVOCATION_ID = '33333333-3333-4333-8333-333333333333';
const ATTEMPT_ID = '44444444-4444-4444-8444-444444444444';
const OPERATOR_SESSION_ID = '77777777-7777-4777-8777-777777777777';
const OPERATOR_TURN_ID = '88888888-8888-4888-8888-888888888888';

const grant: CapabilityGrant = {
  id: GRANT_ID,
  organizationId: 'org-1',
  subject: { kind: 'run', runId: 'run-1' },
  sources: [{ sourceId: 'component:node-1', toolAccess: { mode: 'all' } }],
  createdAt: '2026-07-31T10:00:00.000Z',
};

const snapshot: McpCapabilityCatalogSnapshot = {
  id: SNAPSHOT_ID,
  scope: {
    kind: 'run',
    organizationId: 'org-1',
    runId: 'run-1',
    capabilityGrantId: GRANT_ID,
  },
  version: '1',
  configFingerprint: 'a'.repeat(64),
  tools: [
    {
      canonicalName: 'component.scan',
      displayName: 'Scan',
      inputSchema: { type: 'object' },
      source: {
        kind: 'component',
        sourceId: 'component:node-1',
        nodeId: 'node-1',
        componentId: 'scanner',
        bindingFingerprint: 'b'.repeat(64),
      },
      effects: 'read-only',
      effectsSource: 'sentris-contract',
      retryPolicy: 'reviewed-idempotent',
    },
  ],
  resources: [],
  resourceTemplates: [],
  prompts: [],
  createdAt: '2026-07-31T10:00:01.000Z',
};

const entry: InvocationManifestEntry = {
  toolName: 'component.scan',
  sourceId: 'component:node-1',
  destination: 'component-activity',
  retryPolicy: 'reviewed-idempotent',
};

const manifest: InvocationManifest = {
  capabilitySnapshotId: SNAPSHOT_ID,
  capabilityGrantId: GRANT_ID,
  version: '1',
  entries: [entry],
};

const request: ToolInvocationRequest = {
  invocationId: INVOCATION_ID,
  scope: {
    kind: 'run',
    organizationId: 'org-1',
    runId: 'run-1',
    capabilityGrantId: GRANT_ID,
  },
  capabilitySnapshotId: SNAPSHOT_ID,
  toolName: 'component.scan',
  input: { target: 'https://example.com' },
  requestedAt: '2026-07-31T10:01:00.000Z',
  deadlineAt: '2026-07-31T10:06:00.000Z',
};

const ref: PreparedInvocationRef = {
  invocationId: INVOCATION_ID,
  attemptId: ATTEMPT_ID,
  attemptNumber: 1,
  capabilitySnapshotId: SNAPSHOT_ID,
  capabilityGrantId: GRANT_ID,
  toolName: 'component.scan',
  sourceId: 'component:node-1',
  destination: 'component-activity',
  retryPolicy: 'reviewed-idempotent',
  preparedAt: '2026-07-31T10:01:00.000Z',
};

const completedResult: ToolInvocationResult = {
  invocationId: INVOCATION_ID,
  status: 'completed',
  output: { findings: 1 },
  completedAt: '2026-07-31T10:02:00.000Z',
};

const operationRequest: McpOperationInvocationRequest = {
  invocationId: INVOCATION_ID,
  scope: request.scope,
  capabilitySnapshotId: SNAPSHOT_ID,
  sourceId: 'mcp:github',
  authorizationTarget: 'repo://{path}',
  operation: { kind: 'resource-read', uri: 'repo://src/index.ts' },
  requestedAt: request.requestedAt,
  deadlineAt: request.deadlineAt,
};

const operationEntry: McpOperationManifestEntry = {
  operationKind: 'resource-read',
  operationTarget: 'repo://{path}',
  sourceId: 'mcp:github',
  destination: 'mcp-activity',
  retryPolicy: 'reviewed-idempotent',
};

const runtimeBinding: McpSnapshotRuntimeBinding = {
  runtimeKey: {
    sourceId: 'github-server',
    transport: 'http',
    configFingerprint: 'f'.repeat(64),
    organizationId: 'org-1',
    principalPartitionHash: '1'.repeat(64),
    credentialReference: 'mcp-server:github-server',
    credentialGeneration: 7,
  },
  protocolEra: 'modern',
  protocolVersion: '2026-07-28',
  capabilityFingerprint: '2'.repeat(64),
};

const runtimeRef: McpReadyRuntimeRef = {
  fence: {
    runtimeId: '55555555-5555-4555-8555-555555555555',
    ownerId: 'worker-1',
    ownerEpoch: '66666666-6666-4666-8666-666666666666',
    leaseGeneration: 4,
  },
  leaseExpiresAt: '2026-07-31T10:10:00.000Z',
  protocolEra: runtimeBinding.protocolEra,
  protocolVersion: runtimeBinding.protocolVersion,
  ownerAddress: 'http://worker-1.internal:9301',
  state: 'ready',
  capabilityFingerprint: runtimeBinding.capabilityFingerprint,
};

const operationRef: PreparedMcpOperationRef = {
  invocationId: INVOCATION_ID,
  attemptId: ATTEMPT_ID,
  attemptNumber: 1,
  capabilitySnapshotId: SNAPSHOT_ID,
  capabilityGrantId: GRANT_ID,
  operationKind: 'resource-read',
  operationTarget: 'repo://{path}',
  toolName: null,
  sourceId: operationEntry.sourceId,
  destination: operationEntry.destination,
  retryPolicy: operationEntry.retryPolicy,
  preparedAt: '2026-07-31T10:01:00.000Z',
};

const completedOperationResult: McpOperationResult = {
  operationId: INVOCATION_ID,
  kind: 'completed',
  output: { contents: [] },
  completedAt: '2026-07-31T10:02:00.000Z',
};

interface MockCall {
  method: string;
  args: unknown[];
}

interface MockRows {
  insert?: MockResult[];
  select?: MockResult[];
  update?: MockResult[];
}

type MockResult = unknown[] | ((calls: MockCall[]) => unknown[]);

function createMockDb(rows: MockRows = {}): { db: never; calls: MockCall[] } {
  const calls: MockCall[] = [];
  const queues = {
    insert: [...(rows.insert ?? [])],
    select: [...(rows.select ?? [])],
    update: [...(rows.update ?? [])],
  };

  function chainable(result: MockResult) {
    const builder: Record<string, unknown> = {};
    const builderCalls: MockCall[] = [];
    const self = new Proxy(builder, {
      get(_target, prop: string) {
        if (prop === 'then') {
          return (resolve: (value: unknown[]) => void) =>
            resolve(typeof result === 'function' ? result(builderCalls) : result);
        }
        return (...args: unknown[]) => {
          const call = { method: prop, args };
          calls.push(call);
          builderCalls.push(call);
          return self;
        };
      },
    });
    return self;
  }

  const db: Record<string, unknown> = {};
  for (const operation of ['insert', 'select', 'update'] as const) {
    db[operation] = (...args: unknown[]) => {
      calls.push({ method: operation, args });
      return chainable(queues[operation].shift() ?? []);
    };
  }
  db.transaction = async (callback: (executor: unknown) => Promise<unknown>) => {
    calls.push({ method: 'transaction', args: [callback] });
    return callback(db);
  };

  return { db: db as never, calls };
}

function authorityRows(overrides?: {
  grant?: Partial<CapabilityGrant>;
  snapshot?: Partial<McpCapabilityCatalogSnapshot>;
  manifest?: InvocationManifest;
}) {
  const storedGrant = { ...grant, ...overrides?.grant };
  const storedSnapshot = { ...snapshot, ...overrides?.snapshot };
  const subjectId =
    storedGrant.subject.kind === 'run'
      ? storedGrant.subject.runId
      : storedGrant.subject.kind === 'operator'
        ? storedGrant.subject.turnId
        : storedGrant.subject.operationId;
  return {
    grant: {
      id: storedGrant.id,
      authorityKey: AUTHORITY_KEY,
      organizationId: storedGrant.organizationId,
      subjectKind: storedGrant.subject.kind,
      subjectId,
      grant: storedGrant,
      createdAt: new Date(storedGrant.createdAt),
    },
    snapshot: {
      id: storedSnapshot.id,
      capabilityGrantId: storedGrant.id,
      configFingerprint: storedSnapshot.configFingerprint,
      snapshot: storedSnapshot,
      invocationManifest: overrides?.manifest ?? manifest,
      createdAt: new Date(storedSnapshot.createdAt),
    },
  };
}

function invocationRows(
  status: 'prepared' | 'dispatched' | 'completed' | 'failed' | 'ambiguous' | 'cancelled',
  options: {
    currentAttemptNumber?: number;
    requestHash?: string;
    result?: ToolInvocationResult | Record<string, unknown> | null;
  } = {},
) {
  return {
    invocation: {
      invocationId: INVOCATION_ID,
      subjectKind: 'run',
      subjectId: 'run-1',
      runId: 'run-1',
      organizationId: 'org-1',
      capabilityGrantId: GRANT_ID,
      capabilitySnapshotId: SNAPSHOT_ID,
      toolName: 'component.scan',
      requestHash: options.requestHash ?? REQUEST_HASH,
      request,
      status,
      currentAttemptNumber: options.currentAttemptNumber ?? 1,
      result: options.result ?? null,
      createdAt: new Date('2026-07-31T10:01:00.000Z'),
      updatedAt: new Date('2026-07-31T10:01:00.000Z'),
      terminalAt: options.result ? new Date(options.result.completedAt as string) : null,
    },
    attempt: {
      id: ATTEMPT_ID,
      invocationId: INVOCATION_ID,
      attemptNumber: 1,
      sourceId: 'component:node-1',
      destination: 'component-activity',
      retryPolicy: 'reviewed-idempotent',
      status,
      preparedAt: new Date('2026-07-31T10:01:00.000Z'),
      dispatchedAt: status === 'prepared' ? null : new Date('2026-07-31T10:01:30.000Z'),
      completedAt: options.result ? new Date(options.result.completedAt as string) : null,
    },
  };
}

function operationRows(
  status: 'prepared' | 'dispatched' | 'completed' | 'failed' | 'ambiguous' | 'cancelled',
  result: McpOperationResult | null = null,
) {
  return {
    invocation: {
      invocationId: INVOCATION_ID,
      subjectKind: 'run',
      subjectId: 'run-1',
      runId: 'run-1',
      organizationId: 'org-1',
      capabilityGrantId: GRANT_ID,
      capabilitySnapshotId: SNAPSHOT_ID,
      operationKind: 'resource-read',
      operationTarget: 'repo://{path}',
      toolName: null,
      requestHash: REQUEST_HASH,
      request: operationRequest,
      status,
      currentAttemptNumber: 1,
      result,
      createdAt: new Date('2026-07-31T10:01:00.000Z'),
      updatedAt: new Date('2026-07-31T10:01:00.000Z'),
      terminalAt: result ? new Date(result.completedAt) : null,
    },
    attempt: {
      id: ATTEMPT_ID,
      invocationId: INVOCATION_ID,
      attemptNumber: 1,
      sourceId: operationEntry.sourceId,
      destination: operationEntry.destination,
      retryPolicy: operationEntry.retryPolicy,
      runtimeId: status === 'prepared' ? null : runtimeRef.fence.runtimeId,
      ownerId: status === 'prepared' ? null : runtimeRef.fence.ownerId,
      ownerEpoch: status === 'prepared' ? null : runtimeRef.fence.ownerEpoch,
      leaseGeneration: status === 'prepared' ? null : runtimeRef.fence.leaseGeneration,
      status,
      preparedAt: new Date('2026-07-31T10:01:00.000Z'),
      dispatchedAt: status === 'prepared' ? null : new Date('2026-07-31T10:01:30.000Z'),
      completedAt: result ? new Date(result.completedAt) : null,
    },
  };
}

function sqlContainsParamValue(node: unknown, value: unknown): boolean {
  if (!node || typeof node !== 'object') return false;
  const candidate = node as {
    constructor?: { name?: string };
    value?: unknown;
    queryChunks?: unknown[];
  };
  if (candidate.constructor?.name === 'Param' && candidate.value === value) return true;
  return candidate.queryChunks?.some((chunk) => sqlContainsParamValue(chunk, value)) ?? false;
}

function sqlContainsColumn(node: unknown, name: string): boolean {
  if (!node || typeof node !== 'object') return false;
  const candidate = node as { name?: string; queryChunks?: unknown[] };
  if (candidate.name === name) return true;
  return candidate.queryChunks?.some((chunk) => sqlContainsColumn(chunk, name)) ?? false;
}

function sqlContainsDateParamValue(node: unknown, value: string): boolean {
  if (!node || typeof node !== 'object') return false;
  const candidate = node as {
    constructor?: { name?: string };
    value?: unknown;
    queryChunks?: unknown[];
  };
  if (
    candidate.constructor?.name === 'Param' &&
    candidate.value instanceof Date &&
    candidate.value.toISOString() === value
  ) {
    return true;
  }
  return candidate.queryChunks?.some((chunk) => sqlContainsDateParamValue(chunk, value)) ?? false;
}

function matchAttemptByPreparedAt(row: unknown): (calls: MockCall[]) => unknown[] {
  return (calls) => {
    const where = calls.find((call) => call.method === 'where')?.args[0];
    if (!sqlContainsColumn(where, 'prepared_at')) return [row];
    return sqlContainsDateParamValue(where, ref.preparedAt) ? [row] : [];
  };
}

function sqlContainsText(node: unknown, text: string): boolean {
  if (typeof node === 'string') return node.includes(text);
  if (!node || typeof node !== 'object') return false;
  const candidate = node as { value?: unknown; queryChunks?: unknown[] };
  if (
    Array.isArray(candidate.value) &&
    candidate.value.some((value) => typeof value === 'string' && value.includes(text))
  ) {
    return true;
  }
  return candidate.queryChunks?.some((chunk) => sqlContainsText(chunk, text)) ?? false;
}

describe('McpRuntimeRepository', () => {
  describe('generic MCP operation attempts', () => {
    it('normalizes a legacy tool-only row when the new backend reads it', async () => {
      const legacyRows = invocationRows('prepared');
      Object.assign(legacyRows.invocation, {
        operationKind: null,
        operationTarget: null,
      });
      Object.assign(legacyRows.attempt, {
        runtimeId: null,
        ownerId: null,
        ownerEpoch: null,
        leaseGeneration: null,
      });
      const projectedRequest: McpOperationInvocationRequest = {
        invocationId: request.invocationId,
        scope: request.scope,
        capabilitySnapshotId: request.capabilitySnapshotId,
        sourceId: entry.sourceId,
        authorizationTarget: request.toolName,
        operation: { kind: 'tool-call', name: request.toolName, arguments: request.input },
        requestedAt: request.requestedAt,
        deadlineAt: request.deadlineAt,
      };
      const projectedEntry: McpOperationManifestEntry = {
        operationKind: 'tool-call',
        operationTarget: request.toolName,
        sourceId: entry.sourceId,
        destination: entry.destination,
        retryPolicy: entry.retryPolicy,
      };
      const { db } = createMockDb({ insert: [[]], select: [[legacyRows]] });
      const repository = new McpRuntimeRepository(db);
      const prepareOperation = (
        repository as unknown as {
          prepareOperation(input: unknown): Promise<{ plan: { ref: PreparedMcpOperationRef } }>;
        }
      ).prepareOperation.bind(repository);

      const outcome = await prepareOperation({
        request: projectedRequest,
        dispatchOperation: projectedRequest.operation,
        requestHash: REQUEST_HASH,
        entry: projectedEntry,
        manifest: { ...manifest, version: '2', entries: [projectedEntry] },
      });

      expect(outcome.plan.ref).toEqual(
        expect.objectContaining({
          operationKind: 'tool-call',
          operationTarget: 'component.scan',
          toolName: 'component.scan',
        }),
      );
    });

    it('persists operation identity with nullable tool compatibility and an unfenced prepared attempt', async () => {
      const rows = operationRows('prepared');
      const { db, calls } = createMockDb({
        insert: [[rows.invocation], [rows.attempt]],
      });
      const repository = new McpRuntimeRepository(db);
      const prepareOperation = (
        repository as unknown as {
          prepareOperation(input: unknown): Promise<unknown>;
        }
      ).prepareOperation.bind(repository);

      await prepareOperation({
        request: operationRequest,
        dispatchOperation: operationRequest.operation,
        requestHash: REQUEST_HASH,
        entry: operationEntry,
        runtimeBinding,
        manifest: { ...manifest, version: '2', entries: [operationEntry] },
      });

      const values = calls.filter((call) => call.method === 'values').map((call) => call.args[0]);
      expect(values[0]).toEqual(
        expect.objectContaining({
          subjectKind: 'run',
          subjectId: 'run-1',
          runId: 'run-1',
          operationKind: 'resource-read',
          operationTarget: 'repo://{path}',
          toolName: null,
          organizationId: 'org-1',
        }),
      );
      expect(values[1]).toEqual(
        expect.objectContaining({
          runtimeId: null,
          ownerId: null,
          ownerEpoch: null,
          leaseGeneration: null,
        }),
      );
    });

    it('persists Operator operations under the turn subject without a fake run projection', async () => {
      const operatorRequest: McpOperationInvocationRequest = {
        ...operationRequest,
        scope: {
          kind: 'operator',
          organizationId: 'org-1',
          sessionId: OPERATOR_SESSION_ID,
          turnId: OPERATOR_TURN_ID,
          capabilityGrantId: GRANT_ID,
          expiresAt: '2026-08-01T12:00:00.000Z',
        },
      };
      const rows = operationRows('prepared');
      Object.assign(rows.invocation, {
        subjectKind: 'operator',
        subjectId: OPERATOR_TURN_ID,
        runId: null,
        request: operatorRequest,
      });
      const { db, calls } = createMockDb({
        insert: [[rows.invocation], [rows.attempt]],
      });

      await new McpRuntimeRepository(db).prepareOperation({
        request: operatorRequest,
        dispatchOperation: operatorRequest.operation,
        requestHash: REQUEST_HASH,
        entry: operationEntry,
        runtimeBinding,
        manifest: { ...manifest, version: '2', entries: [operationEntry] },
      });

      const values = calls.filter((call) => call.method === 'values').map((call) => call.args[0]);
      expect(values[0]).toEqual(
        expect.objectContaining({
          subjectKind: 'operator',
          subjectId: OPERATOR_TURN_ID,
          runId: null,
          organizationId: 'org-1',
        }),
      );
    });

    it('captures the exact acquired runtime fence in the current-attempt claim CAS', async () => {
      const prepared = operationRows('prepared');
      const dispatched = operationRows('dispatched');
      const { db, calls } = createMockDb({
        update: [[dispatched.invocation], [dispatched.attempt]],
      });
      const repository = new McpRuntimeRepository(db);
      const claimOperationAttempt = (
        repository as unknown as {
          claimOperationAttempt(input: unknown): Promise<unknown>;
        }
      ).claimOperationAttempt.bind(repository);

      await expect(
        claimOperationAttempt({
          plan: {
            ref: {
              invocationId: INVOCATION_ID,
              attemptId: ATTEMPT_ID,
              attemptNumber: 1,
              capabilitySnapshotId: SNAPSHOT_ID,
              capabilityGrantId: GRANT_ID,
              operationKind: 'resource-read',
              operationTarget: 'repo://{path}',
              toolName: null,
              sourceId: operationEntry.sourceId,
              destination: operationEntry.destination,
              retryPolicy: operationEntry.retryPolicy,
              preparedAt: prepared.attempt.preparedAt.toISOString(),
            },
            manifestEntry: operationEntry,
            runtimeBinding,
            operation: operationRequest.operation,
            requestedAt: operationRequest.requestedAt,
            deadlineAt: operationRequest.deadlineAt,
          },
          runtimeRef,
        }),
      ).resolves.toEqual({ kind: 'claimed' });

      const attemptClaim = calls
        .filter((call) => call.method === 'set')
        .map((call) => call.args[0])
        .find((value) => (value as { runtimeId?: unknown }).runtimeId !== undefined);
      expect(attemptClaim).toEqual(
        expect.objectContaining({
          runtimeId: runtimeRef.fence.runtimeId,
          ownerId: runtimeRef.fence.ownerId,
          ownerEpoch: runtimeRef.fence.ownerEpoch,
          leaseGeneration: runtimeRef.fence.leaseGeneration,
          status: 'dispatched',
        }),
      );
    });

    it('settles only through the exact fence captured by the dispatched attempt', async () => {
      const dispatched = operationRows('dispatched');
      const terminal = operationRows('completed', completedOperationResult);
      const { db, calls } = createMockDb({
        select: [[dispatched]],
        update: [[terminal.invocation], [terminal.attempt]],
      });

      await expect(
        new McpRuntimeRepository(db).settleMcpOperationAttempt({
          ref: operationRef,
          fence: runtimeRef.fence,
          result: completedOperationResult,
        }),
      ).resolves.toEqual(completedOperationResult);

      const attemptWhere = calls.filter((call) => call.method === 'where')[2]?.args[0];
      expect(sqlContainsParamValue(attemptWhere, runtimeRef.fence.runtimeId)).toBe(true);
      expect(sqlContainsParamValue(attemptWhere, runtimeRef.fence.ownerId)).toBe(true);
      expect(sqlContainsParamValue(attemptWhere, runtimeRef.fence.ownerEpoch)).toBe(true);
      expect(sqlContainsParamValue(attemptWhere, runtimeRef.fence.leaseGeneration)).toBe(true);
    });

    it('rejects a later owner fence before attempting settlement', async () => {
      const dispatched = operationRows('dispatched');
      const { db, calls } = createMockDb({ select: [[dispatched]] });

      await expect(
        new McpRuntimeRepository(db).settleMcpOperationAttempt({
          ref: operationRef,
          fence: { ...runtimeRef.fence, leaseGeneration: runtimeRef.fence.leaseGeneration + 1 },
          result: completedOperationResult,
        }),
      ).rejects.toThrow('stale runtime fence');
      expect(calls.filter((call) => call.method === 'update')).toHaveLength(0);
    });

    it('reconciles owner loss after dispatch as ambiguous with the captured fence', async () => {
      const dispatched = operationRows('dispatched');
      const { db, calls } = createMockDb({
        select: [[dispatched]],
        update: [
          [{ ...dispatched.invocation, status: 'ambiguous' }],
          [{ ...dispatched.attempt, status: 'ambiguous' }],
        ],
      });

      const result = await new McpRuntimeRepository(db).reconcileMcpOperationDispatchFailure({
        ref: operationRef,
        cause: 'failure',
        message: 'Runtime owner died after dispatch',
        completedAt: '2026-07-31T10:03:00.000Z',
      });

      expect(result).toEqual(
        expect.objectContaining({ operationId: INVOCATION_ID, kind: 'ambiguous' }),
      );
      const attemptWhere = calls.filter((call) => call.method === 'where')[2]?.args[0];
      expect(sqlContainsParamValue(attemptWhere, runtimeRef.fence.leaseGeneration)).toBe(true);
      expect(calls.filter((call) => call.method === 'insert')).toHaveLength(0);
    });
  });

  describe('immutable run authority', () => {
    it('returns the concurrent winner after normalizing generated IDs and timestamps', async () => {
      const winnerGrantId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
      const winnerSnapshotId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
      const winnerGrant: CapabilityGrant = {
        ...grant,
        id: winnerGrantId,
        createdAt: '2026-07-31T10:00:10.000Z',
      };
      const winnerSnapshot: McpCapabilityCatalogSnapshot = {
        ...snapshot,
        id: winnerSnapshotId,
        scope: { ...snapshot.scope, capabilityGrantId: winnerGrantId },
        createdAt: '2026-07-31T10:00:11.000Z',
      };
      const winnerManifest: InvocationManifest = {
        ...manifest,
        capabilityGrantId: winnerGrantId,
        capabilitySnapshotId: winnerSnapshotId,
      };
      const { db, calls } = createMockDb({
        insert: [[]],
        select: [
          [
            authorityRows({
              grant: winnerGrant,
              snapshot: winnerSnapshot,
              manifest: winnerManifest,
            }),
          ],
        ],
      });

      const repository = new McpRuntimeRepository(db);
      const result = await repository.createOrReadRunAuthority({
        authorityKey: AUTHORITY_KEY,
        grant,
        snapshot,
        manifest,
      });

      expect(result).toEqual({
        grant: winnerGrant,
        snapshot: winnerSnapshot,
        manifest: winnerManifest,
      });
      expect(calls.some((call) => call.method === 'update')).toBe(false);
    });

    it('rejects a real semantic collision without mutating immutable authority', async () => {
      const conflictingSnapshot: McpCapabilityCatalogSnapshot = {
        ...snapshot,
        tools: [{ ...snapshot.tools[0]!, displayName: 'Different scan' }],
      };
      const { db, calls } = createMockDb({
        insert: [[]],
        select: [[authorityRows({ snapshot: conflictingSnapshot })]],
      });

      await expect(
        new McpRuntimeRepository(db).createOrReadRunAuthority({
          authorityKey: AUTHORITY_KEY,
          grant,
          snapshot,
          manifest,
        }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(calls.some((call) => call.method === 'update')).toBe(false);
    });

    it('filters run authority with explicit nullable organization semantics', async () => {
      const publicGrant: CapabilityGrant = {
        ...grant,
        organizationId: null,
      };
      const publicScope: Extract<ExecutionScope, { kind: 'run' }> = {
        kind: 'run',
        organizationId: null,
        runId: 'run-1',
        capabilityGrantId: GRANT_ID,
      };
      const publicSnapshot: McpCapabilityCatalogSnapshot = {
        ...snapshot,
        scope: publicScope,
      };
      const { db, calls } = createMockDb({
        select: [[authorityRows({ grant: publicGrant, snapshot: publicSnapshot })]],
      });

      await expect(
        new McpRuntimeRepository(db).getAuthority({
          capabilityGrantId: GRANT_ID,
          capabilitySnapshotId: SNAPSHOT_ID,
          scope: publicScope,
        }),
      ).resolves.toEqual({
        grant: publicGrant,
        snapshot: publicSnapshot,
        manifest,
      });

      const where = calls.find((call) => call.method === 'where')?.args[0];
      expect(sqlContainsColumn(where, 'organization_id')).toBe(true);
      expect(sqlContainsText(where, 'is null')).toBe(true);
    });
  });

  describe('invocation preparation', () => {
    it('creates attempt 1 and mirrors prepared status on both rows', async () => {
      const prepared = invocationRows('prepared');
      const { db, calls } = createMockDb({
        insert: [[prepared.invocation], [prepared.attempt]],
      });

      await expect(
        new McpRuntimeRepository(db).prepareInvocation({
          request,
          requestHash: REQUEST_HASH,
          entry,
          manifest,
        }),
      ).resolves.toEqual({ kind: 'prepared', ref, manifest });

      const values = calls.filter((call) => call.method === 'values').map((call) => call.args[0]);
      expect(values).toContainEqual(expect.objectContaining({ status: 'prepared' }));
      expect(values).toContainEqual(
        expect.objectContaining({ attemptNumber: 1, status: 'prepared' }),
      );
    });

    it('returns the same attempt for the same invocation ID and request hash', async () => {
      const { db, calls } = createMockDb({
        insert: [[]],
        select: [[invocationRows('prepared')]],
      });

      await expect(
        new McpRuntimeRepository(db).prepareInvocation({
          request,
          requestHash: REQUEST_HASH,
          entry,
          manifest,
        }),
      ).resolves.toEqual({ kind: 'prepared', ref, manifest });
      expect(calls.some((call) => call.method === 'update')).toBe(false);
    });

    it('rejects reuse of an invocation ID with a different request hash', async () => {
      const { db } = createMockDb({
        insert: [[]],
        select: [[invocationRows('prepared', { requestHash: 'f'.repeat(64) })]],
      });

      await expect(
        new McpRuntimeRepository(db).prepareInvocation({
          request,
          requestHash: REQUEST_HASH,
          entry,
          manifest,
        }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('rejects non-run invocation persistence', async () => {
      const studioRequest: ToolInvocationRequest = {
        ...request,
        scope: {
          kind: 'studio',
          organizationId: 'org-1',
          operationId: '55555555-5555-4555-8555-555555555555',
          capabilityGrantId: GRANT_ID,
          expiresAt: '2026-07-31T11:00:00.000Z',
        },
      };
      const { db, calls } = createMockDb();

      await expect(
        new McpRuntimeRepository(db).prepareInvocation({
          request: studioRequest,
          requestHash: REQUEST_HASH,
          entry,
          manifest,
        }),
      ).rejects.toThrow('run-scoped');
      expect(calls.some((call) => call.method === 'insert')).toBe(false);
    });
  });

  describe('attempt state machine', () => {
    it('reads the exact current invocation request and prepared reference for dispatch', async () => {
      const { db } = createMockDb({ select: [[invocationRows('prepared')]] });

      await expect(new McpRuntimeRepository(db).getInvocationForDispatch(ref)).resolves.toEqual({
        request,
        ref,
        status: 'prepared',
        result: null,
      });
    });

    it('claims the exact current prepared attempt atomically on both rows', async () => {
      const dispatched = invocationRows('dispatched');
      const { db, calls } = createMockDb({
        update: [[dispatched.invocation], [dispatched.attempt]],
      });

      await expect(new McpRuntimeRepository(db).claimAttempt(ref)).resolves.toEqual({
        kind: 'claimed',
      });

      const sets = calls.filter((call) => call.method === 'set').map((call) => call.args[0]);
      expect(sets).toHaveLength(2);
      expect(sets[0]).toEqual(expect.objectContaining({ status: 'dispatched' }));
      expect(sets[1]).toEqual(expect.objectContaining({ status: 'dispatched' }));
      expect((sets[0] as { updatedAt: Date }).updatedAt).toBe(
        (sets[1] as { dispatchedAt: Date }).dispatchedAt,
      );
      const where = calls.find((call) => call.method === 'where')?.args[0];
      expect(sqlContainsParamValue(where, 'prepared')).toBe(true);
      expect(sqlContainsParamValue(where, 1)).toBe(true);
      const attemptWhere = calls.filter((call) => call.method === 'where')[1]?.args[0];
      expect(sqlContainsColumn(attemptWhere, 'prepared_at')).toBe(true);
      expect(sqlContainsDateParamValue(attemptWhere, ref.preparedAt)).toBe(true);
    });

    it.each([
      [completedResult],
      [
        {
          invocationId: INVOCATION_ID,
          status: 'failed',
          error: { class: 'remote-tool', message: 'scanner failed', retryable: false },
          completedAt: '2026-07-31T10:02:00.000Z',
        } satisfies ToolInvocationResult,
      ],
    ])('settles dispatched attempts as $status on both rows', async (result) => {
      const terminal = invocationRows(result.status, { result });
      const { db, calls } = createMockDb({
        update: [[terminal.invocation], [terminal.attempt]],
      });

      await expect(new McpRuntimeRepository(db).settleAttempt({ ref, result })).resolves.toEqual(
        result,
      );

      const sets = calls.filter((call) => call.method === 'set').map((call) => call.args[0]);
      expect(sets[0]).toEqual(expect.objectContaining({ status: result.status, result }));
      expect(sets[1]).toEqual(expect.objectContaining({ status: result.status }));
      expect((sets[0] as { terminalAt: Date }).terminalAt).toBe(
        (sets[1] as { completedAt: Date }).completedAt,
      );
      const attemptWhere = calls.filter((call) => call.method === 'where')[1]?.args[0];
      expect(sqlContainsColumn(attemptWhere, 'prepared_at')).toBe(true);
      expect(sqlContainsDateParamValue(attemptWhere, ref.preparedAt)).toBe(true);
    });

    it('marks dispatched attempts ambiguous and never returns them to prepared', async () => {
      const ambiguousResult: ToolInvocationResult = {
        invocationId: INVOCATION_ID,
        status: 'ambiguous',
        error: {
          class: 'ambiguous-after-dispatch',
          message: 'worker lease was lost',
          retryable: false,
        },
        completedAt: '2026-07-31T10:03:00.000Z',
      };
      const ambiguous = invocationRows('ambiguous', { result: ambiguousResult });
      const marking = createMockDb({
        update: [[ambiguous.invocation], [ambiguous.attempt]],
      });

      await expect(
        new McpRuntimeRepository(marking.db).markAttemptAmbiguous({
          ref,
          message: 'worker lease was lost',
          completedAt: ambiguousResult.completedAt,
        }),
      ).resolves.toEqual(ambiguousResult);

      const replay = createMockDb({
        update: [[]],
        select: [[ambiguous]],
      });
      await expect(new McpRuntimeRepository(replay.db).claimAttempt(ref)).resolves.toEqual({
        kind: 'ambiguous',
        result: ambiguousResult,
      });
      const replaySets = replay.calls
        .filter((call) => call.method === 'set')
        .map((call) => call.args[0]);
      expect(replaySets).not.toContainEqual(expect.objectContaining({ status: 'prepared' }));
    });

    it('turns a second claim of the exact dispatched attempt into ambiguous', async () => {
      const ambiguousResult: ToolInvocationResult = {
        invocationId: INVOCATION_ID,
        status: 'ambiguous',
        error: {
          class: 'ambiguous-after-dispatch',
          message: 'Invocation attempt was already dispatched',
          retryable: false,
        },
        completedAt: '2026-07-31T10:03:00.000Z',
      };
      const { db, calls } = createMockDb({
        update: [
          [],
          [invocationRows('ambiguous', { result: ambiguousResult }).invocation],
          [invocationRows('ambiguous', { result: ambiguousResult }).attempt],
        ],
        select: [[invocationRows('dispatched')]],
      });

      const outcome = await new McpRuntimeRepository(db).claimAttempt(ref);

      expect(outcome.kind).toBe('ambiguous');
      if (outcome.kind === 'ambiguous') {
        expect(outcome.result).toEqual(
          expect.objectContaining({
            invocationId: INVOCATION_ID,
            status: 'ambiguous',
            error: expect.objectContaining({
              class: 'ambiguous-after-dispatch',
              retryable: false,
            }),
          }),
        );
      }
      expect(calls.filter((call) => call.method === 'update')).toHaveLength(3);
    });

    it('returns the validated stored result for an identical terminal duplicate', async () => {
      const terminal = invocationRows('completed', { result: completedResult });
      const { db } = createMockDb({ update: [[]], select: [[terminal]] });

      await expect(
        new McpRuntimeRepository(db).settleAttempt({ ref, result: completedResult }),
      ).resolves.toEqual(completedResult);
    });

    it('rejects malformed persisted terminal JSON instead of returning it', async () => {
      const malformed = invocationRows('completed', {
        result: {
          invocationId: INVOCATION_ID,
          status: 'completed',
          completedAt: 'not-a-date',
        },
      });
      const { db } = createMockDb({ update: [[]], select: [[malformed]] });

      await expect(
        new McpRuntimeRepository(db).settleAttempt({ ref, result: completedResult }),
      ).rejects.toThrow();
    });

    it.each(['claim', 'prepare'] as const)(
      'rejects %s replay when persisted terminal result belongs to another invocation',
      async (operation) => {
        const wrongInvocationResult: ToolInvocationResult = {
          ...completedResult,
          invocationId: '66666666-6666-4666-8666-666666666666',
        };
        const terminal = invocationRows('completed', { result: wrongInvocationResult });
        const { db } = createMockDb({
          insert: operation === 'prepare' ? [[]] : [],
          update: operation === 'claim' ? [[]] : [],
          select: [[terminal]],
        });
        const repository = new McpRuntimeRepository(db);

        const replay =
          operation === 'claim'
            ? repository.claimAttempt(ref)
            : repository.prepareInvocation({
                request,
                requestHash: REQUEST_HASH,
                entry,
                manifest,
              });

        await expect(replay).rejects.toThrow('terminal result is inconsistent');
      },
    );

    it('rejects stale non-current attempts on claim and settlement', async () => {
      const stale = invocationRows('dispatched', { currentAttemptNumber: 2 });
      const claimDb = createMockDb({ update: [[]], select: [[stale]] });
      await expect(new McpRuntimeRepository(claimDb.db).claimAttempt(ref)).rejects.toThrow(
        'current attempt',
      );

      const settleDb = createMockDb({ update: [[]], select: [[stale]] });
      await expect(
        new McpRuntimeRepository(settleDb.db).settleAttempt({ ref, result: completedResult }),
      ).rejects.toThrow('current attempt');
    });

    it('rejects a terminal replay with a wrong prepared-reference timestamp', async () => {
      const terminal = invocationRows('completed', { result: completedResult });
      const { db } = createMockDb({ update: [[]], select: [[terminal]] });

      await expect(
        new McpRuntimeRepository(db).claimAttempt({
          ...ref,
          preparedAt: '2026-07-31T10:01:01.000Z',
        }),
      ).rejects.toThrow('does not match persistence');
    });

    it('cannot claim an active attempt with a wrong prepared-reference timestamp', async () => {
      const dispatched = invocationRows('dispatched');
      const { db } = createMockDb({
        update: [[dispatched.invocation], matchAttemptByPreparedAt(dispatched.attempt)],
      });

      await expect(
        new McpRuntimeRepository(db).claimAttempt({
          ...ref,
          preparedAt: '2026-07-31T10:01:01.000Z',
        }),
      ).rejects.toThrow('could not be claimed');
    });

    it('cannot settle an active attempt with a wrong prepared-reference timestamp', async () => {
      const terminal = invocationRows('completed', { result: completedResult });
      const { db } = createMockDb({
        update: [[terminal.invocation], matchAttemptByPreparedAt(terminal.attempt)],
      });

      await expect(
        new McpRuntimeRepository(db).settleAttempt({
          ref: { ...ref, preparedAt: '2026-07-31T10:01:01.000Z' },
          result: completedResult,
        }),
      ).rejects.toThrow('could not be settled');
    });

    it.each([
      ['failure', 'failed', 'pre-dispatch'],
      ['deadline', 'failed', 'deadline-before-dispatch'],
      ['cancelled', 'cancelled', 'cancelled'],
    ] as const)(
      'reconciles prepared %s before dispatch as %s/%s on both rows',
      async (cause, status, failureClass) => {
        const terminalResult: ToolInvocationResult = {
          invocationId: INVOCATION_ID,
          status,
          error: {
            class: failureClass,
            message: 'activity ended',
            retryable: cause === 'failure',
          },
          completedAt: '2026-07-31T10:04:00.000Z',
        };
        const terminal = invocationRows(status, { result: terminalResult });
        const { db, calls } = createMockDb({
          select: [[invocationRows('prepared')]],
          update: [[terminal.invocation], [terminal.attempt]],
        });

        await expect(
          new McpRuntimeRepository(db).reconcileDispatchFailure({
            ref,
            cause,
            message: 'activity ended',
            completedAt: terminalResult.completedAt,
          }),
        ).resolves.toEqual(terminalResult);

        const sets = calls.filter((call) => call.method === 'set').map((call) => call.args[0]);
        expect(sets[0]).toEqual(expect.objectContaining({ status, result: terminalResult }));
        expect(sets[1]).toEqual(expect.objectContaining({ status }));
      },
    );

    it('reconciles dispatched activity failure as ambiguous', async () => {
      const ambiguousResult: ToolInvocationResult = {
        invocationId: INVOCATION_ID,
        status: 'ambiguous',
        error: {
          class: 'ambiguous-after-dispatch',
          message: 'activity transport failed',
          retryable: false,
        },
        completedAt: '2026-07-31T10:04:00.000Z',
      };
      const terminal = invocationRows('ambiguous', { result: ambiguousResult });
      const { db } = createMockDb({
        select: [[invocationRows('dispatched')]],
        update: [[terminal.invocation], [terminal.attempt]],
      });

      await expect(
        new McpRuntimeRepository(db).reconcileDispatchFailure({
          ref,
          cause: 'failure',
          message: 'activity transport failed',
          completedAt: ambiguousResult.completedAt,
        }),
      ).resolves.toEqual(ambiguousResult);
    });

    it('reclassifies a prepared reconciliation as ambiguous when claim wins the CAS race', async () => {
      const ambiguousResult: ToolInvocationResult = {
        invocationId: INVOCATION_ID,
        status: 'ambiguous',
        error: {
          class: 'ambiguous-after-dispatch',
          message: 'activity transport failed',
          retryable: false,
        },
        completedAt: '2026-07-31T10:04:00.000Z',
      };
      const { db, calls } = createMockDb({
        select: [[invocationRows('prepared')], [invocationRows('dispatched')]],
        update: [[], [{}], [{}]],
      });

      await expect(
        new McpRuntimeRepository(db).reconcileDispatchFailure({
          ref,
          cause: 'failure',
          message: 'activity transport failed',
          completedAt: ambiguousResult.completedAt,
        }),
      ).resolves.toEqual(ambiguousResult);

      const sets = calls.filter((call) => call.method === 'set').map((call) => call.args[0]);
      expect(sets.at(-2)).toEqual(
        expect.objectContaining({ status: 'ambiguous', result: ambiguousResult }),
      );
      expect(sets.at(-1)).toEqual(expect.objectContaining({ status: 'ambiguous' }));
    });

    it('replays a terminal winner when reconciliation loses its CAS', async () => {
      const { db } = createMockDb({
        select: [
          [invocationRows('prepared')],
          [invocationRows('completed', { result: completedResult })],
        ],
        update: [[]],
      });

      await expect(
        new McpRuntimeRepository(db).reconcileDispatchFailure({
          ref,
          cause: 'failure',
          message: 'activity transport failed',
          completedAt: '2026-07-31T10:04:00.000Z',
        }),
      ).resolves.toEqual(completedResult);
    });

    it('replays terminal reconciliation and conflicts on missing or stale references', async () => {
      const terminalDb = createMockDb({
        select: [[invocationRows('completed', { result: completedResult })]],
      });
      await expect(
        new McpRuntimeRepository(terminalDb.db).reconcileDispatchFailure({
          ref,
          cause: 'failure',
          message: 'ignored',
          completedAt: completedResult.completedAt,
        }),
      ).resolves.toEqual(completedResult);

      const missingDb = createMockDb({ select: [[]] });
      await expect(
        new McpRuntimeRepository(missingDb.db).reconcileDispatchFailure({
          ref,
          cause: 'failure',
          message: 'missing',
          completedAt: completedResult.completedAt,
        }),
      ).rejects.toBeInstanceOf(ConflictException);

      const staleDb = createMockDb({
        select: [[invocationRows('prepared', { currentAttemptNumber: 2 })]],
      });
      await expect(
        new McpRuntimeRepository(staleDb.db).reconcileDispatchFailure({
          ref,
          cause: 'failure',
          message: 'stale',
          completedAt: completedResult.completedAt,
        }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('closes every prepared and dispatched invocation when a run finalizes', async () => {
      const secondRef = {
        ...ref,
        invocationId: '99999999-9999-4999-8999-999999999999',
        attemptId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      };
      const dispatched = invocationRows('dispatched');
      dispatched.invocation.invocationId = secondRef.invocationId;
      dispatched.invocation.request = {
        ...request,
        invocationId: secondRef.invocationId,
      };
      dispatched.attempt.id = secondRef.attemptId;
      dispatched.attempt.invocationId = secondRef.invocationId;
      const { db, calls } = createMockDb({
        select: [
          [invocationRows('prepared'), dispatched],
          [invocationRows('prepared')],
          [dispatched],
        ],
        update: [
          [
            invocationRows('cancelled', {
              result: {
                invocationId: INVOCATION_ID,
                status: 'cancelled',
                error: { class: 'cancelled', message: 'run finalized', retryable: false },
                completedAt: '2026-07-31T10:05:00.000Z',
              },
            }).invocation,
          ],
          [invocationRows('cancelled').attempt],
          [dispatched.invocation],
          [dispatched.attempt],
        ],
      });

      await expect(
        new McpRuntimeRepository(db).reconcileRunInvocations({
          runId: 'run-1',
          message: 'run finalized',
          completedAt: '2026-07-31T10:05:00.000Z',
        }),
      ).resolves.toBeUndefined();

      const sets = calls.filter((call) => call.method === 'set').map((call) => call.args[0]);
      expect(sets[0]).toEqual(expect.objectContaining({ status: 'cancelled' }));
      expect(sets[2]).toEqual(expect.objectContaining({ status: 'ambiguous' }));
    });

    it('continues the run sweep when one prepared invocation loses its CAS to a claim', async () => {
      const secondInvocationId = '99999999-9999-4999-8999-999999999999';
      const secondAttemptId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
      const firstPrepared = invocationRows('prepared');
      const firstDispatched = invocationRows('dispatched');
      const secondPrepared = invocationRows('prepared');
      secondPrepared.invocation.invocationId = secondInvocationId;
      secondPrepared.invocation.request = {
        ...request,
        invocationId: secondInvocationId,
      };
      secondPrepared.attempt.id = secondAttemptId;
      secondPrepared.attempt.invocationId = secondInvocationId;
      const { db, calls } = createMockDb({
        select: [
          [firstPrepared, secondPrepared],
          [firstPrepared],
          [firstDispatched],
          [secondPrepared],
        ],
        update: [[], [{}], [{}], [{}], [{}]],
      });

      await expect(
        new McpRuntimeRepository(db).reconcileRunInvocations({
          runId: 'run-1',
          message: 'run finalized',
          completedAt: '2026-07-31T10:05:00.000Z',
        }),
      ).resolves.toBeUndefined();

      const sets = calls.filter((call) => call.method === 'set').map((call) => call.args[0]);
      expect(sets).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ status: 'ambiguous' }),
          expect.objectContaining({ status: 'cancelled' }),
        ]),
      );
    });
  });

  it('represents later positive attempt numbers at the schema boundary', () => {
    const laterAttempt: McpInvocationAttemptInsert = {
      invocationId: INVOCATION_ID,
      attemptNumber: 2,
      sourceId: 'component:node-1',
      destination: 'component-activity',
      retryPolicy: 'reviewed-idempotent',
      status: 'planned',
    };

    expect(laterAttempt.attemptNumber).toBe(2);
  });
});
