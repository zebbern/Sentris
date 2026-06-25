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
    };

    const result = await component.execute({ inputs, params }, context as never);

    expect(result.report).toContain('# Report');

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
});
