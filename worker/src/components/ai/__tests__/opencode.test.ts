import { describe, it, expect, vi, beforeEach, afterAll } from 'bun:test';
import { componentRegistry } from '@sentris/component-sdk';
import * as SDK from '@sentris/component-sdk';
import { IsolatedContainerVolume } from '../../../utils/isolated-volume';
import * as utils from '../utils';
import * as agentUtils from '../agent-runner-utils';
import '../opencode';

vi.mock('../../../utils/isolated-volume', () => {
  return {
    IsolatedContainerVolume: vi.fn().mockImplementation(() => ({
      initialize: vi.fn().mockResolvedValue('mock-volume-name'),
      cleanup: vi.fn().mockResolvedValue(undefined),
      getVolumeConfig: vi
        .fn()
        .mockReturnValue({ source: 'mock', target: '/workspace', readOnly: false }),
      getVolumeName: vi.fn().mockReturnValue('mock-volume-name'),
    })),
  };
});

describe('core.ai.opencode', () => {
  let runSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(utils, 'getGatewaySessionToken').mockResolvedValue('mock-session-token');
    vi.spyOn(agentUtils, 'fetchAgentSkills').mockResolvedValue([]);
    runSpy = vi.spyOn(SDK, 'runComponentWithRunner').mockResolvedValue({
      stdout: '# Report\n\nInvestigation complete.',
      stderr: '',
      exitCode: 0,
      results: [],
      raw: '',
    } as never);
  });

  afterAll(() => {
    vi.restoreAllMocks();
  });

  it('should be registered', () => {
    const component = componentRegistry.get('core.ai.opencode');
    expect(component).toBeDefined();
    expect(component?.id).toBe('core.ai.opencode');
    expect(
      component?.inputs.safeParse({ task: 'Gate run', trigger: { verdict: 'promote' } }).success,
    ).toBe(true);
  });

  it('should execute with valid inputs', async () => {
    const component = componentRegistry.get('core.ai.opencode');
    if (!component) throw new Error('Component not found');

    const context = {
      runId: 'test-run',
      componentRef: 'test-ref',
      metadata: {
        connectedToolNodeIds: ['tool-1'],
        organizationId: 'org-1',
      },
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
      },
      emitProgress: vi.fn(),
    };

    const inputs = {
      task: 'Find the bug',
      context: { alertId: '123' },
      model: { provider: 'openai', modelId: 'gpt-4o', apiKey: 'sk-test' },
      supplementaryInputA: 'scanner output',
    };

    const params = {
      systemPrompt: 'You are a detective.',
      autoApprove: false,
      executionProfile: 'deep',
    };

    const result = await component.execute({ inputs, params }, context as never);

    expect(result.report).toContain('# Report');
    expect(result.toolStatus).toEqual({
      requested: true,
      status: 'configured',
      connectedNodeCount: 1,
    });
    expect(utils.getGatewaySessionToken).toHaveBeenCalledWith(
      'test-run',
      'org-1',
      ['tool-1'],
      expect.any(Number),
      'test-ref',
    );

    const volumeInstance = (
      IsolatedContainerVolume as unknown as {
        mock: {
          results: {
            value: { initialize: { mock: { calls: [Record<string, string>][] } } };
          }[];
        };
      }
    ).mock.results[0].value;
    const initCall = volumeInstance.initialize.mock.calls[0][0];

    expect(initCall['context.json']).toContain('"alertId": "123"');
    expect(initCall['opencode.jsonc']).toContain('sentris-gateway');
    expect(initCall['supplementary-a.txt']).toBe('scanner output');

    const config = JSON.parse(initCall['opencode.jsonc']);
    expect(config.permission).toBe('ask');

    expect(runSpy).toHaveBeenCalled();
    const runnerCall = runSpy.mock.calls[0][0];
    expect(runnerCall.image).toBe('ghcr.io/zebbern/opencode:latest');
    expect(runnerCall.network).toBe('bridge');
    expect(runnerCall.env.OPENAI_API_KEY).toBe('sk-test');
    expect(runnerCall.timeoutSeconds).toBe(7200);
    expect(runnerCall.memoryLimit).toBe('4g');
    expect(runnerCall.cpuLimit).toBe('4');
    expect(runnerCall.pidsLimit).toBe(1024);
  });

  it('continues with a prompt limitation in best-effort mode when gateway setup fails', async () => {
    vi.spyOn(utils, 'getGatewaySessionToken').mockRejectedValue(new Error('gateway unavailable'));
    const component = componentRegistry.get('core.ai.opencode');
    if (!component) throw new Error('Component not found');

    const result = await component.execute(
      { inputs: { task: 'Investigate' }, params: { toolAvailability: 'best-effort' } },
      {
        runId: 'best-effort-run',
        componentRef: 'best-effort-ref',
        organizationId: 'org-1',
        metadata: { connectedToolNodeIds: ['tool-1'], organizationId: 'org-1' },
        logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
        emitProgress: vi.fn(),
      } as never,
    );

    expect(result.toolStatus).toEqual({
      requested: true,
      status: 'degraded',
      connectedNodeCount: 1,
      message: 'gateway unavailable',
    });
    const volume = (
      IsolatedContainerVolume as never as {
        mock: {
          results: {
            value: { initialize: { mock: { calls: [Record<string, string>][] } } };
          }[];
        };
      }
    ).mock.results[0].value;
    expect(volume.initialize.mock.calls[0][0]['prompt.txt']).toContain(
      'Connected MCP capabilities are unavailable for this run: gateway unavailable.',
    );
  });

  it('should merge providerConfig and skills into workspace', async () => {
    vi.spyOn(agentUtils, 'fetchAgentSkills').mockResolvedValue([
      { id: 'skill-1', slug: 'investigate', content: '# Investigate' },
    ]);

    const component = componentRegistry.get('core.ai.opencode');
    if (!component) throw new Error('Component not found');

    const context = {
      runId: 'test-run-config',
      componentRef: 'test-ref-config',
      metadata: {
        connectedToolNodeIds: [],
        organizationId: 'org-1',
      },
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
      },
      emitProgress: vi.fn(),
    };

    await component.execute(
      {
        inputs: { task: 'Test config merge' },
        params: {
          providerConfig: {
            githubToken: 'gh-token',
            extraSetting: 123,
          },
          skillIds: ['skill-1'],
          enablePlugins: ['superpowers'],
        },
      },
      context as never,
    );

    const volumeInstance = (
      IsolatedContainerVolume as unknown as {
        mock: {
          results: {
            value: { initialize: { mock: { calls: [Record<string, string>][] } } };
          }[];
        };
      }
    ).mock.results[0].value;
    const initCall = volumeInstance.initialize.mock.calls[0][0];

    const config = JSON.parse(initCall['opencode.jsonc']);
    expect(config.githubToken).toBe('gh-token');
    expect(config.extraSetting).toBe(123);
    expect(config.plugin).toEqual(['superpowers']);
    expect(initCall['.opencode/skills/investigate/SKILL.md']).toContain('# Investigate');
  });

  it('publishes a sanitized, bounded replay trace before cleaning the workspace', async () => {
    const report = 'R'.repeat(16_001);
    runSpy.mockResolvedValueOnce({
      stdout: [
        '[OpenCode] Listing MCP tools before run...',
        'sentris-gateway connected',
        '[OpenCode] === Full tool list output above ===',
        '[OpenCode] Starting agent run...',
        report,
      ].join('\n'),
      stderr: '',
      exitCode: 0,
      results: [],
      raw: '',
    } as never);

    const component = componentRegistry.get('core.ai.opencode');
    if (!component) throw new Error('Component not found');

    let releaseFinishPublication: (() => void) | undefined;
    const finishPublication = new Promise<void>((resolve) => {
      releaseFinishPublication = resolve;
    });
    let finishPublicationStarted: (() => void) | undefined;
    const finishStarted = new Promise<void>((resolve) => {
      finishPublicationStarted = resolve;
    });
    const publish = vi.fn((event: { part: { type: string } }) => {
      if (event.part.type === 'finish') {
        finishPublicationStarted?.();
        return finishPublication;
      }
      return Promise.resolve();
    });
    const emitProgress = vi.fn();

    const execution = component.execute(
      { inputs: { task: 'Summarize the advisory' }, params: {} },
      {
        runId: 'trace-run',
        componentRef: 'opencode-node',
        organizationId: 'org-1',
        metadata: { connectedToolNodeIds: [], organizationId: 'org-1' },
        logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
        emitProgress,
        agentTracePublisher: { publish },
      } as never,
    );

    await finishStarted;

    const volumeInstance = (
      IsolatedContainerVolume as unknown as {
        mock: { results: { value: { cleanup: ReturnType<typeof vi.fn> } }[] };
      }
    ).mock.results.at(-1)?.value;
    expect(volumeInstance?.cleanup).not.toHaveBeenCalled();

    releaseFinishPublication?.();
    const result = await execution;

    expect(result.agentRunId).toMatch(/^trace-run:opencode-node:/);
    expect(result.report).toBe(report);
    expect(result.rawOutput).toContain('sentris-gateway connected');
    expect(emitProgress).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Running OpenCode agent...',
        data: expect.objectContaining({
          agentRunId: result.agentRunId,
          agentStatus: 'running',
        }),
      }),
    );
    expect(emitProgress).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'OpenCode agent completed.',
        data: expect.objectContaining({
          agentRunId: result.agentRunId,
          agentStatus: 'completed',
        }),
      }),
    );

    const parts = publish.mock.calls.map(([event]) => event.part) as {
      type: string;
      textDelta?: string;
    }[];
    expect(parts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'message-start' }),
        expect.objectContaining({ type: 'finish', responseText: report }),
      ]),
    );
    const textDeltas = parts.filter(
      (part): part is { type: 'text-delta'; textDelta: string } => part.type === 'text-delta',
    );
    expect(textDeltas.map((part) => part.textDelta).join('')).toBe(report);
    expect(textDeltas).toHaveLength(2);
    expect(textDeltas.every((part) => part.textDelta.length <= 16_000)).toBe(true);
    expect(volumeInstance?.cleanup).toHaveBeenCalledTimes(1);
  }, 5_000);

  it('preserves non-wrapper stdout when the OpenCode start sentinel is absent', async () => {
    runSpy.mockResolvedValueOnce({
      stdout: '\u001b[31mconnection note\u001b[0m\n# Final report',
      stderr: '',
      exitCode: 0,
      results: [],
      raw: '',
    } as never);

    const component = componentRegistry.get('core.ai.opencode');
    if (!component) throw new Error('Component not found');

    const result = await component.execute(
      { inputs: { task: 'Summarize the advisory' }, params: {} },
      {
        runId: 'fallback-run',
        componentRef: 'opencode-node',
        organizationId: 'org-1',
        metadata: { connectedToolNodeIds: [], organizationId: 'org-1' },
        logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
        emitProgress: vi.fn(),
      } as never,
    );

    expect(result.report).toBe('connection note\n# Final report');
    expect(result.rawOutput).toContain('\u001b[31mconnection note\u001b[0m');
  });
});
