import { describe, it, beforeEach, afterEach, expect, mock, afterAll } from 'bun:test';
import { realModuleExports, restoreMockedModules } from '@/test/restore-mocks';
import { fireEvent, render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ArtifactMetadata } from '@sentris/shared';

// ---------------------------------------------------------------------------
// Mutable mock state
// ---------------------------------------------------------------------------

const mockQueryState: {
  library: ArtifactMetadata[];
  isLoading: boolean;
  error: Error | null;
} = {
  library: [],
  isLoading: false,
  error: null,
};

const mockDownloadMutateAsync = mock(async (_input: any) => {});
const mockDeleteMutateAsync = mock(async (_id: string) => {});
let mockDeleteIsPending = false;
let mockDeleteVariables: string | undefined;
let mockDownloadIsPending = false;

// ---------------------------------------------------------------------------
// Module mocks (BEFORE component import)
// ---------------------------------------------------------------------------

// --- DnD-kit: passthrough mocks ---
mock.module('@dnd-kit/core', () => ({
  ...realModuleExports('@dnd-kit/core'),
  DndContext: ({ children }: any) => <>{children}</>,
  useSensor: () => ({}),
  useSensors: () => [],
  PointerSensor: class {},
  KeyboardSensor: class {},
  closestCenter: () => null,
}));

mock.module('@dnd-kit/sortable', () => ({
  ...realModuleExports('@dnd-kit/sortable'),
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
  arrayMove: (arr: unknown[]) => arr,
}));

// --- Sortable UI components: render children ---
mock.module('@/components/ui/sortable', () => ({
  SortableTableRow: ({ children, id }: any) => {
    const handleProps = { listeners: {}, attributes: {} };
    return (
      <tr data-testid={`sortable-row-${id}`}>
        {typeof children === 'function' ? children({ handleProps }) : children}
      </tr>
    );
  },
  DragHandle: () => <td />,
}));

// --- useSortableList hook ---
mock.module('@/hooks/useSortableList', () => ({
  useSortableList: ({ items }: any) => ({
    orderedItems: items,
    sensors: [],
    collisionDetection: () => null,
    handleDragEnd: () => {},
    isDragDisabled: false,
  }),
}));

// --- Artifact queries ---
mock.module('@/hooks/queries/useArtifactQueries', () => ({
  useArtifactLibrary: () => ({
    data: mockQueryState.library,
    isLoading: mockQueryState.isLoading,
    error: mockQueryState.error,
  }),
  useDownloadArtifact: () => ({
    mutateAsync: mockDownloadMutateAsync,
    isPending: mockDownloadIsPending,
  }),
  useDeleteArtifact: () => ({
    mutateAsync: mockDeleteMutateAsync,
    isPending: mockDeleteIsPending,
    variables: mockDeleteVariables,
  }),
}));

// --- Workflow queries ---
const mockWorkflows = [
  { id: 'wf-111', name: 'Recon Scan' },
  { id: 'wf-222', name: 'Deploy Pipeline' },
];

mock.module('@/hooks/queries/useWorkflowQueries', () => ({
  ...realModuleExports('@/hooks/queries/useWorkflowQueries'),
  useWorkflowsSummary: () => ({
    data: mockWorkflows,
    isLoading: false,
  }),
}));

mock.module('@tanstack/react-query', () => ({
  ...realModuleExports('@tanstack/react-query'),
  useQueryClient: () => ({
    invalidateQueries: mock(async () => {}),
  }),
}));

// --- Confirm dialog hook ---
const mockConfirm = mock(async () => false);
mock.module('@/hooks/useConfirmDialog', () => ({
  useConfirmDialog: () => ({
    confirm: mockConfirm,
    dialogProps: { open: false, onOpenChange: () => {}, title: '', description: '' },
  }),
}));

// --- Confirm dialog component (no-op) ---
mock.module('@/components/ui/confirm-dialog', () => ({
  ConfirmDialog: () => null,
}));

// --- Toast ---
const mockToast = mock((_opts: any) => {});
mock.module('@/components/ui/use-toast', () => ({
  ...realModuleExports('@/components/ui/use-toast'),
  useToast: () => ({ toast: mockToast }),
}));

// --- Auth store ---
mock.module('@/store/authStore', () => {
  const real = realModuleExports('@/store/authStore');
  const useAuthStore: any = (selector?: (state: any) => any) => {
    const state = {
      token: 'test-token',
      userId: 'user-1',
      organizationId: 'org-001',
      roles: ['ADMIN'],
      provider: 'local' as const,
    };
    return selector ? selector(state) : state;
  };
  useAuthStore.setState = (_partial: any) => {};
  useAuthStore.getState = () => ({
    token: 'test-token',
    userId: 'user-1',
    organizationId: 'org-001',
    roles: ['ADMIN'],
    provider: 'local',
  });
  useAuthStore.subscribe = () => () => {};
  useAuthStore.persist = { clearStorage: async () => {} };
  return { ...real, useAuthStore, DEFAULT_ORG_ID: 'default' };
});

// --- Remote uploads utility ---
mock.module('@/utils/artifacts', () => ({
  ...realModuleExports('@/utils/artifacts'),
  getRemoteUploads: () => [],
}));

// --- Logger ---
mock.module('@/lib/logger', () => ({
  ...realModuleExports('@/lib/logger'),
  logger: { error: () => {}, warn: () => {}, info: () => {}, debug: () => {} },
}));

// Import component AFTER all mock.module() calls
import { ArtifactLibrary } from '@/pages/ArtifactLibrary';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ISO = '2024-06-15T12:00:00.000Z';

const artifactA: ArtifactMetadata = {
  id: 'aaa-111',
  runId: 'run-001',
  workflowId: 'wf-111',
  workflowVersionId: null,
  componentRef: 'file-writer',
  fileId: 'file-aaa',
  name: 'nmap-scan-results.json',
  mimeType: 'application/json',
  size: 2048,
  destinations: ['library'],
  metadata: undefined,
  organizationId: 'org-001',
  createdAt: ISO,
};

const artifactB: ArtifactMetadata = {
  id: 'bbb-222',
  runId: 'run-002',
  workflowId: 'wf-222',
  workflowVersionId: null,
  componentRef: 'file-writer',
  fileId: 'file-bbb',
  name: 'deploy-log.txt',
  mimeType: 'text/plain',
  size: 10240,
  destinations: ['library'],
  metadata: undefined,
  organizationId: 'org-001',
  createdAt: '2024-07-01T08:30:00.000Z',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const setupStore = (overrides: Partial<typeof mockQueryState> = {}) => {
  mockQueryState.library = overrides.library ?? [artifactA, artifactB];
  mockQueryState.isLoading = overrides.isLoading ?? false;
  mockQueryState.error = overrides.error ?? null;
  mockDeleteIsPending = false;
  mockDeleteVariables = undefined;
  mockDownloadIsPending = false;
  mockDownloadMutateAsync.mockClear();
  mockDeleteMutateAsync.mockClear();
  mockConfirm.mockClear();
  mockToast.mockClear();
};

const renderPage = () =>
  render(
    <MemoryRouter>
      <ArtifactLibrary />
    </MemoryRouter>,
  );

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

afterAll(() =>
  restoreMockedModules([
    '@dnd-kit/core',
    '@dnd-kit/sortable',
    '@/components/ui/sortable',
    '@/hooks/useSortableList',
    '@/hooks/queries/useArtifactQueries',
    '@/hooks/queries/useWorkflowQueries',
    '@tanstack/react-query',
    '@/hooks/useConfirmDialog',
    '@/components/ui/confirm-dialog',
    '@/components/ui/use-toast',
    '@/store/authStore',
    '@/utils/artifacts',
    '@/lib/logger',
  ]),
);

describe('ArtifactLibrary', () => {
  beforeEach(() => {
    cleanup();
    setupStore();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders without crashing', () => {
    renderPage();
    // The page should render the search input at minimum
    expect(screen.getByPlaceholderText('Filter by name or component')).toBeInTheDocument();
  });

  it('renders loading skeletons when isLoading is true', () => {
    setupStore({ isLoading: true, library: [] });
    renderPage();

    const container = document.querySelector('[aria-busy="true"]');
    expect(container).toBeTruthy();
  });

  it('renders empty state when no artifacts exist', () => {
    setupStore({ library: [] });
    renderPage();

    expect(screen.getByText('No artifacts found')).toBeInTheDocument();
  });

  it('renders artifact rows with name and workflow', () => {
    setupStore();
    renderPage();

    // Artifact names
    expect(screen.getByText('nmap-scan-results.json')).toBeInTheDocument();
    expect(screen.getByText('deploy-log.txt')).toBeInTheDocument();

    // Workflow names resolved from mock
    expect(screen.getByText('Recon Scan')).toBeInTheDocument();
    expect(screen.getByText('Deploy Pipeline')).toBeInTheDocument();
  });

  it('displays formatted file sizes', () => {
    setupStore();
    renderPage();

    // 2048 bytes = 2.0 KB, 10240 bytes = 10 KB
    expect(screen.getByText('2.0 KB')).toBeInTheDocument();
    expect(screen.getByText('10 KB')).toBeInTheDocument();
  });

  it('renders Refresh button with correct aria-label', () => {
    setupStore();
    renderPage();

    const refreshBtn = screen.getByRole('button', { name: /Refresh artifacts/i });
    expect(refreshBtn).toBeInTheDocument();
  });

  it('renders Delete and Download action buttons with aria-labels per artifact', () => {
    setupStore();
    renderPage();

    // Each artifact row has a Delete and Download button with aria-label
    expect(
      screen.getByRole('button', { name: /Delete nmap-scan-results\.json/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /Download nmap-scan-results\.json/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Delete deploy-log\.txt/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Download deploy-log\.txt/i })).toBeInTheDocument();
  });

  it('shows ErrorBanner when error is set', () => {
    setupStore({ error: new Error('Failed to load artifacts') });
    renderPage();

    expect(screen.getByText('Failed to load artifacts')).toBeInTheDocument();
  });

  it('search input filters artifacts by updating search query', () => {
    setupStore();
    renderPage();

    const searchInput = screen.getByPlaceholderText('Filter by name or component');
    expect(searchInput).toBeInTheDocument();

    // Typing in the search should update the input value
    fireEvent.change(searchInput, { target: { value: 'nmap' } });
    expect((searchInput as HTMLInputElement).value).toBe('nmap');
  });

  it('renders table headers when data is present', () => {
    setupStore();
    renderPage();

    expect(screen.getByText('Name')).toBeInTheDocument();
    expect(screen.getByText('Size')).toBeInTheDocument();
    expect(screen.getByText('Actions')).toBeInTheDocument();
  });
});
