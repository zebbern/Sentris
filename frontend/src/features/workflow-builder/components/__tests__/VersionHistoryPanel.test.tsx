import { describe, it, beforeEach, afterEach, expect, mock } from 'bun:test';
import { screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { createAlertDialogMock } from '@/test/mocks/dialog';
import { createQueryKeysMock } from '@/test/mocks/queryKeysMock';
import { renderWithProviders } from '@/test/render-with-providers';

// ---------------------------------------------------------------------------
// Mock dialog / sheet / tooltip components (passthrough for test rendering)
// ---------------------------------------------------------------------------

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

mock.module('@/components/ui/tooltip', () => ({
  Tooltip: ({ children }: any) => <>{children}</>,
  TooltipContent: ({ children }: any) => <span>{children}</span>,
  TooltipProvider: ({ children }: any) => <>{children}</>,
  TooltipTrigger: ({ children }: any) => <>{children}</>,
}));

// ---------------------------------------------------------------------------
// Mutable mock state
// ---------------------------------------------------------------------------

interface MockVersion {
  id: string;
  version: number;
  createdAt: string;
}

const mockToast = mock(() => ({ id: 'test-toast' }));
const mockDismiss = mock();

const mockGetVersion = mock(() =>
  Promise.resolve({
    version: 1,
    graph: { nodes: [{ id: 'n1' }], edges: [], viewport: { x: 0, y: 0, zoom: 1 } },
  }),
);

const mockOnLoadVersion = mock(() => {});
const mockSetVersionHistoryPanelOpen = mock((_open: boolean) => {});

let mockVersions: MockVersion[] = [];
let mockIsLoading = false;
let mockIsDirty = false;
let mockCurrentVersionId: string | null = 'v-2';

mock.module('@/hooks/queries/useWorkflowQueries', () => ({
  useWorkflowVersions: () => ({
    data: mockVersions,
    isLoading: mockIsLoading,
  }),
}));

mock.module('@/store/workflowStore', () => {
  const useWorkflowStore = ((selector?: any) => {
    const state = {
      metadata: { currentVersionId: mockCurrentVersionId },
      isDirty: mockIsDirty,
    };
    return selector ? selector(state) : state;
  }) as any;
  useWorkflowStore.setState = () => {};
  useWorkflowStore.getState = () => ({
    metadata: { currentVersionId: mockCurrentVersionId },
    isDirty: mockIsDirty,
  });
  useWorkflowStore.subscribe = () => () => {};
  useWorkflowStore.destroy = () => {};
  return { useWorkflowStore };
});

mock.module('@/store/workflowUiStore', () => {
  const useWorkflowUiStore = ((selector?: any) => {
    const state = {
      versionHistoryPanelOpen: true,
      setVersionHistoryPanelOpen: mockSetVersionHistoryPanelOpen,
    };
    return selector ? selector(state) : state;
  }) as any;
  useWorkflowUiStore.setState = () => {};
  useWorkflowUiStore.getState = () => ({
    versionHistoryPanelOpen: true,
    setVersionHistoryPanelOpen: mockSetVersionHistoryPanelOpen,
  });
  useWorkflowUiStore.subscribe = () => () => {};
  useWorkflowUiStore.destroy = () => {};
  return { useWorkflowUiStore };
});

mock.module('@/services/api', () => ({
  api: {
    workflows: {
      getVersion: mockGetVersion,
    },
  },
}));

mock.module('@/lib/queryKeys', () =>
  createQueryKeysMock({
    workflows: { versions: (id: string) => ['workflows', id, 'versions'] },
  }),
);

mock.module('@/components/ui/use-toast', () => ({
  useToast: () => ({ toast: mockToast, dismiss: mockDismiss }),
}));

// Import component AFTER all mock.module() calls
import { VersionHistoryPanel } from '@/features/workflow-builder/components/VersionHistoryPanel';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ISO = '2024-06-15T12:00:00.000Z';

const versionFixtures: MockVersion[] = [
  { id: 'v-1', version: 1, createdAt: ISO },
  { id: 'v-2', version: 2, createdAt: '2024-07-01T12:00:00.000Z' },
  { id: 'v-3', version: 3, createdAt: '2024-07-15T12:00:00.000Z' },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resetMocks() {
  mockVersions = [...versionFixtures];
  mockIsLoading = false;
  mockIsDirty = false;
  mockCurrentVersionId = 'v-2';
  mockToast.mockClear();
  mockDismiss.mockClear();
  mockGetVersion.mockClear();
  mockOnLoadVersion.mockClear();
  mockSetVersionHistoryPanelOpen.mockClear();
  mockGetVersion.mockImplementation(() =>
    Promise.resolve({
      version: 1,
      graph: { nodes: [{ id: 'n1' }], edges: [], viewport: { x: 0, y: 0, zoom: 1 } },
    }),
  );
}

function renderPanel(workflowId = 'wf-1') {
  return renderWithProviders(
    <VersionHistoryPanel workflowId={workflowId} onLoadVersion={mockOnLoadVersion} />,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('VersionHistoryPanel', () => {
  beforeEach(() => {
    cleanup();
    resetMocks();
  });

  afterEach(cleanup);

  // --- Loading state ---

  it('renders loading skeleton when isLoading is true', () => {
    mockIsLoading = true;
    mockVersions = [];
    renderPanel();

    // The skeleton renders placeholder divs — panel title should still appear
    expect(screen.getByText('Version History')).toBeTruthy();
  });

  // --- Empty state ---

  it('renders empty state when versions array is empty', () => {
    mockVersions = [];
    renderPanel();

    expect(screen.getByText('No versions yet')).toBeTruthy();
  });

  // --- Version list rendering ---

  it('renders version list sorted descending', () => {
    renderPanel();

    const items = screen.getAllByText(/^v\d+$/);
    expect(items.length).toBe(3);
    // Sorted descending: v3, v2, v1
    expect(items[0].textContent).toBe('v3');
    expect(items[1].textContent).toBe('v2');
    expect(items[2].textContent).toBe('v1');
  });

  it('shows "Current" badge on the active version', () => {
    mockCurrentVersionId = 'v-2';
    renderPanel();

    expect(screen.getByText('Current')).toBeTruthy();
  });

  // --- View version ---

  it('clicking "View" on a non-current version calls api.workflows.getVersion', async () => {
    mockGetVersion.mockResolvedValue({
      version: 1,
      graph: { nodes: [{ id: 'n1' }], edges: [], viewport: { x: 0, y: 0, zoom: 1 } },
    });

    renderPanel();

    const viewButton = screen.getByLabelText('View version 3');
    fireEvent.click(viewButton);

    await waitFor(() => {
      expect(mockGetVersion).toHaveBeenCalledWith('wf-1', 'v-3');
    });

    await waitFor(() => {
      expect(mockOnLoadVersion).toHaveBeenCalledTimes(1);
    });
  });

  // --- Restore version (isDirty = false) ---

  it('clicking "Restore" when isDirty is false calls restore directly', async () => {
    mockIsDirty = false;
    mockGetVersion.mockResolvedValue({
      version: 1,
      graph: { nodes: [{ id: 'n1' }], edges: [], viewport: { x: 0, y: 0, zoom: 1 } },
    });

    renderPanel();

    const restoreButton = screen.getByLabelText('Restore version 3');
    fireEvent.click(restoreButton);

    await waitFor(() => {
      expect(mockGetVersion).toHaveBeenCalledWith('wf-1', 'v-3');
    });

    await waitFor(() => {
      expect(mockOnLoadVersion).toHaveBeenCalledTimes(1);
    });
  });

  // --- Restore version (isDirty = true) ---

  it('clicking "Restore" when isDirty is true shows unsaved-changes AlertDialog', () => {
    mockIsDirty = true;
    renderPanel();

    const restoreButton = screen.getByLabelText('Restore version 3');
    fireEvent.click(restoreButton);

    expect(screen.getByText('Unsaved changes')).toBeTruthy();
    expect(screen.getByText('Restore anyway')).toBeTruthy();
  });

  it('confirming the AlertDialog triggers the restore', async () => {
    mockIsDirty = true;
    mockGetVersion.mockResolvedValue({
      version: 3,
      graph: { nodes: [{ id: 'n1' }], edges: [], viewport: { x: 0, y: 0, zoom: 1 } },
    });

    renderPanel();

    // Open the confirmation dialog
    const restoreButton = screen.getByLabelText('Restore version 3');
    fireEvent.click(restoreButton);

    expect(screen.getByText('Unsaved changes')).toBeTruthy();

    // Click "Restore anyway"
    const confirmButton = screen.getByText('Restore anyway');
    fireEvent.click(confirmButton);

    await waitFor(() => {
      expect(mockGetVersion).toHaveBeenCalledWith('wf-1', 'v-3');
    });

    await waitFor(() => {
      expect(mockOnLoadVersion).toHaveBeenCalledTimes(1);
    });
  });
});
