import { describe, it, beforeEach, afterEach, expect, mock, afterAll } from 'bun:test';
import { realModuleExports, restoreMockedModules } from '@/test/restore-mocks';
import { fireEvent, render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { Template, TemplateCategory } from '@/types/templates';
import { getTemplateSetupLevel } from '@/pages/template-library/setupLevel';
import { createDialogMock } from '@/test/mocks/dialog';
import {
  createDndCoreMock,
  createDndSortableMock,
  createSortableCardMock,
  createUseSortableListMock,
} from '@/test/mocks/dnd-kit';
import { createAuthStoreMock } from '@/test/mocks/auth-store';
import { createSelectMock } from '@/test/mocks/radix-select';

// ---------------------------------------------------------------------------
// Mutable mock state
// ---------------------------------------------------------------------------

const mockQueryState: {
  templates: Template[];
  categories: TemplateCategory[];
  tags: string[];
  isLoading: boolean;
  error: Error | null;
} = {
  templates: [],
  categories: [],
  tags: [],
  isLoading: false,
  error: null,
};

const mockRefetch = mock(async () => {});
const mockSyncMutateAsync = mock(async () => {});
let mockSyncIsPending = false;
let mockRoles: string[] = ['ADMIN'];
realModuleExports('@/hooks/queries/useTemplateQueries');

// ---------------------------------------------------------------------------
// Module mocks (BEFORE component import)
// ---------------------------------------------------------------------------

// --- DnD-kit: passthrough mocks ---
mock.module('@dnd-kit/core', createDndCoreMock);
mock.module('@dnd-kit/sortable', createDndSortableMock);

// --- Sortable card components: passthrough ---
mock.module('@/components/ui/sortable-card', createSortableCardMock);

// --- useSortableList hook ---
mock.module('@/hooks/useSortableList', createUseSortableListMock);

// --- Dialog mock ---
mock.module('@/components/ui/dialog', createDialogMock);

// --- Tooltip mock ---
mock.module('@/components/ui/tooltip', () => ({
  Tooltip: ({ children }: any) => <>{children}</>,
  TooltipContent: ({ children }: any) => <span>{children}</span>,
  TooltipProvider: ({ children }: any) => <>{children}</>,
  TooltipTrigger: ({ children }: any) => <>{children}</>,
}));

// --- Select mock ---
mock.module('@/components/ui/select', createSelectMock);

// --- Template queries ---
mock.module('@/hooks/queries/useTemplateQueries', () => ({
  useTemplates: () => ({
    data: mockQueryState.templates,
    isLoading: mockQueryState.isLoading,
    error: mockQueryState.error,
    refetch: mockRefetch,
  }),
  useTemplateCategories: () => ({
    data: mockQueryState.categories,
  }),
  useTemplateTags: () => ({
    data: mockQueryState.tags,
  }),
  useSyncTemplates: () => ({
    mutateAsync: mockSyncMutateAsync,
    isPending: mockSyncIsPending,
  }),
  useUseTemplate: () => ({
    mutateAsync: mock(async () => ({ workflowId: 'wf-new' })),
    isPending: false,
  }),
}));

// --- Auth store ---
mock.module('@/store/authStore', () => createAuthStoreMock({ roles: () => mockRoles }));

// --- Auth utility ---
mock.module('@/utils/auth', () => ({
  ...realModuleExports('@/utils/auth'),
  hasAdminRole: (roles: string[]) => roles.includes('ADMIN'),
}));

// --- Toast ---
const mockToast = mock((_opts: any) => {});
mock.module('@/components/ui/use-toast', () => ({
  ...realModuleExports('@/components/ui/use-toast'),
  useToast: () => ({ toast: mockToast }),
}));

// --- Analytics events ---
mock.module('@/features/analytics/events', () => ({
  ...realModuleExports('@/features/analytics/events'),
  track: mock(() => {}),
  Events: { TemplateUseClicked: 'template_use_clicked' },
}));

// --- UseTemplateModal / WorkflowPreview (stub) ---
mock.module('@/features/templates/UseTemplateModal', () => ({
  ...realModuleExports('@/features/templates/UseTemplateModal'),
  UseTemplateModal: () => null,
}));

mock.module('@/features/templates/WorkflowPreview', () => ({
  ...realModuleExports('@/features/templates/WorkflowPreview'),
  WorkflowPreview: () => <div data-testid="workflow-preview">preview</div>,
}));

// --- humanizeApiError ---
mock.module('@/lib/humanizeApiError', () => ({
  ...realModuleExports('@/lib/humanizeApiError'),
  humanizeApiError: (err: any) => err?.message ?? 'Unknown error',
}));

// Import component AFTER all mock.module() calls
import { TemplateLibraryPage } from '@/pages/TemplateLibraryPage';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const templateA: Template = {
  id: 'tmpl-001',
  name: 'network recon scan',
  description: 'Run a full network reconnaissance scan across target hosts.',
  category: 'security',
  tags: ['network', 'recon', 'nmap'],
  author: 'sentris',
  repository: 'sentris/templates',
  path: 'templates/network-recon.yaml',
  branch: 'main',
  version: '1.0.0',
  manifest: {},
  graph: { nodes: [{ id: 'node-1' }], edges: [] },
  requiredSecrets: [{ name: 'API_KEY', type: 'string', description: 'API key for scanner' }],
  popularity: 42,
  isOfficial: true,
  isVerified: true,
  isActive: true,
  createdAt: '2024-01-10T00:00:00.000Z',
  updatedAt: '2024-06-15T12:00:00.000Z',
};

const templateB: Template = {
  id: 'tmpl-002',
  name: 'compliance audit',
  description: 'Automated compliance checks against CIS benchmarks.',
  category: 'compliance',
  tags: ['cis', 'audit', 'benchmark'],
  author: 'contrib-user',
  repository: 'sentris/templates',
  path: 'templates/compliance-audit.yaml',
  branch: 'main',
  manifest: {},
  graph: undefined,
  requiredSecrets: [],
  popularity: 15,
  isOfficial: false,
  isVerified: true,
  isActive: true,
  createdAt: '2024-03-20T00:00:00.000Z',
  updatedAt: '2024-05-01T08:00:00.000Z',
};

const mockCategories: TemplateCategory[] = [
  { category: 'security', count: 5 },
  { category: 'compliance', count: 3 },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const setupStore = (overrides: Partial<typeof mockQueryState> & { roles?: string[] } = {}) => {
  mockQueryState.templates = overrides.templates ?? [templateA, templateB];
  mockQueryState.categories = overrides.categories ?? mockCategories;
  mockQueryState.tags = overrides.tags ?? ['network', 'recon', 'audit', 'cis'];
  mockQueryState.isLoading = overrides.isLoading ?? false;
  mockQueryState.error = overrides.error ?? null;
  mockRoles = overrides.roles ?? ['ADMIN'];
  mockSyncIsPending = false;
  mockRefetch.mockClear();
  mockSyncMutateAsync.mockClear();
  mockToast.mockClear();
};

const renderPage = () =>
  render(
    <MemoryRouter>
      <TemplateLibraryPage />
    </MemoryRouter>,
  );

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

afterAll(() =>
  restoreMockedModules([
    '@dnd-kit/core',
    '@dnd-kit/sortable',
    '@/components/ui/sortable-card',
    '@/hooks/useSortableList',
    '@/components/ui/dialog',
    '@/components/ui/tooltip',
    '@/components/ui/select',
    '@/hooks/queries/useTemplateQueries',
    '@/store/authStore',
    '@/utils/auth',
    '@/components/ui/use-toast',
    '@/features/analytics/events',
    '@/features/templates/UseTemplateModal',
    '@/features/templates/WorkflowPreview',
    '@/lib/humanizeApiError',
  ]),
);

describe('TemplateLibraryPage', () => {
  beforeEach(() => {
    cleanup();
    setupStore();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders without crashing', () => {
    renderPage();
    expect(screen.getByPlaceholderText('Filter by template name')).toBeInTheDocument();
  });

  it('omits the redundant page heading supplied by the app top bar', () => {
    renderPage();

    expect(
      screen.queryByRole('heading', { level: 2, name: /^Templates$/ }),
    ).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText('Filter by template name')).toBeInTheDocument();
  });

  it('renders loading skeletons when isLoading is true', () => {
    setupStore({ isLoading: true, templates: [] });
    renderPage();

    // CardSkeleton renders multiple skeleton elements; check for their container
    const skeletons = document.querySelectorAll('.animate-pulse');
    expect(skeletons.length).toBeGreaterThan(0);
  });

  it('renders empty state when no templates exist and no filters active', () => {
    setupStore({ templates: [] });
    renderPage();

    expect(screen.getByText('No templates found')).toBeInTheDocument();
    expect(
      screen.getByText(
        'No templates available yet. Sync from GitHub to load the template library.',
      ),
    ).toBeInTheDocument();
  });

  it('renders template cards with names', () => {
    setupStore();
    renderPage();

    // Template names are title-cased
    expect(screen.getByText('Network Recon Scan')).toBeInTheDocument();
    expect(screen.getByText('Compliance Audit')).toBeInTheDocument();
  });

  it('renders template descriptions', () => {
    setupStore();
    renderPage();

    expect(
      screen.getByText('Run a full network reconnaissance scan across target hosts.'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Automated compliance checks against CIS benchmarks.'),
    ).toBeInTheDocument();
  });

  it('renders category badges', () => {
    setupStore();
    renderPage();

    // Category labels appear in badge text
    expect(screen.getAllByText('security').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('compliance').length).toBeGreaterThanOrEqual(1);
  });

  it('renders "Use Template" buttons for each template', () => {
    setupStore();
    renderPage();

    const useButtons = screen.getAllByRole('button', { name: /Use Template/i });
    expect(useButtons.length).toBe(2);
  });

  it('renders Contribute button', () => {
    setupStore();
    renderPage();

    const contributeBtn = screen.getByRole('button', { name: /Contribute/i });
    expect(contributeBtn).toBeInTheDocument();
  });

  it('renders Sync button', () => {
    setupStore();
    renderPage();

    const syncBtn = screen.getByRole('button', { name: /Sync/i });
    expect(syncBtn).toBeInTheDocument();
  });

  it('renders tag filter buttons', () => {
    setupStore();
    renderPage();

    // Tags may also appear inside template cards, so use getAllByText
    expect(screen.getAllByText('network').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('recon').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('audit').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('cis').length).toBeGreaterThanOrEqual(1);
  });

  it('search input is rendered and accepts input', () => {
    setupStore();
    renderPage();

    const searchInput = screen.getByPlaceholderText('Filter by template name');
    fireEvent.change(searchInput, { target: { value: 'recon' } });
    expect((searchInput as HTMLInputElement).value).toBe('recon');
  });

  it('shows ErrorBanner when error is set', () => {
    setupStore({ error: new Error('Failed to load templates') });
    renderPage();

    expect(screen.getByText('Failed to load templates')).toBeInTheDocument();
  });

  it('renders popularity count for templates with popularity > 0', () => {
    setupStore();
    renderPage();

    // templateA has popularity 42
    expect(screen.getByText('42')).toBeInTheDocument();
    // templateB has popularity 15
    expect(screen.getByText('15')).toBeInTheDocument();
  });

  it('renders required secrets count', () => {
    setupStore();
    renderPage();

    // templateA has 1 required secret
    expect(screen.getByText('1 secret')).toBeInTheDocument();
  });

  it('renders author initials avatar', () => {
    setupStore();
    renderPage();

    // templateA author "sentris" -> "S", templateB author "contrib-user" -> "C"
    expect(screen.getByText('S')).toBeInTheDocument();
    expect(screen.getByText('C')).toBeInTheDocument();
  });

  it('renders updated-at relative timestamps', () => {
    setupStore();
    renderPage();

    const updatedTexts = screen.getAllByText(/Updated/i);
    expect(updatedTexts.length).toBeGreaterThanOrEqual(2);
  });

  it('does not render validation badges or revalidation controls', () => {
    setupStore({
      templates: [
        {
          ...templateA,
          validation: {
            status: 'live-verified',
            recommendation: 'keep',
            terminalStatus: 'COMPLETED',
            artifactsCount: 1,
            verifiedAt: '2026-06-21T07:15:23.121Z',
            rationale: 'Live execution completed and produced at least one artifact.',
            isCurrent: true,
          },
        } as Template,
      ],
    });

    renderPage();

    expect(screen.queryByText('Live verified')).not.toBeInTheDocument();
    expect(screen.queryByText('Validation stale')).not.toBeInTheDocument();
    expect(screen.queryByText('Revalidate')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Filter by validation')).not.toBeInTheDocument();
    expect(screen.queryByText('Recent revalidations')).not.toBeInTheDocument();
  });

  it('opens the preview modal when a template card is clicked', () => {
    setupStore({ templates: [templateA] });
    renderPage();

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    fireEvent.click(
      screen.getByRole('button', { name: /View Network Recon Scan template details/i }),
    );

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toHaveTextContent('Network Recon Scan');
  });

  it('does not open preview when Use Template is clicked', () => {
    setupStore({ templates: [templateA] });
    renderPage();

    fireEvent.click(screen.getAllByRole('button', { name: /Use Template/i })[0]!);

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('does not render a separate preview icon button on cards', () => {
    setupStore({ templates: [templateA] });
    renderPage();

    const useTemplateButtons = screen.getAllByRole('button', { name: /Use Template/i });
    expect(useTemplateButtons.length).toBe(1);
    expect(screen.queryByLabelText(/^Preview network recon scan$/i)).not.toBeInTheDocument();
  });

  it('filters to net-only templates when "No setup required" is toggled', () => {
    mockQueryState.templates = [
      {
        id: 'net',
        name: 'net only',
        tags: [],
        repository: 'r',
        path: 'p',
        branch: 'main',
        manifest: {},
        graph: {
          nodes: [
            { id: 'a', type: 'core.workflow.entrypoint' },
            { id: 'b', type: 'sentris.nvd.cve.query' },
          ],
        },
        requiredSecrets: [],
        popularity: 0,
        isOfficial: false,
        isVerified: false,
        isActive: true,
        createdAt: '2026-07-23T00:00:00.000Z',
        updatedAt: '2026-07-23T00:00:00.000Z',
      },
      {
        id: 'docker',
        name: 'docker scan',
        tags: [],
        repository: 'r',
        path: 'p',
        branch: 'main',
        manifest: {},
        graph: {
          nodes: [
            { id: 'a', type: 'core.workflow.entrypoint' },
            { id: 'b', type: 'sentris.nuclei.scan' },
          ],
        },
        requiredSecrets: [],
        popularity: 0,
        isOfficial: false,
        isVerified: false,
        isActive: true,
        createdAt: '2026-07-23T00:00:00.000Z',
        updatedAt: '2026-07-23T00:00:00.000Z',
      },
    ] as Template[];

    renderPage();

    // Both visible initially.
    expect(screen.getByText('Net Only')).toBeDefined();
    expect(screen.getByText('Docker Scan')).toBeDefined();

    // Toggle "No setup required".
    fireEvent.click(screen.getByRole('button', { name: /No setup required/i }));

    expect(screen.getByText('Net Only')).toBeDefined();
    expect(screen.queryByText('Docker Scan')).toBeNull();
    // sanity: helper agrees
    expect(getTemplateSetupLevel(mockQueryState.templates[1])).toBe('needs-tooling');
  });

  it('shows a non-admin-friendly empty state when the library is empty and user cannot sync', () => {
    mockRoles = [];
    mockQueryState.templates = [];

    renderPage();

    expect(screen.getByText(/synced from GitHub by an administrator/i)).toBeDefined();
    const link = screen.getByRole('link', { name: /Browse templates on GitHub/i });
    expect(link.getAttribute('href')).toContain('github.com');
    // The toolbar always renders a "Sync templates" control (disabled for non-admins);
    // it must not be an active CTA in the empty state.
    const syncButton = screen.queryByRole('button', { name: /Sync templates/i });
    if (syncButton) expect(syncButton).toBeDisabled();
  });

  it('shows the empty-library state (not filter copy) for a non-admin deep-linked to ?setup=none on an empty library', () => {
    // Regression guard for FIX 1: the onboarding checklist deep-links a
    // brand-new user to /templates?setup=none, which sets showNoSetupOnly
    // -> hasFilters becomes true. A truly empty (unsynced) library must
    // still show the non-admin "browse on GitHub" empty state, not the
    // "Try adjusting your filters" copy.
    mockRoles = [];
    mockQueryState.templates = [];

    render(
      <MemoryRouter initialEntries={['/templates?setup=none']}>
        <TemplateLibraryPage />
      </MemoryRouter>,
    );

    const link = screen.getByRole('link', { name: /Browse templates on GitHub/i });
    expect(link.getAttribute('href')).toContain('github.com');
    expect(screen.queryByText(/Try adjusting your filters/i)).not.toBeInTheDocument();
  });

  it('shows the "adjust your filters" empty state (not the sync/GitHub empty state) when a search filters a non-empty library to zero results', () => {
    // Regression guard: `filters` (category/search/tags) is a server-side
    // query — `templates` coming back empty because of an active search
    // does NOT mean the library itself is empty. Simulate that by setting
    // the mocked query result to [] and then driving a search term through
    // the UI so `searchQuery` becomes non-empty.
    mockQueryState.templates = [];

    renderPage();

    const searchInput = screen.getByPlaceholderText('Filter by template name');
    fireEvent.change(searchInput, { target: { value: 'zzz-no-match' } });

    expect(screen.getByText(/Try adjusting your filters/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Clear filters/i })).toBeInTheDocument();

    expect(
      screen.queryByRole('link', { name: /Browse templates on GitHub/i }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/synced from GitHub by an administrator/i)).not.toBeInTheDocument();
    expect(
      screen.queryByText(
        'No templates available yet. Sync from GitHub to load the template library.',
      ),
    ).not.toBeInTheDocument();
  });
});
