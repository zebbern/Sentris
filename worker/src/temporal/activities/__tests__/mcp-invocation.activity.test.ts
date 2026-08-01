import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'bun:test';

const heartbeat = vi.fn();
const cancellationSignal = new AbortController().signal;
const runComponentActivity = vi.fn(
  async (): Promise<{ output: unknown }> => ({ output: { vulnerabilities: [] } }),
);

vi.mock('@temporalio/activity', () => ({
  Context: {
    current: vi.fn(() => ({ heartbeat, cancellationSignal })),
  },
}));

vi.mock('../run-component.activity', () => ({ runComponentActivity }));

const GRANT_ID = '11111111-1111-4111-8111-111111111111';
const SNAPSHOT_ID = '22222222-2222-4222-8222-222222222222';
const INVOCATION_ID = '33333333-3333-4333-8333-333333333333';
const ATTEMPT_ID = '44444444-4444-4444-8444-444444444444';
const WORKFLOW_ID = '55555555-5555-4555-8555-555555555555';
const WORKFLOW_VERSION_ID = '66666666-6666-4666-8666-666666666666';
const SCOPE_ID = '77777777-7777-4777-8777-777777777777';

const scope = {
  kind: 'run' as const,
  runId: 'run-123',
  organizationId: 'org-123',
  capabilityGrantId: GRANT_ID,
  invokingNodeId: 'agent-node',
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

const claimContext = {
  ref,
  run: {
    runId: 'run-123',
    workflowId: WORKFLOW_ID,
    workflowVersionId: WORKFLOW_VERSION_ID,
    organizationId: 'org-123',
    scopeId: SCOPE_ID,
  },
  component: {
    nodeId: 'osv-node',
    componentId: 'security.osv',
    arguments: { package: 'lodash' },
    parameters: { timeoutSeconds: 30 },
    credentials: { apiKey: 'super-secret' },
  },
};

const completedResult = {
  invocationId: INVOCATION_ID,
  status: 'completed' as const,
  output: { vulnerabilities: [] },
  completedAt: '2099-07-31T10:00:02.000Z',
};

const mockFetch = vi.fn();
const originalFetch = globalThis.fetch;
const originalInternalToken = process.env.INTERNAL_SERVICE_TOKEN;
let activityModule: Record<string, any>;

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function requestBody(options: RequestInit | undefined): any {
  return JSON.parse(String(options?.body));
}

beforeAll(async () => {
  globalThis.fetch = mockFetch as unknown as typeof fetch;
  process.env.INTERNAL_SERVICE_TOKEN = 'internal-token';
  activityModule = await import('../mcp-invocation.activity').catch(() => ({}));
});

afterAll(() => {
  globalThis.fetch = originalFetch;
  if (originalInternalToken === undefined) {
    delete process.env.INTERNAL_SERVICE_TOKEN;
  } else {
    process.env.INTERNAL_SERVICE_TOKEN = originalInternalToken;
  }
});

beforeEach(() => {
  vi.clearAllMocks();
  process.env.INTERNAL_SERVICE_TOKEN = 'internal-token';
  runComponentActivity.mockResolvedValue({ output: { vulnerabilities: [] } });
});

function expectActivity(name: string): (...args: any[]) => Promise<any> {
  expect(typeof activityModule[name]).toBe('function');
  return activityModule[name];
}

describe('MCP invocation activities', () => {
  it('prepares through the internal API and strips the manifest from Workflow history', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ kind: 'prepared', ref, manifest }));

    const result = await expectActivity('prepareToolInvocationActivity')(request);

    expect(result).toEqual({ kind: 'prepared', ref });
    expect(result).not.toHaveProperty('manifest');
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/internal/mcp/invocations/prepare'),
      expect.objectContaining({
        method: 'POST',
        signal: cancellationSignal,
        headers: expect.objectContaining({ 'X-Internal-Token': 'internal-token' }),
      }),
    );
    expect(requestBody(mockFetch.mock.calls[0]?.[1])).toEqual({ request });
  });

  it('keeps claim context in activity memory and maps component dispatch inputs exactly once', async () => {
    mockFetch.mockImplementation(async (url: string, options?: RequestInit) => {
      if (url.endsWith('/claim')) {
        return jsonResponse({ kind: 'dispatch', context: claimContext });
      }
      if (url.endsWith('/complete')) {
        return jsonResponse(requestBody(options).result);
      }
      throw new Error(`Unexpected URL: ${url}`);
    });

    const result = await expectActivity('dispatchToolInvocationActivity')(ref);

    expect(result).toEqual(
      expect.objectContaining({
        invocationId: INVOCATION_ID,
        status: 'completed',
        output: { vulnerabilities: [] },
      }),
    );
    expect(JSON.stringify(result)).not.toContain('super-secret');
    expect(runComponentActivity).toHaveBeenCalledTimes(1);
    expect(runComponentActivity).toHaveBeenCalledWith({
      runId: 'run-123',
      workflowId: WORKFLOW_ID,
      workflowVersionId: WORKFLOW_VERSION_ID,
      organizationId: 'org-123',
      scopeId: SCOPE_ID,
      action: {
        ref: `tool-invocation:${INVOCATION_ID}`,
        componentId: 'security.osv',
      },
      inputs: { apiKey: 'super-secret', package: 'lodash' },
      params: { timeoutSeconds: 30 },
      inputOverrides: { apiKey: 'super-secret' },
      rawParams: { timeoutSeconds: 30 },
      metadata: { streamId: INVOCATION_ID },
    });
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('returns a terminal claim replay without executing or settling again', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ kind: 'terminal', result: completedResult }));

    await expect(expectActivity('dispatchToolInvocationActivity')(ref)).resolves.toEqual(
      completedResult,
    );
    expect(runComponentActivity).not.toHaveBeenCalled();
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('normalizes a successful top-level undefined output to JSON null before settlement', async () => {
    runComponentActivity.mockResolvedValueOnce({ output: undefined });
    mockFetch.mockImplementation(async (url: string, options?: RequestInit) => {
      if (url.endsWith('/claim')) {
        return jsonResponse({ kind: 'dispatch', context: claimContext });
      }
      return jsonResponse(requestBody(options).result);
    });

    const result = await expectActivity('dispatchToolInvocationActivity')(ref);

    expect(result.status).toBe('completed');
    expect(result.output).toBeNull();
    const settlement = mockFetch.mock.calls.find(([url]) => String(url).endsWith('/complete'));
    expect(requestBody(settlement?.[1]).result.output).toBeNull();
  });

  it('settles returned component failures as bounded remote-tool failures', async () => {
    runComponentActivity.mockResolvedValueOnce({
      output: { success: false, error: 'sensitive upstream response body' },
    });
    mockFetch.mockImplementation(async (url: string, options?: RequestInit) => {
      if (url.endsWith('/claim')) {
        return jsonResponse({ kind: 'dispatch', context: claimContext });
      }
      return jsonResponse(requestBody(options).result);
    });

    const result = await expectActivity('dispatchToolInvocationActivity')(ref);

    expect(result).toEqual(
      expect.objectContaining({
        invocationId: INVOCATION_ID,
        status: 'failed',
        error: {
          class: 'remote-tool',
          message: expect.any(String),
          retryable: false,
        },
      }),
    );
    expect(JSON.stringify(result)).not.toContain('sensitive upstream response body');
    expect(mockFetch.mock.calls.some(([url]) => String(url).endsWith('/fail'))).toBe(true);
  });

  it('settles oversized component output as a compact remote-tool failure', async () => {
    runComponentActivity.mockResolvedValueOnce({ output: { text: 'x'.repeat(1_048_576) } });
    mockFetch.mockImplementation(async (url: string, options?: RequestInit) => {
      if (url.endsWith('/claim')) {
        return jsonResponse({ kind: 'dispatch', context: claimContext });
      }
      return jsonResponse(requestBody(options).result);
    });

    const result = await expectActivity('dispatchToolInvocationActivity')(ref);

    expect(result.status).toBe('failed');
    expect(result.error.class).toBe('remote-tool');
    expect(JSON.stringify(result).length).toBeLessThan(10_000);
    const settlement = mockFetch.mock.calls.find(([url]) => String(url).endsWith('/fail'));
    expect(settlement).toBeDefined();
    expect(String(settlement?.[1]?.body).length).toBeLessThan(10_000);
  });

  it('lets execution and uncertain settlement failures escape without leaking response bodies', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ kind: 'dispatch', context: claimContext }));
    runComponentActivity.mockRejectedValueOnce(
      new Error('component execution failed with credential=super-secret'),
    );

    const executionError = await expectActivity('dispatchToolInvocationActivity')(ref).catch(
      (caught: unknown) => caught,
    );
    expect(executionError).toBeInstanceOf(Error);
    expect((executionError as Error).message).toBe('Component tool execution failed');
    expect((executionError as Error).message).not.toContain('super-secret');
    expect(mockFetch).toHaveBeenCalledTimes(1);

    vi.clearAllMocks();
    runComponentActivity.mockResolvedValueOnce({ output: { vulnerabilities: [] } });
    mockFetch
      .mockResolvedValueOnce(jsonResponse({ kind: 'dispatch', context: claimContext }))
      .mockResolvedValueOnce(new Response('secret backend response body', { status: 503 }));

    const error = await expectActivity('dispatchToolInvocationActivity')(ref).catch(
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(Error);
    expect(String((error as Error).message)).not.toContain('secret backend response body');
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('reconciles individual and run-wide invocation state through strict internal routes', async () => {
    mockFetch
      .mockResolvedValueOnce(jsonResponse(completedResult))
      .mockResolvedValueOnce(jsonResponse({ success: true }));
    const reconciliation = {
      ref,
      cause: 'failure' as const,
      message: 'Dispatch result was not confirmed',
      completedAt: '2099-07-31T10:00:03.000Z',
    };

    await expect(
      expectActivity('reconcileToolInvocationActivity')(reconciliation),
    ).resolves.toEqual(completedResult);
    await expect(
      expectActivity('reconcileRunToolInvocationsActivity')({
        runId: 'run-123',
        message: 'Workflow completed before invocation settlement',
        completedAt: '2099-07-31T10:00:04.000Z',
      }),
    ).resolves.toBeUndefined();

    expect(mockFetch.mock.calls.map(([url]) => String(url))).toEqual([
      expect.stringContaining('/api/v1/internal/mcp/invocations/reconcile'),
      expect.stringContaining('/api/v1/internal/mcp/invocations/reconcile-run'),
    ]);
    expect(heartbeat).toHaveBeenCalled();
  });
});
