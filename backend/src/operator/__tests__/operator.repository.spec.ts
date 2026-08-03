import { ConflictException } from '@nestjs/common';
import { describe, expect, it, mock } from 'bun:test';

import type { AuthContext } from '../../auth/types';
import type {
  OperatorActionRecord,
  OperatorSessionRecord,
  OperatorTurnRecord,
} from '../../database/schema';
import type { AuditLogService } from '../../audit/audit-log.service';
import { OperatorRepository } from '../operator.repository';

const SESSION_ID = '11111111-1111-4111-8111-111111111111';
const TURN_ID = '22222222-2222-4222-8222-222222222222';
const ACTIVE_TURN_ID = '33333333-3333-4333-8333-333333333333';

const auth: AuthContext = {
  userId: 'operator-user',
  organizationId: 'operator-org',
  roles: ['MEMBER'],
  isAuthenticated: true,
  provider: 'local',
};

const session: OperatorSessionRecord = {
  id: SESSION_ID,
  organizationId: 'operator-org',
  userId: 'operator-user',
  title: 'Session',
  approvalMode: 'ask',
  status: 'active',
  modelProvider: 'gemini',
  modelId: 'gemini-3.5-flash',
  apiKeySecretId: '44444444-4444-4444-8444-444444444444',
  baseUrl: null,
  createdAt: new Date('2026-08-02T10:00:00Z'),
  updatedAt: new Date('2026-08-02T10:00:00Z'),
};

function turnRecord(overrides: Partial<OperatorTurnRecord> = {}): OperatorTurnRecord {
  return {
    id: TURN_ID,
    sessionId: SESSION_ID,
    actorRoles: ['MEMBER'],
    status: 'queued',
    temporalWorkflowId: null,
    temporalRunId: null,
    context: null,
    error: null,
    createdAt: new Date('2026-08-02T10:01:00Z'),
    startedAt: null,
    completedAt: null,
    ...overrides,
  };
}

interface QueryCall {
  query: number;
  method: string;
  args: unknown[];
}

function chainable(rows: unknown[], calls: QueryCall[], query: number) {
  const self = new Proxy(
    {},
    {
      get(_target, property: string) {
        if (property === 'then') {
          return (resolve: (value: unknown) => void) => resolve(rows);
        }
        return (...args: unknown[]) => {
          calls.push({ query, method: property, args });
          return self;
        };
      },
    },
  );
  return self;
}

function repositoryWithSelects(selectResults: unknown[][], insertResults: unknown[][] = []) {
  const calls: QueryCall[] = [];
  let query = 0;
  let insert = 0;
  const tx = {
    select: mock(() => {
      const current = query++;
      return chainable(selectResults[current] ?? [], calls, current);
    }),
    insert: mock(() => chainable(insertResults[insert++] ?? [], calls, query++)),
    update: mock(() => chainable([], calls, query++)),
  };
  const db = {
    transaction: mock(async (handler: (executor: typeof tx) => Promise<unknown>) => handler(tx)),
  };
  const audit = { recordDurableWithExecutor: mock(async () => undefined) };
  return {
    repository: new OperatorRepository(db as never, audit as unknown as AuditLogService),
    tx,
    calls,
  };
}

const createInput = {
  id: TURN_ID,
  session,
  message: 'Run my workflow',
  auth,
};

function replayRow(turn: OperatorTurnRecord, message = createInput.message) {
  return { turn, message };
}

function actionRecord(overrides: Partial<OperatorActionRecord> = {}): OperatorActionRecord {
  return {
    id: '66666666-6666-4666-8666-666666666666',
    sessionId: SESSION_ID,
    turnId: TURN_ID,
    toolCallId: `${TURN_ID}:0:0`,
    commandName: 'run_workflow',
    effect: 'execute',
    approvalMode: 'ask',
    approvalRequired: false,
    status: 'succeeded',
    version: 1,
    arguments: { workflowId: '77777777-7777-4777-8777-777777777777', inputs: {} },
    result: { status: 'COMPLETED' },
    error: null,
    runId: 'sentris-run-1',
    decidedBy: null,
    createdAt: new Date('2026-08-02T10:02:00Z'),
    decidedAt: null,
    startedAt: new Date('2026-08-02T10:02:01Z'),
    completedAt: new Date('2026-08-02T10:02:05Z'),
    ...overrides,
  };
}

function createActionInput(argumentsValue: Record<string, unknown>) {
  return {
    session,
    turn: turnRecord(),
    toolCallId: `${TURN_ID}:1:0`,
    commandName: 'run_workflow' as const,
    effect: 'execute' as const,
    approvalMode: 'ask' as const,
    approvalRequired: false,
    arguments: argumentsValue,
    auth,
  };
}

describe('OperatorRepository.createTurn', () => {
  it('locks the session before rejecting a distinct active turn', async () => {
    const { repository, tx, calls } = repositoryWithSelects([
      [{ id: SESSION_ID }],
      [],
      [{ id: ACTIVE_TURN_ID }],
    ]);

    await expect(repository.createTurn(createInput)).rejects.toThrow(
      'Wait for the active Operator turn to finish',
    );

    expect(tx.select).toHaveBeenCalledTimes(3);
    expect(tx.insert).not.toHaveBeenCalled();
    expect(calls.some((call) => call.query === 0 && call.method === 'for')).toBe(true);
    expect(calls.find((call) => call.query === 0 && call.method === 'for')?.args).toEqual([
      'update',
    ]);
  });

  it('replays the same clientTurnId before applying the active-turn guard', async () => {
    const existing = turnRecord({ status: 'running' });
    const { repository, tx } = repositoryWithSelects([[{ id: SESSION_ID }], [replayRow(existing)]]);

    await expect(repository.createTurn(createInput)).resolves.toEqual({
      turn: existing,
      created: false,
    });
    expect(tx.select).toHaveBeenCalledTimes(2);
    expect(tx.insert).not.toHaveBeenCalled();
  });

  it('rejects a replay whose clientTurnId belongs to another session', async () => {
    const { repository, tx } = repositoryWithSelects([
      [{ id: SESSION_ID }],
      [replayRow(turnRecord({ sessionId: '55555555-5555-4555-8555-555555555555' }))],
    ]);

    await expect(repository.createTurn(createInput)).rejects.toBeInstanceOf(ConflictException);
    expect(tx.select).toHaveBeenCalledTimes(2);
    expect(tx.insert).not.toHaveBeenCalled();
  });

  it.each([
    ['message', { ...createInput, message: 'Run a different workflow' }],
    ['route context', { ...createInput, context: { path: '/workflows/another' } }],
    [
      'direct command',
      {
        ...createInput,
        directCommand: {
          commandName: 'cancel_run' as const,
          arguments: { runId: 'sentris-run-1' },
        },
      },
    ],
  ])('rejects a replay with a different %s', async (_field, request) => {
    const { repository, tx } = repositoryWithSelects([
      [{ id: SESSION_ID }],
      [replayRow(turnRecord())],
    ]);

    await expect(repository.createTurn(request)).rejects.toThrow(
      'Turn identifier is already used with different message, context, command, or authority',
    );
    expect(tx.insert).not.toHaveBeenCalled();
  });

  it('rejects a replay under changed actor authority', async () => {
    const { repository, tx } = repositoryWithSelects([
      [{ id: SESSION_ID }],
      [replayRow(turnRecord({ actorRoles: ['MEMBER'] }))],
    ]);

    await expect(
      repository.createTurn({
        ...createInput,
        auth: { ...auth, roles: ['ADMIN'] },
      }),
    ).rejects.toThrow(
      'Turn identifier is already used with different message, context, command, or authority',
    );
    expect(tx.insert).not.toHaveBeenCalled();
  });

  it('reads a legacy route-only row as the same request without a direct command', async () => {
    const context = { path: '/workflows/77777777-7777-4777-8777-777777777777' };
    const existing = turnRecord({ context });
    const { repository } = repositoryWithSelects([[{ id: SESSION_ID }], [replayRow(existing)]]);

    await expect(repository.createTurn({ ...createInput, context })).resolves.toEqual({
      turn: existing,
      created: false,
    });
  });

  it('replays the same versioned direct-command payload', async () => {
    const directCommand = {
      commandName: 'get_run' as const,
      arguments: { runId: 'sentris-run-1' },
    };
    const existing = turnRecord({
      context: { version: 1, routeContext: null, directCommand },
    });
    const { repository } = repositoryWithSelects([[{ id: SESSION_ID }], [replayRow(existing)]]);

    await expect(repository.createTurn({ ...createInput, directCommand })).resolves.toEqual({
      turn: existing,
      created: false,
    });
  });

  it('persists the canonical payload for a new turn', async () => {
    const context = { path: '/runs/sentris-run-1', runId: 'sentris-run-1' };
    const directCommand = {
      commandName: 'get_run' as const,
      arguments: { runId: 'sentris-run-1' },
    };
    const persistedPayload = {
      version: 1 as const,
      routeContext: context,
      directCommand,
      journey: null,
    };
    const created = turnRecord({ context: persistedPayload });
    const { repository, calls } = repositoryWithSelects(
      [[{ id: SESSION_ID }], [], []],
      [[created], []],
    );

    await expect(
      repository.createTurn({ ...createInput, context, directCommand }),
    ).resolves.toEqual({ turn: created, created: true });

    expect(
      calls.some(
        (call) =>
          call.method === 'values' &&
          (call.args[0] as { id?: string; context?: unknown; actorRoles?: unknown }).id ===
            TURN_ID &&
          JSON.stringify((call.args[0] as { context?: unknown }).context) ===
            JSON.stringify(persistedPayload) &&
          JSON.stringify((call.args[0] as { actorRoles?: unknown }).actorRoles) ===
            JSON.stringify(['MEMBER']),
      ),
    ).toBe(true);
  });
});

describe('OperatorRepository.createAction', () => {
  it('reuses an equivalent completed mutation within the same turn', async () => {
    const existing = actionRecord();
    const { repository, tx, calls } = repositoryWithSelects([[{ id: TURN_ID }], [existing]]);

    await expect(repository.createAction(createActionInput(existing.arguments))).resolves.toEqual({
      action: existing,
      created: false,
    });

    expect(tx.insert).not.toHaveBeenCalled();
    expect(calls.some((call) => call.query === 0 && call.method === 'for')).toBe(true);
  });

  it('creates a distinct mutation when validated arguments differ', async () => {
    const created = actionRecord({
      id: '88888888-8888-4888-8888-888888888888',
      toolCallId: `${TURN_ID}:1:0`,
      status: 'approved',
      version: 0,
      arguments: { workflowId: '99999999-9999-4999-8999-999999999999', inputs: {} },
      result: null,
      runId: null,
      completedAt: null,
    });
    const { repository, tx } = repositoryWithSelects([[{ id: TURN_ID }], []], [[created]]);

    await expect(repository.createAction(createActionInput(created.arguments))).resolves.toEqual({
      action: created,
      created: true,
    });
    expect(tx.insert).toHaveBeenCalledTimes(1);
  });
});
