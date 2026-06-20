import { afterEach, afterAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import { screen, cleanup } from '@testing-library/react';
import { renderWithProviders } from '@/test/render-with-providers';
import { createAlertDialogMock } from '@/test/mocks/dialog';
import {
  createDndCoreMock,
  createDndSortableMock,
  createDndUtilitiesMock,
  createUseSortableListMock,
} from '@/test/mocks/dnd-kit';
import { createAuthStoreMock } from '@/test/mocks/auth-store';
import { createSelectMock } from '@/test/mocks/radix-select';
import { restoreMockedModules } from '@/test/restore-mocks';

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
mock.module('@/components/ui/select', createSelectMock);

// --- AlertDialog: passthrough for ConfirmDialog ---
mock.module('@/components/ui/alert-dialog', createAlertDialogMock);

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
mock.module('@dnd-kit/core', createDndCoreMock);
mock.module('@dnd-kit/sortable', createDndSortableMock);
mock.module('@dnd-kit/utilities', createDndUtilitiesMock);
mock.module('@/hooks/useSortableList', createUseSortableListMock);

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
mock.module('@/store/authStore', () => createAuthStoreMock({ roles: () => mockRoles }));

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

const renderList = () => renderWithProviders(<WorkflowList />);

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

  afterAll(() =>
    restoreMockedModules([
      '@/components/ui/alert-dialog',
      '@/components/ui/dropdown-menu',
      '@/components/ui/select',
      '@/components/ui/tooltip',
      '@/components/ui/use-toast',
      '@/features/analytics/events',
      '@/hooks/queries/useWorkflowQueries',
      '@/hooks/useDocumentTitle',
      '@/hooks/useSortableList',
      '@/lib/logger',
      '@/store/authStore',
      '@/utils/auth',
      '@dnd-kit/core',
      '@dnd-kit/sortable',
      '@dnd-kit/utilities',
    ]),
  );

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
