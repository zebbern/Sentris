import { describe, it, expect, vi, beforeEach, afterEach } from 'bun:test';
import {
  assertSkillsResolved,
  buildAgentPrompt,
  buildClaudeMcpConfig,
  buildClaudeRunCommand,
  buildClaudeSettings,
  buildClaudeAuthEnv,
  buildClaudeModelEnv,
  buildClaudeEffortEnv,
  formatClaudeAuthErrorHint,
  buildSupplementaryFiles,
  fetchAgentSkills,
  mapAutoApprove,
  materializeSkillsToVolume,
  mergeOpenCodePlugins,
  resolveGatewayMcpConfig,
} from '../agent-runner-utils';

describe('agent-runner-utils', () => {
  const originalFetch = globalThis.fetch;
  const originalToken = process.env.INTERNAL_SERVICE_TOKEN;

  beforeEach(() => {
    process.env.INTERNAL_SERVICE_TOKEN = 'test-internal-token';
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    process.env.INTERNAL_SERVICE_TOKEN = originalToken;
    vi.restoreAllMocks();
  });

  it('buildSupplementaryFiles writes only populated inputs', () => {
    expect(buildSupplementaryFiles({ supplementaryInputA: 'scan json' })).toEqual({
      'supplementary-a.txt': 'scan json',
    });
    expect(buildSupplementaryFiles({ supplementaryInputB: 'brief' })).toEqual({
      'supplementary-b.txt': 'brief',
    });
  });

  it('materializeSkillsToVolume uses layout-specific paths', () => {
    const skills = [
      { id: '1', slug: 'triage', content: '# Triage', files: { 'SKILL.md': '# Triage' } },
    ];
    expect(materializeSkillsToVolume(skills, 'opencode')).toEqual({
      '.opencode/skills/triage/SKILL.md': '# Triage',
    });
    expect(materializeSkillsToVolume(skills, 'claude')).toEqual({
      '.claude/skills/triage/SKILL.md': '# Triage',
    });
  });

  it('materializeSkillsToVolume writes nested bundle files', () => {
    const skills = [
      {
        id: '1',
        slug: 'playwright',
        content: '# Root',
        files: {
          'SKILL.md': '# Root',
          'core/accessibility.md': '# Accessibility',
        },
      },
    ];
    const files = materializeSkillsToVolume(skills, 'claude');
    expect(files['.claude/skills/playwright/SKILL.md']).toBe('# Root');
    expect(files['.claude/skills/playwright/core/accessibility.md']).toBe('# Accessibility');
  });

  it('mapAutoApprove maps permission modes', () => {
    expect(mapAutoApprove(true)).toEqual({
      opencodePermission: 'allow',
      claudeSkipPermissions: true,
    });
    expect(mapAutoApprove(false)).toEqual({
      opencodePermission: 'ask',
      claudeSkipPermissions: false,
    });
  });

  it('resolveGatewayMcpConfig includes bearer token when provided', () => {
    const config = resolveGatewayMcpConfig('token-123') as {
      mcp: Record<string, { headers: Record<string, string> }>;
    };
    expect(config.mcp['sentris-gateway'].headers.Authorization).toBe('Bearer token-123');
  });

  it('buildClaudeMcpConfig uses http transport', () => {
    const config = buildClaudeMcpConfig('token-123') as {
      mcpServers: Record<string, { type: string; headers: Record<string, string> }>;
    };
    expect(config.mcpServers['sentris-gateway'].type).toBe('http');
    expect(config.mcpServers['sentris-gateway'].headers.Authorization).toBe('Bearer token-123');
  });

  it('buildClaudeRunCommand adds skip-permissions and plugin dirs', () => {
    const command = buildClaudeRunCommand({
      skipPermissions: true,
      enablePlugins: ['oh-my-claudecode'],
    });
    expect(command).toContain('--dangerously-skip-permissions');
    expect(command).toContain('--plugin-dir /opt/plugins/oh-my-claudecode');
  });

  it('buildClaudeSettings toggles default permission mode', () => {
    expect(buildClaudeSettings(true)).toEqual({
      permissions: { defaultMode: 'bypassPermissions' },
    });
    expect(buildClaudeSettings(false)).toEqual({
      permissions: { defaultMode: 'default' },
    });
  });

  it('buildClaudeAuthEnv injects API key or subscription token exclusively', () => {
    expect(buildClaudeAuthEnv({ authMode: 'api_key', apiKey: 'sk-ant-test' })).toEqual({
      ANTHROPIC_API_KEY: 'sk-ant-test',
    });
    expect(
      buildClaudeAuthEnv({ authMode: 'subscription_oauth', oauthToken: 'oauth-token' }),
    ).toEqual({
      CLAUDE_CODE_OAUTH_TOKEN: 'oauth-token',
    });
    expect(
      buildClaudeAuthEnv({
        authMode: 'subscription_oauth',
        oauthToken: 'oauth-token',
        apiKey: 'sk-ant-test',
      }),
    ).toEqual({
      CLAUDE_CODE_OAUTH_TOKEN: 'oauth-token',
    });
  });

  it('buildClaudeModelEnv sets ANTHROPIC_MODEL when modelId present', () => {
    expect(buildClaudeModelEnv({ modelId: 'claude-opus-4-8' })).toEqual({
      ANTHROPIC_MODEL: 'claude-opus-4-8',
    });
    expect(buildClaudeModelEnv({ modelId: '  ' })).toEqual({});
    expect(buildClaudeModelEnv(undefined)).toEqual({});
  });

  it('buildClaudeEffortEnv sets CLAUDE_CODE_EFFORT_LEVEL only when chosen', () => {
    expect(buildClaudeEffortEnv('default')).toEqual({});
    expect(buildClaudeEffortEnv(undefined)).toEqual({});
    expect(buildClaudeEffortEnv('bogus')).toEqual({});
    expect(buildClaudeEffortEnv('low')).toEqual({ CLAUDE_CODE_EFFORT_LEVEL: 'low' });
    expect(buildClaudeEffortEnv('high')).toEqual({ CLAUDE_CODE_EFFORT_LEVEL: 'high' });
    expect(buildClaudeEffortEnv('xhigh')).toEqual({ CLAUDE_CODE_EFFORT_LEVEL: 'xhigh' });
    expect(buildClaudeEffortEnv('max')).toEqual({ CLAUDE_CODE_EFFORT_LEVEL: 'max' });
  });

  it('formatClaudeAuthErrorHint returns auth-mode-specific guidance', () => {
    expect(
      formatClaudeAuthErrorHint('Not logged in · Please run /login', { authMode: 'api_key' }),
    ).toContain('API key');
    expect(
      formatClaudeAuthErrorHint('Not logged in · Please run /login', {
        authMode: 'subscription_oauth',
      }),
    ).toContain('setup-token');
    expect(
      formatClaudeAuthErrorHint('Invalid API key', { authMode: 'subscription_oauth' }),
    ).toContain('setup-token');
  });

  it('mergeOpenCodePlugins merges plugin list', () => {
    expect(mergeOpenCodePlugins({ foo: 1 }, ['superpowers'])).toEqual({
      foo: 1,
      plugin: ['superpowers'],
    });
  });

  it('buildAgentPrompt references supplementary files', () => {
    const prompt = buildAgentPrompt({
      task: 'Investigate',
      supplementaryFiles: ['supplementary-a.txt'],
    });
    expect(prompt).toContain('/workspace/supplementary-a.txt');
    expect(prompt).toContain('Investigate');
  });

  it('fetchAgentSkills calls internal batch endpoint', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [{ id: 'skill-1', slug: 'triage', content: '# Skill' }],
    }) as unknown as typeof fetch;

    const skills = await fetchAgentSkills('org-1', ['skill-1']);
    expect(skills).toHaveLength(1);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/internal/agent-skills/batch?ids=skill-1'),
      expect.objectContaining({
        headers: expect.objectContaining({
          'X-Internal-Token': 'test-internal-token',
          'X-Organization-Id': 'org-1',
        }),
      }),
    );
  });

  it('assertSkillsResolved throws for missing skills', () => {
    expect(() => assertSkillsResolved(['missing-id'], [])).toThrow(
      'Agent skills not found or disabled',
    );
  });
});
