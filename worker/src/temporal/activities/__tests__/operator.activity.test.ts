import { afterAll, beforeAll, beforeEach, describe, expect, mock, test, vi } from 'bun:test';

const heartbeat = vi.fn();
const cancellationSignal = new AbortController().signal;

mock.module('@temporalio/activity', () => ({
  Context: {
    current: vi.fn(() => ({ heartbeat, cancellationSignal })),
  },
}));

const fetchImpl = vi.fn();
const generateTextImpl = vi.fn();
const secretGet = vi.fn();
const forOrganization = vi.fn(() => ({ get: secretGet }));
const openAIModel = vi.fn((modelId: string) => ({ provider: 'openai', modelId }));
const createOpenAI = vi.fn(() => Object.assign(openAIModel, { chat: openAIModel }));
const createGoogleGenerativeAI = vi.fn(() => openAIModel);
const createAnthropic = vi.fn(() => openAIModel);

const originalInternalToken = process.env.INTERNAL_SERVICE_TOKEN;
let activities: typeof import('../operator.activity');

const SESSION_ID = '11111111-1111-4111-8111-111111111111';
const TURN_ID = '22222222-2222-4222-8222-222222222222';
const ORGANIZATION_ID = 'default-org';
const USER_ID = 'local-user';
const SECRET_ID = '55555555-5555-4555-8555-555555555555';
const WORKFLOW_ID = '66666666-6666-4666-8666-666666666666';
const ACTION_ID = '77777777-7777-4777-8777-777777777777';

const base = {
  sessionId: SESSION_ID,
  turnId: TURN_ID,
  organizationId: ORGANIZATION_ID,
};

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function requestBody(init?: RequestInit): any {
  return JSON.parse(String(init?.body));
}

beforeAll(async () => {
  process.env.INTERNAL_SERVICE_TOKEN = 'operator-internal-token';
  activities = await import('../operator.activity');
});

afterAll(() => {
  if (originalInternalToken === undefined) delete process.env.INTERNAL_SERVICE_TOKEN;
  else process.env.INTERNAL_SERVICE_TOKEN = originalInternalToken;
});

beforeEach(() => {
  vi.clearAllMocks();
  process.env.INTERNAL_SERVICE_TOKEN = 'operator-internal-token';
  secretGet.mockResolvedValue({ value: 'provider-secret', version: 1 });
  activities.initializeOperatorActivities({
    secrets: { forOrganization } as any,
    fetchImpl: fetchImpl as unknown as typeof fetch,
    generateTextImpl: generateTextImpl as any,
    modelFactories: {
      createOpenAI: createOpenAI as any,
      createGoogleGenerativeAI: createGoogleGenerativeAI as any,
      createAnthropic: createAnthropic as any,
    },
  });
});

describe('Operator activities', () => {
  test('loads org-scoped context and emits stable typed tool-call IDs for one model step', async () => {
    fetchImpl.mockResolvedValueOnce(
      jsonResponse({
        session: {
          id: SESSION_ID,
          title: 'Session',
          organizationId: ORGANIZATION_ID,
          userId: USER_ID,
          approvalMode: 'ask',
          status: 'active',
          model: {
            provider: 'openai',
            modelId: 'gpt-test',
            apiKeySecretId: SECRET_ID,
            baseUrl: null,
          },
          createdAt: '2026-08-02T00:00:00.000Z',
          updatedAt: '2026-08-02T00:00:00.000Z',
        },
        turn: {
          id: TURN_ID,
          sessionId: SESSION_ID,
          status: 'running',
          context: { path: `/workflows/${WORKFLOW_ID}`, workflowId: WORKFLOW_ID },
        },
        messages: [{ role: 'user', content: 'Run this workflow' }],
        actions: [],
      }),
    );
    generateTextImpl.mockResolvedValue({
      text: '',
      finishReason: 'tool-calls',
      toolCalls: [
        {
          toolCallId: 'provider-generated-id',
          toolName: 'run_workflow',
          input: { workflowId: WORKFLOW_ID },
          providerMetadata: {
            google: { thoughtSignature: 'signed-provider-thought' },
          },
        },
        {
          toolCallId: 'provider-invalid-id',
          toolName: 'cancel_run',
          input: {},
        },
      ],
    });

    const result = await activities.operatorModelStepActivity({ ...base, step: 2 });

    expect(forOrganization).toHaveBeenCalledWith(ORGANIZATION_ID);
    expect(secretGet).toHaveBeenCalledWith(SECRET_ID);
    expect(result.toolCalls).toEqual([
      {
        toolCallId: `${TURN_ID}:2:0`,
        modelToolCallId: 'provider-generated-id',
        providerOptions: {
          google: { thoughtSignature: 'signed-provider-thought' },
        },
        commandName: 'run_workflow',
        arguments: { workflowId: WORKFLOW_ID },
      },
      {
        toolCallId: `${TURN_ID}:2:1`,
        modelToolCallId: 'provider-invalid-id',
        commandName: 'cancel_run',
        arguments: {},
      },
    ]);
    expect(String(fetchImpl.mock.calls[0]?.[0])).toEndWith(
      `/api/v1/operator/internal/turns/${TURN_ID}/context`,
    );
    expect(fetchImpl.mock.calls[0]?.[1]?.headers).toMatchObject({
      'X-Internal-Token': 'operator-internal-token',
      'X-Organization-Id': ORGANIZATION_ID,
    });
    expect(generateTextImpl).toHaveBeenCalledTimes(1);
    expect(String(generateTextImpl.mock.calls[0]?.[0]?.system)).toContain(
      'inspect the same workflow version with get_workflow',
    );
    expect(String(generateTextImpl.mock.calls[0]?.[0]?.system)).toContain(
      'call propose_workflow_edits with only the smallest ID-based operations',
    );
    expect(String(generateTextImpl.mock.calls[0]?.[0]?.system)).toContain(
      'use operation patch_node with nodeId and setParameters and/or setInputOverrides',
    );
    expect(generateTextImpl.mock.calls[0]?.[0]?.tools).toHaveProperty('propose_workflow_edits');
    expect(String(generateTextImpl.mock.calls[0]?.[0]?.system)).toContain(
      'get_run returns bounded failed/recent trace evidence and run-scoped findings',
    );
    expect(String(generateTextImpl.mock.calls[0]?.[0]?.system)).toContain(
      'only for an evidence-supported graph or component-configuration defect',
    );
    expect(String(generateTextImpl.mock.calls[0]?.[0]?.system)).toContain(
      'do not weaken a valid workflow contract by adding aliases',
    );
    expect(String(generateTextImpl.mock.calls[0]?.[0]?.system)).toContain(
      'Include sourceRunId on an update proposal derived from a run',
    );
    expect(String(generateTextImpl.mock.calls[0]?.[0]?.system)).toContain(
      'call run_workflow with sourceRunId only when the user explicitly requests',
    );
  });

  test('recovers a provider-declared tool generation error with a text-only diagnosis', async () => {
    fetchImpl.mockResolvedValueOnce(
      jsonResponse({
        session: {
          id: SESSION_ID,
          title: 'Session',
          organizationId: ORGANIZATION_ID,
          userId: USER_ID,
          approvalMode: 'ask',
          status: 'active',
          model: {
            provider: 'openai',
            modelId: 'gpt-test',
            apiKeySecretId: SECRET_ID,
            baseUrl: null,
          },
          createdAt: '2026-08-02T00:00:00.000Z',
          updatedAt: '2026-08-02T00:00:00.000Z',
        },
        turn: {
          id: TURN_ID,
          sessionId: SESSION_ID,
          status: 'running',
          context: null,
        },
        messages: [{ role: 'user', content: 'Review the failed run' }],
        actions: [
          {
            id: ACTION_ID,
            toolCallId: `${TURN_ID}:1:0`,
            commandName: 'get_run',
            status: 'succeeded',
            arguments: { runId: 'failed-run' },
            result: {
              status: 'FAILED',
              failedTraceEvents: [
                {
                  error:
                    "Required runtime input 'npm package and optional version' (packageSpec) was not provided",
                },
              ],
            },
            error: null,
            runId: 'failed-run',
          },
        ],
      }),
    );
    generateTextImpl
      .mockResolvedValueOnce({
        text: '',
        finishReason: 'error',
        rawFinishReason: 'MALFORMED_FUNCTION_CALL',
        toolCalls: [],
      })
      .mockResolvedValueOnce({
        text: 'The run failed because the required packageSpec input was missing.',
        finishReason: 'stop',
        toolCalls: [],
      });

    const result = await activities.operatorModelStepActivity({
      ...base,
      step: 2,
      toolCallHistory: [
        {
          toolCallId: `${TURN_ID}:1:0`,
          modelToolCallId: 'provider-get-run-id',
          commandName: 'get_run',
          arguments: { runId: 'failed-run' },
        },
      ],
    });

    expect(result).toEqual({
      text: expect.stringContaining('required packageSpec input was missing'),
      finishReason: 'stop',
      toolCalls: [],
    });
    expect(result.text).toContain(
      'No workflow draft was proposed or applied by this recovery response.',
    );
    expect(generateTextImpl).toHaveBeenCalledTimes(2);
    expect(generateTextImpl.mock.calls[1]?.[0]).not.toHaveProperty('tools');
    expect(generateTextImpl.mock.calls[1]?.[0]).not.toHaveProperty('toolChoice');
    expect(String(generateTextImpl.mock.calls[1]?.[0]?.system)).toContain(
      'text-only recovery response',
    );
    const recoveryMessages = generateTextImpl.mock.calls[1]?.[0]?.messages;
    expect(recoveryMessages).toHaveLength(1);
    expect(recoveryMessages?.[0]).toMatchObject({ role: 'user' });
    expect(String(recoveryMessages?.[0]?.content)).toContain('packageSpec');
    expect(JSON.stringify(recoveryMessages)).not.toContain('tool-call');
    expect(JSON.stringify(recoveryMessages)).not.toContain('tool-result');
  });

  test('fails the activity when the text-only recovery also returns a provider error', async () => {
    fetchImpl.mockResolvedValueOnce(
      jsonResponse({
        session: {
          id: SESSION_ID,
          title: 'Session',
          organizationId: ORGANIZATION_ID,
          userId: USER_ID,
          approvalMode: 'ask',
          status: 'active',
          model: {
            provider: 'openai',
            modelId: 'gpt-test',
            apiKeySecretId: SECRET_ID,
            baseUrl: null,
          },
          createdAt: '2026-08-02T00:00:00.000Z',
          updatedAt: '2026-08-02T00:00:00.000Z',
        },
        turn: {
          id: TURN_ID,
          sessionId: SESSION_ID,
          status: 'running',
          context: null,
        },
        messages: [{ role: 'user', content: 'Review the failed run' }],
        actions: [],
      }),
    );
    generateTextImpl
      .mockResolvedValueOnce({ text: '', finishReason: 'error', toolCalls: [] })
      .mockResolvedValueOnce({
        text: '',
        finishReason: 'error',
        rawFinishReason: 'RECOVERY_FAILED',
        toolCalls: [],
      });

    await expect(activities.operatorModelStepActivity({ ...base, step: 2 })).rejects.toThrow(
      'Operator model generation failed (RECOVERY_FAILED)',
    );
  });

  test('replays durable command results as native AI SDK tool history', async () => {
    const toolCallId = `${TURN_ID}:0:0`;
    const catalog = {
      capabilitySnapshotId: 'snapshot-1',
      sourceId: 'server-1',
      tools: [{ name: 'echo', inputSchema: { type: 'object' } }],
    };
    fetchImpl.mockResolvedValueOnce(
      jsonResponse({
        session: {
          id: SESSION_ID,
          title: 'Session',
          organizationId: ORGANIZATION_ID,
          userId: USER_ID,
          approvalMode: 'ask',
          status: 'active',
          model: {
            provider: 'openai',
            modelId: 'gpt-test',
            apiKeySecretId: SECRET_ID,
            baseUrl: null,
          },
          createdAt: '2026-08-02T00:00:00.000Z',
          updatedAt: '2026-08-02T00:00:00.000Z',
        },
        turn: {
          id: TURN_ID,
          sessionId: SESSION_ID,
          status: 'running',
          context: null,
        },
        messages: [{ role: 'user', content: 'List the MCP capabilities' }],
        actions: [
          {
            id: ACTION_ID,
            toolCallId,
            commandName: 'list_mcp_capabilities',
            status: 'succeeded',
            arguments: { serverId: 'server-1' },
            result: catalog,
            error: null,
            runId: null,
          },
        ],
      }),
    );
    generateTextImpl.mockResolvedValue({
      text: 'The server exposes the echo tool.',
      finishReason: 'stop',
      toolCalls: [],
    });

    await activities.operatorModelStepActivity({
      ...base,
      step: 1,
      toolCallHistory: [
        {
          toolCallId,
          modelToolCallId: 'provider-catalog-call',
          providerOptions: {
            google: { thoughtSignature: 'signed-catalog-thought' },
          },
          commandName: 'list_mcp_capabilities',
          arguments: { serverId: 'server-1' },
        },
      ],
    });

    const generation = generateTextImpl.mock.calls[0]?.[0];
    expect(generation.messages).toEqual([
      { role: 'user', content: 'List the MCP capabilities' },
      {
        role: 'assistant',
        content: [
          {
            type: 'tool-call',
            toolCallId: 'provider-catalog-call',
            toolName: 'list_mcp_capabilities',
            input: { serverId: 'server-1' },
            providerOptions: {
              google: { thoughtSignature: 'signed-catalog-thought' },
            },
          },
        ],
      },
      {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: 'provider-catalog-call',
            toolName: 'list_mcp_capabilities',
            output: { type: 'json', value: catalog },
          },
        ],
      },
    ]);
    expect(String(generation.system)).not.toContain('capabilitySnapshotId');
  });

  test('uses a plain durable observation for pre-upgrade tool history without provider call data', async () => {
    const toolCallId = `${TURN_ID}:0:0`;
    fetchImpl.mockResolvedValueOnce(
      jsonResponse({
        session: {
          id: SESSION_ID,
          title: 'Session',
          organizationId: ORGANIZATION_ID,
          userId: USER_ID,
          approvalMode: 'ask',
          status: 'active',
          model: {
            provider: 'openai',
            modelId: 'gpt-test',
            apiKeySecretId: SECRET_ID,
            baseUrl: null,
          },
          createdAt: '2026-08-02T00:00:00.000Z',
          updatedAt: '2026-08-02T00:00:00.000Z',
        },
        turn: { id: TURN_ID, sessionId: SESSION_ID, status: 'running', context: null },
        messages: [{ role: 'user', content: 'List the MCP capabilities' }],
        actions: [
          {
            id: ACTION_ID,
            toolCallId,
            commandName: 'list_mcp_capabilities',
            status: 'succeeded',
            arguments: { serverId: 'server-1' },
            result: { tools: [{ name: 'echo' }] },
            error: null,
            runId: null,
          },
        ],
      }),
    );
    generateTextImpl.mockResolvedValue({
      text: 'The server exposes the echo tool.',
      finishReason: 'stop',
      toolCalls: [],
    });

    await activities.operatorModelStepActivity({
      ...base,
      step: 1,
      toolCallHistory: [
        {
          toolCallId,
          modelToolCallId: 'provider-call-without-continuation-metadata',
          commandName: 'list_mcp_capabilities',
          arguments: { serverId: 'server-1' },
        },
      ],
    });

    const messages = generateTextImpl.mock.calls[0]?.[0].messages;
    expect(messages).toHaveLength(2);
    expect(messages[1]).toMatchObject({
      role: 'user',
      content: expect.stringContaining('Durable Operator action observation'),
    });
    expect(JSON.stringify(messages)).not.toContain('"type":"tool-call"');
  });

  test('uses canonical prepare and execute endpoints with organization-bound payloads', async () => {
    fetchImpl
      .mockResolvedValueOnce(
        jsonResponse({
          action: { id: ACTION_ID, version: 4, status: 'pending_approval' },
          disposition: 'wait_for_approval',
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          action: { id: ACTION_ID },
          result: { runId: 'sentris-run-1' },
          launchedRunId: 'sentris-run-1',
        }),
      );

    const prepared = await activities.operatorPrepareActionActivity({
      ...base,
      toolCallId: `${TURN_ID}:0:0`,
      commandName: 'cancel_run',
      arguments: { runId: 'sentris-run-1' },
    });
    const executed = await activities.operatorExecuteActionActivity({
      ...base,
      actionId: ACTION_ID,
    });

    expect(prepared).toEqual({
      actionId: ACTION_ID,
      actionVersion: 4,
      disposition: 'wait_for_approval',
    });
    expect(requestBody(fetchImpl.mock.calls[0]?.[1])).toEqual({
      organizationId: ORGANIZATION_ID,
      toolCallId: `${TURN_ID}:0:0`,
      commandName: 'cancel_run',
      arguments: { runId: 'sentris-run-1' },
    });
    expect(String(fetchImpl.mock.calls[1]?.[0])).toEndWith(
      `/api/v1/operator/internal/actions/${ACTION_ID}/execute`,
    );
    expect(requestBody(fetchImpl.mock.calls[1]?.[1])).toEqual({
      organizationId: ORGANIZATION_ID,
    });
    expect(executed.launchedRunId).toBe('sentris-run-1');
  });

  test('keeps heartbeating while a long internal action request is in flight', async () => {
    let resolveFetch!: (response: Response) => void;
    fetchImpl.mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve;
        }),
    );
    const timer = { unref: vi.fn() } as unknown as ReturnType<typeof setInterval>;
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval').mockImplementation(((
      callback: () => void,
    ) => {
      callback();
      return timer;
    }) as typeof setInterval);
    const clearIntervalSpy = vi
      .spyOn(globalThis, 'clearInterval')
      .mockImplementation(() => undefined);

    try {
      const executing = activities.operatorExecuteActionActivity({
        ...base,
        actionId: ACTION_ID,
      });

      expect(heartbeat).toHaveBeenCalledWith(
        `operator:operator/internal/actions/${ACTION_ID}/execute:request`,
      );
      expect(heartbeat).toHaveBeenCalledWith(
        `operator:operator/internal/actions/${ACTION_ID}/execute:waiting`,
      );
      resolveFetch(
        jsonResponse({
          action: { id: ACTION_ID },
          result: { inspected: true },
        }),
      );

      await expect(executing).resolves.toEqual({
        actionId: ACTION_ID,
        result: { inspected: true },
      });
      expect(timer.unref).toHaveBeenCalledTimes(1);
      expect(clearIntervalSpy).toHaveBeenCalledWith(timer);
    } finally {
      setIntervalSpy.mockRestore();
      clearIntervalSpy.mockRestore();
    }
  });

  test('returns a terminal run observation without mutating or cancelling the launched run', async () => {
    fetchImpl.mockResolvedValueOnce(
      jsonResponse({
        runId: 'sentris-run-2',
        workflowId: WORKFLOW_ID,
        status: 'COMPLETED',
        terminal: true,
        result: { findings: 2 },
      }),
    );

    const observation = await activities.operatorObserveRunActivity({
      ...base,
      runId: 'sentris-run-2',
    });

    expect(observation).toEqual({
      runId: 'sentris-run-2',
      workflowId: WORKFLOW_ID,
      status: 'COMPLETED',
      terminal: true,
      result: { findings: 2 },
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(String(fetchImpl.mock.calls[0]?.[0])).toEndWith(
      `/api/v1/operator/internal/runs/sentris-run-2/observation?turnId=${TURN_ID}`,
    );
    expect(fetchImpl.mock.calls[0]?.[1]?.method).toBe('GET');
  });

  test('preserves a deferred MCP request and posts its terminal result to settlement', async () => {
    const request = {
      invocationId: ACTION_ID,
      scope: {
        kind: 'operator' as const,
        organizationId: ORGANIZATION_ID,
        sessionId: SESSION_ID,
        turnId: TURN_ID,
        capabilityGrantId: '88888888-8888-4888-8888-888888888888',
        expiresAt: '2099-08-02T11:00:00.000Z',
      },
      capabilitySnapshotId: '99999999-9999-4999-8999-999999999999',
      sourceId: 'saved-server-1',
      authorizationTarget: 'search',
      operation: { kind: 'tool-call' as const, name: 'search', arguments: {} },
      requestedAt: '2099-08-02T10:00:00.000Z',
      deadlineAt: '2099-08-02T10:10:00.000Z',
    };
    const result = {
      operationId: ACTION_ID,
      kind: 'completed' as const,
      output: { matches: 1 },
      completedAt: '2099-08-02T10:00:02.000Z',
    };
    fetchImpl
      .mockResolvedValueOnce(
        jsonResponse({
          action: { id: ACTION_ID },
          result: { kind: 'mcp-operation', state: 'ready_for_dispatch' },
          mcpOperationRequest: request,
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ id: ACTION_ID, status: 'succeeded' }));

    const executed = await activities.operatorExecuteActionActivity({
      ...base,
      actionId: ACTION_ID,
    });
    await activities.operatorSettleMcpActionActivity({
      ...base,
      actionId: ACTION_ID,
      result,
    });

    expect(executed.mcpOperationRequest).toEqual(request);
    expect(String(fetchImpl.mock.calls[1]?.[0])).toEndWith(
      `/api/v1/operator/internal/actions/${ACTION_ID}/mcp/settle`,
    );
    expect(requestBody(fetchImpl.mock.calls[1]?.[1])).toEqual({
      organizationId: ORGANIZATION_ID,
      result,
    });
  });
});
