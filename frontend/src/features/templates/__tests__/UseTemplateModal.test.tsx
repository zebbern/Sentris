import { describe, it, expect, mock, afterEach, beforeEach } from 'bun:test';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { createDialogMock } from '@/test/mocks/dialog';
import type { Template } from '@/types/templates';
import type { ComponentMetadata } from '@/schemas/component';
import { MemoryRouter } from 'react-router-dom';

// ---------------------------------------------------------------------------
// Module mocks (BEFORE import)
// ---------------------------------------------------------------------------

mock.module('@/components/ui/dialog', createDialogMock);

const mockMutateAsync = mock(() => Promise.resolve({ workflowId: 'wf-new-123' }));
let mockIsPending = false;
let mockSecrets = [
  {
    id: 'secret-api',
    name: 'Scanner API key',
    createdAt: '2025-01-01T00:00:00Z',
    updatedAt: '2025-01-01T00:00:00Z',
  },
  {
    id: 'secret-db',
    name: 'Database password',
    createdAt: '2025-01-01T00:00:00Z',
    updatedAt: '2025-01-01T00:00:00Z',
  },
];
let mockSecretsLoading = false;
let mockSecretsError: Error | null = null;
let mockComponentIndex:
  | { byId: Record<string, ComponentMetadata>; slugIndex: Record<string, string> }
  | undefined;
let mockComponentsLoading = false;
let mockComponentsError: Error | null = null;
let mockMcpServers: Record<string, unknown>[] = [];
let mockMcpTools: Record<string, unknown>[] = [];
let mockMcpServersLoading = false;
let mockMcpToolsLoading = false;
let mockMcpServersError: Error | null = null;
let mockMcpToolsError: Error | null = null;
const mockUseMcpServers = mock((_options?: { enabled?: boolean }) => ({
  data: mockMcpServers,
  isLoading: mockMcpServersLoading,
  error: mockMcpServersError,
}));
const mockUseMcpAllTools = mock((_options?: { enabled?: boolean }) => ({
  data: mockMcpTools,
  isLoading: mockMcpToolsLoading,
  error: mockMcpToolsError,
}));

mock.module('@/hooks/queries/useTemplateQueries', () => ({
  useUseTemplate: () => ({
    mutateAsync: mockMutateAsync,
    isPending: mockIsPending,
  }),
}));

mock.module('@/hooks/queries/useSecretQueries', () => ({
  useSecrets: () => ({
    data: mockSecrets,
    isLoading: mockSecretsLoading,
    error: mockSecretsError,
  }),
}));

mock.module('@/hooks/queries/useComponentQueries', () => ({
  useComponents: () => ({
    data: mockComponentIndex,
    isLoading: mockComponentsLoading,
    error: mockComponentsError,
  }),
}));

mock.module('@/hooks/queries/useMcpServerQueries', () => ({
  useMcpServers: mockUseMcpServers,
  useMcpAllTools: mockUseMcpAllTools,
}));

import { UseTemplateModal } from '../UseTemplateModal';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockTemplate(overrides: Partial<Template> = {}): Template {
  return {
    id: 'tpl-1',
    name: 'Security Scan Template',
    description: 'Runs a security scan',
    category: 'Security',
    tags: ['security', 'scanning'],
    author: 'Test Author',
    repository: 'org/repo',
    path: 'templates/security-scan.json',
    branch: 'main',
    version: '1.0.0',
    manifest: {},
    graph: {},
    requiredSecrets: [],
    popularity: 10,
    isOfficial: true,
    isVerified: true,
    isActive: true,
    createdAt: '2025-01-01T00:00:00Z',
    updatedAt: '2025-01-01T00:00:00Z',
    ...overrides,
  };
}

function component(id = 'core.ai.agent', inputId = 'chatModel'): ComponentMetadata {
  return {
    id,
    slug: id,
    name: 'AI Agent',
    type: 'process',
    category: 'transform',
    categoryConfig: { label: 'AI', color: '#000', description: '', emoji: '🤖' },
    inputs: [
      {
        id: inputId,
        label: 'Model',
        editor: 'llm-provider',
        connectionType: { kind: 'contract', name: 'core.ai.llm-provider.v1' },
      },
    ],
    outputs: [],
    parameters: [],
    version: '1.0.0',
    description: '',
    documentation: null,
    documentationUrl: null,
    icon: null,
    logo: null,
    author: null,
    isLatest: true,
    deprecated: false,
    example: null,
    runner: { kind: 'inline' },
    examples: [],
    toolProvider: null,
    toolSchema: null,
  };
}

function setComponentCatalog(...components: ComponentMetadata[]) {
  mockComponentIndex = {
    byId: Object.fromEntries(components.map((item) => [item.id, item])),
    slugIndex: Object.fromEntries(components.map((item) => [item.slug, item.id])),
  };
}

const modelGraph = (modelId = 'gpt-5') => ({
  nodes: [
    {
      id: 'agent-1',
      type: 'core.ai.agent',
      data: { config: { inputOverrides: { chatModel: { provider: 'openai', modelId } } } },
    },
  ],
  edges: [],
});

const mcpGraph = (policy: 'required' | 'best-effort' = 'required') => ({
  nodes: [
    {
      id: 'mcp-1',
      type: 'mcp.custom',
      data: { config: { params: { useAllEnabled: true }, inputOverrides: {} } },
    },
    {
      id: 'agent-1',
      type: 'core.ai.agent',
      data: {
        config: {
          params: { toolAvailability: policy },
          inputOverrides: { chatModel: { provider: 'openai', modelId: 'gpt-5' } },
        },
      },
    },
  ],
  edges: [{ source: 'mcp-1', target: 'agent-1', targetHandle: 'tools' }],
});

function renderModal(
  templateOverrides: Partial<Template> = {},
  props: Partial<Parameters<typeof UseTemplateModal>[0]> = {},
) {
  const template = createMockTemplate(templateOverrides);
  const defaultProps = {
    template,
    open: true,
    onOpenChange: mock(() => {}),
    onSuccess: mock(() => {}),
    ...props,
  };

  return {
    ...render(
      <MemoryRouter>
        <UseTemplateModal {...defaultProps} />
      </MemoryRouter>,
    ),
    props: defaultProps,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('UseTemplateModal', () => {
  beforeEach(() => {
    mockMutateAsync.mockReset();
    mockMutateAsync.mockImplementation(() => Promise.resolve({ workflowId: 'wf-new-123' }));
    mockIsPending = false;
    mockSecrets = [
      {
        id: 'secret-api',
        name: 'Scanner API key',
        createdAt: '2025-01-01T00:00:00Z',
        updatedAt: '2025-01-01T00:00:00Z',
      },
      {
        id: 'secret-db',
        name: 'Database password',
        createdAt: '2025-01-01T00:00:00Z',
        updatedAt: '2025-01-01T00:00:00Z',
      },
    ];
    mockSecretsLoading = false;
    mockSecretsError = null;
    mockComponentsLoading = false;
    mockComponentsError = null;
    setComponentCatalog(component(), {
      ...component('mcp.custom'),
      name: 'Custom MCP',
      inputs: [],
    });
    mockMcpServers = [];
    mockMcpTools = [];
    mockMcpServersLoading = false;
    mockMcpToolsLoading = false;
    mockMcpServersError = null;
    mockMcpToolsError = null;
    mockUseMcpServers.mockClear();
    mockUseMcpAllTools.mockClear();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders dialog with template name in title', () => {
    renderModal({ name: 'My Template' });

    expect(screen.getByText(/Configure & Run: My Template/)).toBeTruthy();
  });

  it('name input is pre-filled with the template name', () => {
    renderModal({ name: 'Security Scan' });

    const input = screen.getByLabelText('Workflow Name') as HTMLInputElement;
    expect(input.value).toBe('Security Scan');
  });

  it('renders category and description info', () => {
    renderModal({
      category: 'Monitoring',
      description: 'Monitors infrastructure',
    });

    expect(screen.getByText('Monitoring')).toBeTruthy();
    expect(screen.getByText('Monitors infrastructure')).toBeTruthy();
  });

  it('renders tags as badges', () => {
    renderModal({ tags: ['api', 'webhook'] });

    expect(screen.getByText('api')).toBeTruthy();
    expect(screen.getByText('webhook')).toBeTruthy();
  });

  it('renders secret mapping fields for templates with requiredSecrets', () => {
    renderModal({
      requiredSecrets: [
        { name: 'API_KEY', type: 'string', description: 'API key for service' },
        { name: 'DB_PASSWORD', type: 'password' },
      ],
    });

    expect(screen.getByText('API_KEY')).toBeTruthy();
    expect(screen.getByText('DB_PASSWORD')).toBeTruthy();
    expect(screen.getByText('API key for service')).toBeTruthy();
    expect(screen.getByText(/Required Secrets \(2\)/)).toBeTruthy();
  });

  it('shows "no secrets required" message when requiredSecrets is empty', () => {
    renderModal({ requiredSecrets: [] });

    expect(screen.getByText(/doesn't require any secrets/)).toBeTruthy();
  });

  it('fires mutation on submit', async () => {
    const onSuccess = mock(() => {});
    renderModal({ requiredSecrets: [] }, { onSuccess });

    fireEvent.click(screen.getByText('Create & Run'));

    await waitFor(() => {
      expect(mockMutateAsync).toHaveBeenCalledTimes(1);
    });
  });

  it('calls onSuccess with workflow ID after successful mutation', async () => {
    const onSuccess = mock(() => {});
    mockMutateAsync.mockImplementation(() => Promise.resolve({ workflowId: 'wf-created-456' }));

    renderModal({ requiredSecrets: [] }, { onSuccess });

    fireEvent.click(screen.getByText('Create & Run'));

    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalledWith('wf-created-456');
    });
  });

  it('shows error when workflow name is empty', async () => {
    renderModal({ requiredSecrets: [] });

    // Clear the workflow name
    const input = screen.getByLabelText('Workflow Name') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '' } });

    fireEvent.click(screen.getByText('Create & Run'));

    await waitFor(() => {
      expect(screen.getByText('Please enter a workflow name')).toBeTruthy();
    });
  });

  it('shows error when required secrets are not mapped', async () => {
    renderModal({
      requiredSecrets: [{ name: 'API_KEY', type: 'string' }],
    });

    fireEvent.submit(screen.getByRole('button', { name: 'Create & Run' }).closest('form')!);

    await waitFor(() => {
      expect(screen.getByText(/for each required credential/)).toBeTruthy();
    });
  });

  it('blocks direct submission when model readiness is unavailable', async () => {
    mockComponentIndex = undefined;
    mockComponentsError = Error('offline');
    renderModal({ graph: modelGraph() });

    fireEvent.submit(screen.getByRole('button', { name: 'Create & Run' }).closest('form')!);

    await waitFor(() => {
      expect(screen.getByText(/Resolve run readiness issues/)).toBeTruthy();
    });
    expect(mockMutateAsync).not.toHaveBeenCalled();
  });

  it('blocks direct submission when required MCP capabilities are unavailable', async () => {
    renderModal({ graph: mcpGraph('required') });

    fireEvent.submit(screen.getByRole('button', { name: 'Create & Run' }).closest('form')!);

    await waitFor(() => {
      expect(screen.getByText(/Resolve run readiness issues/)).toBeTruthy();
    });
    expect(mockMutateAsync).not.toHaveBeenCalled();
  });

  it('blocks direct submission when a selected secret mapping is stale', async () => {
    const rendered = renderModal({ requiredSecrets: [{ name: 'API_KEY', type: 'string' }] });

    fireEvent.change(screen.getByLabelText('API_KEY'), { target: { value: 'secret-api' } });
    mockSecrets = [
      {
        id: 'secret-db',
        name: 'Database password',
        createdAt: '2025-01-01T00:00:00Z',
        updatedAt: '2025-01-01T00:00:00Z',
      },
    ];
    rendered.rerender(
      <MemoryRouter>
        <UseTemplateModal {...rendered.props} />
      </MemoryRouter>,
    );
    fireEvent.submit(screen.getByRole('button', { name: 'Create & Run' }).closest('form')!);

    await waitFor(() => {
      expect(screen.getByText(/Resolve run readiness issues/)).toBeTruthy();
    });
    expect(mockMutateAsync).not.toHaveBeenCalled();
  });

  it('sends stored secret IDs rather than raw credential values', async () => {
    renderModal({
      requiredSecrets: [{ name: 'API_KEY', type: 'string' }],
    });

    fireEvent.change(screen.getByLabelText('API_KEY'), {
      target: { value: 'secret-api' },
    });
    fireEvent.click(screen.getByText('Create & Run'));

    await waitFor(() => {
      expect(mockMutateAsync).toHaveBeenCalledWith({
        templateId: 'tpl-1',
        workflowName: 'Security Scan Template',
        secretMappings: { API_KEY: 'secret-api' },
      });
    });
  });

  it('links to secret settings and prevents creation when no secrets exist', () => {
    mockSecrets = [];
    renderModal({
      requiredSecrets: [{ name: 'API_KEY', type: 'string' }],
    });

    expect(screen.getByText('No stored secrets are available.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Open secret settings' })).toHaveAttribute(
      'href',
      '/secrets',
    );
    expect(screen.getByRole('button', { name: 'Create & Run' })).toBeDisabled();
  });

  it('shows error state when mutation fails', async () => {
    mockMutateAsync.mockImplementation(() => Promise.reject(new Error('Network error')));

    renderModal({ requiredSecrets: [] });

    fireEvent.click(screen.getByText('Create & Run'));

    await waitFor(() => {
      expect(screen.getByText('Network error')).toBeTruthy();
    });
  });

  it('does not render when open is false', () => {
    renderModal({}, { open: false });

    expect(screen.queryByText(/Configure & Run/)).toBeNull();
  });

  it('shows the configured provider and model before creation', () => {
    renderModal({ graph: modelGraph() });

    expect(screen.getByLabelText('Configuration readiness').textContent).toContain(
      'OpenAI · gpt-5',
    );
  });

  it('deduplicates identical model configurations and shows the agent count', () => {
    renderModal({
      graph: {
        nodes: [
          ...modelGraph().nodes,
          {
            id: 'agent-2',
            type: 'core.ai.agent',
            data: {
              config: { inputOverrides: { chatModel: { provider: 'openai', modelId: 'gpt-5' } } },
            },
          },
        ],
        edges: [],
      },
    });

    expect(screen.getByLabelText('Configuration readiness').textContent).toContain(
      'OpenAI · gpt-5 (2 agents)',
    );
  });

  it('renders distinct model and MCP readiness rows without duplicate-key warnings', () => {
    const originalConsoleError = console.error;
    const consoleError = mock((..._args: unknown[]) => {});
    console.error = consoleError as typeof console.error;

    try {
      renderModal({
        graph: {
          nodes: [
            {
              id: 'mcp-1',
              type: 'mcp.custom',
              data: { config: { params: { useAllEnabled: true }, inputOverrides: {} } },
            },
            {
              id: 'openai-agent',
              type: 'core.ai.agent',
              data: {
                config: {
                  inputOverrides: { chatModel: { provider: 'openai', modelId: 'gpt-5' } },
                },
              },
            },
            {
              id: 'gemini-agent',
              type: 'core.ai.agent',
              data: {
                config: {
                  inputOverrides: {
                    chatModel: { provider: 'gemini', modelId: 'gemini-3.5-flash' },
                  },
                },
              },
            },
          ],
          edges: [
            { source: 'mcp-1', target: 'openai-agent', targetHandle: 'tools' },
            { source: 'mcp-1', target: 'gemini-agent', targetHandle: 'tools' },
          ],
        },
      });

      const readiness = screen.getByLabelText('Configuration readiness').textContent ?? '';
      expect(readiness).toContain('OpenAI · gpt-5');
      expect(readiness).toContain('Gemini · gemini-3.5-flash');
      expect(readiness.match(/MCP capabilities/g)).toHaveLength(2);
      expect(
        consoleError.mock.calls.some((call) => String(call[0]).includes('same key')),
      ).toBeFalse();
    } finally {
      console.error = originalConsoleError;
    }
  });

  it('shows required credentials as needing mapping and disables creation', () => {
    renderModal({ requiredSecrets: [{ name: 'API_KEY', type: 'string' }] });

    expect(screen.getByText('Needs mapping')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Create & Run' })).toBeDisabled();
  });

  it('shows required credentials as mapped and enables creation after selection', () => {
    renderModal({ requiredSecrets: [{ name: 'API_KEY', type: 'string' }] });

    fireEvent.change(screen.getByLabelText('API_KEY'), { target: { value: 'secret-api' } });

    expect(screen.getByText('1/1 mapped')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Create & Run' })).not.toBeDisabled();
  });

  it('shows optional MCP with no enabled servers without blocking creation', () => {
    renderModal({ graph: mcpGraph('best-effort') });

    expect(screen.getByLabelText('Configuration readiness').textContent).toContain(
      'MCP capabilities (optional)',
    );
    expect(screen.getByText('No enabled servers.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Create & Run' })).not.toBeDisabled();
  });

  it('shows ready and attention MCP server counts from current server and tool data', () => {
    mockMcpServers = [
      {
        id: 'server-1',
        name: 'Ready',
        enabled: true,
        lastHealthStatus: 'healthy',
      },
      {
        id: 'server-2',
        name: 'Attention',
        enabled: true,
        lastHealthStatus: 'unhealthy',
      },
    ];
    mockMcpTools = [
      {
        id: 'tool-1',
        toolName: 'search',
        serverId: 'server-1',
        serverName: 'Ready',
        enabled: true,
      },
      {
        id: 'tool-2',
        toolName: 'search',
        serverId: 'server-2',
        serverName: 'Attention',
        enabled: true,
      },
    ];
    renderModal({ graph: mcpGraph() });

    expect(screen.getByText('1 ready, 1 needs attention.')).toBeTruthy();
  });

  it('shows MCP status unavailable without blocking a best-effort template', () => {
    mockMcpServersError = Error('offline');
    renderModal({ graph: mcpGraph('best-effort') });

    expect(screen.getByText('Status unavailable.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Create & Run' })).not.toBeDisabled();
  });

  it('does not query or render MCP readiness for templates without an MCP connection', () => {
    renderModal({ graph: modelGraph() });

    expect(mockUseMcpServers).toHaveBeenCalledWith({ enabled: false });
    expect(screen.queryByText('MCP capabilities')).toBeNull();
  });

  it('shows model readiness unavailable when component metadata cannot load', () => {
    mockComponentIndex = undefined;
    mockComponentsError = Error('offline');
    renderModal({ graph: modelGraph() });

    expect(screen.getByLabelText('Configuration readiness').textContent).toContain(
      'Model status unavailable',
    );
    expect(screen.getByRole('button', { name: 'Create & Run' })).toBeDisabled();
  });

  it('announces readiness changes through a polite live region', () => {
    renderModal({ graph: modelGraph() });

    const liveRegion = document.querySelector('[aria-live="polite"][aria-atomic="true"]');
    expect(liveRegion?.textContent).toContain('Run readiness');
  });
});
