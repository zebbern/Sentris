import { describe, it, beforeEach, afterEach, afterAll, expect, vi, mock } from 'bun:test';
import { render, screen, fireEvent, within, waitFor, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import type { WorkflowSummary } from '@/services/api';

// ---------------------------------------------------------------------------
// Mutable mock state
// ---------------------------------------------------------------------------

let mockWorkflows: WorkflowSummary[] = [];
const deleteMutateAsync = mock(async (_id: string) => {});
let mockDeleteIsPending = false;
const cloneMutateAsync = mock(async (_id: string) => ({ id: 'new-id', name: 'Copy' }));
let mockCloneIsPending = false;
const mockToast = mock((_opts: any) => {});

// ---------------------------------------------------------------------------
// Module mocks (BEFORE component import)
// ---------------------------------------------------------------------------

// --- AlertDialog: passthrough for ConfirmDialog rendering ---
mock.module('@/components/ui/alert-dialog', () => {
  const AlertDialog = ({ open, children }: { open: boolean; children: ReactNode }) =>
    open ? <>{children}</> : null;
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

// --- DropdownMenu: render items directly for testability ---
mock.module('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: any) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: any) => <>{children}</>,
  DropdownMenuContent: ({ children }: any) => <div>{children}</div>,
  DropdownMenuItem: ({ children, onClick, disabled, ...props }: any) => (
    <button onClick={onClick} disabled={disabled} role="menuitem" {...props}>
      {children}
    </button>
  ),
  DropdownMenuSeparator: () => <hr />,
}));

// --- Tooltip: passthrough ---
mock.module('@/components/ui/tooltip', () => ({
  Tooltip: ({ children }: any) => <>{children}</>,
  TooltipContent: ({ children }: any) => <span>{children}</span>,
  TooltipProvider: ({ children }: any) => <>{children}</>,
  TooltipTrigger: ({ children }: any) => <>{children}</>,
}));

// --- Select: passthrough ---
mock.module('@/components/ui/select', () => ({
  Select: ({ children }: any) => <div>{children}</div>,
  SelectContent: ({ children }: any) => <div>{children}</div>,
  SelectItem: ({ children, value }: any) => <option value={value}>{children}</option>,
  SelectTrigger: ({ children, ...props }: any) => <div {...props}>{children}</div>,
  SelectValue: ({ placeholder }: any) => <span>{placeholder}</span>,
}));

// --- DnD-kit: passthrough ---
mock.module('@dnd-kit/core', () => ({
  DndContext: ({ children }: any) => <>{children}</>,
  useSensor: () => ({}),
  useSensors: () => [],
  PointerSensor: class {},
  KeyboardSensor: class {},
  closestCenter: () => null,
}));

mock.module('@dnd-kit/sortable', () => ({
  SortableContext: ({ children }: any) => <>{children}</>,
  verticalListSortingStrategy: {},
  useSortable: () => ({
    attributes: {},
    listeners: {},
    setNodeRef: () => {},
    transform: null,
    transition: null,
    isDragging: false,
  }),
}));

mock.module('@dnd-kit/utilities', () => ({
  CSS: { Transform: { toString: () => undefined } },
}));

mock.module('@/hooks/useSortableList', () => ({
  useSortableList: ({ items }: any) => ({
    orderedItems: items,
    sensors: [],
    collisionDetection: () => null,
    handleDragEnd: () => {},
    isDragDisabled: false,
  }),
}));

// --- Workflow query hooks (replaces direct @/services/api mock) ---
mock.module('@/hooks/queries/useWorkflowQueries', () => ({
  useWorkflowsSummary: () => ({
    data: mockWorkflows,
    isLoading: false,
    error: null,
    refetch: mock(() => {}),
  }),
  useDeleteWorkflow: () => ({
    mutateAsync: deleteMutateAsync,
    isPending: mockDeleteIsPending,
  }),
  useCloneWorkflow: () => ({
    mutateAsync: cloneMutateAsync,
    isPending: mockCloneIsPending,
  }),
}));

// --- Auth store ---
const mockAuthStore: any = {
  roles: ['ADMIN'],
  token: 'test-token',
  userId: 'user-1',
  organizationId: 'local-dev',
  provider: 'local' as const,
};

mock.module('@/store/authStore', () => {
  const useAuthStoreMock = ((selector: (state: typeof mockAuthStore) => any) =>
    selector(mockAuthStore)) as any;
  useAuthStoreMock.setState = (partial: any) => {
    const nextState = typeof partial === 'function' ? partial(mockAuthStore) : partial;
    if (nextState && typeof nextState === 'object') {
      Object.assign(mockAuthStore, nextState);
    }
  };
  useAuthStoreMock.getState = () => mockAuthStore;
  useAuthStoreMock.persist = { clearStorage: async () => {} };
  return { useAuthStore: useAuthStoreMock, DEFAULT_ORG_ID: 'local-dev' };
});

// --- Auth utility ---
mock.module('@/utils/auth', () => ({
  hasAdminRole: (roles: string[]) => roles.includes('ADMIN'),
}));

// --- Toast ---
mock.module('@/components/ui/use-toast', () => ({
  useToast: () => ({ toast: mockToast }),
}));

// --- Analytics ---
mock.module('@/features/analytics/events', () => ({
  track: mock(() => {}),
  Events: {
    WorkflowListViewed: 'wf_list_viewed',
    WorkflowCreateClicked: 'wf_create_clicked',
    WorkflowDuplicated: 'wf_duplicated',
  },
}));

// --- Document title ---
mock.module('@/hooks/useDocumentTitle', () => ({
  useDocumentTitle: () => {},
}));

// --- Logger ---
mock.module('@/lib/logger', () => ({
  logger: { error: () => {}, warn: () => {}, info: () => {}, debug: () => {} },
}));

const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

// Import component AFTER all mock.module() calls
import { WorkflowList } from '@/pages/WorkflowList';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ISO = '2024-01-01T00:00:00.000Z';

const makeWorkflow = (id: string, name: string): WorkflowSummary => ({
  id,
  name,
  description: null,
  organizationId: 'local-dev',
  isSystem: false,
  templateId: null,
  lastRun: null,
  latestRunStatus: null,
  runCount: 0,
  nodeCount: 2,
  createdAt: ISO,
  updatedAt: ISO,
});

const renderWorkflowList = () =>
  render(
    <MemoryRouter>
      <WorkflowList />
    </MemoryRouter>,
  );

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('WorkflowList delete workflow flow', () => {
  beforeEach(() => {
    cleanup();
    mockWorkflows = [];
    deleteMutateAsync.mockReset();
    deleteMutateAsync.mockResolvedValue(undefined);
    cloneMutateAsync.mockReset();
    mockDeleteIsPending = false;
    mockCloneIsPending = false;
    mockToast.mockReset();
    mockAuthStore.roles = ['ADMIN'];
  });

  afterEach(() => {
    cleanup();
  });

  it('opens confirmation dialog with workflow details when delete is clicked', async () => {
    const workflow = makeWorkflow('11111111-1111-4111-8111-111111111111', 'Alpha Workflow');
    mockWorkflows = [workflow];

    renderWorkflowList();

    await screen.findAllByText('Alpha Workflow');

    // Find the delete menu item in the dropdown (rendered inline due to mock)
    const deleteItems = screen.getAllByRole('menuitem');
    const deleteItem = deleteItems.find((el) => el.textContent?.includes('Delete'));
    expect(deleteItem).toBeDefined();
    fireEvent.click(deleteItem!);

    // ConfirmDialog renders as an AlertDialog with the workflow name
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText(/Alpha Workflow/)).toBeInTheDocument();
    // "Delete workflow" appears as both title and confirm button
    expect(within(dialog).getAllByText('Delete workflow').length).toBeGreaterThanOrEqual(1);
  });

  it('calls mutation on confirmed delete', async () => {
    const workflow = makeWorkflow('22222222-2222-4222-8222-222222222222', 'Beta Workflow');
    mockWorkflows = [workflow];

    renderWorkflowList();

    await screen.findAllByText('Beta Workflow');

    const deleteItems = screen.getAllByRole('menuitem');
    const deleteItem = deleteItems.find((el) => el.textContent?.includes('Delete'));
    fireEvent.click(deleteItem!);

    const dialog = await screen.findByRole('alertdialog');
    const confirmButton = within(dialog).getByRole('button', { name: 'Delete workflow' });
    fireEvent.click(confirmButton);

    await waitFor(() => {
      expect(deleteMutateAsync).toHaveBeenCalledWith(workflow.id);
    });
  });

  it('shows toast error when delete fails', async () => {
    const workflow = makeWorkflow('33333333-3333-4333-8333-333333333333', 'Gamma Workflow');
    mockWorkflows = [workflow];
    deleteMutateAsync.mockRejectedValue(new Error('Delete failed'));

    renderWorkflowList();

    await screen.findAllByText('Gamma Workflow');

    const deleteItems = screen.getAllByRole('menuitem');
    const deleteItem = deleteItems.find((el) => el.textContent?.includes('Delete'));
    fireEvent.click(deleteItem!);

    const dialog = await screen.findByRole('alertdialog');
    const confirmButton = within(dialog).getByRole('button', { name: 'Delete workflow' });
    fireEvent.click(confirmButton);

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Delete failed',
          variant: 'destructive',
        }),
      );
    });
  });
});

afterAll(() => {
  consoleErrorSpy.mockRestore();
});
