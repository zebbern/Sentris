import { ConfigurationError } from '@sentris/component-sdk';
import { DEFAULT_API_BASE_URL, DEFAULT_GATEWAY_URL } from './utils';

export type AgentSkillRecord = {
  id: string;
  slug: string;
  content: string;
  files?: Record<string, string>;
};

export type AgentSkillLayout = 'opencode' | 'claude';

export type SupplementaryInputs = {
  supplementaryInputA?: string;
  supplementaryInputB?: string;
};

const AGENT_PLUGIN_DIRS: Record<string, string> = {
  'oh-my-claudecode': '/opt/plugins/oh-my-claudecode',
  superpowers: '/opt/plugins/superpowers',
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export async function fetchAgentSkills(
  organizationId: string | null | undefined,
  skillIds: string[],
): Promise<AgentSkillRecord[]> {
  const uniqueIds = [...new Set(skillIds.filter(Boolean))];
  if (uniqueIds.length === 0) {
    return [];
  }

  if (!organizationId) {
    throw new ConfigurationError('Organization ID is required to fetch agent skills', {
      configKey: 'organizationId',
    });
  }

  const internalToken = process.env.INTERNAL_SERVICE_TOKEN;
  if (!internalToken) {
    throw new ConfigurationError('INTERNAL_SERVICE_TOKEN env var must be set for agent skills', {
      configKey: 'INTERNAL_SERVICE_TOKEN',
    });
  }

  const query = uniqueIds.map((id) => encodeURIComponent(id)).join(',');
  const url = `${DEFAULT_API_BASE_URL}/internal/agent-skills/batch?ids=${query}`;
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'X-Internal-Token': internalToken,
      'X-Organization-Id': organizationId,
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to fetch agent skills: ${errorText}`);
  }

  const payload = await response.json();
  if (!Array.isArray(payload)) {
    throw new Error('Failed to fetch agent skills: invalid response shape');
  }

  return payload
    .filter(isRecord)
    .map((item) => ({
      id: typeof item.id === 'string' ? item.id : '',
      slug: typeof item.slug === 'string' ? item.slug : '',
      content: typeof item.content === 'string' ? item.content : '',
      files:
        isRecord(item.files) && Object.keys(item.files).length > 0
          ? Object.fromEntries(
              Object.entries(item.files).filter(
                (entry): entry is [string, string] => typeof entry[1] === 'string',
              ),
            )
          : typeof item.content === 'string'
            ? { 'SKILL.md': item.content }
            : {},
    }))
    .filter((item) => item.id && item.slug && (item.content || Object.keys(item.files).length > 0));
}

export function buildSupplementaryFiles(inputs: SupplementaryInputs): Record<string, string> {
  const files: Record<string, string> = {};
  if (inputs.supplementaryInputA?.trim()) {
    files['supplementary-a.txt'] = inputs.supplementaryInputA;
  }
  if (inputs.supplementaryInputB?.trim()) {
    files['supplementary-b.txt'] = inputs.supplementaryInputB;
  }
  return files;
}

export function materializeSkillsToVolume(
  skills: AgentSkillRecord[],
  layout: AgentSkillLayout,
): Record<string, string> {
  const base = layout === 'opencode' ? '.opencode/skills' : '.claude/skills';
  const files: Record<string, string> = {};

  for (const skill of skills) {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(skill.slug)) {
      throw new ConfigurationError(`Invalid agent skill slug: ${skill.slug}`, {
        configKey: 'skillIds',
      });
    }

    const bundleFiles =
      skill.files && Object.keys(skill.files).length > 0
        ? skill.files
        : skill.content
          ? { 'SKILL.md': skill.content }
          : {};

    for (const [relativePath, content] of Object.entries(bundleFiles)) {
      if (relativePath.includes('..') || relativePath.startsWith('/')) {
        throw new ConfigurationError(`Invalid skill file path: ${relativePath}`, {
          configKey: 'skillIds',
        });
      }
      files[`${base}/${skill.slug}/${relativePath.replace(/\\/g, '/')}`] = content;
    }
  }

  return files;
}

export function resolveGatewayMcpConfig(gatewayToken: string): Record<string, unknown> {
  return {
    mcp: {
      'sentris-gateway': {
        type: 'remote' as const,
        url: DEFAULT_GATEWAY_URL,
        oauth: false,
        headers: gatewayToken
          ? {
              Authorization: `Bearer ${gatewayToken}`,
              Accept: 'application/json, text/event-stream',
            }
          : {
              Accept: 'application/json, text/event-stream',
            },
        enabled: true,
      },
    },
  };
}

export function buildClaudeMcpConfig(gatewayToken: string): Record<string, unknown> {
  return {
    mcpServers: {
      'sentris-gateway': {
        type: 'http',
        url: DEFAULT_GATEWAY_URL,
        headers: gatewayToken
          ? {
              Authorization: `Bearer ${gatewayToken}`,
              Accept: 'application/json, text/event-stream',
            }
          : {
              Accept: 'application/json, text/event-stream',
            },
      },
    },
  };
}

export function buildClaudeSettings(autoApprove: boolean): Record<string, unknown> {
  return {
    permissions: {
      defaultMode: autoApprove ? 'bypassPermissions' : 'default',
    },
  };
}

export function buildProviderEnv(model?: { provider: string; apiKey?: string }): Record<string, string> {
  if (!model?.apiKey) {
    return {};
  }

  switch (model.provider) {
    case 'openai':
      return { OPENAI_API_KEY: model.apiKey };
    case 'openrouter':
      return { OPENROUTER_API_KEY: model.apiKey };
    case 'anthropic':
      return { ANTHROPIC_API_KEY: model.apiKey };
    case 'groq':
      return { GROQ_API_KEY: model.apiKey };
    case 'xai':
      return { XAI_API_KEY: model.apiKey };
    case 'deepseek':
      return { DEEPSEEK_API_KEY: model.apiKey };
    case 'zai-coding-plan':
      return { ZAI_API_KEY: model.apiKey };
    default:
      return {};
  }
}

export type ClaudeAuthModel = {
  authMode?: 'api_key' | 'subscription_oauth';
  apiKey?: string;
  oauthToken?: string;
};

export function buildClaudeAuthEnv(model?: ClaudeAuthModel): Record<string, string> {
  if (!model) {
    return {};
  }

  if (model.authMode === 'subscription_oauth') {
    return model.oauthToken ? { CLAUDE_CODE_OAUTH_TOKEN: model.oauthToken } : {};
  }

  return model.apiKey ? { ANTHROPIC_API_KEY: model.apiKey } : {};
}

export type ClaudeEffortLevel = 'default' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export function buildClaudeModelEnv(model?: { modelId?: string }): Record<string, string> {
  const modelId = typeof model?.modelId === 'string' ? model.modelId.trim() : '';
  return modelId ? { ANTHROPIC_MODEL: modelId } : {};
}

const CLAUDE_EFFORT_LEVELS: ReadonlySet<string> = new Set([
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
]);

/**
 * Map the agent effort selection to Claude Code's `CLAUDE_CODE_EFFORT_LEVEL`
 * env var. Only set when the user explicitly picks a level; otherwise the agent
 * runs at the model default (full capability).
 */
export function buildClaudeEffortEnv(effort?: string): Record<string, string> {
  if (!effort || effort === 'default' || !CLAUDE_EFFORT_LEVELS.has(effort)) {
    return {};
  }
  return { CLAUDE_CODE_EFFORT_LEVEL: effort };
}

export function formatClaudeAuthErrorHint(
  stderr: string,
  model?: ClaudeAuthModel,
): string | undefined {
  const authMode = model?.authMode ?? 'api_key';
  const lower = stderr.toLowerCase();

  if (lower.includes('not logged in') || lower.includes('please run /login')) {
    if (authMode === 'subscription_oauth') {
      return 'Claude subscription token missing or expired. Re-run `claude setup-token`, update the secret, and rotate it in Manage → Secrets.';
    }
    return 'Claude API key missing. Select an API key secret in the node config or connect a Provider node.';
  }

  if (lower.includes('invalid api key')) {
    if (authMode === 'subscription_oauth') {
      return 'Subscription token rejected. Ensure the secret contains the output of `claude setup-token` (not an Anthropic API key).';
    }
    return 'Anthropic API key rejected. Verify the secret contains a valid `sk-ant-...` API key.';
  }

  return undefined;
}

export function mapAutoApprove(allow: boolean): {
  opencodePermission: 'allow' | 'ask';
  claudeSkipPermissions: boolean;
} {
  return {
    opencodePermission: allow ? 'allow' : 'ask',
    claudeSkipPermissions: allow,
  };
}

export function getOpenCodeModelString(
  model: { provider: string; modelId: string } | undefined,
): string {
  if (!model) return 'gpt-4o';
  return `${model.provider}/${model.modelId}`;
}

export function buildAgentPrompt(options: {
  task: string;
  systemPrompt?: string;
  taskContext?: unknown;
  supplementaryFiles?: string[];
}): string {
  const { task, systemPrompt, taskContext, supplementaryFiles = [] } = options;

  const defaultPrompt = `
# Investigation Task
{{TASK}}

# Context
The following context is available in /workspace/context.json.
Please investigate the issue and generate a detailed report.
`;

  let finalPrompt: string;
  if (systemPrompt?.trim()) {
    finalPrompt = `${systemPrompt}\n\n# Task\n${task}`;
    if (taskContext && typeof taskContext === 'object' && Object.keys(taskContext).length > 0) {
      finalPrompt +=
        '\n\n# Context\nThe following context is available in /workspace/context.json.';
    }
  } else {
    finalPrompt = defaultPrompt.replace('{{TASK}}', task);
  }

  if (supplementaryFiles.length > 0) {
    finalPrompt += '\n\n# Supplementary Files\n';
    for (const file of supplementaryFiles) {
      finalPrompt += `- /workspace/${file}\n`;
    }
  }

  finalPrompt =
    `${finalPrompt}\n\n# MCP Tools\n` +
    `Before you start, list the MCP tools you can see. If none are available, say so explicitly.`;

  return finalPrompt;
}

export function mergeOpenCodePlugins(
  providerConfig: Record<string, unknown>,
  enablePlugins: string[],
): Record<string, unknown> {
  if (enablePlugins.length === 0) {
    return providerConfig;
  }
  return {
    ...providerConfig,
    plugin: enablePlugins,
  };
}

export function buildClaudeRunCommand(options: {
  skipPermissions: boolean;
  enablePlugins: string[];
}): string {
  const parts = [
    'claude -p "$(cat /workspace/prompt.txt)"',
    '--mcp-config /workspace/.mcp.json',
    '--settings /workspace/settings.json',
  ];
  if (options.skipPermissions) {
    parts.push('--dangerously-skip-permissions');
  }
  for (const plugin of options.enablePlugins) {
    const dir = AGENT_PLUGIN_DIRS[plugin];
    if (dir) {
      parts.push(`--plugin-dir ${dir}`);
    }
  }
  return parts.join(' \\\n  ');
}

export function assertSkillsResolved(requestedIds: string[], resolved: AgentSkillRecord[]): void {
  if (requestedIds.length === 0) {
    return;
  }
  const resolvedIds = new Set(resolved.map((skill) => skill.id));
  const missing = requestedIds.filter((id) => !resolvedIds.has(id));
  if (missing.length > 0) {
    throw new ConfigurationError(`Agent skills not found or disabled: ${missing.join(', ')}`, {
      configKey: 'skillIds',
      details: { missingSkillIds: missing },
    });
  }
}
