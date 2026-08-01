import { describe, expect, it } from 'bun:test';
import type { InputPort } from '@/schemas/component';
import type { McpServerResponse, McpToolResponse } from '@/hooks/queries/useMcpServerQueries';
import {
  evaluateCredentialMappingReadiness,
  evaluateLlmCredentialReadiness,
  evaluateLlmModelReadiness,
  evaluateLlmProviderReadiness,
  evaluateMcpToolsReadiness,
  findLlmProviderInput,
  isLlmProviderInput,
  type CatalogState,
} from '../readiness';

const secrets: CatalogState<{ id: string; name: string }> = {
  items: [{ id: 'secret-1', name: 'OPENAI_API_KEY' }],
  isLoading: false,
  error: null,
};

const server = (overrides: Partial<McpServerResponse> = {}): McpServerResponse => ({
  id: 'server-1',
  name: 'MCP Server',
  transportType: 'http',
  hasHeaders: false,
  enabled: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

const tool = (overrides: Partial<McpToolResponse> = {}): McpToolResponse => ({
  id: 'tool-1',
  toolName: 'search',
  serverId: 'server-1',
  serverName: 'MCP Server',
  enabled: true,
  discoveredAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

describe('agent readiness', () => {
  it('marks a supported inline provider and model ready', () => {
    const input = {
      id: 'model',
      label: 'Model',
      editor: 'llm-provider',
      connectionType: { kind: 'contract', name: 'core.ai.llm-provider.v1' },
    } as InputPort;

    expect(isLlmProviderInput(input)).toBe(true);
    expect(findLlmProviderInput([input])).toBe(input);
    expect(
      evaluateLlmModelReadiness({ value: { provider: 'openai', modelId: 'gpt-custom' } }),
    ).toMatchObject({ state: 'ready', blocksCreation: false, blocksExecution: false });
  });

  it('keeps malformed stored provider or model blocked after display normalization', () => {
    expect(
      evaluateLlmModelReadiness({ value: { provider: 'not-real', modelId: 'gpt-5' } }),
    ).toMatchObject({ state: 'not-configured', blocksCreation: true, blocksExecution: true });
    expect(
      evaluateLlmModelReadiness({ value: { provider: 'openai', modelId: ' ' } }),
    ).toMatchObject({ state: 'not-configured', blocksCreation: true, blocksExecution: true });
  });

  it('marks an existing API-key secret reference as Mapped', () => {
    expect(
      evaluateLlmCredentialReadiness({
        value: { provider: 'openai', modelId: 'gpt-5', apiKeySecretId: 'secret-1' },
        secrets,
      }),
    ).toMatchObject({ state: 'ready', label: 'Mapped' });
  });

  it('marks a deleted secret reference as Needs mapping', () => {
    expect(
      evaluateLlmCredentialReadiness({
        value: { provider: 'openai', modelId: 'gpt-5', apiKeySecretId: 'deleted' },
        secrets,
      }),
    ).toMatchObject({ state: 'needs-mapping', label: 'Needs mapping', blocksExecution: true });
  });

  it('reports secret loading and query errors without claiming Mapped', () => {
    const value = { provider: 'openai', modelId: 'gpt-5', apiKeySecretId: 'secret-1' };
    expect(
      evaluateLlmCredentialReadiness({
        value,
        secrets: { items: [], isLoading: true, error: null },
      }),
    ).toMatchObject({ state: 'loading', label: 'Loading' });
    expect(
      evaluateLlmCredentialReadiness({
        value,
        secrets: { items: [], isLoading: false, error: Error('nope') },
      }),
    ).toMatchObject({ state: 'error', label: 'Error' });
  });

  it('uses the connected provider for both model and credential readiness', () => {
    expect(
      evaluateLlmProviderReadiness({
        value: undefined,
        connectedSource: 'upstream-model',
        secrets: { items: [], isLoading: false, error: null },
      }),
    ).toEqual([
      expect.objectContaining({ kind: 'model', state: 'ready' }),
      expect.objectContaining({ kind: 'credential', state: 'ready' }),
    ]);
  });

  it('blocks subscription OAuth when the component supports API keys only', () => {
    expect(
      evaluateLlmCredentialReadiness({
        value: { authMode: 'subscription_oauth', oauthTokenSecretId: 'secret-1' },
        secrets,
      }),
    ).toMatchObject({ state: 'error', blocksCreation: true, blocksExecution: true });
  });

  it('accepts subscription OAuth only when the component declares that capability', () => {
    expect(
      evaluateLlmCredentialReadiness({
        value: { authMode: 'subscription_oauth', oauthTokenSecretId: 'secret-1' },
        supportedAuthModes: ['api_key', 'subscription_oauth'],
        secrets,
      }),
    ).toMatchObject({ state: 'ready', label: 'Mapped' });
  });

  it('reports a legacy inline key as degraded but executable', () => {
    expect(
      evaluateLlmCredentialReadiness({
        value: { provider: 'openai', modelId: 'gpt-5', apiKey: 'legacy-key' },
        secrets,
      }),
    ).toMatchObject({ state: 'degraded', blocksCreation: false, blocksExecution: false });
  });

  it('summarizes required template credential mappings by existing secret ID', () => {
    expect(
      evaluateCredentialMappingReadiness({
        requiredNames: ['OPENAI_API_KEY', 'GITHUB_TOKEN'],
        mappings: { OPENAI_API_KEY: 'secret-1', GITHUB_TOKEN: 'missing' },
        secrets,
      }),
    ).toMatchObject({ state: 'needs-mapping', blocksCreation: true, blocksExecution: true });
  });

  it('keeps no connected MCP node optional and non-blocking', () => {
    expect(
      evaluateMcpToolsReadiness({
        connected: false,
        policy: 'required',
        servers: { items: [], isLoading: false, error: null },
        tools: { items: [], isLoading: false, error: null },
      }),
    ).toMatchObject({ state: 'not-configured', blocksCreation: false, blocksExecution: false });
  });

  it('keeps degraded best-effort MCP selections non-blocking', () => {
    expect(
      evaluateMcpToolsReadiness({
        connected: true,
        policy: 'best-effort',
        selection: { useAllEnabled: false, serverIds: ['server-1'], toolExclusions: [] },
        servers: {
          items: [server({ lastHealthStatus: 'unhealthy' })],
          isLoading: false,
          error: null,
        },
        tools: { items: [tool()], isLoading: false, error: null },
      }),
    ).toMatchObject({ state: 'degraded', blocksCreation: false, blocksExecution: false });
  });

  it('blocks required MCP when selected servers expose no usable tools', () => {
    expect(
      evaluateMcpToolsReadiness({
        connected: true,
        policy: 'required',
        selection: { useAllEnabled: false, serverIds: ['server-1'], toolExclusions: [] },
        servers: { items: [server()], isLoading: false, error: null },
        tools: { items: [tool({ enabled: false })], isLoading: false, error: null },
      }),
    ).toMatchObject({ state: 'not-configured', blocksCreation: true, blocksExecution: true });
  });

  it('honors use-all-enabled, explicit selections, disabled servers, and tool exclusions', () => {
    const servers = {
      items: [server({ lastHealthStatus: 'healthy' }), server({ id: 'server-2', enabled: false })],
      isLoading: false,
      error: null,
    };
    const tools = {
      items: [
        tool(),
        tool({ id: 'tool-2', toolName: 'excluded' }),
        tool({ id: 'tool-3', serverId: 'server-2' }),
      ],
      isLoading: false,
      error: null,
    };
    expect(
      evaluateMcpToolsReadiness({
        connected: true,
        policy: 'required',
        selection: { useAllEnabled: true, serverIds: [], toolExclusions: ['server-1:excluded'] },
        servers,
        tools,
      }),
    ).toMatchObject({ state: 'ready' });
    expect(
      evaluateMcpToolsReadiness({
        connected: true,
        policy: 'required',
        selection: { useAllEnabled: false, serverIds: ['server-2'], toolExclusions: [] },
        servers,
        tools,
      }),
    ).toMatchObject({ state: 'not-configured' });
  });

  it('blocks an MCP query failure only for required tools', () => {
    const failedServers = { items: [], isLoading: false, error: Error('offline') };
    const tools = { items: [], isLoading: false, error: null };
    expect(
      evaluateMcpToolsReadiness({
        connected: true,
        policy: 'required',
        servers: failedServers,
        tools,
      }),
    ).toMatchObject({ state: 'error', blocksCreation: true, blocksExecution: true });
    expect(
      evaluateMcpToolsReadiness({
        connected: true,
        policy: 'best-effort',
        servers: failedServers,
        tools,
      }),
    ).toMatchObject({ state: 'error', blocksCreation: false, blocksExecution: false });
  });
});
