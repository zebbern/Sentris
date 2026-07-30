import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'bun:test';
import type {
  RunComponentActivityInput,
  RunComponentActivityOutput,
  RunWorkflowActivityInput,
} from '../../types';
import type { HumanInputResolution } from '../../signals';

const runComponentActivity = vi.fn(
  async (_input: RunComponentActivityInput): Promise<RunComponentActivityOutput> => ({
    output: { value: 'done' },
    activeOutputPorts: ['value'],
  }),
);
const setRunMetadataActivity = vi.fn(async () => {});
const cleanupRunResourcesActivity = vi.fn(async () => {});
const finalizeRunActivity = vi.fn(async () => {});
const recordTraceEventActivity = vi.fn(async () => {});
const registerLocalMcpActivity = vi.fn(async () => {});
const prepareAndRegisterToolActivity = vi.fn(async () => {});
const areAllToolsReadyActivity = vi.fn(async () => ({ ready: true }));
const createHumanInputRequestActivity = vi.fn(async () => ({
  requestId: 'request-1',
  resolveToken: 'token-1',
  resolveUrl: 'https://example.test/resolve/token-1',
}));
const expireHumanInputRequestActivity = vi.fn(async () => {});
const prepareRunPayloadActivity = vi.fn();
const markRunStartedActivity = vi.fn(async () => ({
  runId: 'child-run',
  workflowId: '00000000-0000-4000-8000-000000000001',
  temporalRunId: 'temporal-child-run',
  duplicate: false,
}));
const startChild = vi.fn();

const workflowActivities = {
  runComponentActivity,
  setRunMetadataActivity,
  cleanupRunResourcesActivity,
  finalizeRunActivity,
  recordTraceEventActivity,
  registerLocalMcpActivity,
  prepareAndRegisterToolActivity,
  areAllToolsReadyActivity,
  createHumanInputRequestActivity,
  expireHumanInputRequestActivity,
  prepareRunPayloadActivity,
  markRunStartedActivity,
};

class MockApplicationFailure extends Error {
  nonRetryable = false;
  details?: unknown[];
  type?: string;

  static nonRetryable(message: string, type?: string, details?: unknown[]) {
    const error = new MockApplicationFailure(message);
    error.name = type ?? 'ApplicationFailure';
    error.type = type;
    error.details = details;
    error.nonRetryable = true;
    return error;
  }
}

class MockCancelledFailure extends Error {}
const nonCancellable = vi.fn(async (callback: () => Promise<void>) => callback());
const patched = vi.fn((_patchId: string) => true);

vi.mock('@temporalio/workflow', () => ({
  ApplicationFailure: MockApplicationFailure,
  CancellationScope: { nonCancellable },
  condition: vi.fn(async (predicate: () => boolean) => predicate()),
  defineQuery: vi.fn((name: string) => name),
  defineSignal: vi.fn((name: string) => name),
  getExternalWorkflowHandle: vi.fn(() => ({ cancel: vi.fn(async () => {}) })),
  isCancellation: vi.fn((error: unknown) => error instanceof MockCancelledFailure),
  patched,
  proxyActivities: vi.fn(() => workflowActivities),
  setHandler: vi.fn(),
  sleep: vi.fn(async () => {}),
  startChild,
  workflowInfo: vi.fn(() => ({ workflowId: 'workflow-info-id' })),
  uuid4: vi.fn(() => 'test-uuid'),
}));

let sentrisWorkflowRun: typeof import('../index').sentrisWorkflowRun;
let scheduleTriggerWorkflow: typeof import('../index').scheduleTriggerWorkflow;
let handleHumanInput: typeof import('../human-input-handler').handleHumanInput;
let handleToolModeRegistration: typeof import('../tool-mode-handler').handleToolModeRegistration;
let handleSubWorkflowCall: typeof import('../sub-workflow-handler').handleSubWorkflowCall;

const originalDebugWorkflow = process.env.SENTRIS_DEBUG_WORKFLOW;

function quietWorkflowInput(): RunWorkflowActivityInput {
  return {
    runId: 'quiet-workflow-run',
    workflowId: 'workflow-1',
    workflowVersionId: null,
    organizationId: null,
    inputs: {},
    definition: {
      version: 1,
      title: 'Quiet workflow orchestration',
      entrypoint: { ref: 'node-1' },
      config: {
        environment: 'test',
        timeoutSeconds: 30,
      },
      nodes: {
        'node-1': { ref: 'node-1' },
      },
      edges: [],
      dependencyCounts: {
        'node-1': 0,
      },
      actions: [
        {
          ref: 'node-1',
          componentId: 'core.workflow.entrypoint',
          params: {},
          inputOverrides: {},
          dependsOn: [],
          inputMappings: {},
        },
      ],
    },
  };
}

describe('workflow orchestration diagnostics', () => {
  beforeAll(async () => {
    ({ sentrisWorkflowRun, scheduleTriggerWorkflow } = await import('../index'));
    ({ handleHumanInput } = await import('../human-input-handler'));
    ({ handleToolModeRegistration } = await import('../tool-mode-handler'));
    ({ handleSubWorkflowCall } = await import('../sub-workflow-handler'));
  });

  beforeEach(() => {
    delete process.env.SENTRIS_DEBUG_WORKFLOW;
    vi.clearAllMocks();
    patched.mockReturnValue(true);
  });

  afterEach(() => {
    if (originalDebugWorkflow === undefined) {
      delete process.env.SENTRIS_DEBUG_WORKFLOW;
    } else {
      process.env.SENTRIS_DEBUG_WORKFLOW = originalDebugWorkflow;
    }
  });

  test('sentrisWorkflowRun does not mirror successful lifecycle diagnostics to console.log by default', async () => {
    const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    try {
      const result = await sentrisWorkflowRun(quietWorkflowInput());

      expect(result).toEqual({
        success: true,
        outputs: {
          'node-1': { value: 'done' },
        },
      });
      expect(consoleLogSpy).not.toHaveBeenCalled();
      expect(finalizeRunActivity).toHaveBeenCalledWith(
        expect.objectContaining({
          runId: 'quiet-workflow-run',
          organizationId: null,
          status: 'COMPLETED',
        }),
      );
    } finally {
      consoleLogSpy.mockRestore();
    }
  });

  test('preserves cancellation and finalizes the run as CANCELLED in a non-cancellable scope', async () => {
    const cancellation = new MockCancelledFailure('cancelled');
    runComponentActivity.mockRejectedValueOnce(cancellation);

    await expect(sentrisWorkflowRun(quietWorkflowInput())).rejects.toBe(cancellation);

    expect(nonCancellable).toHaveBeenCalled();
    expect(cleanupRunResourcesActivity).toHaveBeenCalledWith({
      runId: 'quiet-workflow-run',
    });
    expect(finalizeRunActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: 'quiet-workflow-run',
        organizationId: null,
        status: 'CANCELLED',
      }),
    );
  });

  test('finalizes cancellation during run metadata initialization', async () => {
    const cancellation = new MockCancelledFailure('metadata initialization cancelled');
    setRunMetadataActivity.mockRejectedValueOnce(cancellation);

    await expect(sentrisWorkflowRun(quietWorkflowInput())).rejects.toBe(cancellation);

    expect(runComponentActivity).not.toHaveBeenCalled();
    expect(nonCancellable).toHaveBeenCalledTimes(1);
    expect(cleanupRunResourcesActivity).toHaveBeenCalledWith({
      runId: 'quiet-workflow-run',
    });
    expect(finalizeRunActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: 'quiet-workflow-run',
        organizationId: null,
        status: 'CANCELLED',
      }),
    );
  });

  test('replays metadata failures on the pre-lifecycle command path', async () => {
    const cancellation = new MockCancelledFailure('historical metadata cancellation');
    patched.mockImplementation((patchId) => patchId !== 'sentris-run-metadata-lifecycle-v1');
    setRunMetadataActivity.mockRejectedValueOnce(cancellation);

    await expect(sentrisWorkflowRun(quietWorkflowInput())).rejects.toBe(cancellation);

    expect(cleanupRunResourcesActivity).not.toHaveBeenCalled();
    expect(finalizeRunActivity).not.toHaveBeenCalled();
    expect(nonCancellable).not.toHaveBeenCalled();
  });

  test('finalizes ordinary workflow errors as FAILED', async () => {
    runComponentActivity.mockRejectedValueOnce(new Error('component failed'));

    await expect(sentrisWorkflowRun(quietWorkflowInput())).rejects.toBeInstanceOf(
      MockApplicationFailure,
    );

    expect(finalizeRunActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: 'quiet-workflow-run',
        status: 'FAILED',
      }),
    );
  });

  test('preserves the legacy finalize command shape when replaying pre-patch histories', async () => {
    patched.mockReturnValue(false);

    await sentrisWorkflowRun(quietWorkflowInput());

    expect(finalizeRunActivity).toHaveBeenCalledWith({
      runId: 'quiet-workflow-run',
    });
    expect(nonCancellable).not.toHaveBeenCalled();
  });

  test('publishes tenant-aware stable trace identity from deterministic workflow state', async () => {
    const input = quietWorkflowInput();
    input.organizationId = 'org-1';
    input.definition.nodes['error-node'] = { ref: 'error-node' };
    input.definition.edges.push({
      id: 'node-1->error-node',
      sourceRef: 'node-1',
      targetRef: 'error-node',
      kind: 'error',
    });
    input.definition.dependencyCounts['error-node'] = 1;
    input.definition.actions.push({
      ref: 'error-node',
      componentId: 'core.workflow.entrypoint',
      params: {},
      inputOverrides: {},
      dependsOn: ['node-1'],
      inputMappings: {},
    });

    await sentrisWorkflowRun(input);

    expect(recordTraceEventActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        eventId: 'trace:quiet-workflow-run:workflow:1',
        sequence: 1,
        workflowId: 'workflow-1',
        organizationId: 'org-1',
        type: 'NODE_SKIPPED',
        nodeRef: 'error-node',
      }),
    );
  });

  test('persists an automatically scheduled child start before consuming its result', async () => {
    const callOrder: string[] = [];
    prepareRunPayloadActivity.mockResolvedValueOnce({
      runId: 'scheduled-child-run',
      workflowId: '00000000-0000-4000-8000-000000000001',
      workflowVersionId: '00000000-0000-4000-8000-000000000002',
      workflowVersion: 1,
      organizationId: 'org-1',
      scopeId: null,
      definition: quietWorkflowInput().definition,
      inputs: {},
      trigger: {
        type: 'schedule',
        sourceId: 'schedule-1',
        label: 'Nightly',
      },
      inputPreview: { runtimeInputs: {}, nodeOverrides: {} },
    });
    markRunStartedActivity.mockImplementationOnce(async () => {
      callOrder.push('persisted');
      return {
        runId: 'scheduled-child-run',
        workflowId: '00000000-0000-4000-8000-000000000001',
        temporalRunId: 'temporal-scheduled-child',
        duplicate: false,
      };
    });
    startChild.mockResolvedValueOnce({
      workflowId: 'scheduled-child-run',
      firstExecutionRunId: 'temporal-scheduled-child',
      result: async () => {
        callOrder.push('result');
        return { success: true, outputs: {} };
      },
    });

    await scheduleTriggerWorkflow({
      workflowId: '00000000-0000-4000-8000-000000000001',
      organizationId: 'org-1',
      scheduleId: 'schedule-1',
      scheduleName: 'Nightly',
    });

    expect(markRunStartedActivity).toHaveBeenCalledWith({
      runId: 'scheduled-child-run',
      temporalRunId: 'temporal-scheduled-child',
      organizationId: 'org-1',
    });
    expect(callOrder).toEqual(['persisted', 'result']);
  });

  test('keeps pre-patch scheduled-child histories command-compatible', async () => {
    patched.mockReturnValue(false);
    prepareRunPayloadActivity.mockResolvedValueOnce({
      runId: 'legacy-scheduled-child-run',
      workflowId: '00000000-0000-4000-8000-000000000001',
      workflowVersionId: '00000000-0000-4000-8000-000000000002',
      workflowVersion: 1,
      organizationId: 'org-1',
      scopeId: null,
      definition: quietWorkflowInput().definition,
      inputs: {},
      trigger: {
        type: 'schedule',
        sourceId: 'schedule-1',
        label: 'Nightly',
      },
      inputPreview: { runtimeInputs: {}, nodeOverrides: {} },
    });
    startChild.mockResolvedValueOnce({
      workflowId: 'legacy-scheduled-child-run',
      firstExecutionRunId: 'temporal-legacy-scheduled-child',
      result: async () => ({ success: true, outputs: {} }),
    });

    await scheduleTriggerWorkflow({
      workflowId: '00000000-0000-4000-8000-000000000001',
      organizationId: 'org-1',
      scheduleId: 'schedule-1',
      scheduleName: 'Nightly',
    });

    expect(markRunStartedActivity).not.toHaveBeenCalled();
  });

  test('persists a nested child start through the same replay-safe transition', async () => {
    const prepared = {
      runId: 'nested-child-run',
      workflowId: '00000000-0000-4000-8000-000000000001',
      workflowVersionId: '00000000-0000-4000-8000-000000000002',
      workflowVersion: 1,
      organizationId: 'org-1',
      scopeId: null,
      definition: quietWorkflowInput().definition,
      inputs: {},
      trigger: {
        type: 'api' as const,
        sourceId: 'parent-run',
        label: 'Sub-workflow',
      },
      inputPreview: { runtimeInputs: {}, nodeOverrides: {} },
    };
    prepareRunPayloadActivity.mockResolvedValueOnce(prepared);
    startChild.mockResolvedValueOnce({
      workflowId: 'nested-child-run',
      firstExecutionRunId: 'temporal-nested-child',
      result: async () => ({ success: true, outputs: { child: true } }),
    });
    const input = quietWorkflowInput();
    input.runId = 'parent-run';
    input.organizationId = 'org-1';

    await handleSubWorkflowCall({
      input,
      action: {
        ref: 'call-child',
        componentId: 'core.workflow.call',
        params: {},
        inputOverrides: {},
        dependsOn: [],
        inputMappings: {},
      },
      mergedInputs: {},
      mergedParams: {
        workflowId: '00000000-0000-4000-8000-000000000001',
      },
      warnings: [],
      depth: 0,
      callChain: ['parent-workflow'],
      results: new Map(),
      activities: {
        prepareRunPayloadActivity,
        markRunStartedActivity,
        recordTraceEventActivity,
      },
      workflowFn: sentrisWorkflowRun,
      persistStartedRun: true,
    });

    expect(markRunStartedActivity).toHaveBeenCalledWith({
      runId: 'nested-child-run',
      temporalRunId: 'temporal-nested-child',
      organizationId: 'org-1',
    });
  });

  test('keeps pre-patch child histories command-compatible', async () => {
    prepareRunPayloadActivity.mockResolvedValueOnce({
      runId: 'legacy-child-run',
      workflowId: '00000000-0000-4000-8000-000000000001',
      workflowVersionId: '00000000-0000-4000-8000-000000000002',
      workflowVersion: 1,
      organizationId: 'org-1',
      scopeId: null,
      definition: quietWorkflowInput().definition,
      inputs: {},
      trigger: {
        type: 'api',
        sourceId: 'parent-run',
        label: 'Sub-workflow',
      },
      inputPreview: { runtimeInputs: {}, nodeOverrides: {} },
    });
    startChild.mockResolvedValueOnce({
      workflowId: 'legacy-child-run',
      firstExecutionRunId: 'temporal-legacy-child',
      result: async () => ({ success: true, outputs: {} }),
    });
    const input = quietWorkflowInput();
    input.organizationId = 'org-1';

    await handleSubWorkflowCall({
      input,
      action: {
        ref: 'call-child',
        componentId: 'core.workflow.call',
        params: {},
        inputOverrides: {},
        dependsOn: [],
        inputMappings: {},
      },
      mergedInputs: {},
      mergedParams: {
        workflowId: '00000000-0000-4000-8000-000000000001',
      },
      warnings: [],
      depth: 0,
      callChain: ['parent-workflow'],
      results: new Map(),
      activities: {
        prepareRunPayloadActivity,
        markRunStartedActivity,
        recordTraceEventActivity,
      },
      workflowFn: sentrisWorkflowRun,
      persistStartedRun: false,
    });

    expect(markRunStartedActivity).not.toHaveBeenCalled();
  });

  test('handleToolModeRegistration does not mirror successful registration diagnostics to console.log by default', async () => {
    const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const results = new Map<string, unknown>();

    try {
      const output = await handleToolModeRegistration({
        runId: 'tool-run',
        action: { ref: 'tool-node', componentId: 'test.component' },
        mergedInputs: {},
        mergedParams: {},
        activityInput: {
          runId: 'tool-run',
          workflowId: 'workflow-1',
          action: { ref: 'tool-node', componentId: 'test.component' },
          inputs: {},
          params: {},
        },
        results,
        activities: {
          registerLocalMcpActivity,
          prepareAndRegisterToolActivity,
          cleanupRunResourcesActivity,
          recordTraceEventActivity,
        },
      });

      expect(output).toEqual({ activePorts: ['default', 'tools'] });
      expect(results.get('tool-node')).toEqual({ mode: 'tool', status: 'ready', tools: [] });
      expect(consoleLogSpy).not.toHaveBeenCalled();
    } finally {
      consoleLogSpy.mockRestore();
    }
  });

  test('handleHumanInput does not mirror successful request diagnostics to console.log by default', async () => {
    const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const results = new Map<string, unknown>();
    const resolution: HumanInputResolution = {
      requestId: 'request-1',
      nodeRef: 'approval-node',
      approved: true,
      respondedBy: 'user-1',
      responseNote: 'approved',
      respondedAt: '2026-06-20T19:00:00.000Z',
      responseData: { selection: 'approve' },
    };

    try {
      const output = await handleHumanInput({
        runId: 'human-run',
        workflowId: 'workflow-1',
        organizationId: null,
        actionRef: 'approval-node',
        mergedParams: {},
        pendingData: {
          pending: true,
          inputType: 'approval',
          title: 'Approve deployment',
        },
        results,
        humanInputResolutions: new Map([['approval-node', resolution]]),
        activities: {
          createHumanInputRequestActivity,
          expireHumanInputRequestActivity,
          recordTraceEventActivity,
        },
      });

      expect(output).toEqual({
        activePorts: ['respondedBy', 'responseNote', 'respondedAt', 'requestId', 'approved'],
      });
      expect(results.get('approval-node')).toMatchObject({
        approved: true,
        rejected: false,
        requestId: 'request-1',
      });
      expect(consoleLogSpy).not.toHaveBeenCalled();
    } finally {
      consoleLogSpy.mockRestore();
    }
  });
});
