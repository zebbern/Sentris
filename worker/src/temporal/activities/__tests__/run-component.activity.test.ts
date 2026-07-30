import { describe, it, expect, beforeAll, beforeEach, mock, vi } from 'bun:test';
import { z } from 'zod';
import {
  componentRegistry,
  withPortMeta,
  inputs,
  outputs,
  NotFoundError,
  TEMPORAL_SPILL_THRESHOLD_BYTES,
  type ComponentDefinition,
} from '@sentris/component-sdk';

// ── Mock @temporalio/activity ────────────────────────────────────────────────
const mockHeartbeat = vi.fn();
let mockCancellationSignal = new AbortController().signal;

mock.module('@temporalio/activity', () => ({
  Context: {
    current: () => ({
      info: {
        activityId: 'test-activity-1',
        attempt: 1,
      },
      heartbeat: mockHeartbeat,
      cancellationSignal: mockCancellationSignal,
    }),
  },
}));

// Import AFTER mock so the mock is applied
import {
  initializeComponentActivityServices,
  resetComponentActivityServices,
  runComponentActivity,
  setRunMetadataActivity,
  finalizeRunActivity,
} from '../run-component.activity';
import type { RunComponentActivityInput } from '../../types';

// ── Test helpers ─────────────────────────────────────────────────────────────

function createMockStorage() {
  const scoped = {
    downloadFile: vi.fn(),
    uploadFile: vi.fn().mockResolvedValue(undefined),
    getFileMetadata: vi.fn(),
    forOrganization: vi.fn(),
  };
  scoped.forOrganization.mockReturnValue(scoped);
  const storage = {
    downloadFile: vi.fn().mockRejectedValue(new Error('unscoped storage access')),
    uploadFile: vi.fn().mockRejectedValue(new Error('unscoped storage access')),
    getFileMetadata: vi.fn().mockRejectedValue(new Error('unscoped storage access')),
    forOrganization: vi.fn(),
    scoped,
  };
  storage.forOrganization.mockReturnValue(scoped);
  return storage;
}

function createMockTrace() {
  const events: any[] = [];
  return {
    record: vi.fn().mockImplementation((event: any) => events.push(event)),
    setRunMetadata: vi.fn(),
    finalizeRun: vi.fn(),
    events,
  };
}

function createMockNodeIO() {
  return {
    recordStart: vi.fn().mockResolvedValue(undefined),
    recordCompletion: vi.fn().mockResolvedValue(undefined),
  };
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function expectPromisePending(promise: Promise<unknown>): Promise<void> {
  let settled = false;
  void promise.then(
    () => {
      settled = true;
    },
    () => {
      settled = true;
    },
  );
  await new Promise<void>((resolve) => setImmediate(resolve));
  expect(settled).toBe(false);
}

// Shared execute function that tests can swap per-test
let currentExecuteFn: (ctx: any) => Promise<any> = async () => ({ result: 'default' });

function createBaseActivityInput(
  overrides: Partial<RunComponentActivityInput> = {},
): RunComponentActivityInput {
  return {
    runId: 'test-run-1',
    workflowId: 'test-workflow-1',
    workflowName: 'Test Workflow',
    action: {
      ref: 'node-1',
      componentId: 'test.run-component-activity',
    },
    inputs: { value: 'hello' },
    params: {},
    ...overrides,
  };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('initializeComponentActivityServices', () => {
  beforeEach(() => {
    resetComponentActivityServices();
  });

  it('initializes services successfully', () => {
    expect(() =>
      initializeComponentActivityServices({
        storage: createMockStorage() as any,
        trace: createMockTrace() as any,
      }),
    ).not.toThrow();
  });

  it('throws on double-initialization', () => {
    initializeComponentActivityServices({
      storage: createMockStorage() as any,
      trace: createMockTrace() as any,
    });

    expect(() =>
      initializeComponentActivityServices({
        storage: createMockStorage() as any,
        trace: createMockTrace() as any,
      }),
    ).toThrow('Component activity services already initialized');
  });
});

describe('resetComponentActivityServices', () => {
  beforeEach(() => {
    resetComponentActivityServices();
  });

  it('allows re-initialization after reset', () => {
    initializeComponentActivityServices({
      storage: createMockStorage() as any,
      trace: createMockTrace() as any,
    });

    resetComponentActivityServices();

    expect(() =>
      initializeComponentActivityServices({
        storage: createMockStorage() as any,
        trace: createMockTrace() as any,
      }),
    ).not.toThrow();
  });
});

describe('setRunMetadataActivity', () => {
  beforeEach(() => {
    resetComponentActivityServices();
  });

  it('calls trace.setRunMetadata when trace is metadata-aware', async () => {
    const trace = createMockTrace();
    initializeComponentActivityServices({
      storage: createMockStorage() as any,
      trace: trace as any,
    });

    await setRunMetadataActivity({
      runId: 'run-1',
      workflowId: 'wf-1',
      organizationId: 'org-1',
    });

    expect(trace.setRunMetadata).toHaveBeenCalledWith('run-1', {
      workflowId: 'wf-1',
      organizationId: 'org-1',
    });
  });

  it('handles null organizationId by passing null', async () => {
    const trace = createMockTrace();
    initializeComponentActivityServices({
      storage: createMockStorage() as any,
      trace: trace as any,
    });

    await setRunMetadataActivity({
      runId: 'run-1',
      workflowId: 'wf-1',
    });

    expect(trace.setRunMetadata).toHaveBeenCalledWith('run-1', {
      workflowId: 'wf-1',
      organizationId: null,
    });
  });
});

describe('finalizeRunActivity', () => {
  beforeEach(() => {
    resetComponentActivityServices();
  });

  it('calls trace.finalizeRun when trace is metadata-aware', async () => {
    const trace = createMockTrace();
    initializeComponentActivityServices({
      storage: createMockStorage() as any,
      trace: trace as any,
    });

    await finalizeRunActivity({
      runId: 'run-1',
      organizationId: 'org-1',
      status: 'COMPLETED',
    });

    expect(trace.finalizeRun).toHaveBeenCalledWith('run-1');
  });

  it('reports the terminal status to the backend after flushing trace metadata', async () => {
    const trace = createMockTrace();
    const order: string[] = [];
    trace.finalizeRun.mockImplementation(() => {
      order.push('trace');
    });
    const runFinalizer = vi.fn(async () => {
      order.push('backend');
    });
    initializeComponentActivityServices({
      storage: createMockStorage() as any,
      trace: trace as any,
      runFinalizer,
    });

    await finalizeRunActivity({
      runId: 'run-1',
      organizationId: 'org-1',
      status: 'FAILED',
      completedAt: '2026-07-26T12:00:00.000Z',
    });

    expect(runFinalizer).toHaveBeenCalledWith({
      runId: 'run-1',
      organizationId: 'org-1',
      status: 'FAILED',
      completedAt: '2026-07-26T12:00:00.000Z',
    });
    expect(order).toEqual(['trace', 'backend']);
  });

  it('keeps legacy in-flight finalize activities capability-preserving', async () => {
    const trace = createMockTrace();
    const runFinalizer = vi.fn(async () => {});
    initializeComponentActivityServices({
      storage: createMockStorage() as any,
      trace: trace as any,
      runFinalizer,
    });

    await finalizeRunActivity({ runId: 'legacy-run' } as any);

    expect(trace.finalizeRun).toHaveBeenCalledWith('legacy-run');
    expect(runFinalizer).not.toHaveBeenCalled();
  });
});

describe('runComponentActivity', () => {
  let storage: ReturnType<typeof createMockStorage>;
  let trace: ReturnType<typeof createMockTrace>;
  let nodeIO: ReturnType<typeof createMockNodeIO>;

  // Register the test component ONCE — componentRegistry throws on duplicate
  beforeAll(() => {
    const component: ComponentDefinition = {
      id: 'test.run-component-activity',
      label: 'Test Echo',
      category: 'transform',
      runner: { kind: 'inline' },
      inputs: inputs({
        value: withPortMeta(z.string().optional(), { label: 'Value' }),
      }),
      outputs: outputs({
        result: withPortMeta(z.string().optional(), { label: 'Result' }),
      }),
      async execute({ inputs: inp }, context) {
        return currentExecuteFn({ inputs: inp, context });
      },
    };

    componentRegistry.register(component);
  });

  beforeEach(() => {
    // Reset to default behavior
    currentExecuteFn = async () => ({ result: 'default' });

    resetComponentActivityServices();
    mockHeartbeat.mockClear();
    mockCancellationSignal = new AbortController().signal;

    storage = createMockStorage();
    trace = createMockTrace();
    nodeIO = createMockNodeIO();

    initializeComponentActivityServices({
      storage: storage as any,
      trace: trace as any,
      nodeIO: nodeIO as any,
    });
  });

  it('executes a registered component and returns output', async () => {
    currentExecuteFn = async ({ inputs: inp }) => ({
      result: `echoed: ${inp.value}`,
    });

    const input = createBaseActivityInput();
    const result = await runComponentActivity(input);

    expect(result.output).toEqual({ result: 'echoed: hello' });
  });

  it('drains trace, log, and terminal publications before a successful activity settles', async () => {
    const tracePublication = deferred<undefined>();
    const logPublication = deferred<undefined>();
    const terminalPublication = deferred<undefined>();
    const completedTraceObserved = deferred<undefined>();
    const executionObserved = deferred<undefined>();
    const trackedTrace = createMockTrace();
    trackedTrace.record.mockImplementation((event: any) => {
      trackedTrace.events.push(event);
      if (event.type === 'NODE_COMPLETED') {
        completedTraceObserved.resolve(undefined);
      }
      return tracePublication.promise;
    });
    const logs = {
      append: vi.fn(() => logPublication.promise),
    };
    const terminal = {
      append: vi.fn(() => terminalPublication.promise),
    };

    resetComponentActivityServices();
    initializeComponentActivityServices({
      storage: storage as any,
      trace: trackedTrace as any,
      nodeIO: nodeIO as any,
      logs: logs as any,
      terminalStream: terminal as any,
    });
    currentExecuteFn = async ({ context }) => {
      context.logger.info('publication must be retained');
      context.terminalCollector?.({
        runId: 'test-run-1',
        nodeRef: 'node-1',
        stream: 'stdout',
        chunkIndex: 0,
        payload: 'scanner output',
        recordedAt: new Date().toISOString(),
        deltaMs: 0,
      });
      executionObserved.resolve(undefined);
      return { result: 'done' };
    };

    const activity = runComponentActivity(createBaseActivityInput());
    await executionObserved.promise;
    await completedTraceObserved.promise;
    await expectPromisePending(activity);

    tracePublication.resolve(undefined);
    logPublication.resolve(undefined);
    terminalPublication.resolve(undefined);

    await expect(activity).resolves.toEqual({
      output: { result: 'done' },
      activeOutputPorts: undefined,
    });
    expect(logs.append).toHaveBeenCalledTimes(1);
    expect(terminal.append).toHaveBeenCalledTimes(1);
  });

  it('preserves a successful component result and marks sticky readiness on terminal loss', async () => {
    const workerState: { telemetryError?: string } = {};
    const terminal = {
      append: vi.fn(async () => {
        throw new Error('WRONGTYPE terminal stream key');
      }),
    };

    resetComponentActivityServices();
    initializeComponentActivityServices({
      storage: storage as any,
      trace: trace as any,
      nodeIO: nodeIO as any,
      terminalStream: terminal as any,
      onRequiredTelemetryFailure: (message) => {
        workerState.telemetryError = message;
      },
    });
    currentExecuteFn = async ({ context }) => {
      context.terminalCollector?.({
        runId: 'test-run-1',
        nodeRef: 'node-1',
        stream: 'stdout',
        chunkIndex: 0,
        payload: 'scanner output',
        recordedAt: new Date().toISOString(),
        deltaMs: 0,
      });
      return { result: 'side effect completed' };
    };

    await expect(runComponentActivity(createBaseActivityInput())).resolves.toEqual({
      output: { result: 'side effect completed' },
      activeOutputPorts: undefined,
    });
    expect(terminal.append).toHaveBeenCalledTimes(1);
    expect(workerState.telemetryError).toContain('Required terminal telemetry publication failed');
    expect(workerState.telemetryError).toContain('WRONGTYPE terminal stream key');
  });

  it('drains started trace publication when input validation fails', async () => {
    const tracePublication = deferred<undefined>();
    const startedTraceObserved = deferred<undefined>();
    const trackedTrace = createMockTrace();
    trackedTrace.record.mockImplementation((event: any) => {
      trackedTrace.events.push(event);
      if (event.type === 'NODE_STARTED') {
        startedTraceObserved.resolve(undefined);
      }
      return tracePublication.promise;
    });
    resetComponentActivityServices();
    initializeComponentActivityServices({
      storage: storage as any,
      trace: trackedTrace as any,
      nodeIO: nodeIO as any,
    });

    const activity = runComponentActivity(
      createBaseActivityInput({ inputs: { value: 42 as unknown as string } }),
    );
    await startedTraceObserved.promise;
    await expectPromisePending(activity);

    tracePublication.resolve(undefined);
    await expect(activity).rejects.toThrow();
  });

  it('drains failed trace publication without replacing a component failure', async () => {
    const tracePublication = deferred<undefined>();
    const failedTraceObserved = deferred<undefined>();
    const trackedTrace = createMockTrace();
    trackedTrace.record.mockImplementation((event: any) => {
      trackedTrace.events.push(event);
      if (event.type === 'NODE_FAILED') {
        failedTraceObserved.resolve(undefined);
      }
      return tracePublication.promise;
    });
    resetComponentActivityServices();
    initializeComponentActivityServices({
      storage: storage as any,
      trace: trackedTrace as any,
      nodeIO: nodeIO as any,
    });
    currentExecuteFn = async () => {
      throw new Error('component failure retained');
    };

    const activity = runComponentActivity(createBaseActivityInput());
    await failedTraceObserved.promise;
    await expectPromisePending(activity);

    tracePublication.resolve(undefined);
    await expect(activity).rejects.toThrow('component failure retained');
  });

  it('drains started trace publication before propagating cancellation', async () => {
    const tracePublication = deferred<undefined>();
    const executionObserved = deferred<undefined>();
    const trackedTrace = createMockTrace();
    trackedTrace.record.mockImplementation((event: any) => {
      trackedTrace.events.push(event);
      return tracePublication.promise;
    });
    const controller = new AbortController();
    const cancellation = new Error('cancelled with telemetry in flight');
    controller.abort(cancellation);
    mockCancellationSignal = controller.signal;
    resetComponentActivityServices();
    initializeComponentActivityServices({
      storage: storage as any,
      trace: trackedTrace as any,
      nodeIO: nodeIO as any,
    });
    currentExecuteFn = async ({ context }) => {
      executionObserved.resolve(undefined);
      context.signal.throwIfAborted();
      return { result: 'unreachable' };
    };

    const activity = runComponentActivity(createBaseActivityInput());
    await executionObserved.promise;
    await expectPromisePending(activity);

    tracePublication.resolve(undefined);
    await expect(activity).rejects.toBe(cancellation);
  });

  it('exposes the authoritative scope identity to component execution', async () => {
    let capturedScopeId: string | null | undefined;
    currentExecuteFn = async ({ context }) => {
      capturedScopeId = context.scopeId;
      return { result: 'done' };
    };

    await runComponentActivity(createBaseActivityInput({ scopeId: 'scope-1' }));

    expect(capturedScopeId).toBe('scope-1');
  });

  it('propagates the Temporal activity cancellation signal into component execution', async () => {
    let capturedSignal: AbortSignal | undefined;
    currentExecuteFn = async ({ context }) => {
      capturedSignal = context.signal;
      return { result: 'done' };
    };

    await runComponentActivity(createBaseActivityInput());

    expect(capturedSignal).toBe(mockCancellationSignal);
  });

  it('preserves activity cancellation instead of converting it to a failed component', async () => {
    const controller = new AbortController();
    const cancellation = new Error('Temporal activity cancelled');
    controller.abort(cancellation);
    mockCancellationSignal = controller.signal;
    currentExecuteFn = async ({ context }) => {
      context.signal.throwIfAborted();
      return { result: 'unreachable' };
    };

    await expect(runComponentActivity(createBaseActivityInput())).rejects.toBe(cancellation);
    expect(nodeIO.recordCompletion).not.toHaveBeenCalledWith(
      expect.objectContaining({ status: 'failed' }),
    );
    expect(trace.events.some((event) => event.type === 'NODE_FAILED')).toBe(false);
  });

  it('records NODE_STARTED and NODE_COMPLETED trace events', async () => {
    currentExecuteFn = async () => ({ result: 'done' });

    const input = createBaseActivityInput();
    await runComponentActivity(input);

    const types = trace.events.map((e: any) => e.type);
    expect(types).toContain('NODE_STARTED');
    expect(types).toContain('NODE_COMPLETED');
  });

  it('calls nodeIO.recordStart and nodeIO.recordCompletion', async () => {
    currentExecuteFn = async () => ({ result: 'done' });

    const input = createBaseActivityInput();
    await runComponentActivity(input);

    expect(nodeIO.recordStart).toHaveBeenCalledTimes(1);
    const startCall = nodeIO.recordStart.mock.calls[0][0];
    expect(startCall.runId).toBe('test-run-1');
    expect(startCall.nodeRef).toBe('node-1');

    expect(nodeIO.recordCompletion).toHaveBeenCalledTimes(1);
    const completionCall = nodeIO.recordCompletion.mock.calls[0][0];
    expect(completionCall.status).toBe('completed');
  });

  it('throws NotFoundError for unknown component ID', async () => {
    const input = createBaseActivityInput({
      action: { ref: 'node-1', componentId: 'nonexistent.component' },
    });

    try {
      await runComponentActivity(input);
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(NotFoundError);
      expect((error as NotFoundError).message).toContain('nonexistent.component');
    }
  });

  it('handles component execution error via handleComponentError', async () => {
    currentExecuteFn = async () => {
      throw new Error('component execution failed');
    };

    const input = createBaseActivityInput({ organizationId: 'org-a' });

    try {
      await runComponentActivity(input);
      expect.unreachable('should have thrown');
    } catch (error: any) {
      expect(error.message).toContain('component execution failed');
    }

    expect(nodeIO.recordCompletion).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: 'test-run-1',
        status: 'failed',
        organizationId: 'org-a',
      }),
    );
  });

  it('normalizes a missing organization to null on failed completion', async () => {
    currentExecuteFn = async () => {
      throw new Error('trusted-local failure');
    };

    try {
      await runComponentActivity(createBaseActivityInput({ organizationId: undefined }));
      expect.unreachable('should have thrown');
    } catch (error: any) {
      expect(error.message).toContain('trusted-local failure');
    }

    expect(nodeIO.recordCompletion).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'failed',
        organizationId: null,
      }),
    );
  });

  it('sends heartbeats during execution', async () => {
    currentExecuteFn = async () => ({ result: 'done' });

    const input = createBaseActivityInput();
    await runComponentActivity(input);

    expect(mockHeartbeat).toHaveBeenCalled();
    const heartbeatArgs = mockHeartbeat.mock.calls.map((c: any[]) => c[0]);
    expect(heartbeatArgs).toContain('inputs-resolved');
    expect(heartbeatArgs).toContain('secrets-resolved');
    expect(heartbeatArgs).toContain('validated');
    expect(heartbeatArgs).toContain('execution-complete');
  });

  it('resolves spilled inputs from storage', async () => {
    // The spill resolver JSON.parses the downloaded buffer and replaces the
    // spilled marker. The schema expects a string, so the resolved value
    // must be a plain string.
    const resolvedValue = 'resolved big payload data';
    storage.scoped.downloadFile.mockResolvedValue({
      buffer: Buffer.from(JSON.stringify(resolvedValue), 'utf8'),
      metadata: {
        id: 'spill-ref',
        fileName: 'spill.json',
        mimeType: 'application/json',
        size: 100,
      },
    });

    currentExecuteFn = async ({ inputs: inp }) => {
      return { result: inp.value ?? 'resolved' };
    };

    const input = createBaseActivityInput({
      organizationId: 'org-a',
      inputs: {
        value: {
          __spilled__: true,
          storageRef: 'spill-ref',
          originalSize: 100,
        },
      },
    });

    await runComponentActivity(input);

    expect(storage.forOrganization).toHaveBeenCalledWith('org-a');
    expect(storage.scoped.downloadFile).toHaveBeenCalledWith('spill-ref');
    expect(storage.downloadFile).not.toHaveBeenCalled();
  });

  it('spills output larger than threshold to storage', async () => {
    const largeResult = 'x'.repeat(TEMPORAL_SPILL_THRESHOLD_BYTES + 1000);
    currentExecuteFn = async () => ({ result: largeResult });

    const input = createBaseActivityInput();
    const result = await runComponentActivity(input);

    expect(storage.scoped.uploadFile).toHaveBeenCalled();
    expect(storage.uploadFile).not.toHaveBeenCalled();

    const output = result.output as Record<string, unknown>;
    expect(output.__spilled__).toBe(true);
    expect(output.storageRef).toBeDefined();
    expect(output.originalSize).toBeGreaterThan(TEMPORAL_SPILL_THRESHOLD_BYTES);
  });

  it('does not spill output within threshold', async () => {
    currentExecuteFn = async () => ({ result: 'small output' });

    const input = createBaseActivityInput();
    const result = await runComponentActivity(input);

    expect(storage.scoped.uploadFile).not.toHaveBeenCalled();
    expect((result.output as any).__spilled__).toBeUndefined();
  });

  it('returns activeOutputPorts when component provides them', async () => {
    currentExecuteFn = async () => ({
      result: 'done',
      activeOutputPorts: ['success', 'warning'],
    });

    const input = createBaseActivityInput();
    const result = await runComponentActivity(input);

    expect(result.activeOutputPorts).toEqual(['success', 'warning']);
  });

  it('throws when services are not initialized', async () => {
    resetComponentActivityServices();
    currentExecuteFn = async () => ({ result: 'done' });

    const input = createBaseActivityInput();

    try {
      await runComponentActivity(input);
      expect.unreachable('should have thrown');
    } catch (error: any) {
      expect(error.message).toContain('Component activity services not initialized');
    }
  });

  it('passes metadata fields without error', async () => {
    currentExecuteFn = async () => ({ result: 'done' });

    const input = createBaseActivityInput({
      metadata: {
        streamId: 'stream-1',
        joinStrategy: 'all',
        groupId: 'group-1',
        triggeredBy: 'upstream-node',
      },
    });

    await runComponentActivity(input);

    expect(nodeIO.recordCompletion).toHaveBeenCalledTimes(1);
  });
});
