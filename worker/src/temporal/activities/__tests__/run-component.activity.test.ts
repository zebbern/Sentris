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

mock.module('@temporalio/activity', () => ({
  Context: {
    current: () => ({
      info: {
        activityId: 'test-activity-1',
        attempt: 1,
      },
      heartbeat: mockHeartbeat,
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
  return {
    downloadFile: vi.fn(),
    uploadFile: vi.fn().mockResolvedValue(undefined),
    getFileMetadata: vi.fn(),
  };
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

    await finalizeRunActivity({ runId: 'run-1' });

    expect(trace.finalizeRun).toHaveBeenCalledWith('run-1');
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

    const input = createBaseActivityInput();

    try {
      await runComponentActivity(input);
      expect.unreachable('should have thrown');
    } catch (error: any) {
      expect(error.message).toContain('component execution failed');
    }
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
    storage.downloadFile.mockResolvedValue({
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
      inputs: {
        value: {
          __spilled__: true,
          storageRef: 'spill-ref',
          originalSize: 100,
        },
      },
    });

    await runComponentActivity(input);

    expect(storage.downloadFile).toHaveBeenCalledWith('spill-ref');
  });

  it('spills output larger than threshold to storage', async () => {
    const largeResult = 'x'.repeat(TEMPORAL_SPILL_THRESHOLD_BYTES + 1000);
    currentExecuteFn = async () => ({ result: largeResult });

    const input = createBaseActivityInput();
    const result = await runComponentActivity(input);

    expect(storage.uploadFile).toHaveBeenCalled();

    const output = result.output as Record<string, unknown>;
    expect(output.__spilled__).toBe(true);
    expect(output.storageRef).toBeDefined();
    expect(output.originalSize).toBeGreaterThan(TEMPORAL_SPILL_THRESHOLD_BYTES);
  });

  it('does not spill output within threshold', async () => {
    currentExecuteFn = async () => ({ result: 'small output' });

    const input = createBaseActivityInput();
    const result = await runComponentActivity(input);

    expect(storage.uploadFile).not.toHaveBeenCalled();
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
