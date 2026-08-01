import { beforeAll, beforeEach, describe, expect, test, vi } from 'bun:test';
import type {
  FinishReason,
  LanguageModelUsage,
  StreamTextResult,
  TextStreamPart,
  ToolSet,
} from 'ai';
import type { AgentTraceEvent, ExecutionContext } from '@sentris/component-sdk';
import { componentRegistry, runComponentWithRunner } from '@sentris/component-sdk';
import type { AiAgentInput, AiAgentOutput } from '../ai-agent';

const stepCountIsMock = vi.fn((limit: number) => ({ type: 'step-count', limit }));
const createOpenAIMock = vi.fn(() =>
  Object.assign(
    (modelId: string) => ({ provider: 'openai', modelId }),
    { chat: (modelId: string) => ({ provider: 'openrouter', modelId }) },
  ),
);
const createGoogleGenerativeAIMock = vi.fn(() => (modelId: string) => ({
  provider: 'gemini',
  modelId,
}));
const createMCPClientMock = vi.fn();

let toolLoopAgentSettings: unknown;
let lastStreamMessages: unknown;

class MockToolLoopAgent {
  settings: unknown;

  constructor(settings: unknown) {
    this.settings = settings;
    toolLoopAgentSettings = settings;
  }

  async stream({ messages }: { messages: unknown }) {
    lastStreamMessages = messages;
    return createStreamResult();
  }
}

function createTestContext(overrides?: Partial<ExecutionContext>): ExecutionContext {
  return {
    runId: 'test-run',
    componentRef: 'core.ai.agent',
    logger: {
      debug: () => {},
      info: () => {},
      error: () => {},
      warn: () => {},
    },
    emitProgress: () => {},
    metadata: {
      runId: 'test-run',
      componentRef: 'core.ai.agent',
      aiSdkOverrides: {
        ToolLoopAgent: MockToolLoopAgent,
        stepCountIs: stepCountIsMock,
        createOpenAI: createOpenAIMock,
        createGoogleGenerativeAI: createGoogleGenerativeAIMock,
        createMCPClient: createMCPClientMock,
      },
    },
    http: {
      fetch: async (input, init) => globalThis.fetch(input as any, init),
      toCurl: () => '',
    },
    ...overrides,
  };
}

function createUsage(overrides: Partial<LanguageModelUsage> = {}): LanguageModelUsage {
  return {
    inputTokens: 1,
    inputTokenDetails: {
      noCacheTokens: undefined,
      cacheReadTokens: undefined,
      cacheWriteTokens: undefined,
    },
    outputTokens: 1,
    outputTokenDetails: {
      textTokens: undefined,
      reasoningTokens: undefined,
    },
    totalTokens: 2,
    ...overrides,
  };
}

function asyncParts(parts: TextStreamPart<ToolSet>[]): AsyncIterable<TextStreamPart<ToolSet>> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const part of parts) yield part;
    },
  };
}

type StreamToolResult = Awaited<StreamTextResult<ToolSet, never>['toolResults']>[number];

function createStreamResult(
  options: {
    parts?: TextStreamPart<ToolSet>[];
    text?: string;
    toolResults?: StreamToolResult[];
    finishReason?: FinishReason;
  } = {},
): StreamTextResult<ToolSet, never> {
  const text = options.text ?? 'Agent final answer';
  return {
    fullStream: asyncParts(
      options.parts ?? [
        { type: 'text-start', id: 'sdk-text-1' },
        { type: 'text-delta', id: 'sdk-text-1', text },
        { type: 'text-end', id: 'sdk-text-1' },
        {
          type: 'finish',
          finishReason: options.finishReason ?? 'stop',
          rawFinishReason: 'stop',
          totalUsage: createUsage(),
        },
      ],
    ),
    text: Promise.resolve(text),
    toolResults: Promise.resolve(options.toolResults ?? []),
    finishReason: Promise.resolve(options.finishReason ?? 'stop'),
  } as unknown as StreamTextResult<ToolSet, never>;
}

function createDeferredStreamResult(
  fullStream: AsyncIterable<TextStreamPart<ToolSet>>,
  results: {
    text: PromiseLike<string>;
    toolResults: PromiseLike<StreamToolResult[]>;
    finishReason: PromiseLike<FinishReason>;
  },
): StreamTextResult<ToolSet, never> {
  return {
    fullStream,
    ...results,
  } as unknown as StreamTextResult<ToolSet, never>;
}

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 500;
  while (!predicate()) {
    if (Date.now() >= deadline) {
      throw new Error('Timed out waiting for condition');
    }
    await Bun.sleep(5);
  }
}

function contextWithTracePublisher(published: AgentTraceEvent[]): ExecutionContext {
  return createTestContext({
    agentTracePublisher: {
      publish: (event) => {
        published.push(event);
      },
    },
  });
}

function runAgent(context: ExecutionContext = createTestContext()) {
  const component = componentRegistry.get<AiAgentInput, AiAgentOutput>('core.ai.agent');
  if (!component) {
    throw new Error('Expected core.ai.agent to be registered');
  }
  return runComponentWithRunner(
    component.runner,
    component.execute,
    {
      inputs: {
        userInput: 'Investigate the target',
        conversationState: undefined,
        chatModel: { provider: 'openai', modelId: 'gpt-4o-mini' },
        modelApiKey: 'sk-test',
      },
      params: {
        systemPrompt: '',
        temperature: 0.2,
        maxTokens: 128,
        memorySize: 5,
        stepLimit: 2,
      },
    },
    context,
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function expectRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error(`Expected ${label} to be an object`);
  }
  return value;
}

beforeEach(() => {
  toolLoopAgentSettings = undefined;
  lastStreamMessages = undefined;
  stepCountIsMock.mockClear();
  createOpenAIMock.mockClear();
  createGoogleGenerativeAIMock.mockClear();
  createMCPClientMock.mockClear();
  vi.restoreAllMocks();
  process.env.INTERNAL_SERVICE_TOKEN = 'internal-token';
});

beforeAll(async () => {
  await import('../../index');
});

describe('core.ai.agent (refactor)', () => {
  test('runs without tool discovery when no connected tools', async () => {
    const component = componentRegistry.get<AiAgentInput, AiAgentOutput>('core.ai.agent');
    expect(component).toBeDefined();

    vi.spyOn(MockToolLoopAgent.prototype, 'stream').mockImplementation(async function (
      this: MockToolLoopAgent,
      { messages }: { messages: unknown },
    ) {
      lastStreamMessages = messages;
      return createStreamResult({ text: 'Hello agent' });
    });

    const result = await runComponentWithRunner(
      component!.runner,
      component!.execute,
      {
        inputs: {
          userInput: 'Hi',
          conversationState: undefined,
          chatModel: {
            provider: 'openai',
            modelId: 'gpt-4o-mini',
          },
          modelApiKey: 'sk-test',
        },
        params: {
          systemPrompt: 'Say hello',
          temperature: 0.2,
          maxTokens: 128,
          memorySize: 4,
          stepLimit: 2,
        },
      },
      createTestContext(),
    );

    expect(result.responseText).toBe('Hello agent');
    expect(result.toolStatus).toEqual({
      requested: false,
      status: 'not-requested',
      connectedNodeCount: 0,
    });
    expect(createMCPClientMock).not.toHaveBeenCalled();

    const settings = expectRecord(toolLoopAgentSettings, 'agent settings');
    expect(settings.tools).toBeUndefined();
    expect(settings.temperature).toBe(0.2);
    expect(stepCountIsMock).toHaveBeenCalledWith(2);

    const messages = Array.isArray(lastStreamMessages) ? lastStreamMessages : [];
    expect(messages.at(-1)).toMatchObject({
      role: 'user',
      content: 'Hi',
    });
  });

  test('uses the execution profile step limit when no explicit limit is saved', async () => {
    const component = componentRegistry.get<AiAgentInput, AiAgentOutput>('core.ai.agent');
    expect(component).toBeDefined();

    await runComponentWithRunner(
      component!.runner,
      component!.execute,
      {
        inputs: {
          userInput: 'Investigate the target',
          conversationState: undefined,
          chatModel: { provider: 'openai', modelId: 'gpt-4o-mini' },
          modelApiKey: 'sk-test',
        },
        params: {
          systemPrompt: '',
          temperature: 0.2,
          maxTokens: 128,
          memorySize: 4,
          executionProfile: 'deep',
        },
      },
      createTestContext(),
    );

    expect(stepCountIsMock).toHaveBeenCalledWith(64);
  });

  test('falls back to the current stable Gemini Flash model', async () => {
    const component = componentRegistry.get<AiAgentInput, AiAgentOutput>('core.ai.agent');
    expect(component).toBeDefined();

    await runComponentWithRunner(
      component!.runner,
      component!.execute,
      {
        inputs: {
          userInput: 'Investigate the target',
          conversationState: undefined,
          chatModel: { provider: 'gemini', modelId: '' },
          modelApiKey: 'test-gemini-key',
        },
        params: {
          systemPrompt: '',
          temperature: 0.2,
          maxTokens: 128,
          memorySize: 4,
          executionProfile: 'fast',
        },
      },
      createTestContext(),
    );

    const settings = expectRecord(toolLoopAgentSettings, 'agent settings');
    expect(settings.model).toEqual({
      provider: 'gemini',
      modelId: 'gemini-3.5-flash',
    });
  });

  test.each([
    ['openai', 'gpt-4o-mini'],
    ['gemini', 'gemini-3.5-flash'],
    ['openrouter', 'openai/gpt-4o-mini'],
    ['anthropic', 'claude-sonnet-4-6'],
    ['zai-coding-plan', 'gpt-4o-mini'],
  ] as const)('preserves the %s fallback model for graphs without a model ID', async (provider, modelId) => {
    const component = componentRegistry.get<AiAgentInput, AiAgentOutput>('core.ai.agent');
    expect(component).toBeDefined();

    await runComponentWithRunner(
      component!.runner,
      component!.execute,
      {
        inputs: {
          userInput: 'Investigate the target',
          chatModel: { provider, modelId: '' },
          modelApiKey: 'test-model-key',
        },
        params: { systemPrompt: '', temperature: 0.2, maxTokens: 128, memorySize: 4 },
      },
      createTestContext(),
    );

    const settings = expectRecord(toolLoopAgentSettings, 'agent settings');
    expect(settings.model).toMatchObject({ modelId });
  });

  test('uses the Z.AI Coding Plan base URL when no URL is configured on the graph', async () => {
    const component = componentRegistry.get<AiAgentInput, AiAgentOutput>('core.ai.agent');
    expect(component).toBeDefined();

    await runComponentWithRunner(
      component!.runner,
      component!.execute,
      {
        inputs: {
          userInput: 'Investigate the target',
          chatModel: { provider: 'zai-coding-plan', modelId: 'glm-5.1' },
          modelApiKey: 'test-zai-key',
        },
        params: { systemPrompt: '', temperature: 0.2, maxTokens: 128, memorySize: 4 },
      },
      createTestContext(),
    );

    expect(createOpenAIMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ baseURL: 'https://api.z.ai/api/coding/paas/v4' }),
    );
  });

  test('uses an explicit Z.AI base URL instead of the Coding Plan default', async () => {
    const component = componentRegistry.get<AiAgentInput, AiAgentOutput>('core.ai.agent');
    expect(component).toBeDefined();

    await runComponentWithRunner(
      component!.runner,
      component!.execute,
      {
        inputs: {
          userInput: 'Investigate the target',
          chatModel: {
            provider: 'zai-coding-plan',
            modelId: 'glm-5.1',
            baseUrl: 'https://zai.example.test/v4',
          },
          modelApiKey: 'test-zai-key',
        },
        params: { systemPrompt: '', temperature: 0.2, maxTokens: 128, memorySize: 4 },
      },
      createTestContext(),
    );

    expect(createOpenAIMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ baseURL: 'https://zai.example.test/v4' }),
    );
  });

  test('discovers gateway tools and passes them to the agent', async () => {
    const component = componentRegistry.get<AiAgentInput, AiAgentOutput>('core.ai.agent');
    expect(component).toBeDefined();

    vi.spyOn(MockToolLoopAgent.prototype, 'stream').mockResolvedValue(
      createStreamResult({ text: 'Agent final answer' }),
    );

    let fetchCalls = 0;
    let tokenRequestBody: Record<string, unknown> | undefined;
    const originalFetch = globalThis.fetch;
    const fetchMock: typeof fetch = async (_input, init) => {
      fetchCalls += 1;
      tokenRequestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(JSON.stringify({ token: 'gateway-token' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };
    fetchMock.preconnect = () => {};
    globalThis.fetch = fetchMock;

    const mockTools = {
      ping: {
        inputSchema: { type: 'object', properties: {} },
        execute: async () => ({ type: 'json', value: { ok: true } }),
      },
    };

    createMCPClientMock.mockResolvedValue({
      tools: async () => mockTools,
      close: async () => {},
    });

    const contextWithTools: ExecutionContext = createTestContext({
      metadata: {
        ...createTestContext().metadata,
        connectedToolNodeIds: ['tool-node-1'],
      },
    });

    try {
      const result = await runComponentWithRunner(
        component!.runner,
        component!.execute,
        {
          inputs: {
            userInput: 'Use tools',
            conversationState: undefined,
            chatModel: {
              provider: 'openai',
              modelId: 'gpt-4o-mini',
            },
            modelApiKey: 'sk-test',
          },
          params: {
            systemPrompt: '',
            temperature: 0.3,
            maxTokens: 64,
            memorySize: 3,
            stepLimit: 1,
          },
        },
        contextWithTools,
      );

      expect(result.responseText).toBe('Agent final answer');
      expect(result.toolStatus).toEqual({
        requested: true,
        status: 'configured',
        connectedNodeCount: 1,
        availableToolCount: 1,
      });
      expect(fetchCalls).toBeGreaterThan(0);
      expect(tokenRequestBody?.invokingNodeId).toBe('core.ai.agent');
      expect(createMCPClientMock).toHaveBeenCalledWith(
        expect.objectContaining({
          transport: {
            type: 'http',
            url: 'http://localhost:3211/api/v1/mcp/gateway',
            headers: { Authorization: 'Bearer gateway-token' },
          },
        }),
      );

      const settings = expectRecord(toolLoopAgentSettings, 'agent settings');
      const tools = expectRecord(settings.tools, 'agent tools');
      expect(Object.keys(tools)).toEqual(['ping']);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('fails by default when gateway discovery returns zero connected tools', async () => {
    const component = componentRegistry.get<AiAgentInput, AiAgentOutput>('core.ai.agent');
    expect(component).toBeDefined();
    const published: AgentTraceEvent[] = [];

    const originalFetch = globalThis.fetch;
    const fetchMock: typeof fetch = async () =>
      new Response(JSON.stringify({ token: 'gateway-token' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    fetchMock.preconnect = () => {};
    globalThis.fetch = fetchMock;
    createMCPClientMock.mockResolvedValue({ tools: async () => ({}), close: async () => {} });
    const baseContext = createTestContext();

    try {
      await expect(
        runComponentWithRunner(
          component!.runner,
          component!.execute,
          {
            inputs: {
              userInput: 'Use tools',
              chatModel: { provider: 'openai', modelId: 'gpt-4o-mini' },
              modelApiKey: 'sk-test',
            },
            params: { systemPrompt: '', temperature: 0.3, maxTokens: 64, memorySize: 3 },
          },
          createTestContext({
            metadata: {
              ...baseContext.metadata,
              connectedToolNodeIds: ['tool-node-1'],
            },
            agentTracePublisher: {
              publish: async (event) => {
                await Bun.sleep(1);
                published.push(event);
              },
            },
          }),
        ),
      ).rejects.toThrow('Connected MCP tools are required but unavailable');
      expect(published.filter((event) => event.part.type === 'message-start')).toHaveLength(1);
      expect(published.filter((event) => event.part.type === 'finish')).toHaveLength(1);
      expect(published.find((event) => event.part.type === 'finish')?.part).toMatchObject({
        type: 'finish',
        finishReason: 'error',
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('closes the MCP client when tool discovery throws', async () => {
    const component = componentRegistry.get<AiAgentInput, AiAgentOutput>('core.ai.agent');
    expect(component).toBeDefined();

    const originalFetch = globalThis.fetch;
    const fetchMock: typeof fetch = async () =>
      new Response(JSON.stringify({ token: 'gateway-token' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    fetchMock.preconnect = () => {};
    globalThis.fetch = fetchMock;
    const close = vi.fn(async () => {});
    createMCPClientMock.mockResolvedValue({
      tools: async () => {
        throw new Error('tool discovery failed');
      },
      close,
    });

    try {
      await expect(
        runComponentWithRunner(
          component!.runner,
          component!.execute,
          {
            inputs: {
              userInput: 'Use tools',
              chatModel: { provider: 'openai', modelId: 'gpt-4o-mini' },
              modelApiKey: 'sk-test',
            },
            params: { systemPrompt: '', temperature: 0.3, maxTokens: 64, memorySize: 3 },
          },
          createTestContext({
            metadata: {
              ...createTestContext().metadata,
              connectedToolNodeIds: ['tool-node-1'],
            },
          }),
        ),
      ).rejects.toThrow('Connected MCP tools are required but unavailable: tool discovery failed');
      expect(close).toHaveBeenCalledTimes(1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('routes gateway discovery diagnostics through the component logger', async () => {
    const component = componentRegistry.get<AiAgentInput, AiAgentOutput>('core.ai.agent');
    expect(component).toBeDefined();

    vi.spyOn(MockToolLoopAgent.prototype, 'stream').mockResolvedValue(
      createStreamResult({ text: 'Agent final answer' }),
    );

    const originalFetch = globalThis.fetch;
    const fetchMock: typeof fetch = async () =>
      new Response(JSON.stringify({ token: 'gateway-token' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    fetchMock.preconnect = () => {};
    globalThis.fetch = fetchMock;

    createMCPClientMock.mockResolvedValue({
      tools: async () => ({
        ping: {
          inputSchema: { type: 'object', properties: {} },
          execute: async () => ({ type: 'json', value: { ok: true } }),
        },
      }),
      close: async () => {},
    });

    const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const loggerInfo = vi.fn();
    const baseContext = createTestContext();
    const contextWithTools: ExecutionContext = createTestContext({
      logger: {
        ...baseContext.logger,
        info: loggerInfo,
      },
      metadata: {
        ...baseContext.metadata,
        connectedToolNodeIds: ['tool-node-1'],
      },
    });

    try {
      await runComponentWithRunner(
        component!.runner,
        component!.execute,
        {
          inputs: {
            userInput: 'Use tools',
            conversationState: undefined,
            chatModel: {
              provider: 'openai',
              modelId: 'gpt-4o-mini',
            },
            modelApiKey: 'sk-test',
          },
          params: {
            systemPrompt: '',
            temperature: 0.3,
            maxTokens: 64,
            memorySize: 3,
            stepLimit: 1,
          },
        },
        contextWithTools,
      );

      expect(consoleLogSpy).not.toHaveBeenCalled();
      expect(loggerInfo).toHaveBeenCalledWith(
        '[AGENT] Connecting to MCP gateway at http://localhost:3211/api/v1/mcp/gateway to discover tools',
      );
      expect(loggerInfo).toHaveBeenCalledWith('[AGENT] Discovered 1 tools from gateway: ping');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('stores tool outputs in conversation state', async () => {
    const component = componentRegistry.get<AiAgentInput, AiAgentOutput>('core.ai.agent');
    expect(component).toBeDefined();

    vi.spyOn(MockToolLoopAgent.prototype, 'stream').mockResolvedValue(
      createStreamResult({
        text: 'Tool done',
        toolResults: [
          {
            type: 'tool-result',
            toolCallId: 'call-1',
            toolName: 'ping',
            input: { target: 'example.com' },
            output: { type: 'json', value: { ok: true } },
            dynamic: true,
          },
        ],
      }),
    );

    const result = await runComponentWithRunner(
      component!.runner,
      component!.execute,
      {
        inputs: {
          userInput: 'Run the tool',
          conversationState: undefined,
          chatModel: {
            provider: 'openai',
            modelId: 'gpt-4o-mini',
          },
          modelApiKey: 'sk-test',
        },
        params: {
          systemPrompt: '',
          temperature: 0.2,
          maxTokens: 128,
          memorySize: 5,
          stepLimit: 2,
        },
      },
      createTestContext(),
    );

    const toolMessage = result.conversationState.messages.find(
      (message: { role: string }) => message.role === 'tool',
    );
    expect(toolMessage).toBeDefined();
    expect(toolMessage?.content).toMatchObject({
      toolCallId: 'call-1',
      toolName: 'ping',
      output: { type: 'json', value: { ok: true } },
    });
  });

  test('publishes response text before the model stream completes', async () => {
    let releaseFinish!: () => void;
    const finishGate = new Promise<void>((resolve) => {
      releaseFinish = resolve;
    });
    const published: AgentTraceEvent[] = [];

    vi.spyOn(MockToolLoopAgent.prototype, 'stream').mockImplementation(async () => {
      const fullStream = {
        async *[Symbol.asyncIterator]() {
          yield { type: 'text-start', id: 'sdk-text-1' } as const;
          yield { type: 'text-delta', id: 'sdk-text-1', text: 'Early evidence' } as const;
          await finishGate;
          yield { type: 'text-end', id: 'sdk-text-1' } as const;
          yield {
            type: 'finish',
            finishReason: 'stop',
            rawFinishReason: 'stop',
            totalUsage: createUsage(),
          } as const;
        },
      };
      return createDeferredStreamResult(fullStream, {
        text: finishGate.then(() => 'Early evidence complete'),
        toolResults: finishGate.then(() => []),
        finishReason: finishGate.then(() => 'stop'),
      });
    });

    const execution = runAgent(contextWithTracePublisher(published));
    await waitFor(() =>
      published.some(
        (event) =>
          event.part.type === 'text-delta' &&
          typeof event.part.textDelta === 'string' &&
          event.part.textDelta.includes('Early evidence'),
      ),
    );
    expect(published.some((event) => event.part.type === 'finish')).toBe(false);

    releaseFinish();
    const result = await execution;
    expect(result.responseText).toBe('Early evidence complete');
  });

  test('projects each streamed tool event exactly once', async () => {
    const published: AgentTraceEvent[] = [];
    const longToolError = { message: 'x'.repeat(2_500) };
    vi.spyOn(MockToolLoopAgent.prototype, 'stream').mockResolvedValue(
      createStreamResult({
        parts: [
          {
            type: 'tool-call',
            toolCallId: 'call-1',
            toolName: 'lookup',
            input: { package: 'sentris' },
            dynamic: true,
          },
          {
            type: 'tool-result',
            toolCallId: 'call-1',
            toolName: 'lookup',
            input: { package: 'sentris' },
            output: { ok: true },
            dynamic: true,
          },
          {
            type: 'tool-error',
            toolCallId: 'call-2',
            toolName: 'audit',
            input: { package: 'unsafe' },
            error: longToolError,
            dynamic: true,
          },
          {
            type: 'finish',
            finishReason: 'stop',
            rawFinishReason: 'stop',
            totalUsage: createUsage(),
          },
        ] as TextStreamPart<ToolSet>[],
        text: '',
      }),
    );

    await runAgent(contextWithTracePublisher(published));

    const expectations = [
      { type: 'tool-input-available', toolCallId: 'call-1', toolName: 'lookup' },
      { type: 'tool-output-available', toolCallId: 'call-1', toolName: 'lookup' },
      { type: 'data-tool-error', toolCallId: 'call-2', toolName: 'audit' },
    ] as const;
    for (const expected of expectations) {
      const matches = published.filter(
        (event) =>
          event.part.type === expected.type &&
          (event.part.toolCallId === expected.toolCallId ||
            (isRecord(event.part.data) && event.part.data.toolCallId === expected.toolCallId)),
      );
      expect(matches).toHaveLength(1);
      const part = matches[0]!.part;
      expect(part.toolName ?? (isRecord(part.data) ? part.data.toolName : undefined)).toBe(
        expected.toolName,
      );
    }

    const toolError = published.find((event) => event.part.type === 'data-tool-error');
    const errorData = isRecord(toolError?.part.data) ? toolError.part.data : {};
    expect(errorData.error).toStartWith('{"message":"');
    expect(errorData.error).toContain('...(+');
    expect((errorData.error as string).length).toBeLessThan(2_050);
  });

  test('redacts credentials from durable tool error events', async () => {
    const published: AgentTraceEvent[] = [];
    const apiKey = 'sk-tool-trace-secret-12345';
    const bearerToken = 'tool-bearer-trace-secret-67890';
    const basicCredential = 'dG9vbC11c2VyOnRvb2wtcGFzcw==';
    vi.spyOn(MockToolLoopAgent.prototype, 'stream').mockResolvedValue(
      createStreamResult({
        parts: [
          {
            type: 'tool-error',
            toolCallId: 'call-secret',
            toolName: 'audit',
            input: { package: 'sentris' },
            error: {
              message: `tool request rejected apiKey=${apiKey} Authorization: Bearer ${bearerToken} upstream Basic ${basicCredential}`,
            },
            dynamic: true,
          },
        ] as TextStreamPart<ToolSet>[],
      }),
    );

    await runAgent(contextWithTracePublisher(published));

    const toolError = published.find((event) => event.part.type === 'data-tool-error');
    const errorData = isRecord(toolError?.part.data) ? toolError.part.data : {};
    expect(errorData.error).toContain('tool request rejected');
    expect(errorData.error).toContain('[REDACTED]');
    const durableTrace = JSON.stringify(published);
    for (const secret of [apiKey, bearerToken, basicCredential]) {
      expect(durableTrace).not.toContain(secret);
    }
  });

  test('publishes one error finish and rejects when the provider stream fails', async () => {
    const published: AgentTraceEvent[] = [];
    const providerError = new Error('provider stream failed');
    vi.spyOn(MockToolLoopAgent.prototype, 'stream').mockResolvedValue(
      createStreamResult({
        parts: [{ type: 'error', error: providerError }],
        text: '',
      }),
    );

    await expect(runAgent(contextWithTracePublisher(published))).rejects.toBe(providerError);

    const finishes = published.filter((event) => event.part.type === 'finish');
    expect(finishes).toHaveLength(1);
    expect(finishes[0]!.part).toMatchObject({
      type: 'finish',
      finishReason: 'error',
      responseText: 'provider stream failed',
    });
  });

  test('redacts credentials from the terminal provider error trace', async () => {
    const published: AgentTraceEvent[] = [];
    const apiKey = 'sk-provider-trace-secret-12345';
    const bearerToken = 'provider-bearer-trace-secret-67890';
    const basicCredential = 'cHJvdmlkZXItdXNlcjpwcm92aWRlci1wYXNz';
    const providerError = new Error(
      `provider request failed apiKey=${apiKey} Authorization: Bearer ${bearerToken} upstream Basic ${basicCredential}`,
    );
    vi.spyOn(MockToolLoopAgent.prototype, 'stream').mockResolvedValue(
      createStreamResult({
        parts: [{ type: 'error', error: providerError }],
        text: '',
      }),
    );

    await expect(runAgent(contextWithTracePublisher(published))).rejects.toBe(providerError);

    const finish = published.find((event) => event.part.type === 'finish');
    expect(finish?.part.responseText).toContain('provider request failed');
    expect(finish?.part.responseText).toContain('[REDACTED]');
    const durableTrace = JSON.stringify(published);
    for (const secret of [apiKey, bearerToken, basicCredential]) {
      expect(durableTrace).not.toContain(secret);
    }
  });

  test('preserves the provider failure when MCP cleanup also fails', async () => {
    const providerError = new Error('provider stream failed first');
    const cleanupError = new Error('MCP cleanup failed second');
    vi.spyOn(MockToolLoopAgent.prototype, 'stream').mockResolvedValue(
      createStreamResult({
        parts: [{ type: 'error', error: providerError }],
        text: '',
      }),
    );

    const originalFetch = globalThis.fetch;
    const fetchMock: typeof fetch = async () =>
      new Response(JSON.stringify({ token: 'gateway-token' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    fetchMock.preconnect = () => {};
    globalThis.fetch = fetchMock;
    const close = vi.fn(async () => {
      throw cleanupError;
    });
    createMCPClientMock.mockResolvedValue({
      tools: async () => ({
        ping: {
          inputSchema: { type: 'object', properties: {} },
          execute: async () => ({ type: 'json', value: { ok: true } }),
        },
      }),
      close,
    });

    const baseContext = createTestContext();
    try {
      await expect(
        runAgent(
          createTestContext({
            metadata: {
              ...baseContext.metadata,
              connectedToolNodeIds: ['tool-node-1'],
            },
          }),
        ),
      ).rejects.toBe(providerError);
      expect(close).toHaveBeenCalledTimes(1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('redacts credentials from provider error diagnostics', async () => {
    const apiKey = 'sk-review-message-secret-12345';
    const bearerToken = 'review-bearer-secret-67890';
    const stackToken = 'review-stack-token-secret-abc';
    const causeAuthorization = 'review-cause-authorization-secret-xyz';
    const causeAccessToken = 'review-cause-access-token-secret-uvw';
    const providerError = new Error(
      `provider rejected apiKey=${apiKey} Authorization: Bearer ${bearerToken}`,
    );
    providerError.stack = `${providerError.stack}\nrequest token=${stackToken}`;
    providerError.cause = {
      authorization: `Bearer ${causeAuthorization}`,
      access_token: causeAccessToken,
    };
    vi.spyOn(MockToolLoopAgent.prototype, 'stream').mockResolvedValue(
      createStreamResult({
        parts: [{ type: 'error', error: providerError }],
        text: '',
      }),
    );
    const loggerError = vi.fn();
    const baseContext = createTestContext();

    await expect(
      runAgent(
        createTestContext({
          logger: {
            ...baseContext.logger,
            error: loggerError,
          },
        }),
      ),
    ).rejects.toBe(providerError);

    const diagnostics = loggerError.mock.calls.flat().join('\n');
    expect(diagnostics).toContain('[REDACTED]');
    for (const secret of [apiKey, bearerToken, stackToken, causeAuthorization, causeAccessToken]) {
      expect(diagnostics).not.toContain(secret);
    }
  });
});
