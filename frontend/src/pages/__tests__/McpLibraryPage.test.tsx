import { describe, it, beforeEach, afterEach, expect, mock, afterAll } from 'bun:test';
import { restoreMockedModules } from '@/test/restore-mocks';
import { fireEvent, screen, cleanup } from '@testing-library/react';
import { createDialogMock, createAlertDialogMock } from '@/test/mocks/dialog';
import { createAuthStoreMock } from '@/test/mocks/auth-store';
import { renderWithProviders } from '@/test/render-with-providers';

// --- Mock dialog / alert-dialog components (passthrough for test rendering) ---
mock.module('@/components/ui/dialog', createDialogMock);
mock.module('@/components/ui/alert-dialog', createAlertDialogMock);

mock.module('@/components/ui/sheet', () => {
  const Sheet = ({ open, children }: any) => (open ? <>{children}</> : null);
  const SheetContent = ({ children, ...props }: any) => (
    <div role="dialog" data-testid="sheet-content" {...props}>
      {children}
    </div>
  );
  const passthrough = ({ children, ...props }: any) => <div {...props}>{children}</div>;
  const passthroughInline = ({ children, ...props }: any) => <span {...props}>{children}</span>;
  const FragmentWrapper = ({ children }: any) => <>{children}</>;

  return {
    Sheet,
    SheetContent,
    SheetHeader: passthrough,
    SheetFooter: passthrough,
    SheetTitle: passthroughInline,
    SheetDescription: passthroughInline,
    SheetPortal: FragmentWrapper,
    SheetOverlay: FragmentWrapper,
    SheetTrigger: FragmentWrapper,
    SheetClose: FragmentWrapper,
  };
});

// --- Mutable mock state for MCP server queries ---
import type { McpServerResponse, McpToolResponse } from '@/hooks/queries/useMcpServerQueries';
import type { McpGroupResponse, McpGroupTemplateResponse } from '@/services/mcpGroupsApi';

const mockQueryState: {
  servers: McpServerResponse[];
  tools: McpToolResponse[];
  groups: McpGroupResponse[];
  groupTemplates: McpGroupTemplateResponse[];
  isLoading: boolean;
  isLoadingTemplates: boolean;
  error: Error | null;
  deleteServer: any;
  toggleServer: any;
  testConnection: any;
  fetchServerTools: any;
  toggleTool: any;
  discoverTools: any;
} = {
  servers: [],
  tools: [],
  groups: [],
  groupTemplates: [],
  isLoading: false,
  isLoadingTemplates: false,
  error: null,
  deleteServer: mock().mockResolvedValue(undefined),
  toggleServer: mock().mockResolvedValue({ id: 'srv-1', enabled: true, name: 'Test' }),
  testConnection: mock().mockResolvedValue({ success: true, message: 'OK' }),
  fetchServerTools: mock().mockResolvedValue([]),
  toggleTool: mock().mockResolvedValue({ id: 'tool-1', toolName: 'test', enabled: true }),
  discoverTools: mock().mockResolvedValue([]),
};

mock.module('@/hooks/queries/useMcpServerQueries', () => ({
  useMcpServers: () => ({
    data: mockQueryState.servers,
    isLoading: mockQueryState.isLoading,
    error: mockQueryState.error,
  }),
  useMcpAllTools: () => ({
    data: mockQueryState.tools,
    isLoading: false,
  }),
  useDeleteMcpServer: () => ({
    mutateAsync: mockQueryState.deleteServer,
  }),
  useToggleMcpServer: () => ({
    mutateAsync: mockQueryState.toggleServer,
  }),
  useTestMcpConnection: () => ({
    mutateAsync: mockQueryState.testConnection,
  }),
  useFetchServerTools: () => ({
    mutateAsync: mockQueryState.fetchServerTools,
  }),
  useToggleMcpTool: () => ({
    mutateAsync: mockQueryState.toggleTool,
  }),
  useDiscoverMcpTools: () => ({
    mutateAsync: mockQueryState.discoverTools,
  }),
  useCreateMcpServer: () => ({
    mutateAsync: mock().mockResolvedValue({}),
  }),
  useUpdateMcpServer: () => ({
    mutateAsync: mock().mockResolvedValue({}),
  }),
}));

mock.module('@/hooks/queries/useMcpGroupQueries', () => ({
  useMcpGroupsWithServers: () => ({
    data: mockQueryState.groups,
    isLoading: false,
  }),
  useMcpGroupTemplates: () => ({
    data: mockQueryState.groupTemplates,
    isLoading: mockQueryState.isLoadingTemplates,
  }),
  useImportMcpGroupTemplate: () => ({
    mutateAsync: mock().mockResolvedValue({}),
  }),
  useDeleteMcpGroup: () => ({
    mutateAsync: mock().mockResolvedValue(undefined),
  }),
  useSyncMcpGroupTemplates: () => ({
    mutateAsync: mock().mockResolvedValue(undefined),
  }),
}));

// Mock mcpDiscoveryApi to prevent real API calls
mock.module('@/services/mcpDiscoveryApi', () => ({
  mcpDiscoveryApi: {
    discover: mock().mockResolvedValue({ workflowId: 'wf-1' }),
    getStatus: mock().mockResolvedValue({ status: 'completed', tools: [] }),
    testGroupServers: mock().mockResolvedValue({ servers: [] }),
  },
}));

// Mock env to avoid schema validation errors
mock.module('@/config/env', () => ({
  env: {
    VITE_API_BASE_URL: 'http://localhost:4000',
    VITE_LOGO_DEV_PUBLIC_KEY: 'test-key',
  },
}));

// --- Auth store ---
mock.module('@/store/authStore', () => createAuthStoreMock());

// Import component AFTER all mock.module() calls
import { McpLibraryPage } from '@/pages/McpLibraryPage';

// --- Fixtures ---
const ISO = '2024-06-15T12:00:00.000Z';

const baseServer: McpServerResponse = {
  id: 'srv-001',
  name: 'GitHub MCP',
  description: 'GitHub API integration',
  transportType: 'http',
  endpoint: 'http://localhost:3100',
  command: null,
  args: null,
  hasHeaders: false,
  headerKeys: null,
  enabled: true,
  healthCheckUrl: null,
  lastHealthCheck: null,
  lastHealthStatus: 'healthy',
  createdAt: ISO,
  updatedAt: ISO,
  groupId: null,
};

const secondServer: McpServerResponse = {
  ...baseServer,
  id: 'srv-002',
  name: 'Filesystem MCP',
  description: 'Local filesystem access',
  transportType: 'stdio',
  endpoint: null,
  command: 'npx',
  args: ['-y', '@modelcontextprotocol/server-filesystem'],
  enabled: false,
  lastHealthStatus: 'unknown',
};

const baseTool: McpToolResponse = {
  id: 'tool-001',
  toolName: 'list_repos',
  description: 'List GitHub repositories',
  inputSchema: null,
  serverId: 'srv-001',
  serverName: 'GitHub MCP',
  enabled: true,
  discoveredAt: ISO,
};

// --- Helpers ---
interface MockQueryOverrides {
  servers?: McpServerResponse[];
  tools?: McpToolResponse[];
  groups?: McpGroupResponse[];
  groupTemplates?: McpGroupTemplateResponse[];
  isLoading?: boolean;
  isLoadingTemplates?: boolean;
  error?: Error | null;
  deleteServer?: (...args: any[]) => Promise<any>;
  toggleServer?: (...args: any[]) => Promise<any>;
  testConnection?: (...args: any[]) => Promise<any>;
}

const setupStore = (overrides: MockQueryOverrides = {}) => {
  mockQueryState.servers = overrides.servers ?? [baseServer, secondServer];
  mockQueryState.tools = overrides.tools ?? [baseTool];
  mockQueryState.groups = overrides.groups ?? [];
  mockQueryState.groupTemplates = overrides.groupTemplates ?? [];
  mockQueryState.isLoading = overrides.isLoading ?? false;
  mockQueryState.isLoadingTemplates = overrides.isLoadingTemplates ?? false;
  mockQueryState.error = overrides.error ?? null;
  mockQueryState.deleteServer = overrides.deleteServer ?? mock().mockResolvedValue(undefined);
  mockQueryState.toggleServer =
    overrides.toggleServer ??
    mock().mockResolvedValue({ id: 'srv-1', enabled: true, name: 'Test' });
  mockQueryState.testConnection =
    overrides.testConnection ?? mock().mockResolvedValue({ success: true, message: 'OK' });

  return mockQueryState;
};

const renderPage = () => renderWithProviders(<McpLibraryPage />);

// --- Tests ---
afterAll(() =>
  restoreMockedModules([
    '@/components/ui/dialog',
    '@/components/ui/alert-dialog',
    '@/components/ui/sheet',
    '@/hooks/queries/useMcpServerQueries',
    '@/hooks/queries/useMcpGroupQueries',
    '@/services/mcpDiscoveryApi',
    '@/config/env',
  ]),
);

describe('McpLibraryPage', () => {
  beforeEach(() => {
    cleanup();
    setupStore();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders without crashing', () => {
    renderPage();
    expect(screen.getByText('Add Server')).toBeInTheDocument();
  });

  it('renders page heading', () => {
    renderPage();

    expect(screen.getByRole('heading', { level: 2, name: /MCP Library/i })).toBeInTheDocument();
  });

  it('renders loading skeletons when isLoading is true and no servers', () => {
    setupStore({ isLoading: true, servers: [] });
    renderPage();

    // Skeleton component renders with animate-pulse class
    const skeletons = document.querySelectorAll('[class*="animate-pulse"]');
    expect(skeletons.length).toBeGreaterThan(0);
  });

  it('renders empty state when no custom servers', () => {
    setupStore({ servers: [] });
    renderPage();

    expect(screen.getByText('No custom servers configured')).toBeInTheDocument();
    expect(screen.getByText('Add your first custom server')).toBeInTheDocument();
  });

  it('renders server names with mock data', () => {
    setupStore();
    renderPage();

    expect(screen.getByText('GitHub MCP')).toBeInTheDocument();
    expect(screen.getByText('Filesystem MCP')).toBeInTheDocument();
  });

  it('renders server descriptions', () => {
    setupStore();
    renderPage();

    expect(screen.getByText('GitHub API integration')).toBeInTheDocument();
    expect(screen.getByText('Local filesystem access')).toBeInTheDocument();
  });

  it('renders the "Add Server" button', () => {
    renderPage();

    const addButton = screen.getByRole('button', { name: /Add Server/i });
    expect(addButton).toBeInTheDocument();
  });

  it('renders the search input', () => {
    renderPage();

    const searchInput = screen.getByPlaceholderText(/Filter by server name/i);
    expect(searchInput).toBeInTheDocument();
  });

  it('search filters custom servers by name', () => {
    setupStore();
    renderPage();

    // Both servers initially visible
    expect(screen.getByText('GitHub MCP')).toBeInTheDocument();
    expect(screen.getByText('Filesystem MCP')).toBeInTheDocument();

    // Type in search
    const searchInput = screen.getByPlaceholderText(/Filter by server name/i);
    fireEvent.change(searchInput, { target: { value: 'GitHub' } });

    // Only matching server remains
    expect(screen.getByText('GitHub MCP')).toBeInTheDocument();
    expect(screen.queryByText('Filesystem MCP')).not.toBeInTheDocument();
  });

  it('search shows empty message when no match', () => {
    setupStore();
    renderPage();

    const searchInput = screen.getByPlaceholderText(/Filter by server name/i);
    fireEvent.change(searchInput, { target: { value: 'nonexistent' } });

    expect(screen.getByText('No servers match your search')).toBeInTheDocument();
  });

  it('renders refresh button', () => {
    renderPage();

    const refreshButton = screen.getByRole('button', { name: /Refresh MCP servers/i });
    expect(refreshButton).toBeInTheDocument();
  });

  it('shows ErrorBanner when error is set', () => {
    setupStore({ error: new Error('Failed to load MCP servers') });
    renderPage();

    expect(screen.getByText('Failed to load MCP servers')).toBeInTheDocument();
  });

  it('renders the Custom MCP Servers section heading', () => {
    renderPage();

    expect(screen.getByText('Custom MCP Servers')).toBeInTheDocument();
  });

  it('displays server count badge', () => {
    setupStore({ servers: [baseServer, secondServer] });
    renderPage();

    expect(screen.getByText('2 servers')).toBeInTheDocument();
  });

  it('displays singular server count badge for one server', () => {
    setupStore({ servers: [baseServer] });
    renderPage();

    expect(screen.getByText('1 server')).toBeInTheDocument();
  });

  it('renders group templates section heading when templates exist', () => {
    const template: McpGroupTemplateResponse = {
      slug: 'aws-mcp',
      name: 'AWS MCP',
      description: 'AWS integration servers',
      credentialContractName: 'aws-creds',
      credentialMapping: null,
      defaultDockerImage: 'ghcr.io/aws/mcp:latest',
      version: { major: 1, minor: 0, patch: 0 },
      servers: [],
      templateHash: 'abc123',
    };
    setupStore({ groupTemplates: [template] });
    renderPage();

    expect(screen.getByText('AWS MCP')).toBeInTheDocument();
  });
});
