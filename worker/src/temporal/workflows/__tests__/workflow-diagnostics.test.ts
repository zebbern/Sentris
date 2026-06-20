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

vi.mock('@temporalio/workflow', () => ({
  ApplicationFailure: MockApplicationFailure,
  condition: vi.fn(async (predicate: () => boolean) => predicate()),
  defineQuery: vi.fn((name: string) => name),
  defineSignal: vi.fn((name: string) => name),
  getExternalWorkflowHandle: vi.fn(() => ({ cancel: vi.fn(async () => {}) })),
  proxyActivities: vi.fn(() => workflowActivities),
  setHandler: vi.fn(),
  sleep: vi.fn(async () => {}),
  startChild: vi.fn(),
  workflowInfo: vi.fn(() => ({ workflowId: 'workflow-info-id' })),
  uuid4: vi.fn(() => 'test-uuid'),
}));

let sentrisWorkflowRun: typeof import('../index').sentrisWorkflowRun;
let handleHumanInput: typeof import('../human-input-handler').handleHumanInput;
let handleToolModeRegistration: typeof import('../tool-mode-handler').handleToolModeRegistration;

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
    ({ sentrisWorkflowRun } = await import('../index'));
    ({ handleHumanInput } = await import('../human-input-handler'));
    ({ handleToolModeRegistration } = await import('../tool-mode-handler'));
  });

  beforeEach(() => {
    delete process.env.SENTRIS_DEBUG_WORKFLOW;
    vi.clearAllMocks();
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
    } finally {
      consoleLogSpy.mockRestore();
    }
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
