import { describe, it, expect, vi, beforeEach, afterAll } from 'bun:test';
import { componentRegistry, ServiceError } from '@sentris/component-sdk';
import * as SDK from '@sentris/component-sdk';
import { IsolatedContainerVolume } from '../../../utils/isolated-volume';
import * as utils from '../utils';
import * as agentUtils from '../agent-runner-utils';
import '../claude-code-agent';

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

describe('core.ai.claude-code', () => {
  let runSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(utils, 'getGatewaySessionToken').mockResolvedValue('mock-session-token');
    vi.spyOn(agentUtils, 'fetchAgentSkills').mockResolvedValue([
      { id: 'skill-1', slug: 'triage', content: '# Triage playbook' },
    ]);
    runSpy = vi.spyOn(SDK, 'runComponentWithRunner').mockResolvedValue({
      stdout: '# Claude report\n\nDone.',
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
    const component = componentRegistry.get('core.ai.claude-code');
    expect(component).toBeDefined();
    expect(component?.id).toBe('core.ai.claude-code');
  });

  it('materializes claude workspace files and runs wrapper', async () => {
    const component = componentRegistry.get('core.ai.claude-code');
    if (!component) throw new Error('Component not found');

    const context = {
      runId: 'test-run',
      componentRef: 'test-ref',
      organizationId: 'org-1',
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

    const result = await component.execute(
      {
        inputs: {
          task: 'Triage findings',
          context: { findingId: 'f-1' },
          model: {
            provider: 'anthropic',
            modelId: 'claude-sonnet-4-6',
            apiKey: 'sk-test',
            effort: 'xhigh',
          },
          supplementaryInputA: '{"severity":"high"}',
        },
        params: {
          autoApprove: true,
          skillIds: ['skill-1'],
          enablePlugins: ['oh-my-claudecode'],
        },
      },
      context as never,
    );

    expect(result.report).toContain('# Claude report');

    const volumeInstance = (IsolatedContainerVolume as unknown as { mock: { results: Array<{ value: { initialize: { mock: { calls: Array<[Record<string, string>]> } } } }> } }).mock
      .results[0].value;
    const initCall = volumeInstance.initialize.mock.calls[0][0];

    expect(initCall['.mcp.json']).toContain('sentris-gateway');
    expect(initCall['.claude/skills/triage/SKILL.md']).toContain('# Triage playbook');
    expect(initCall['supplementary-a.txt']).toContain('severity');
    expect(initCall['run.sh']).toContain('--dangerously-skip-permissions');
    expect(initCall['run.sh']).toContain('--plugin-dir /opt/plugins/oh-my-claudecode');

    const runnerCall = runSpy.mock.calls[0][0];
    expect(runnerCall.image).toBe('ghcr.io/zebbern/claude-code:latest');
    expect(runnerCall.env.ANTHROPIC_API_KEY).toBe('sk-test');
    expect(runnerCall.env.ANTHROPIC_MODEL).toBe('claude-sonnet-4-6');
    expect(runnerCall.env.CLAUDE_CODE_EFFORT_LEVEL).toBe('xhigh');
  });

  it('passes subscription oauth token env when configured', async () => {
    const component = componentRegistry.get('core.ai.claude-code');
    if (!component) throw new Error('Component not found');

    await component.execute(
      {
        inputs: {
          task: 'Triage findings',
          model: {
            provider: 'anthropic',
            modelId: 'claude-sonnet-4-6',
            authMode: 'subscription_oauth',
            oauthToken: 'oauth-token-value',
          },
        },
        params: { autoApprove: true },
      },
      {
        runId: 'oauth-run',
        componentRef: 'oauth-ref',
        organizationId: 'org-1',
        metadata: { connectedToolNodeIds: [], organizationId: 'org-1' },
        logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
        emitProgress: vi.fn(),
      } as never,
    );

    const runnerCall = runSpy.mock.calls[0][0];
    expect(runnerCall.env.CLAUDE_CODE_OAUTH_TOKEN).toBe('oauth-token-value');
    expect(runnerCall.env.ANTHROPIC_API_KEY).toBeUndefined();
  });

  it('fails on non-zero exit code', async () => {
    runSpy.mockResolvedValueOnce({
      stdout: '',
      stderr: 'permission denied',
      exitCode: 1,
      results: [],
      raw: '',
    } as never);

    const component = componentRegistry.get('core.ai.claude-code');
    if (!component) throw new Error('Component not found');

    await expect(
      component.execute(
        {
          inputs: { task: 'Fail test' },
          params: {},
        },
        {
          runId: 'fail-run',
          componentRef: 'fail-ref',
          organizationId: 'org-1',
          metadata: { connectedToolNodeIds: [], organizationId: 'org-1' },
          logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
          emitProgress: vi.fn(),
        } as never,
      ),
    ).rejects.toBeInstanceOf(ServiceError);
  });
});
