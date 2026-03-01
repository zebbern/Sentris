import { describe, it, beforeEach, afterEach, expect, mock } from 'bun:test';
import { fireEvent, render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { HumanInputRequest } from '@/components/workflow/HumanInputResolutionView';
import { createDialogMock } from '@/test/mocks/dialog';
import {
  createDndCoreMock,
  createDndSortableMock,
  createDndUtilitiesMock,
  createSortableUiMock,
  createUseSortableListMock,
} from '@/test/mocks/dnd-kit';
import { createAuthStoreMock } from '@/test/mocks/auth-store';

// --- Mock dialog components (passthrough for test rendering) ---
mock.module('@/components/ui/dialog', createDialogMock);

// --- Mock DnD (avoid jsdom issues) ---
mock.module('@dnd-kit/core', createDndCoreMock);
mock.module('@dnd-kit/sortable', createDndSortableMock);
mock.module('@dnd-kit/utilities', createDndUtilitiesMock);
mock.module('@/components/ui/sortable', createSortableUiMock);
mock.module('@/hooks/useSortableList', createUseSortableListMock);

// --- Mock HumanInputResolutionView ---
mock.module('@/components/workflow/HumanInputResolutionView', () => ({
  HumanInputResolutionView: () => <div data-testid="resolution-view" />,
}));

// --- Mutable mock state ---
const mockQueryState: {
  approvals: HumanInputRequest[];
  isLoading: boolean;
  error: Error | null;
} = {
  approvals: [],
  isLoading: false,
  error: null,
};

const mockInvalidateHumanInputs = mock().mockReturnValue(undefined);

mock.module('@/hooks/queries/useHumanInputQueries', () => ({
  useHumanInputs: () => ({
    data: mockQueryState.approvals,
    isLoading: mockQueryState.isLoading,
    error: mockQueryState.error,
  }),
  useInvalidateHumanInputs: () => mockInvalidateHumanInputs,
}));

// --- Auth store ---
mock.module('@/store/authStore', () => createAuthStoreMock());

// Import component AFTER all mock.module() calls
import { ActionCenterPage } from '@/pages/ActionCenterPage';

// --- Fixtures ---
const ISO = '2024-06-15T12:00:00.000Z';

const pendingApproval: HumanInputRequest = {
  id: 'hi-001',
  runId: 'run-aaa-111',
  workflowId: 'wf-111',
  nodeRef: 'approval-node-1',
  status: 'pending',
  inputType: 'approval',
  title: 'Deploy to Production',
  description: 'Approve deployment to production environment',
  inputSchema: null,
  context: null,
  resolveToken: 'tok-abc',
  timeoutAt: '2024-06-20T12:00:00.000Z',
  respondedAt: null,
  respondedBy: null,
  responseData: null,
  createdAt: ISO,
  updatedAt: ISO,
};

const resolvedApproval: HumanInputRequest = {
  ...pendingApproval,
  id: 'hi-002',
  title: 'Security Review',
  nodeRef: 'review-node-2',
  status: 'resolved',
  inputType: 'review',
  description: 'Review security findings',
  respondedAt: ISO,
  respondedBy: 'user-1',
  responseData: { status: 'approved' },
};

const acknowledgeApproval: HumanInputRequest = {
  ...pendingApproval,
  id: 'hi-003',
  title: 'Acknowledge Alert',
  nodeRef: 'ack-node-3',
  inputType: 'acknowledge',
  description: null,
};

// --- Helpers ---
interface MockQueryOverrides {
  approvals?: HumanInputRequest[];
  isLoading?: boolean;
  error?: Error | null;
}

const setupStore = (overrides: MockQueryOverrides = {}) => {
  mockQueryState.approvals = overrides.approvals ?? [pendingApproval, resolvedApproval];
  mockQueryState.isLoading = overrides.isLoading ?? false;
  mockQueryState.error = overrides.error ?? null;
  mockInvalidateHumanInputs.mockClear();
  return mockQueryState;
};

const renderPage = () =>
  render(
    <MemoryRouter>
      <ActionCenterPage />
    </MemoryRouter>,
  );

// --- Tests ---
describe('ActionCenterPage', () => {
  beforeEach(() => {
    cleanup();
    setupStore();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders page heading', () => {
    setupStore();
    renderPage();

    expect(screen.getByRole('heading', { level: 1, name: /Action Center/i })).toBeInTheDocument();
  });

  it('renders loading skeletons when isLoading is true and no data', () => {
    setupStore({ isLoading: true, approvals: [] });
    renderPage();

    const container = document.querySelector('[aria-busy="true"]');
    expect(container).toBeTruthy();
  });

  it('renders empty state with "No pending actions" when data is empty', () => {
    setupStore({ approvals: [] });
    renderPage();

    expect(screen.getByText('No pending actions')).toBeInTheDocument();
  });

  it('renders approval rows showing title and status badge', () => {
    setupStore();
    renderPage();

    expect(screen.getByText('Deploy to Production')).toBeInTheDocument();
    expect(screen.getByText('Security Review')).toBeInTheDocument();
  });

  it('shows pending badge count when pending approvals exist', () => {
    setupStore({ approvals: [pendingApproval] });
    renderPage();

    expect(screen.getByText('1 pending')).toBeInTheDocument();
  });

  it('shows ErrorBanner when error is set', () => {
    setupStore({ error: new Error('Failed to load requests') });
    renderPage();

    expect(screen.getByText('Failed to load requests')).toBeInTheDocument();
  });

  it('renders Approve and Reject buttons for pending approval-type items', () => {
    setupStore({ approvals: [pendingApproval] });
    renderPage();

    expect(screen.getByRole('button', { name: /Approve/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Reject/i })).toBeInTheDocument();
  });

  it('renders Acknowledge button for acknowledge-type pending items', () => {
    setupStore({ approvals: [acknowledgeApproval] });
    renderPage();

    expect(screen.getByRole('button', { name: /Acknowledge/i })).toBeInTheDocument();
  });

  it('renders View Details button for resolved items', () => {
    setupStore({ approvals: [resolvedApproval] });
    renderPage();

    expect(screen.getByRole('button', { name: /View Details/i })).toBeInTheDocument();
  });

  it('search input filters approvals by title', () => {
    setupStore();
    renderPage();

    expect(screen.getByText('Deploy to Production')).toBeInTheDocument();
    expect(screen.getByText('Security Review')).toBeInTheDocument();

    const searchInput = screen.getByPlaceholderText(/Filter by title, node, or run ID/i);
    fireEvent.change(searchInput, { target: { value: 'Deploy' } });

    expect(screen.getByText('Deploy to Production')).toBeInTheDocument();
    expect(screen.queryByText('Security Review')).not.toBeInTheDocument();
  });

  it('search input filters approvals by node ref', () => {
    setupStore();
    renderPage();

    const searchInput = screen.getByPlaceholderText(/Filter by title, node, or run ID/i);
    fireEvent.change(searchInput, { target: { value: 'review-node' } });

    expect(screen.queryByText('Deploy to Production')).not.toBeInTheDocument();
    expect(screen.getByText('Security Review')).toBeInTheDocument();
  });

  it('renders drag handles for DnD sortable rows', () => {
    setupStore();
    renderPage();

    const dragHandles = screen.getAllByLabelText('Drag to reorder');
    expect(dragHandles.length).toBeGreaterThanOrEqual(2);
  });

  it('renders Refresh button', () => {
    setupStore();
    renderPage();

    const refreshButtons = screen.getAllByRole('button', { name: /Refresh/i });
    expect(refreshButtons.length).toBeGreaterThanOrEqual(1);
  });
});
