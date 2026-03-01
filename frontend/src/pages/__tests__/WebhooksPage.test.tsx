import { describe, it, beforeEach, afterEach, expect, mock } from 'bun:test';
import { fireEvent, render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { WebhookConfiguration } from '@sentris/shared';

// --- Mock dialog / alert-dialog components (passthrough for test rendering) ---
mock.module('@/components/ui/dialog', () => {
  const Dialog = ({ open, children }: any) => (open ? <>{children}</> : null);
  const DialogContent = ({ children, ...props }: any) => (
    <div role="dialog" {...props}>
      {children}
    </div>
  );
  const passthrough = ({ children, ...props }: any) => <div {...props}>{children}</div>;
  const passthroughInline = ({ children, ...props }: any) => <span {...props}>{children}</span>;
  const FragmentWrapper = ({ children }: any) => <>{children}</>;

  return {
    Dialog,
    DialogContent,
    DialogHeader: passthrough,
    DialogFooter: passthrough,
    DialogTitle: passthroughInline,
    DialogDescription: passthroughInline,
    DialogPortal: FragmentWrapper,
    DialogOverlay: FragmentWrapper,
    DialogTrigger: FragmentWrapper,
    DialogClose: FragmentWrapper,
  };
});

mock.module('@/components/ui/alert-dialog', () => {
  const AlertDialog = ({ open, children }: any) =>
    open ? <div data-testid="alert-dialog">{children}</div> : null;
  const AlertDialogContent = ({ children, ...props }: any) => (
    <div role="alertdialog" {...props}>
      {children}
    </div>
  );
  const passthrough = ({ children, ...props }: any) => <div {...props}>{children}</div>;
  const AlertDialogAction = ({ children, onClick, ...props }: any) => (
    <button onClick={onClick} {...props}>
      {children}
    </button>
  );
  const AlertDialogCancel = ({ children, onClick, ...props }: any) => (
    <button onClick={onClick} {...props}>
      {children}
    </button>
  );

  return {
    AlertDialog,
    AlertDialogContent,
    AlertDialogHeader: passthrough,
    AlertDialogFooter: passthrough,
    AlertDialogTitle: passthrough,
    AlertDialogDescription: passthrough,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogPortal: ({ children }: any) => <>{children}</>,
    AlertDialogOverlay: ({ children }: any) => <>{children}</>,
    AlertDialogTrigger: ({ children }: any) => <>{children}</>,
  };
});

// --- Mock DnD (avoid jsdom issues) ---
mock.module('@dnd-kit/core', () => {
  const DndContext = ({ children }: any) => <>{children}</>;
  return {
    DndContext,
    closestCenter: () => null,
    KeyboardSensor: class {},
    PointerSensor: class {},
    useSensor: () => ({}),
    useSensors: () => [],
  };
});

mock.module('@dnd-kit/sortable', () => {
  const SortableContext = ({ children }: any) => <>{children}</>;
  return {
    SortableContext,
    verticalListSortingStrategy: {},
    useSortable: () => ({
      attributes: {},
      listeners: {},
      setNodeRef: () => {},
      transform: null,
      transition: null,
      isDragging: false,
    }),
    sortableKeyboardCoordinates: () => ({}),
  };
});

mock.module('@dnd-kit/utilities', () => ({
  CSS: { Transform: { toString: () => '' } },
}));

// --- Mock sortable UI components ---
mock.module('@/components/ui/sortable', () => {
  const SortableTableRow = ({ children, id, className, onClick, ...rest }: any) => {
    const handleProps = { role: 'button', 'aria-label': 'Drag handle' };
    return (
      <tr data-id={id} className={className} onClick={onClick} {...rest}>
        {typeof children === 'function' ? children({ handleProps }) : children}
      </tr>
    );
  };
  const DragHandle = (props: any) => (
    <td>
      <span {...props}>⠿</span>
    </td>
  );
  return { SortableTableRow, DragHandle };
});

// --- Mock useSortableList ---
mock.module('@/hooks/useSortableList', () => ({
  useSortableList: ({ items }: any) => ({
    orderedItems: items,
    sensors: [],
    collisionDetection: null,
    handleDragEnd: () => {},
    isDragDisabled: false,
  }),
}));

// --- Mock useConfirmDialog ---
const mockConfirm = mock().mockResolvedValue(false);
mock.module('@/hooks/useConfirmDialog', () => ({
  useConfirmDialog: () => ({
    confirm: mockConfirm,
    dialogProps: {
      open: false,
      title: '',
      description: '',
      confirmLabel: 'Confirm',
      cancelLabel: 'Cancel',
      destructive: false,
      onConfirm: () => {},
      onCancel: () => {},
    },
  }),
}));

// --- Mutable mock state for webhook queries ---
const mockQueryState: {
  webhooks: WebhookConfiguration[];
  isLoading: boolean;
  error: Error | null;
  deleteWebhook: any;
  regeneratePath: any;
} = {
  webhooks: [],
  isLoading: false,
  error: null,
  deleteWebhook: mock().mockResolvedValue(undefined),
  regeneratePath: mock().mockResolvedValue(undefined),
};

mock.module('@/hooks/queries/useWebhookQueries', () => ({
  useWebhooks: () => ({
    data: mockQueryState.webhooks,
    isLoading: mockQueryState.isLoading,
    error: mockQueryState.error,
  }),
  useDeleteWebhook: () => ({
    mutateAsync: mockQueryState.deleteWebhook,
  }),
  useRegenerateWebhookPath: () => ({
    mutateAsync: mockQueryState.regeneratePath,
  }),
}));

// --- Mock workflow queries ---
const mockWorkflows = [
  { id: 'wf-111', name: 'Scan Network' },
  { id: 'wf-222', name: 'Deploy App' },
];

mock.module('@/hooks/queries/useWorkflowQueries', () => ({
  useWorkflowsSummary: () => ({
    data: mockWorkflows,
    isLoading: false,
  }),
}));

const mockInvalidateQueries = mock().mockResolvedValue(undefined);

mock.module('@tanstack/react-query', () => ({
  useQueryClient: () => ({
    invalidateQueries: mockInvalidateQueries,
  }),
}));

// --- Mock useBulkSelection ---
const mockBulkSelection = {
  selectedIds: new Set<string>(),
  toggleId: mock(),
  toggleAll: mock(),
  clearSelection: mock(),
  isAllSelected: false,
  isIndeterminate: false,
  selectedCount: 0,
};

mock.module('@/hooks/useBulkSelection', () => ({
  useBulkSelection: () => mockBulkSelection,
}));

// Import component AFTER all mock.module() calls
import { WebhooksPage } from '@/pages/WebhooksPage';
import { useAuthStore, DEFAULT_ORG_ID } from '@/store/authStore';

// --- Fixtures ---
const ISO = '2024-06-15T12:00:00.000Z';

const activeWebhook: WebhookConfiguration = {
  id: 'wh-001',
  workflowId: 'wf-111',
  workflowVersionId: null,
  workflowVersion: null,
  name: 'GitHub Push Hook',
  description: 'Triggered on push events',
  webhookPath: 'wh_abc123def456',
  parsingScript: 'return { branch: payload.ref }',
  expectedInputs: [],
  status: 'active',
  organizationId: 'org-001',
  createdBy: 'user-1',
  createdAt: ISO,
  updatedAt: ISO,
};

const inactiveWebhook: WebhookConfiguration = {
  ...activeWebhook,
  id: 'wh-002',
  workflowId: 'wf-222',
  name: 'Slack Notification',
  description: null,
  webhookPath: 'wh_xyz789ghi012',
  status: 'inactive',
};

// --- Helpers ---
interface MockQueryOverrides {
  webhooks?: WebhookConfiguration[];
  isLoading?: boolean;
  error?: Error | null;
  deleteWebhook?: (...args: any[]) => Promise<void>;
  regeneratePath?: (...args: any[]) => Promise<void>;
}

async function resetAuthStore() {
  const persist = (useAuthStore as typeof useAuthStore & { persist?: any }).persist;
  if (persist?.clearStorage) {
    await persist.clearStorage();
  }
  useAuthStore.setState({
    token: null,
    userId: null,
    organizationId: DEFAULT_ORG_ID,
    roles: ['ADMIN'],
    provider: 'local',
  });
}

const setupStore = (overrides: MockQueryOverrides = {}) => {
  mockQueryState.webhooks = overrides.webhooks ?? [activeWebhook, inactiveWebhook];
  mockQueryState.isLoading = overrides.isLoading ?? false;
  mockQueryState.error = overrides.error ?? null;
  mockQueryState.deleteWebhook = overrides.deleteWebhook ?? mock().mockResolvedValue(undefined);
  mockQueryState.regeneratePath = overrides.regeneratePath ?? mock().mockResolvedValue(undefined);
  mockInvalidateQueries.mockClear();
  mockConfirm.mockClear();

  // Reset bulk selection state
  mockBulkSelection.selectedIds = new Set<string>();
  mockBulkSelection.toggleId.mockClear();
  mockBulkSelection.toggleAll.mockClear();
  mockBulkSelection.clearSelection.mockClear();
  mockBulkSelection.isAllSelected = false;
  mockBulkSelection.isIndeterminate = false;
  mockBulkSelection.selectedCount = 0;

  return mockQueryState;
};

const renderPage = () =>
  render(
    <MemoryRouter>
      <WebhooksPage />
    </MemoryRouter>,
  );

// --- Tests ---
describe('WebhooksPage', () => {
  beforeEach(async () => {
    cleanup();
    setupStore();
    await resetAuthStore();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders loading skeletons when isLoading is true and no data', () => {
    setupStore({ isLoading: true, webhooks: [] });
    renderPage();

    const container = document.querySelector('[aria-busy="true"]');
    expect(container).toBeTruthy();
  });

  it('renders empty state with "No webhooks found" when data is empty', () => {
    setupStore({ webhooks: [] });
    renderPage();

    expect(screen.getByText('No webhooks found')).toBeInTheDocument();
  });

  it('renders webhook rows showing name and status badge', () => {
    setupStore();
    renderPage();

    expect(screen.getByText('GitHub Push Hook')).toBeInTheDocument();
    expect(screen.getByText('Slack Notification')).toBeInTheDocument();

    expect(screen.getByText('Active')).toBeInTheDocument();
    expect(screen.getByText('Inactive')).toBeInTheDocument();
  });

  it('renders workflow name for each webhook', () => {
    setupStore();
    renderPage();

    expect(screen.getByText('Scan Network')).toBeInTheDocument();
    expect(screen.getByText('Deploy App')).toBeInTheDocument();
  });

  it('shows ErrorBanner when error is set', () => {
    setupStore({ error: new Error('Failed to load webhooks') });
    renderPage();

    expect(screen.getByText('Failed to load webhooks')).toBeInTheDocument();
  });

  it('renders "New webhook" button', () => {
    setupStore();
    renderPage();

    const newButton = screen.getByRole('button', { name: /New webhook/i });
    expect(newButton).toBeInTheDocument();
  });

  it('renders "Select all webhooks" checkbox', () => {
    setupStore();
    renderPage();

    expect(screen.getByRole('checkbox', { name: /Select all webhooks/i })).toBeInTheDocument();
  });

  it('renders per-row selection checkboxes', () => {
    setupStore();
    renderPage();

    expect(screen.getByRole('checkbox', { name: /Select GitHub Push Hook/i })).toBeInTheDocument();
    expect(
      screen.getByRole('checkbox', { name: /Select Slack Notification/i }),
    ).toBeInTheDocument();
  });

  it('search input filters webhooks by name', () => {
    setupStore();
    renderPage();

    expect(screen.getByText('GitHub Push Hook')).toBeInTheDocument();
    expect(screen.getByText('Slack Notification')).toBeInTheDocument();

    const searchInput = screen.getByPlaceholderText(/Filter by name, workflow, or URL/i);
    fireEvent.change(searchInput, { target: { value: 'GitHub' } });

    expect(screen.getByText('GitHub Push Hook')).toBeInTheDocument();
    expect(screen.queryByText('Slack Notification')).not.toBeInTheDocument();
  });

  it('search input filters webhooks by workflow name', () => {
    setupStore();
    renderPage();

    const searchInput = screen.getByPlaceholderText(/Filter by name, workflow, or URL/i);
    fireEvent.change(searchInput, { target: { value: 'Deploy App' } });

    expect(screen.queryByText('GitHub Push Hook')).not.toBeInTheDocument();
    expect(screen.getByText('Slack Notification')).toBeInTheDocument();
  });

  it('renders Refresh button', () => {
    setupStore();
    renderPage();

    const refreshButtons = screen.getAllByRole('button', { name: /Refresh/i });
    expect(refreshButtons.length).toBeGreaterThanOrEqual(1);
  });

  it('renders drag handles for DnD sortable rows', () => {
    setupStore();
    renderPage();

    const dragHandles = screen.getAllByLabelText('Drag handle');
    expect(dragHandles.length).toBeGreaterThanOrEqual(2);
  });

  it('renders delete button per webhook row', () => {
    setupStore();
    renderPage();

    const deleteButtons = screen.getAllByRole('button', { name: /Delete webhook/i });
    expect(deleteButtons.length).toBe(2);
  });

  it('renders History button per webhook row', () => {
    setupStore();
    renderPage();

    const historyButtons = screen.getAllByRole('button', { name: /History/i });
    expect(historyButtons.length).toBeGreaterThanOrEqual(2);
  });

  it('renders Copy webhook URL button per webhook row', () => {
    setupStore();
    renderPage();

    const copyButtons = screen.getAllByRole('button', { name: /Copy webhook URL/i });
    expect(copyButtons.length).toBe(2);
  });

  it('renders Regenerate URL button per webhook row', () => {
    setupStore();
    renderPage();

    const regenButtons = screen.getAllByRole('button', { name: /Regenerate URL/i });
    expect(regenButtons.length).toBe(2);
  });
});
