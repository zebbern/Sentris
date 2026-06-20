import { describe, it, beforeEach, afterEach, expect, mock, afterAll } from 'bun:test';
import { realModuleExports, restoreMockedModules } from '@/test/restore-mocks';
import { fireEvent, screen, cleanup } from '@testing-library/react';
import type { ArtifactMetadata } from '@sentris/shared';
import { createConfirmDialogMock } from '@/test/mocks/dialog';
import {
  createDndCoreMock,
  createDndSortableMock,
  createSortableUiMock,
  createUseSortableListMock,
} from '@/test/mocks/dnd-kit';
import { createAuthStoreMock } from '@/test/mocks/auth-store';
import { renderWithProviders } from '@/test/render-with-providers';

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
mock.module('@dnd-kit/core', createDndCoreMock);
mock.module('@dnd-kit/sortable', createDndSortableMock);

// --- Sortable UI components: render children ---
mock.module('@/components/ui/sortable', createSortableUiMock);

// --- useSortableList hook ---
mock.module('@/hooks/useSortableList', createUseSortableListMock);

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

// --- Confirm dialog component ---
mock.module('@/components/ui/confirm-dialog', createConfirmDialogMock);

// --- Toast ---
const mockToast = mock((_opts: any) => {});
mock.module('@/components/ui/use-toast', () => ({
  ...realModuleExports('@/components/ui/use-toast'),
  useToast: () => ({ toast: mockToast }),
}));

// --- Auth store ---
mock.module('@/store/authStore', () => createAuthStoreMock());

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
  mockToast.mockClear();
};

const renderPage = () => renderWithProviders(<ArtifactLibrary />);

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
    expect(screen.getByPlaceholderText('Filter by name...')).toBeInTheDocument();
  });

  it('omits the redundant page heading supplied by the app top bar', () => {
    renderPage();

    expect(
      screen.queryByRole('heading', { level: 2, name: /^Artifacts$/ }),
    ).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText('Filter by name...')).toBeInTheDocument();
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

    const searchInput = screen.getByPlaceholderText('Filter by name...');
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
