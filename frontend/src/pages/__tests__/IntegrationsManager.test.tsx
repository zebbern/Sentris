import { describe, it, beforeEach, afterEach, expect, mock } from 'bun:test';
import { screen, cleanup } from '@testing-library/react';
import { createDialogMock, createAlertDialogMock } from '@/test/mocks/dialog';
import { renderWithProviders } from '@/test/render-with-providers';

// --- Mock dialog components (passthrough for test rendering) ---
mock.module('@/components/ui/dialog', createDialogMock);
mock.module('@/components/ui/alert-dialog', createAlertDialogMock);

// --- Types for mock data ---
interface MockProvider {
  id: string;
  name: string;
  description: string;
  isConfigured: boolean;
  defaultScopes: string[];
  docsUrl?: string | null;
}

interface MockConnection {
  id: string;
  provider: string;
  providerName: string;
  userId: string;
  status: 'active' | 'expired' | 'revoked';
  scopes: string[];
  expiresAt: string | null;
  hasRefreshToken: boolean;
  supportsRefresh: boolean;
  updatedAt: string;
  createdAt: string;
}

// --- Mutable mock state for integration queries ---
const mockQueryState: {
  providers: MockProvider[];
  connections: MockConnection[];
  loadingProviders: boolean;
  loadingConnections: boolean;
  providersError: Error | null;
  connectionsError: Error | null;
  refreshConnection: any;
  disconnectIntegration: any;
} = {
  providers: [],
  connections: [],
  loadingProviders: false,
  loadingConnections: false,
  providersError: null,
  connectionsError: null,
  refreshConnection: mock().mockResolvedValue(undefined),
  disconnectIntegration: mock().mockResolvedValue(undefined),
};

mock.module('@/hooks/queries/useIntegrationQueries', () => ({
  useIntegrationProviders: () => ({
    data: mockQueryState.providers,
    isLoading: mockQueryState.loadingProviders,
    error: mockQueryState.providersError,
  }),
  useIntegrationConnections: () => ({
    data: mockQueryState.connections,
    isLoading: mockQueryState.loadingConnections,
    error: mockQueryState.connectionsError,
  }),
  useRefreshConnection: () => ({
    mutateAsync: mockQueryState.refreshConnection,
  }),
  useDisconnectIntegration: () => ({
    mutateAsync: mockQueryState.disconnectIntegration,
  }),
}));

// Mock getCurrentUserId
mock.module('@/lib/currentUser', () => ({
  getCurrentUserId: () => 'test-user-id',
}));

// Mock env to avoid schema validation errors
mock.module('@/config/env', () => ({
  env: {
    VITE_API_BASE_URL: 'http://localhost:4000',
    VITE_LOGO_DEV_PUBLIC_KEY: 'test-key',
  },
}));

// Mock api service to prevent real API calls
mock.module('@/services/api', () => ({
  api: {
    integrations: {
      startOAuth: mock().mockResolvedValue({ authorizationUrl: 'https://example.com/oauth' }),
      listProviders: mock().mockResolvedValue([]),
      listConnections: mock().mockResolvedValue([]),
      getProviderConfig: mock().mockResolvedValue({}),
    },
  },
  getApiAuthHeaders: mock().mockResolvedValue({}),
  API_BASE_URL: 'http://localhost:4000',
}));

// Mock ProviderConfigDialog as a simple stub
mock.module('@/pages/integrations/ProviderConfigDialog', () => ({
  ProviderConfigDialog: () => null,
}));

// Mock IntegrationCallbackBridge as a no-op
mock.module('@/pages/integrations/IntegrationCallbackBridge', () => ({
  IntegrationCallbackBridge: () => null,
}));

// Import component AFTER all mock.module() calls
import { IntegrationsManager } from '@/pages/IntegrationsManager';

// --- Fixtures ---
const ISO = '2024-06-15T12:00:00.000Z';

const githubProvider: MockProvider = {
  id: 'github',
  name: 'GitHub',
  description: 'GitHub OAuth integration for repository access',
  isConfigured: true,
  defaultScopes: ['repo', 'read:user'],
  docsUrl: 'https://docs.github.com',
};

const zoomProvider: MockProvider = {
  id: 'zoom',
  name: 'Zoom',
  description: 'Zoom OAuth for meeting management',
  isConfigured: false,
  defaultScopes: ['meeting:read'],
  docsUrl: null,
};

const githubConnection: MockConnection = {
  id: 'conn-001',
  provider: 'github',
  providerName: 'GitHub',
  userId: 'test-user-id',
  status: 'active',
  scopes: ['repo', 'read:user'],
  expiresAt: '2025-01-01T00:00:00.000Z',
  hasRefreshToken: true,
  supportsRefresh: true,
  updatedAt: ISO,
  createdAt: ISO,
};

const expiredConnection: MockConnection = {
  ...githubConnection,
  id: 'conn-002',
  provider: 'zoom',
  providerName: 'Zoom',
  status: 'expired',
  scopes: ['meeting:read'],
  hasRefreshToken: false,
  supportsRefresh: false,
};

// --- Helpers ---
interface MockQueryOverrides {
  providers?: MockProvider[];
  connections?: MockConnection[];
  loadingProviders?: boolean;
  loadingConnections?: boolean;
  providersError?: Error | null;
  connectionsError?: Error | null;
  refreshConnection?: (...args: any[]) => Promise<any>;
  disconnectIntegration?: (...args: any[]) => Promise<any>;
}

const setupStore = (overrides: MockQueryOverrides = {}) => {
  mockQueryState.providers = overrides.providers ?? [githubProvider, zoomProvider];
  mockQueryState.connections = overrides.connections ?? [];
  mockQueryState.loadingProviders = overrides.loadingProviders ?? false;
  mockQueryState.loadingConnections = overrides.loadingConnections ?? false;
  mockQueryState.providersError = overrides.providersError ?? null;
  mockQueryState.connectionsError = overrides.connectionsError ?? null;
  mockQueryState.refreshConnection =
    overrides.refreshConnection ?? mock().mockResolvedValue(undefined);
  mockQueryState.disconnectIntegration =
    overrides.disconnectIntegration ?? mock().mockResolvedValue(undefined);

  return mockQueryState;
};

const renderPage = () => renderWithProviders(<IntegrationsManager />);

// --- Tests ---
describe('IntegrationsManager', () => {
  beforeEach(() => {
    cleanup();
    setupStore();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders without crashing', () => {
    renderPage();
    expect(screen.getByText('Available providers')).toBeInTheDocument();
  });

  it('renders page heading', () => {
    renderPage();

    expect(screen.getByRole('heading', { level: 2, name: /^Connections$/ })).toBeInTheDocument();
  });

  it('renders section headings', () => {
    renderPage();

    expect(screen.getByText('Active connections')).toBeInTheDocument();
    expect(screen.getByText('Available providers')).toBeInTheDocument();
  });

  it('renders loading skeletons when providers are loading', () => {
    setupStore({ loadingProviders: true });
    renderPage();

    // Skeleton component renders with animate-pulse class
    const skeletons = document.querySelectorAll('[class*="animate-pulse"]');
    expect(skeletons.length).toBeGreaterThan(0);
  });

  it('renders loading skeletons when connections are loading', () => {
    setupStore({ loadingConnections: true });
    renderPage();

    // Skeleton component renders with animate-pulse class
    const skeletons = document.querySelectorAll('[class*="animate-pulse"]');
    expect(skeletons.length).toBeGreaterThan(0);
  });

  it('renders empty state when no active connections', () => {
    setupStore({ connections: [] });
    renderPage();

    expect(screen.getByText('No active connections yet')).toBeInTheDocument();
    expect(
      screen.getByText(
        'Connect a provider below to start using OAuth-protected APIs in your workflows.',
      ),
    ).toBeInTheDocument();
  });

  it('renders provider cards with mock data', () => {
    setupStore();
    renderPage();

    expect(screen.getByText('GitHub')).toBeInTheDocument();
    expect(screen.getByText('Zoom')).toBeInTheDocument();
    expect(screen.getByText('GitHub OAuth integration for repository access')).toBeInTheDocument();
    expect(screen.getByText('Zoom OAuth for meeting management')).toBeInTheDocument();
  });

  it('shows "Configured" badge for configured providers', () => {
    setupStore({ providers: [githubProvider] });
    renderPage();

    expect(screen.getByText('Configured')).toBeInTheDocument();
  });

  it('shows "Setup required" badge for unconfigured providers', () => {
    setupStore({ providers: [zoomProvider] });
    renderPage();

    expect(screen.getByText('Setup required')).toBeInTheDocument();
  });

  it('renders Connect button for providers without connections', () => {
    setupStore({ providers: [githubProvider], connections: [] });
    renderPage();

    const connectButtons = screen.getAllByRole('button', { name: /Connect/i });
    expect(connectButtons.length).toBeGreaterThanOrEqual(1);
  });

  it('renders Manage credentials button for each provider', () => {
    setupStore();
    renderPage();

    const manageButtons = screen.getAllByRole('button', { name: /Manage credentials/i });
    expect(manageButtons.length).toBe(2);
  });

  it('renders provider default scopes as badges', () => {
    setupStore({ providers: [githubProvider] });
    renderPage();

    expect(screen.getByText('repo')).toBeInTheDocument();
    expect(screen.getByText('read:user')).toBeInTheDocument();
  });

  it('renders active connections in a table', () => {
    setupStore({ connections: [githubConnection] });
    renderPage();

    // The connection table should show provider name and status
    // "GitHub" appears in both connection table and provider card, so use getAllByText
    const githubElements = screen.getAllByText('GitHub');
    expect(githubElements.length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('active')).toBeInTheDocument();
  });

  it('renders Refresh button for connections that support refresh', () => {
    setupStore({ connections: [githubConnection], providers: [githubProvider] });
    renderPage();

    const refreshButtons = screen.getAllByRole('button', { name: /Refresh/i });
    expect(refreshButtons.length).toBeGreaterThanOrEqual(1);
  });

  it('renders Remove button for active connections', () => {
    setupStore({ connections: [githubConnection], providers: [githubProvider] });
    renderPage();

    const removeButtons = screen.getAllByRole('button', { name: /Remove/i });
    expect(removeButtons.length).toBeGreaterThanOrEqual(1);
  });

  it('renders Reconnect button for active connections', () => {
    setupStore({ connections: [githubConnection], providers: [githubProvider] });
    renderPage();

    const reconnectButtons = screen.getAllByRole('button', { name: /Reconnect/i });
    expect(reconnectButtons.length).toBeGreaterThanOrEqual(1);
  });

  it('shows connection scopes as badges', () => {
    setupStore({ connections: [githubConnection], providers: [githubProvider] });
    renderPage();

    // Scopes appear in both the connection table and the provider card
    const repoBadges = screen.getAllByText('repo');
    expect(repoBadges.length).toBeGreaterThanOrEqual(1);
  });

  it('shows ErrorBanner when providers error is set', () => {
    setupStore({ providersError: new Error('Failed to load providers') });
    renderPage();

    expect(screen.getByText('Failed to load providers')).toBeInTheDocument();
  });

  it('shows ErrorBanner when connections error is set', () => {
    setupStore({ connectionsError: new Error('Failed to load connections') });
    renderPage();

    expect(screen.getByText('Failed to load connections')).toBeInTheDocument();
  });

  it('renders additional scopes input for each provider', () => {
    setupStore({ providers: [githubProvider] });
    renderPage();

    const scopeInput = screen.getByPlaceholderText('repo delete_repo');
    expect(scopeInput).toBeInTheDocument();
  });

  it('renders "expired" status badge for expired connections', () => {
    setupStore({ connections: [expiredConnection], providers: [zoomProvider] });
    renderPage();

    expect(screen.getByText('expired')).toBeInTheDocument();
  });

  it('disables Refresh button when connection does not support refresh', () => {
    setupStore({ connections: [expiredConnection], providers: [zoomProvider] });
    renderPage();

    const refreshButtons = screen.getAllByRole('button', { name: /Refresh/i });
    const disabledRefresh = refreshButtons.find((btn) => btn.hasAttribute('disabled'));
    expect(disabledRefresh).toBeTruthy();
  });

  it('renders docs button for providers that have docsUrl', () => {
    setupStore({ providers: [githubProvider] });
    renderPage();

    const docsButton = screen.getByTitle('View documentation');
    expect(docsButton).toBeInTheDocument();
  });

  it('displays "No active token" text for providers without connections', () => {
    setupStore({ providers: [githubProvider], connections: [] });
    renderPage();

    expect(screen.getByText('No active token stored for this provider.')).toBeInTheDocument();
  });
});
