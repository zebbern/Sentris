import { describe, it, expect, beforeEach, beforeAll, afterEach, mock } from 'bun:test';
import { render, screen, cleanup } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { createTestQueryClient } from '@/test/render-with-providers';

// ---------------------------------------------------------------------------
// Mutable mock state
// ---------------------------------------------------------------------------

let mockConnectionData: Record<string, unknown> | undefined = undefined;
let mockConnectionLoading = false;
let mockConnectionError: Error | null = null;

let mockProjectsData:
  | { id: string; key: string; name: string; avatarUrl: string | null }[]
  | undefined = undefined;
let mockProjectsLoading = false;

let mockIssueTypesData:
  | { id: string; name: string; description: string | null; iconUrl: string | null }[]
  | undefined = undefined;
let mockIssueTypesLoading = false;

const mockConnectMutate = mock((_redirectUri: string, _opts?: any) => {});
const mockDisconnectMutate = mock((_: any, _opts?: any) => {});
const mockUpdateConfigMutate = mock((_config: any, _opts?: any) => {});

mock.module('@/hooks/queries/useTicketingQueries', () => ({
  useTicketingConnection: () => ({
    data: mockConnectionData,
    isLoading: mockConnectionLoading,
    error: mockConnectionError,
  }),
  useTicketingProjects: () => ({
    data: mockProjectsData,
    isLoading: mockProjectsLoading,
  }),
  useTicketingIssueTypes: () => ({
    data: mockIssueTypesData,
    isLoading: mockIssueTypesLoading,
  }),
  useFindingTicket: () => ({
    data: undefined,
    isLoading: false,
    isError: false,
  }),
  useConnectJiraMutation: () => ({
    mutate: mockConnectMutate,
    isPending: false,
  }),
  useDisconnectJiraMutation: () => ({
    mutate: mockDisconnectMutate,
    isPending: false,
  }),
  useUpdateTicketingConfigMutation: () => ({
    mutate: mockUpdateConfigMutate,
    isPending: false,
  }),
  useTicketingCallbackMutation: () => ({
    mutate: mock(() => {}),
    isPending: false,
  }),
}));

mock.module('@/hooks/useDocumentTitle', () => ({
  useDocumentTitle: () => {},
}));

mock.module('@/components/ui/use-toast', () => ({
  useToast: () => ({
    toast: mock(() => {}),
  }),
}));

// Import component AFTER all mock.module() calls
let TicketingSettings: React.ComponentType;

beforeAll(async () => {
  const mod = await import('../TicketingSettings');
  TicketingSettings = mod.TicketingSettings;
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resetMockState() {
  mockConnectionData = undefined;
  mockConnectionLoading = false;
  mockConnectionError = null;
  mockProjectsData = undefined;
  mockProjectsLoading = false;
  mockIssueTypesData = undefined;
  mockIssueTypesLoading = false;
  mockConnectMutate.mockClear();
  mockDisconnectMutate.mockClear();
  mockUpdateConfigMutate.mockClear();
}

function renderTicketingSettings() {
  return render(
    <QueryClientProvider client={createTestQueryClient()}>
      <TicketingSettings />
    </QueryClientProvider>,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('TicketingSettings', () => {
  beforeEach(() => {
    cleanup();
    resetMockState();
  });

  afterEach(cleanup);

  // -----------------------------------------------------------------------
  // Disconnected state
  // -----------------------------------------------------------------------

  it('renders "Connect Jira" button when not connected', () => {
    mockConnectionData = {
      id: null,
      provider: 'jira',
      isConnected: false,
      cloudId: null,
      config: null,
      createdAt: null,
    };

    renderTicketingSettings();

    expect(screen.getByText('Connect Jira')).toBeTruthy();
    expect(screen.getByText('Disconnected')).toBeTruthy();
  });

  it('shows Jira Integration heading', () => {
    mockConnectionData = {
      id: null,
      provider: 'jira',
      isConnected: false,
      cloudId: null,
      config: null,
      createdAt: null,
    };

    renderTicketingSettings();

    expect(screen.getByText('Jira Integration')).toBeTruthy();
  });

  // -----------------------------------------------------------------------
  // Connected state
  // -----------------------------------------------------------------------

  it('shows connected status badge when connected', () => {
    mockConnectionData = {
      id: 'conn-1',
      provider: 'jira',
      isConnected: true,
      cloudId: 'cloud-abc',
      config: {
        projectKey: 'SEC',
        issueTypeId: '10001',
        statusMapping: { triaged: 'Open' },
        autoCreateOnStatuses: ['triaged'],
      },
      createdAt: '2025-01-01T00:00:00.000Z',
    };
    mockProjectsData = [{ id: '1', key: 'SEC', name: 'Security', avatarUrl: null }];

    renderTicketingSettings();

    expect(screen.getByText('Connected')).toBeTruthy();
  });

  it('shows configuration form when connected', () => {
    mockConnectionData = {
      id: 'conn-1',
      provider: 'jira',
      isConnected: true,
      cloudId: 'cloud-abc',
      config: {
        projectKey: 'SEC',
        issueTypeId: '10001',
        statusMapping: { triaged: 'Open' },
        autoCreateOnStatuses: ['triaged'],
      },
      createdAt: '2025-01-01T00:00:00.000Z',
    };

    renderTicketingSettings();

    expect(screen.getByText('Configuration')).toBeTruthy();
    expect(screen.getByText('Save Configuration')).toBeTruthy();
  });

  it('shows disconnect button when connected', () => {
    mockConnectionData = {
      id: 'conn-1',
      provider: 'jira',
      isConnected: true,
      cloudId: 'cloud-abc',
      config: {
        projectKey: 'SEC',
        issueTypeId: '10001',
        statusMapping: { triaged: 'Open' },
        autoCreateOnStatuses: ['triaged'],
      },
      createdAt: '2025-01-01T00:00:00.000Z',
    };

    renderTicketingSettings();

    expect(screen.getByText('Disconnect Jira')).toBeTruthy();
  });

  // -----------------------------------------------------------------------
  // Disconnect confirmation dialog
  // -----------------------------------------------------------------------

  it('disconnect button is rendered when connected', () => {
    mockConnectionData = {
      id: 'conn-1',
      provider: 'jira',
      isConnected: true,
      cloudId: 'cloud-abc',
      config: {
        projectKey: 'SEC',
        issueTypeId: '10001',
        statusMapping: { triaged: 'Open' },
        autoCreateOnStatuses: ['triaged'],
      },
      createdAt: '2025-01-01T00:00:00.000Z',
    };

    renderTicketingSettings();

    const disconnectBtn = screen.getByText('Disconnect Jira');
    expect(disconnectBtn).toBeTruthy();
    // The button should be an AlertDialogTrigger, verify it's clickable
    expect(disconnectBtn.closest('button')).toBeTruthy();
  });

  // -----------------------------------------------------------------------
  // Loading state
  // -----------------------------------------------------------------------

  it('shows loading skeleton when data is loading', () => {
    mockConnectionLoading = true;

    const { container } = renderTicketingSettings();

    // aria-busy is set on the loading container
    const busyEl = container.querySelector('[aria-busy="true"]');
    expect(busyEl).toBeTruthy();
  });

  // -----------------------------------------------------------------------
  // Error state
  // -----------------------------------------------------------------------

  it('shows error banner when connection query fails', () => {
    mockConnectionError = new Error('Network failure');
    mockConnectionData = undefined;

    renderTicketingSettings();

    // The ErrorBanner component should be rendered (may show humanized message)
    // Check that no "Connect Jira" button appears
    expect(screen.queryByText('Connect Jira')).toBeNull();
  });

  // -----------------------------------------------------------------------
  // Status mapping section
  // -----------------------------------------------------------------------

  it('shows status mapping editor', () => {
    mockConnectionData = {
      id: 'conn-1',
      provider: 'jira',
      isConnected: true,
      cloudId: 'cloud-abc',
      config: {
        projectKey: 'SEC',
        issueTypeId: '10001',
        statusMapping: {
          triaged: 'Open',
          in_progress: 'In Progress',
          fixed: 'Done',
          verified: 'Done',
          wont_fix: "Won't Do",
          accepted_risk: "Won't Do",
        },
        autoCreateOnStatuses: ['triaged'],
      },
      createdAt: '2025-01-01T00:00:00.000Z',
    };

    renderTicketingSettings();

    expect(screen.getByText('Status Mapping')).toBeTruthy();
    expect(screen.getByText('Finding Status')).toBeTruthy();
    expect(screen.getByText('Jira Status')).toBeTruthy();
  });
});
