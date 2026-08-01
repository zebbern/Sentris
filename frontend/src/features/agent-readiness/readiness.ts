import { isLlmModelProvider } from '@sentris/shared';
import type { McpServerResponse, McpToolResponse } from '@/hooks/queries/useMcpServerQueries';
import { getMcpAgentReadiness } from '@/lib/mcpReadiness';
import type { InputPort } from '@/schemas/component';
import type { SecretSummary } from '@/schemas/secret';

export type AgentReadinessKind = 'model' | 'credential' | 'mcp-tools';
export type AgentReadinessState =
  | 'ready'
  | 'loading'
  | 'not-configured'
  | 'needs-mapping'
  | 'degraded'
  | 'error';

export interface AgentReadinessRow {
  kind: AgentReadinessKind;
  state: AgentReadinessState;
  label: string;
  detail: string;
  blocksCreation: boolean;
  blocksExecution: boolean;
}

export interface CatalogState<T> {
  items: readonly T[];
  isLoading: boolean;
  error: unknown | null;
}

export type LlmAuthMode = 'api_key' | 'subscription_oauth';

export interface McpSelection {
  useAllEnabled: boolean;
  serverIds: readonly string[];
  toolExclusions: readonly string[];
}

interface LlmProviderValue {
  provider?: unknown;
  modelId?: unknown;
  authMode?: unknown;
  apiKeySecretId?: unknown;
  oauthTokenSecretId?: unknown;
  apiKey?: unknown;
}

const apiKeyAuthModes: readonly LlmAuthMode[] = ['api_key'];

function row(
  kind: AgentReadinessKind,
  state: AgentReadinessState,
  label: string,
  detail: string,
  blocksCreation: boolean,
  blocksExecution: boolean,
): AgentReadinessRow {
  return { kind, state, label, detail, blocksCreation, blocksExecution };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asProviderValue(value: unknown): LlmProviderValue {
  return isRecord(value) ? value : {};
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function authMode(value: LlmProviderValue): LlmAuthMode | undefined {
  if (value.authMode === undefined) return 'api_key';
  return value.authMode === 'api_key' || value.authMode === 'subscription_oauth'
    ? value.authMode
    : undefined;
}

function supportedModes(supportedAuthModes?: readonly LlmAuthMode[]): readonly LlmAuthMode[] {
  return supportedAuthModes ?? apiKeyAuthModes;
}

function hasSupportedAuthMode(
  value: LlmProviderValue,
  modes: readonly LlmAuthMode[],
): value is LlmProviderValue & { authMode?: LlmAuthMode } {
  const mode = authMode(value);
  return mode !== undefined && modes.includes(mode);
}

export function isLlmProviderInput(input: InputPort): boolean {
  return (
    input.editor === 'llm-provider' ||
    (input.connectionType?.kind === 'contract' &&
      input.connectionType.name === 'core.ai.llm-provider.v1')
  );
}

export function findLlmProviderInput(inputs: readonly InputPort[]): InputPort | undefined {
  return inputs.find(isLlmProviderInput);
}

export function evaluateLlmModelReadiness(input: {
  value: unknown;
  connectedSource?: string;
  supportedAuthModes?: readonly LlmAuthMode[];
}): AgentReadinessRow {
  if (nonEmptyString(input.connectedSource)) {
    return row(
      'model',
      'ready',
      'Connected',
      'Provided by the connected upstream model.',
      false,
      false,
    );
  }

  const value = asProviderValue(input.value);
  if (!isLlmModelProvider(value.provider) || !nonEmptyString(value.modelId)) {
    return row(
      'model',
      'not-configured',
      'Not configured',
      'Choose a supported provider and a model.',
      true,
      true,
    );
  }

  return row('model', 'ready', 'Ready', 'Provider and model are configured.', false, false);
}

export function evaluateLlmCredentialReadiness(input: {
  value: unknown;
  connectedSource?: string;
  supportedAuthModes?: readonly LlmAuthMode[];
  secrets: CatalogState<Pick<SecretSummary, 'id' | 'name'>>;
}): AgentReadinessRow {
  if (nonEmptyString(input.connectedSource)) {
    return row(
      'credential',
      'ready',
      'Connected',
      'Credentials are provided by the connected upstream model.',
      false,
      false,
    );
  }

  const value = asProviderValue(input.value);
  const mode = authMode(value);
  if (!mode || !hasSupportedAuthMode(value, supportedModes(input.supportedAuthModes))) {
    return row(
      'credential',
      'error',
      'Unsupported authentication',
      'This component does not support the configured authentication mode.',
      true,
      true,
    );
  }

  const secretId = nonEmptyString(
    mode === 'subscription_oauth' ? value.oauthTokenSecretId : value.apiKeySecretId,
  );
  if (secretId) {
    if (input.secrets.isLoading) {
      return row(
        'credential',
        'loading',
        'Loading',
        'Loading stored secret mappings.',
        true,
        false,
      );
    }
    if (input.secrets.error) {
      return row(
        'credential',
        'error',
        'Error',
        'Stored secret mappings could not be loaded.',
        true,
        false,
      );
    }
    if (input.secrets.items.some((secret) => secret.id === secretId)) {
      return row(
        'credential',
        'ready',
        'Mapped',
        'Mapped to an existing stored secret.',
        false,
        false,
      );
    }
    return row(
      'credential',
      'needs-mapping',
      'Needs mapping',
      'The referenced stored secret no longer exists.',
      true,
      true,
    );
  }

  if (mode === 'api_key' && nonEmptyString(value.apiKey)) {
    return row(
      'credential',
      'degraded',
      'Legacy inline key',
      'Move this inline API key to a stored secret.',
      false,
      false,
    );
  }

  return row(
    'credential',
    'needs-mapping',
    'Needs mapping',
    'Select a stored secret for this credential.',
    true,
    true,
  );
}

export function evaluateLlmProviderReadiness(input: {
  value: unknown;
  connectedSource?: string;
  supportedAuthModes?: readonly LlmAuthMode[];
  secrets: CatalogState<Pick<SecretSummary, 'id' | 'name'>>;
}): AgentReadinessRow[] {
  return [evaluateLlmModelReadiness(input), evaluateLlmCredentialReadiness(input)];
}

export function evaluateCredentialMappingReadiness(input: {
  requiredNames: readonly string[];
  mappings: Readonly<Record<string, string>>;
  secrets: CatalogState<Pick<SecretSummary, 'id' | 'name'>>;
}): AgentReadinessRow {
  if (input.requiredNames.length === 0) {
    return row(
      'credential',
      'ready',
      'Mapped',
      'No credential mappings are required.',
      false,
      false,
    );
  }
  if (input.secrets.isLoading) {
    return row('credential', 'loading', 'Loading', 'Loading stored secret mappings.', true, false);
  }
  if (input.secrets.error) {
    return row(
      'credential',
      'error',
      'Error',
      'Stored secret mappings could not be loaded.',
      true,
      false,
    );
  }

  const secretIds = new Set(input.secrets.items.map((secret) => secret.id));
  const missing = input.requiredNames.filter((name) => !secretIds.has(input.mappings[name] ?? ''));
  if (missing.length > 0) {
    return row(
      'credential',
      'needs-mapping',
      'Needs mapping',
      `${missing.length} required credential mapping${missing.length === 1 ? '' : 's'} need attention.`,
      true,
      true,
    );
  }
  return row('credential', 'ready', 'Mapped', 'All required credentials are mapped.', false, false);
}

function availabilityRow(
  policy: 'required' | 'best-effort',
  state: AgentReadinessState,
  detail: string,
) {
  if (policy === 'best-effort') {
    return row(
      'mcp-tools',
      state === 'error' ? 'error' : 'degraded',
      state === 'error' ? 'Error' : 'Degraded',
      detail,
      false,
      false,
    );
  }
  if (state === 'loading') return row('mcp-tools', 'loading', 'Loading', detail, true, false);
  if (state === 'error') return row('mcp-tools', 'error', 'Error', detail, true, true);
  return row('mcp-tools', 'not-configured', 'Not configured', detail, true, true);
}

export function evaluateMcpToolsReadiness(input: {
  connected: boolean;
  policy: 'required' | 'best-effort';
  selection?: McpSelection;
  servers: CatalogState<McpServerResponse>;
  tools: CatalogState<McpToolResponse>;
}): AgentReadinessRow {
  if (!input.connected) {
    return row(
      'mcp-tools',
      'not-configured',
      'Not connected',
      'No MCP node is connected.',
      false,
      false,
    );
  }
  if (input.servers.error || input.tools.error) {
    return availabilityRow(
      input.policy,
      'error',
      'MCP server or tool catalog could not be loaded.',
    );
  }
  if (input.servers.isLoading || input.tools.isLoading) {
    return availabilityRow(input.policy, 'loading', 'Loading MCP server and tool catalogs.');
  }

  const selection = input.selection ?? { useAllEnabled: false, serverIds: [], toolExclusions: [] };
  const selectedIds = new Set(selection.serverIds);
  const selectedServers = input.servers.items.filter(
    (server) => server.enabled && (selection.useAllEnabled || selectedIds.has(server.id)),
  );
  const exclusions = new Set(selection.toolExclusions);
  const usableServers = selectedServers.filter((server) => {
    const toolCounts = input.tools.items
      .filter((tool) => tool.serverId === server.id)
      .reduce(
        (counts, tool) => ({
          total: counts.total + 1,
          enabled:
            counts.enabled +
            (tool.enabled && !exclusions.has(`${server.id}:${tool.toolName}`) ? 1 : 0),
        }),
        { enabled: 0, total: 0 },
      );
    return (
      getMcpAgentReadiness({
        enabled: server.enabled,
        healthStatus: server.lastHealthStatus ?? null,
        toolCounts,
      }).status === 'ready'
    );
  });

  if (usableServers.length === 0) {
    return availabilityRow(
      input.policy,
      'not-configured',
      'No selected MCP servers expose usable tools.',
    );
  }
  return row('mcp-tools', 'ready', 'Ready', 'Selected MCP tools are available.', false, false);
}
