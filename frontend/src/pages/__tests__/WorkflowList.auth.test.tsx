import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import { MemoryRouter } from 'react-router-dom';
import { render, screen, cleanup } from '@testing-library/react';

// ---------------------------------------------------------------------------
// Mutable mock state
// ---------------------------------------------------------------------------

let mockRoles: string[] = ['ADMIN'];

// ---------------------------------------------------------------------------
// Module mocks (BEFORE component import)
// ---------------------------------------------------------------------------

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

// --- AlertDialog: passthrough for ConfirmDialog ---
mock.module('@/components/ui/alert-dialog', () => {
  const passthrough = ({ children, ...props }: any) => <div {...props}>{children}</div>;
  return {
    AlertDialog: ({ open, children }: any) => (open ? <>{children}</> : null),
    AlertDialogContent: ({ children, ...props }: any) => (
      <div role="alertdialog" {...props}>
        {children}
      </div>
    ),
    AlertDialogHeader: passthrough,
    AlertDialogFooter: passthrough,
    AlertDialogTitle: passthrough,
    AlertDialogDescription: passthrough,
    AlertDialogAction: ({ children, onClick, ...props }: any) => (
      <button onClick={onClick} {...props}>
        {children}
      </button>
    ),
    AlertDialogCancel: ({ children, onClick, ...props }: any) => (
      <button onClick={onClick} {...props}>
        {children}
      </button>
    ),
    AlertDialogPortal: ({ children }: any) => <>{children}</>,
    AlertDialogOverlay: ({ children }: any) => <>{children}</>,
    AlertDialogTrigger: ({ children }: any) => <>{children}</>,
  };
});

// --- DropdownMenu: render items directly ---
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

// --- Workflow query hooks (returns empty data so EmptyState renders) ---
mock.module('@/hooks/queries/useWorkflowQueries', () => ({
  useWorkflowsSummary: () => ({
    data: [],
    isLoading: false,
    error: null,
    refetch: mock(() => {}),
  }),
  useDeleteWorkflow: () => ({
    mutateAsync: mock(async () => {}),
    isPending: false,
  }),
  useCloneWorkflow: () => ({
    mutateAsync: mock(async () => ({ id: 'new', name: 'Copy' })),
    isPending: false,
  }),
}));

// --- Auth store (mutable roles) ---
mock.module('@/store/authStore', () => {
  const useAuthStoreMock = ((selector?: (state: any) => any) => {
    const state = {
      roles: mockRoles,
      token: 'test-token',
      userId: 'user-1',
      organizationId: 'local-dev',
      provider: 'local' as const,
    };
    return selector ? selector(state) : state;
  }) as any;

  useAuthStoreMock.setState = () => {};
  useAuthStoreMock.getState = () => ({
    roles: mockRoles,
    token: 'test-token',
    userId: 'user-1',
    organizationId: 'local-dev',
    provider: 'local',
  });
  useAuthStoreMock.persist = { clearStorage: async () => {} };

  return { useAuthStore: useAuthStoreMock, DEFAULT_ORG_ID: 'local-dev' };
});

// --- Auth utility ---
mock.module('@/utils/auth', () => ({
  hasAdminRole: (roles: string[]) => roles.includes('ADMIN'),
}));

// --- Toast ---
mock.module('@/components/ui/use-toast', () => ({
  useToast: () => ({ toast: mock(() => {}) }),
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

// Import component AFTER all mock.module() calls
import { WorkflowList } from '@/pages/WorkflowList';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const renderList = () =>
  render(
    <MemoryRouter>
      <WorkflowList />
    </MemoryRouter>,
  );

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('WorkflowList role gating', () => {
  beforeEach(() => {
    cleanup();
    mockRoles = ['ADMIN'];
  });

  afterEach(() => {
    cleanup();
  });

  it('enables workflow creation for admins', async () => {
    renderList();
    const createButton = await screen.findByRole('button', { name: /Create Workflow/i });
    expect(createButton).toBeEnabled();
  });

  it('disables workflow creation for members', async () => {
    mockRoles = ['MEMBER'];

    renderList();
    const createButton = await screen.findByRole('button', { name: /Create Workflow/i });
    expect(createButton).toBeDisabled();
  });
});
