import { describe, it, expect, beforeEach, beforeAll, afterEach, mock } from 'bun:test';
import { render, screen, cleanup } from '@testing-library/react';

// ---------------------------------------------------------------------------
// Mutable mock state
// ---------------------------------------------------------------------------

let mockTicketData: Record<string, unknown> | undefined = undefined;
let mockTicketLoading = false;
let mockTicketError = false;

mock.module('@/hooks/queries/useTicketingQueries', () => ({
  useFindingTicket: () => ({
    data: mockTicketData,
    isLoading: mockTicketLoading,
    isError: mockTicketError,
  }),
  useTicketingConnection: () => ({
    data: undefined,
    isLoading: false,
    error: null,
  }),
  useTicketingProjects: () => ({
    data: undefined,
    isLoading: false,
  }),
  useTicketingIssueTypes: () => ({
    data: undefined,
    isLoading: false,
  }),
  useConnectJiraMutation: () => ({
    mutate: mock(() => {}),
    isPending: false,
  }),
  useDisconnectJiraMutation: () => ({
    mutate: mock(() => {}),
    isPending: false,
  }),
  useUpdateTicketingConfigMutation: () => ({
    mutate: mock(() => {}),
    isPending: false,
  }),
  useTicketingCallbackMutation: () => ({
    mutate: mock(() => {}),
    isPending: false,
  }),
}));

// Import component AFTER all mock.module() calls
let LinkedTicket: React.ComponentType<{ findingId: string }>;

beforeAll(async () => {
  const mod = await import('../LinkedTicket');
  LinkedTicket = mod.LinkedTicket;
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resetMockState() {
  mockTicketData = undefined;
  mockTicketLoading = false;
  mockTicketError = false;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('LinkedTicket', () => {
  beforeEach(() => {
    cleanup();
    resetMockState();
  });

  afterEach(cleanup);

  // -----------------------------------------------------------------------
  // Ticket linked
  // -----------------------------------------------------------------------

  it('renders Jira issue key as external link', () => {
    mockTicketData = {
      id: 'link-1',
      findingTriageId: 'triage-1',
      provider: 'jira',
      externalId: 'SEC-42',
      externalUrl: 'https://myteam.atlassian.net/browse/SEC-42',
      syncStatus: 'synced',
      lastSyncedAt: '2025-01-01T12:00:00Z',
      createdAt: '2025-01-01T11:00:00Z',
    };

    render(<LinkedTicket findingId="finding-1" />);

    const link = screen.getByText('SEC-42');
    expect(link).toBeTruthy();
    expect(link.closest('a')?.getAttribute('href')).toBe(
      'https://myteam.atlassian.net/browse/SEC-42',
    );
    expect(link.closest('a')?.getAttribute('target')).toBe('_blank');
    expect(link.closest('a')?.getAttribute('rel')).toContain('noopener');
  });

  // -----------------------------------------------------------------------
  // Sync status badges
  // -----------------------------------------------------------------------

  it('shows "Synced" badge when sync status is synced', () => {
    mockTicketData = {
      id: 'link-1',
      findingTriageId: 'triage-1',
      provider: 'jira',
      externalId: 'SEC-42',
      externalUrl: 'https://myteam.atlassian.net/browse/SEC-42',
      syncStatus: 'synced',
      lastSyncedAt: '2025-01-01T12:00:00Z',
      createdAt: '2025-01-01T11:00:00Z',
    };

    render(<LinkedTicket findingId="finding-1" />);

    expect(screen.getByText('Synced')).toBeTruthy();
  });

  it('shows "Error" badge when sync status is error', () => {
    mockTicketData = {
      id: 'link-1',
      findingTriageId: 'triage-1',
      provider: 'jira',
      externalId: 'SEC-42',
      externalUrl: 'https://myteam.atlassian.net/browse/SEC-42',
      syncStatus: 'error',
      lastSyncedAt: '2025-01-01T12:00:00Z',
      createdAt: '2025-01-01T11:00:00Z',
    };

    render(<LinkedTicket findingId="finding-1" />);

    expect(screen.getByText('Error')).toBeTruthy();
  });

  it('shows "Pending" badge when sync status is pending', () => {
    mockTicketData = {
      id: 'link-1',
      findingTriageId: 'triage-1',
      provider: 'jira',
      externalId: 'SEC-42',
      externalUrl: 'https://myteam.atlassian.net/browse/SEC-42',
      syncStatus: 'pending',
      lastSyncedAt: null,
      createdAt: '2025-01-01T11:00:00Z',
    };

    render(<LinkedTicket findingId="finding-1" />);

    expect(screen.getByText('Pending')).toBeTruthy();
  });

  // -----------------------------------------------------------------------
  // No ticket linked
  // -----------------------------------------------------------------------

  it('renders nothing when no ticket link exists (data is undefined)', () => {
    mockTicketData = undefined;
    mockTicketError = false;

    const { container } = render(<LinkedTicket findingId="finding-1" />);

    // The component should return null → container is empty
    expect(container.innerHTML).toBe('');
  });

  it('renders nothing when query returns error (404)', () => {
    mockTicketData = undefined;
    mockTicketError = true;

    const { container } = render(<LinkedTicket findingId="finding-1" />);

    expect(container.innerHTML).toBe('');
  });

  // -----------------------------------------------------------------------
  // Loading state
  // -----------------------------------------------------------------------

  it('shows loading skeleton while data is loading', () => {
    mockTicketLoading = true;

    const { container } = render(<LinkedTicket findingId="finding-1" />);

    // aria-busy is set on loading container
    const busyEl = container.querySelector('[aria-busy="true"]');
    expect(busyEl).toBeTruthy();
  });

  // -----------------------------------------------------------------------
  // Linked Ticket label
  // -----------------------------------------------------------------------

  it('shows "Linked Ticket" label', () => {
    mockTicketData = {
      id: 'link-1',
      findingTriageId: 'triage-1',
      provider: 'jira',
      externalId: 'PROJ-1',
      externalUrl: 'https://myteam.atlassian.net/browse/PROJ-1',
      syncStatus: 'synced',
      lastSyncedAt: '2025-03-01T12:00:00Z',
      createdAt: '2025-03-01T11:00:00Z',
    };

    render(<LinkedTicket findingId="finding-1" />);

    expect(screen.getByText('Linked Ticket')).toBeTruthy();
  });
});
