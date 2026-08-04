import { beforeAll, beforeEach, describe, expect, mock, test, vi } from 'bun:test';
import { NotFoundError, ValidationError } from '@sentris/component-sdk';

const heartbeat = vi.fn();
const cancellationSignal = new AbortController().signal;

mock.module('@temporalio/activity', () => ({
  Context: {
    current: () => ({
      info: { activityId: 'workflow-agent-test', attempt: 1 },
      heartbeat,
      cancellationSignal,
    }),
  },
}));

let agentActivities: typeof import('../workflow-agent.activity');
let componentActivities: typeof import('../run-component.activity');

const ROOT_ID = '11111111-1111-4111-8111-111111111111';
const MODEL_ID = '22222222-2222-4222-8222-222222222222';
const TOOL_STATE_ID = '33333333-3333-4333-8333-333333333333';
const RESULT_ID = '44444444-4444-4444-8444-444444444444';
const OUTPUT_ID = '55555555-5555-4555-8555-555555555555';

const input = {
  agentRunId: 'run-1:agent-1:turn-1',
  component: {
    runId: 'run-1',
    workflowId: 'workflow-1',
    organizationId: 'org-1',
    action: { ref: 'agent-1', componentId: 'core.ai.agent' },
    inputs: {
      userInput: 'Investigate the package',
      chatModel: {
        provider: 'gemini',
        modelId: 'gemini-test',
        apiKeySecretId: 'provider-secret-id',
      },
    },
    params: {},
    inputOverrides: {},
  },
};

function createStorage() {
  const files = new Map<string, Buffer>();
  const scoped = {
    forOrganization: vi.fn(),
    downloadFile: vi.fn(async (fileId: string) => {
      const buffer = files.get(fileId);
      if (!buffer) {
        throw new NotFoundError(`File not found: ${fileId}`, {
          resourceType: 'file',
          resourceId: fileId,
        });
      }
      return {
        buffer,
        metadata: {
          id: fileId,
          fileName: 'state.json',
          mimeType: 'application/json',
          size: buffer.length,
        },
      };
    }),
    getFileMetadata: vi.fn(),
    uploadFile: vi.fn(async (fileId: string, _name: string, buffer: Buffer) => {
      files.set(fileId, Buffer.from(buffer));
    }),
  };
  scoped.forOrganization.mockReturnValue(scoped);
  return { ...scoped, files };
}

function parseStored(storage: ReturnType<typeof createStorage>, fileId: string): any {
  return JSON.parse(storage.files.get(fileId)!.toString('utf8'));
}

beforeAll(async () => {
  agentActivities = await import('../workflow-agent.activity');
  componentActivities = await import('../run-component.activity');
});

describe('workflow Agent activities', () => {
  let storage: ReturnType<typeof createStorage>;
  let nodeIO: { recordStart: ReturnType<typeof vi.fn>; recordCompletion: ReturnType<typeof vi.fn> };
  let trace: { record: ReturnType<typeof vi.fn> };
  let agentTracePublisher: { publish: ReturnType<typeof vi.fn> };
  let secretGet: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.SECRET_STORE_MASTER_KEY = '12345678901234567890123456789012';
    delete process.env.INTERNAL_SERVICE_TOKEN;
    storage = createStorage();
    nodeIO = {
      recordStart: vi.fn(async () => undefined),
      recordCompletion: vi.fn(async () => undefined),
    };
    trace = { record: vi.fn(async () => undefined) };
    agentTracePublisher = { publish: vi.fn(async () => undefined) };
    secretGet = vi.fn(async () => ({ value: 'provider-api-key', version: 1 }));
    const secrets = {
      forOrganization: vi.fn(() => ({ get: secretGet, list: vi.fn() })),
      get: vi.fn(),
      list: vi.fn(),
    };
    componentActivities.resetComponentActivityServices();
    componentActivities.initializeComponentActivityServices({
      storage: storage as any,
      secrets: secrets as any,
      trace: trace as any,
      nodeIO: nodeIO as any,
      agentTracePublisher: agentTracePublisher as any,
    });
    agentActivities.initializeWorkflowAgentActivityOverrides();
  });

  test('persists a secret-free root checkpoint and native provider continuation messages', async () => {
    const setup = await agentActivities.workflowAgentSetupActivity({
      ...input,
      initialStateFileId: ROOT_ID,
    });
    const root = parseStored(storage, ROOT_ID);
    expect(root.credential).toEqual({ kind: 'secret', secretId: 'provider-secret-id' });
    expect(JSON.stringify(root)).not.toContain('provider-api-key');
    expect(setup.toolStatus).toEqual({
      requested: false,
      status: 'not-requested',
      connectedNodeCount: 0,
    });
    expect(setup.modelActivityTimeout).toBe('45 minutes');

    root.tools = [
      {
        canonicalName: 'npm_lookup',
        displayName: 'NPM lookup',
        description: 'Look up package metadata',
        inputSchema: {
          type: 'object',
          properties: { packageName: { type: 'string' } },
          required: ['packageName'],
        },
        source: {
          kind: 'mcp',
          sourceId: 'saved-npm-server',
          upstreamName: 'lookup',
          bindingFingerprint: 'a'.repeat(64),
        },
        effects: 'read-only',
        effectsSource: 'mcp-annotation',
        retryPolicy: 'pre-dispatch-only',
      },
    ];
    storage.files.set(ROOT_ID, Buffer.from(JSON.stringify(root)));

    const providerMessages = [
      {
        role: 'assistant' as const,
        content: [
          {
            type: 'tool-call' as const,
            toolCallId: 'provider-call-1',
            toolName: 'npm_lookup',
            input: { packageName: 'minimatch' },
            providerOptions: {
              google: { thoughtSignature: 'signed-provider-thought' },
            },
          },
        ],
      },
    ];
    const streamTextImpl = vi.fn(() => ({
      fullStream: (async function* () {
        yield { type: 'text-delta' as const, text: 'Checking package metadata' };
      })(),
      text: Promise.resolve('Checking package metadata'),
      finishReason: Promise.resolve('tool-calls'),
      response: Promise.resolve({ messages: providerMessages }),
      toolCalls: Promise.resolve([
        {
          toolCallId: 'provider-call-1',
          toolName: 'npm_lookup',
          input: { packageName: 'minimatch' },
        },
      ]),
    }));
    const model = vi.fn(() => ({ provider: 'gemini', modelId: 'gemini-test' }));
    agentActivities.initializeWorkflowAgentActivityOverrides({
      streamTextImpl: streamTextImpl as any,
      modelFactories: {
        createOpenAI: vi.fn() as any,
        createAnthropic: vi.fn() as any,
        createGoogleGenerativeAI: vi.fn(() => model) as any,
      },
    });

    const modelStep = await agentActivities.workflowAgentModelStepActivity({
      ...input,
      state: setup.state,
      outputStateFileId: MODEL_ID,
      step: 0,
    });

    expect(secretGet).toHaveBeenCalledWith('provider-secret-id');
    expect(modelStep).toEqual({
      state: { fileId: MODEL_ID, rootFileId: ROOT_ID },
      finishReason: 'tool-calls',
      toolCalls: [{ modelToolCallId: 'provider-call-1', toolName: 'npm_lookup' }],
    });
    expect(modelStep).not.toHaveProperty('responseText');
    const modelDelta = parseStored(storage, MODEL_ID);
    expect(modelDelta.messages).toEqual(providerMessages);
    expect(modelDelta.toolCalls[0].arguments).toEqual({ packageName: 'minimatch' });

    storage.files.set(
      RESULT_ID,
      Buffer.from(
        JSON.stringify({
          operationId: '66666666-6666-4666-8666-666666666666',
          kind: 'completed',
          output: { versions: ['1.0.0'] },
          completedAt: '2026-08-02T10:00:00.000Z',
        }),
      ),
    );
    const checkpoint = await agentActivities.workflowAgentCheckpointActivity({
      ...input,
      state: modelStep.state,
      outputStateFileId: TOOL_STATE_ID,
      step: 0,
      executions: [{ resultFileId: RESULT_ID, kind: 'completed' }],
    });
    expect(checkpoint).toEqual({ fileId: TOOL_STATE_ID, rootFileId: ROOT_ID });
    expect(parseStored(storage, TOOL_STATE_ID).messages).toEqual([
      {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: 'provider-call-1',
            toolName: 'npm_lookup',
            output: { type: 'json', value: { versions: ['1.0.0'] } },
          },
        ],
      },
    ]);

    const finalized = await agentActivities.workflowAgentFinalizeActivity({
      ...input,
      state: checkpoint,
      toolStatus: setup.toolStatus,
      outputFileId: OUTPUT_ID,
    });
    expect(finalized.output).toMatchObject({
      responseText: 'Checking package metadata',
      agentRunId: input.agentRunId,
      conversationState: { sessionId: expect.any(String) },
    });
    expect(JSON.stringify(finalized.output)).toContain('signed-provider-thought');
    expect(nodeIO.recordStart).toHaveBeenCalledTimes(1);
    expect(nodeIO.recordCompletion).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'completed' }),
    );
    expect(agentTracePublisher.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        eventId: `${input.agentRunId}:90000000`,
        part: expect.objectContaining({ type: 'finish' }),
      }),
    );
  });

  test('turns resource and prompt-only MCP authority into durable model operations', async () => {
    const sourceId = 'mcp-node';
    const grantId = '66666666-6666-4666-8666-666666666666';
    const snapshotId = '77777777-7777-4777-8777-777777777777';
    const authority = {
      grant: {
        id: grantId,
        organizationId: 'org-1',
        subject: { kind: 'run', runId: 'run-1' },
        sources: [{ sourceId, toolAccess: { mode: 'all' } }],
        createdAt: '2026-08-04T10:00:00.000Z',
      },
      snapshot: {
        id: snapshotId,
        scope: {
          kind: 'run',
          runId: 'run-1',
          organizationId: 'org-1',
          invokingNodeId: 'agent-1',
          capabilityGrantId: grantId,
        },
        version: '2',
        configFingerprint: 'a'.repeat(64),
        runtimeBindings: {
          [sourceId]: {
            runtimeKey: {
              sourceId: 'saved-server',
              transport: 'stdio',
              configFingerprint: 'b'.repeat(64),
              organizationId: 'org-1',
              principalPartitionHash: 'c'.repeat(64),
              credentialReference: 'mcp-server:saved-server',
              credentialGeneration: 1,
            },
            protocolEra: 'modern',
            protocolVersion: '2026-07-28',
            capabilityFingerprint: 'd'.repeat(64),
          },
        },
        tools: [],
        resources: [
          {
            sourceId,
            uri: 'fixture://report',
            name: 'Latest report',
            description: 'Current investigation report',
          },
        ],
        resourceTemplates: [
          {
            sourceId,
            uriTemplate: 'fixture://reports/{id}',
            name: 'Report by ID',
          },
        ],
        prompts: [
          {
            sourceId,
            name: 'summarize_report',
            description: 'Prepare a report summary',
            arguments: [{ name: 'reportId', required: true }],
          },
        ],
        createdAt: '2026-08-04T10:00:00.000Z',
      },
      manifest: {
        capabilitySnapshotId: snapshotId,
        capabilityGrantId: grantId,
        version: '2',
        entries: [
          {
            operationKind: 'resource-read',
            operationTarget: 'fixture://report',
            sourceId,
            destination: 'mcp-activity',
            retryPolicy: 'reviewed-idempotent',
          },
          {
            operationKind: 'resource-read',
            operationTarget: 'fixture://reports/{id}',
            sourceId,
            destination: 'mcp-activity',
            retryPolicy: 'reviewed-idempotent',
          },
          {
            operationKind: 'prompt-get',
            operationTarget: 'summarize_report',
            sourceId,
            destination: 'mcp-activity',
            retryPolicy: 'reviewed-idempotent',
          },
        ],
      },
    };
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify(authority), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    );
    const streamTextImpl = vi.fn((options: { tools: Record<string, unknown> }) => {
      const names = Object.keys(options.tools);
      const exactResource = names.find((name) => name.includes('read_resource_Latest_report'))!;
      const templatedResource = names.find((name) => name.includes('read_resource_Report_by_ID'))!;
      const prompt = names.find((name) => name.includes('get_prompt_summarize_report'))!;
      const toolCalls = [
        { toolCallId: 'resource-call', toolName: exactResource, input: {} },
        {
          toolCallId: 'template-call',
          toolName: templatedResource,
          input: { uri: 'fixture://reports/42' },
        },
        {
          toolCallId: 'prompt-call',
          toolName: prompt,
          input: { reportId: '42' },
        },
      ];
      return {
        fullStream: (async function* () {})(),
        text: Promise.resolve(''),
        finishReason: Promise.resolve('tool-calls'),
        response: Promise.resolve({
          messages: [
            {
              role: 'assistant',
              content: toolCalls.map((call) => ({ type: 'tool-call', ...call })),
            },
          ],
        }),
        toolCalls: Promise.resolve(toolCalls),
      };
    });
    const model = vi.fn(() => ({ provider: 'gemini', modelId: 'gemini-test' }));
    process.env.INTERNAL_SERVICE_TOKEN = 'internal-token';
    agentActivities.initializeWorkflowAgentActivityOverrides({
      fetchImpl: fetchImpl as any,
      streamTextImpl: streamTextImpl as any,
      modelFactories: {
        createOpenAI: vi.fn() as any,
        createAnthropic: vi.fn() as any,
        createGoogleGenerativeAI: vi.fn(() => model) as any,
      },
    });

    const setup = await agentActivities.workflowAgentSetupActivity({
      ...input,
      component: {
        ...input.component,
        metadata: { connectedToolNodeIds: [sourceId] },
      },
      initialStateFileId: ROOT_ID,
    });
    expect(setup.toolStatus).toEqual({
      requested: true,
      status: 'configured',
      connectedNodeCount: 1,
      availableToolCount: 0,
      availableResourceCount: 2,
      availablePromptCount: 1,
    });

    await agentActivities.workflowAgentModelStepActivity({
      ...input,
      state: setup.state,
      outputStateFileId: MODEL_ID,
      step: 0,
    });

    expect(parseStored(storage, MODEL_ID).toolCalls).toEqual([
      expect.objectContaining({
        sourceId,
        authorizationTarget: 'fixture://report',
        operation: { kind: 'resource-read', uri: 'fixture://report' },
      }),
      expect.objectContaining({
        sourceId,
        authorizationTarget: 'fixture://reports/{id}',
        operation: { kind: 'resource-read', uri: 'fixture://reports/42' },
      }),
      expect.objectContaining({
        sourceId,
        authorizationTarget: 'summarize_report',
        operation: {
          kind: 'prompt-get',
          name: 'summarize_report',
          arguments: { reportId: '42' },
        },
      }),
    ]);
  });

  test('rejects a provider-declared model error before checkpointing model state', async () => {
    const setup = await agentActivities.workflowAgentSetupActivity({
      ...input,
      initialStateFileId: ROOT_ID,
    });
    const streamTextImpl = vi.fn(() => ({
      fullStream: (async function* () {})(),
      text: Promise.resolve(''),
      finishReason: Promise.resolve('error'),
      rawFinishReason: Promise.resolve('MALFORMED_FUNCTION_CALL'),
      response: Promise.resolve({ messages: [] }),
      toolCalls: Promise.resolve([]),
    }));
    const model = vi.fn(() => ({ provider: 'gemini', modelId: 'gemini-test' }));
    agentActivities.initializeWorkflowAgentActivityOverrides({
      streamTextImpl: streamTextImpl as any,
      modelFactories: {
        createOpenAI: vi.fn() as any,
        createAnthropic: vi.fn() as any,
        createGoogleGenerativeAI: vi.fn(() => model) as any,
      },
    });

    await expect(
      agentActivities.workflowAgentModelStepActivity({
        ...input,
        state: setup.state,
        outputStateFileId: MODEL_ID,
        step: 0,
      }),
    ).rejects.toThrow('MALFORMED_FUNCTION_CALL');

    expect(storage.files.has(MODEL_ID)).toBe(false);
    expect(storage.uploadFile).toHaveBeenCalledTimes(2);
    expect(
      agentTracePublisher.publish.mock.calls.some(
        ([event]) => event.part.type === 'tool-input-available',
      ),
    ).toBe(false);
  });

  test('reuses a completed setup checkpoint without redelivering its start events', async () => {
    const first = await agentActivities.workflowAgentSetupActivity({
      ...input,
      initialStateFileId: ROOT_ID,
    });
    const second = await agentActivities.workflowAgentSetupActivity({
      ...input,
      initialStateFileId: ROOT_ID,
    });

    expect(second).toEqual(first);
    expect(storage.uploadFile).toHaveBeenCalledTimes(2);
    expect(nodeIO.recordStart).toHaveBeenCalledTimes(1);
    expect(
      trace.record.mock.calls
        .map(([event]) => event.eventId)
        .filter(
          (eventId) =>
            eventId === `trace:${input.component.runId}:workflow-agent:${input.agentRunId}:started`,
        ),
    ).toHaveLength(1);
  });

  test.each([
    ['fast', '66666666-6666-4666-8666-666666666666', '10 minutes'],
    ['deep', '77777777-7777-4777-8777-777777777777', '135 minutes'],
  ] as const)(
    'carries the resolved %s model timeout in durable setup state',
    async (executionProfile, initialStateFileId, expectedTimeout) => {
      const setup = await agentActivities.workflowAgentSetupActivity({
        ...input,
        component: {
          ...input.component,
          params: { executionProfile },
        },
        initialStateFileId,
      });

      expect(setup.modelActivityTimeout).toBe(expectedTimeout);
      expect(parseStored(storage, initialStateFileId).modelActivityTimeout).toBe(expectedTimeout);
    },
  );

  test('redelivers start events when setup was persisted before delivery completed', async () => {
    await agentActivities.workflowAgentSetupActivity({
      ...input,
      initialStateFileId: ROOT_ID,
    });
    const interruptedRoot = parseStored(storage, ROOT_ID);
    interruptedRoot.startDeliveryCompleted = false;
    storage.files.set(ROOT_ID, Buffer.from(JSON.stringify(interruptedRoot)));
    nodeIO.recordStart.mockClear();
    trace.record.mockClear();

    await agentActivities.workflowAgentSetupActivity({
      ...input,
      initialStateFileId: ROOT_ID,
    });

    expect(nodeIO.recordStart).toHaveBeenCalledTimes(1);
    expect(parseStored(storage, ROOT_ID).startDeliveryCompleted).toBe(true);
  });

  test('seals an inline provider key before persisting durable state', async () => {
    const rawApiKey = 'inline-provider-key-that-must-not-be-stored';
    await agentActivities.workflowAgentSetupActivity({
      ...input,
      component: {
        ...input.component,
        inputs: {
          ...input.component.inputs,
          chatModel: {
            provider: 'gemini',
            modelId: 'gemini-test',
            apiKey: rawApiKey,
          },
        },
      },
      initialStateFileId: ROOT_ID,
    });

    const root = parseStored(storage, ROOT_ID);
    expect(root.credential).toEqual(
      expect.objectContaining({
        kind: 'sealed',
        ciphertext: expect.any(String),
        authTag: expect.any(String),
      }),
    );
    expect(JSON.stringify(root)).not.toContain(rawApiKey);
  });

  test('allows an unresolved optional tools anchor but still rejects missing required inputs', async () => {
    const optionalToolsSetup = await agentActivities.workflowAgentSetupActivity({
      ...input,
      component: {
        ...input.component,
        warnings: [
          {
            target: 'tools',
            sourceRef: 'optional-mcp',
            sourceHandle: 'tools',
          },
        ],
      },
      initialStateFileId: ROOT_ID,
    });

    expect(optionalToolsSetup.toolStatus).toEqual({
      requested: false,
      status: 'not-requested',
      connectedNodeCount: 0,
    });

    await expect(
      agentActivities.workflowAgentSetupActivity({
        ...input,
        component: {
          ...input.component,
          warnings: [
            {
              target: 'userInput',
              sourceRef: 'required-input',
              sourceHandle: 'value',
            },
          ],
        },
        initialStateFileId: '77777777-7777-4777-8777-777777777777',
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});
