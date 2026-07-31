import { ConflictException } from '@nestjs/common';
import { describe, expect, it } from 'bun:test';

import type {
  CapabilityGrant,
  InvocationManifest,
  InvocationManifestEntry,
  McpCapabilityCatalogSnapshot,
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

interface MockCall {
  method: string;
  args: unknown[];
}

interface MockRows {
  insert?: unknown[][];
  select?: unknown[][];
  update?: unknown[][];
}

function createMockDb(rows: MockRows = {}): { db: never; calls: MockCall[] } {
  const calls: MockCall[] = [];
  const queues = {
    insert: [...(rows.insert ?? [])],
    select: [...(rows.select ?? [])],
    update: [...(rows.update ?? [])],
  };

  function chainable(resolvedValue: unknown[]) {
    const builder: Record<string, unknown> = {};
    const self = new Proxy(builder, {
      get(_target, prop: string) {
        if (prop === 'then') {
          return (resolve: (value: unknown[]) => void) => resolve(resolvedValue);
        }
        return (...args: unknown[]) => {
          calls.push({ method: prop, args });
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
  return {
    grant: {
      id: storedGrant.id,
      authorityKey: AUTHORITY_KEY,
      organizationId: storedGrant.organizationId,
      subjectKind: storedGrant.subject.kind,
      subjectId:
        storedGrant.subject.kind === 'run'
          ? storedGrant.subject.runId
          : storedGrant.subject.operationId,
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
      const publicSnapshot: McpCapabilityCatalogSnapshot = {
        ...snapshot,
        scope: { ...snapshot.scope, organizationId: null },
      };
      const { db, calls } = createMockDb({
        select: [[authorityRows({ grant: publicGrant, snapshot: publicSnapshot })]],
      });

      await expect(
        new McpRuntimeRepository(db).getAuthority({
          capabilityGrantId: GRANT_ID,
          capabilitySnapshotId: SNAPSHOT_ID,
          runId: 'run-1',
          organizationId: null,
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
