import { beforeAll, beforeEach, describe, expect, it, vi } from 'bun:test';

const registrations = new Map<
  string,
  { handler: (...args: any[]) => any; options?: { validator?: (...args: any[]) => void } }
>();
let currentUpdateId: string | undefined;

class MockApplicationFailure extends Error {
  static nonRetryable(message: string, type?: string): MockApplicationFailure {
    const failure = new MockApplicationFailure(message);
    failure.name = type ?? 'ApplicationFailure';
    return failure;
  }
}

class MockCancelledFailure extends Error {}

const withTimeout = vi.fn(async (_timeout: number, callback: () => Promise<unknown>) => callback());
const nonCancellable = vi.fn(async (callback: () => Promise<unknown>) => callback());

const GRANT_ID = '11111111-1111-4111-8111-111111111111';
const SNAPSHOT_ID = '22222222-2222-4222-8222-222222222222';
const INVOCATION_ID = '33333333-3333-4333-8333-333333333333';
const ATTEMPT_ID = '44444444-4444-4444-8444-444444444444';

const scope = {
  kind: 'run' as const,
  runId: 'run-123',
  organizationId: 'org-123',
  capabilityGrantId: GRANT_ID,
  invokingNodeId: 'agent-node',
};

const manifest = {
  capabilitySnapshotId: SNAPSHOT_ID,
  capabilityGrantId: GRANT_ID,
  version: '1' as const,
  entries: [
    {
      toolName: 'osv_query',
      sourceId: 'component:osv',
      destination: 'component-activity' as const,
      retryPolicy: 'pre-dispatch-only' as const,
    },
  ],
};

const request = {
  invocationId: INVOCATION_ID,
  scope,
  capabilitySnapshotId: SNAPSHOT_ID,
  toolName: 'osv_query',
  input: { package: 'lodash' },
  requestedAt: '2099-07-31T10:00:00.000Z',
  deadlineAt: '2099-07-31T10:05:00.000Z',
};

const ref = {
  invocationId: INVOCATION_ID,
  attemptId: ATTEMPT_ID,
  attemptNumber: 1,
  capabilitySnapshotId: SNAPSHOT_ID,
  capabilityGrantId: GRANT_ID,
  toolName: 'osv_query',
  sourceId: 'component:osv',
  destination: 'component-activity' as const,
  retryPolicy: 'pre-dispatch-only' as const,
  preparedAt: '2099-07-31T10:00:01.000Z',
};

const completedResult = {
  invocationId: INVOCATION_ID,
  status: 'completed' as const,
  output: { vulnerabilities: [] },
  completedAt: '2099-07-31T10:00:02.000Z',
};

let handlerModule: Record<string, any>;

beforeAll(async () => {
  handlerModule = await import('../tool-invocation-update-handler');
});

beforeEach(() => {
  registrations.clear();
  currentUpdateId = undefined;
  vi.clearAllMocks();
  withTimeout.mockImplementation(async (_timeout, callback) => callback());
  nonCancellable.mockImplementation(async (callback) => callback());
});

function createActivities(overrides: Record<string, unknown> = {}) {
  return {
    prepareToolInvocationActivity: vi.fn(async () => ({ kind: 'prepared' as const, ref })),
    dispatchToolInvocationActivity: vi.fn(async () => completedResult),
    reconcileToolInvocationActivity: vi.fn(async () => completedResult),
    reconcileRunToolInvocationsActivity: vi.fn(async () => undefined),
    ...overrides,
  };
}

function register(overrides: Record<string, unknown> = {}) {
  expect(typeof handlerModule.createToolInvocationUpdateHandlers).toBe('function');
  const activities = createActivities(overrides);
  const created = handlerModule.createToolInvocationUpdateHandlers(
    {
      runId: 'run-123',
      organizationId: 'org-123',
      activities,
    },
    {
      currentUpdateId: () => currentUpdateId,
      withTimeout,
      nonCancellable,
      isCancellation: (error: unknown) => error instanceof MockCancelledFailure,
      applicationFailure: (message: string, type: string) =>
        MockApplicationFailure.nonRetryable(message, type),
    },
  );
  registrations.set('installToolInvocationManifest', {
    handler: created.install.handler,
    options: { validator: created.install.validator },
  });
  registrations.set('executeToolInvocation', {
    handler: created.execute.handler,
    options: { validator: created.execute.validator },
  });
  return { activities, controller: created.controller };
}

function updateRegistration(name: string) {
  const registration = registrations.get(name);
  expect(registration).toBeDefined();
  expect(registration?.options?.validator).toBeFunction();
  return registration!;
}

function installManifest(): void {
  currentUpdateId = `install-manifest:${GRANT_ID}`;
  const registration = updateRegistration('installToolInvocationManifest');
  const install = { scope, manifest };
  registration.options!.validator!(install);
  registration.handler(install);
}

describe('registerToolInvocationUpdateHandlers', () => {
  it('rejects malformed, cross-run, cross-organization, closed, and wrongly keyed invocations', () => {
    const { controller } = register();
    installManifest();
    const execute = updateRegistration('executeToolInvocation');

    currentUpdateId = INVOCATION_ID;
    expect(() => execute.options!.validator!({ ...request, toolName: '' })).toThrow();
    expect(() =>
      execute.options!.validator!({ ...request, scope: { ...scope, runId: 'run-other' } }),
    ).toThrow();
    expect(() =>
      execute.options!.validator!({
        ...request,
        scope: { ...scope, organizationId: 'org-other' },
      }),
    ).toThrow();

    currentUpdateId = '55555555-5555-4555-8555-555555555555';
    expect(() => execute.options!.validator!(request)).toThrow();

    currentUpdateId = INVOCATION_ID;
    controller.stopAccepting();
    expect(() => execute.options!.validator!(request)).toThrow();
  });

  it('keys manifest installation by grant and permits replay only for identical content', () => {
    register();
    installManifest();
    installManifest();

    const install = updateRegistration('installToolInvocationManifest');
    currentUpdateId = `install-manifest:${GRANT_ID}`;
    expect(() =>
      install.options!.validator!({
        scope,
        manifest: {
          ...manifest,
          entries: [{ ...manifest.entries[0], sourceId: 'component:changed' }],
        },
      }),
    ).toThrow();

    currentUpdateId = 'install-manifest:wrong';
    expect(() => install.options!.validator!({ scope, manifest })).toThrow();
    expect(() =>
      install.options!.validator!({ scope: { ...scope, runId: 'run-other' }, manifest }),
    ).toThrow();
    expect(() =>
      install.options!.validator!({
        scope: { ...scope, organizationId: 'org-other' },
        manifest,
      }),
    ).toThrow();
  });

  it('returns a terminal preflight replay without dispatching component work', async () => {
    const terminal = {
      invocationId: INVOCATION_ID,
      status: 'failed' as const,
      error: { class: 'remote-tool' as const, message: 'Previously failed', retryable: false },
      completedAt: '2099-07-31T10:00:02.000Z',
    };
    const prepare = vi.fn(async () => ({ kind: 'terminal' as const, result: terminal }));
    const dispatch = vi.fn(async () => completedResult);
    register({
      prepareToolInvocationActivity: prepare,
      dispatchToolInvocationActivity: dispatch,
    });
    installManifest();
    currentUpdateId = INVOCATION_ID;
    const execute = updateRegistration('executeToolInvocation');
    execute.options!.validator!(request);

    await expect(execute.handler(request)).resolves.toEqual(terminal);
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('dispatches prepared component work exactly once', async () => {
    const { activities } = register();
    installManifest();
    currentUpdateId = INVOCATION_ID;
    const execute = updateRegistration('executeToolInvocation');
    execute.options!.validator!(request);

    await expect(execute.handler(request)).resolves.toEqual(completedResult);
    expect(activities.prepareToolInvocationActivity).toHaveBeenCalledWith(request);
    expect(activities.dispatchToolInvocationActivity).toHaveBeenCalledTimes(1);
    expect(activities.dispatchToolInvocationActivity).toHaveBeenCalledWith(ref);
    expect(activities.reconcileToolInvocationActivity).not.toHaveBeenCalled();
    expect(withTimeout).toHaveBeenCalledTimes(1);
  });

  it('reconciles a dispatch failure without retrying dispatch and returns stored terminal state', async () => {
    const dispatch = vi.fn(async () => {
      throw new Error('secret upstream failure detail');
    });
    const reconcile = vi.fn(async () => completedResult);
    register({
      dispatchToolInvocationActivity: dispatch,
      reconcileToolInvocationActivity: reconcile,
    });
    installManifest();
    currentUpdateId = INVOCATION_ID;
    const execute = updateRegistration('executeToolInvocation');

    await expect(execute.handler(request)).resolves.toEqual(completedResult);
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(nonCancellable).toHaveBeenCalledTimes(1);
    expect(reconcile).toHaveBeenCalledWith({
      ref,
      cause: 'failure',
      message: expect.any(String),
      completedAt: expect.any(String),
    });
    expect(JSON.stringify(reconcile.mock.calls)).not.toContain('secret upstream failure detail');
  });

  it('cancels deadline-bound dispatch and reconciles in a non-cancellable scope', async () => {
    const deadline = Date.parse(request.deadlineAt);
    let now = deadline - 1_000;
    const dateNow = vi.spyOn(Date, 'now').mockImplementation(() => now);
    const cancellation = new MockCancelledFailure('cancelled by timeout');
    const dispatch = vi.fn(async () => {
      throw cancellation;
    });
    const reconcile = vi.fn(async () => ({
      invocationId: INVOCATION_ID,
      status: 'cancelled' as const,
      error: { class: 'cancelled' as const, message: 'Invocation cancelled', retryable: false },
      completedAt: request.deadlineAt,
    }));
    withTimeout.mockImplementation(async (_timeout, callback) => {
      try {
        return await callback();
      } finally {
        now = deadline;
      }
    });

    try {
      register({
        dispatchToolInvocationActivity: dispatch,
        reconcileToolInvocationActivity: reconcile,
      });
      installManifest();
      currentUpdateId = INVOCATION_ID;
      const execute = updateRegistration('executeToolInvocation');

      await execute.handler(request);

      expect(withTimeout).toHaveBeenCalledWith(1_000, expect.any(Function));
      expect(dispatch).toHaveBeenCalledTimes(1);
      expect(nonCancellable).toHaveBeenCalledTimes(1);
      expect(reconcile).toHaveBeenCalledWith(expect.objectContaining({ ref, cause: 'deadline' }));
    } finally {
      dateNow.mockRestore();
    }
  });

  it('converts unexpected accepted-handler errors to ApplicationFailure', async () => {
    register({
      dispatchToolInvocationActivity: vi.fn(async () => {
        throw new Error('dispatch failed');
      }),
      reconcileToolInvocationActivity: vi.fn(async () => {
        throw new Error('database unavailable');
      }),
    });
    installManifest();
    currentUpdateId = INVOCATION_ID;
    const execute = updateRegistration('executeToolInvocation');

    const error = await execute.handler(request).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(MockApplicationFailure);
    expect(error).not.toEqual(expect.objectContaining({ message: 'database unavailable' }));
  });
});
