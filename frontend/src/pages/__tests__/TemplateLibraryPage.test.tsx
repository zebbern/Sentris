import { describe, it, beforeEach, afterEach, expect, mock, afterAll } from 'bun:test';
import { realModuleExports, restoreMockedModules } from '@/test/restore-mocks';
import { fireEvent, render, screen, cleanup, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { Template, TemplateCategory } from '@/types/templates';
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
const mockRevalidateMutate = mock(
  (_templateId: string, _options?: { onSuccess?: (data: any) => void }) => {},
);
let mockLatestRevalidationJob: any = null;
let mockLatestRevalidationIsFetching = false;
let mockRevalidationJobs: any[] = [];
let mockRevalidationJobsIsLoading = false;
let mockRevalidationLogTail: any = null;
let mockRevalidationLogIsFetching = false;
let mockSyncIsPending = false;
let mockRevalidateIsPending = false;
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
  useRevalidateTemplate: () => ({
    mutate: mockRevalidateMutate,
    isPending: mockRevalidateIsPending,
    variables: undefined,
  }),
  useTemplateRevalidationJob: (auditId: string | null) => ({
    data: auditId ? mockLatestRevalidationJob : undefined,
    isFetching: mockLatestRevalidationIsFetching,
    refetch: mock(async () => mockLatestRevalidationJob),
  }),
  useTemplateRevalidationJobs: () => ({
    data: mockRevalidationJobs,
    isLoading: mockRevalidationJobsIsLoading,
    refetch: mock(async () => mockRevalidationJobs),
  }),
  useTemplateRevalidationJobLog: (auditId: string | null) => ({
    data: auditId ? mockRevalidationLogTail : undefined,
    isFetching: mockRevalidationLogIsFetching,
    refetch: mock(async () => mockRevalidationLogTail),
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
  mockRevalidateIsPending = false;
  mockLatestRevalidationJob = null;
  mockLatestRevalidationIsFetching = false;
  mockRevalidationJobs = [];
  mockRevalidationJobsIsLoading = false;
  mockRevalidationLogTail = null;
  mockRevalidationLogIsFetching = false;
  mockRefetch.mockClear();
  mockSyncMutateAsync.mockClear();
  mockRevalidateMutate.mockReset();
  mockRevalidateMutate.mockImplementation((_templateId: string) => {});
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
      screen.getByText('No templates available yet. Sync from GitHub to load templates.'),
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

    // formatTimeAgo is not mocked — it will render a relative date string
    // We check that "Updated" prefix appears for each card
    const updatedTexts = screen.getAllByText(/Updated/i);
    expect(updatedTexts.length).toBeGreaterThanOrEqual(2);
  });

  it('renders live validation metadata on template cards', () => {
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

    expect(screen.getAllByText('Live verified').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('1 artifact')).toBeInTheDocument();
  });

  it('renders stale validation metadata when a template changed after verification', () => {
    setupStore({
      templates: [
        {
          ...templateA,
          validation: {
            status: 'live-verified',
            recommendation: 'keep',
            terminalStatus: 'COMPLETED',
            artifactsCount: 1,
            verifiedAt: '2026-06-21T06:00:00.000Z',
            rationale: 'Live execution completed before the latest template update.',
            isCurrent: false,
          },
        } as Template,
      ],
    });

    renderPage();

    expect(screen.getAllByText('Validation stale').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Revalidate')).toBeInTheDocument();
    expect(
      screen.getByText('bun run template-library:audit -- --name "network recon scan" --force'),
    ).toBeInTheDocument();
  });

  it('renders live-audit guidance for templates that need fixes', () => {
    setupStore({
      templates: [
        {
          ...templateA,
          validation: {
            status: 'needs-fix',
            recommendation: 'fix',
            terminalStatus: 'FAILED',
            artifactsCount: 0,
            verifiedAt: '2026-06-21T07:15:23.121Z',
            rationale: 'Live execution failed.',
            isCurrent: true,
          },
        } as Template,
      ],
    });

    renderPage();

    expect(screen.getAllByText('Needs fix').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Revalidate')).toBeInTheDocument();
    expect(
      screen.getByText('bun run template-library:audit -- --name "network recon scan" --force'),
    ).toBeInTheDocument();
  });

  it('starts revalidation from a stale template card', () => {
    setupStore({
      templates: [
        {
          ...templateA,
          validation: {
            status: 'live-verified',
            recommendation: 'keep',
            terminalStatus: 'COMPLETED',
            artifactsCount: 1,
            verifiedAt: '2026-06-21T06:00:00.000Z',
            rationale: 'Live execution completed before the latest template update.',
            isCurrent: false,
          },
        } as Template,
      ],
    });

    renderPage();

    fireEvent.click(screen.getByRole('button', { name: 'Revalidate' }));

    expect(mockRevalidateMutate.mock.calls[0]?.[0]).toBe('tmpl-001');
    expect(typeof mockRevalidateMutate.mock.calls[0]?.[1]?.onSuccess).toBe('function');
  });

  it('shows a confirmation toast when revalidation starts', () => {
    setupStore({
      templates: [
        {
          ...templateA,
          validation: {
            status: 'needs-review',
            recommendation: 'review',
            terminalStatus: 'COMPLETED',
            artifactsCount: 1,
            verifiedAt: '2026-06-21T07:15:23.121Z',
            rationale: 'Live execution completed with warnings.',
            isCurrent: true,
          },
        } as Template,
      ],
    });
    mockRevalidateMutate.mockImplementation(
      (_templateId: string, options?: { onSuccess?: (data: any) => void }) => {
        options?.onSuccess?.({
          auditId: 'audit-1',
          templateId: 'tmpl-001',
          templateName: 'network recon scan',
          status: 'started',
          command: 'bun run template-library:audit -- --name "network recon scan" --force',
          outputDir: '.cache/template-revalidations/audit-1',
        });
      },
    );

    renderPage();

    fireEvent.click(screen.getByRole('button', { name: 'Revalidate' }));

    expect(mockToast).toHaveBeenCalledWith({
      title: 'Template revalidation started',
      description: 'network recon scan is running a targeted live audit.',
    });
  });

  it('shows latest revalidation status after starting a live audit', () => {
    setupStore({
      templates: [
        {
          ...templateA,
          validation: {
            status: 'needs-review',
            recommendation: 'review',
            terminalStatus: 'COMPLETED',
            artifactsCount: 1,
            verifiedAt: '2026-06-21T07:15:23.121Z',
            rationale: 'Live execution completed with warnings.',
            isCurrent: true,
          },
        } as Template,
      ],
    });
    mockLatestRevalidationJob = {
      auditId: 'template-revalidation-00000000-0000-4000-8000-000000000000',
      templateId: 'tmpl-001',
      templateName: 'network recon scan',
      status: 'completed',
      command: 'bun run template-library:audit -- --name "network recon scan" --force',
      outputDir:
        '.cache/template-revalidations/template-revalidation-00000000-0000-4000-8000-000000000000',
      startedAt: '2026-06-21T06:00:00.000Z',
      outputFiles: {
        marker:
          '.cache/template-revalidations/template-revalidation-00000000-0000-4000-8000-000000000000/revalidation-job.json',
        stdout:
          '.cache/template-revalidations/template-revalidation-00000000-0000-4000-8000-000000000000/stdout.log',
        stderr:
          '.cache/template-revalidations/template-revalidation-00000000-0000-4000-8000-000000000000/stderr.log',
        reportJson:
          '.cache/template-revalidations/template-revalidation-00000000-0000-4000-8000-000000000000/template-live-audit.json',
        reportMarkdown:
          '.cache/template-revalidations/template-revalidation-00000000-0000-4000-8000-000000000000/template-live-audit.md',
      },
      report: {
        generatedAt: '2026-06-21T06:30:00.000Z',
        resultCount: 1,
        recommendations: ['keep'],
        terminalStatuses: ['COMPLETED'],
      },
    };
    mockRevalidateMutate.mockImplementation(
      (_templateId: string, options?: { onSuccess?: (data: any) => void }) => {
        options?.onSuccess?.({
          auditId: 'template-revalidation-00000000-0000-4000-8000-000000000000',
          templateId: 'tmpl-001',
          templateName: 'network recon scan',
          status: 'started',
          command: 'bun run template-library:audit -- --name "network recon scan" --force',
          outputDir:
            '.cache/template-revalidations/template-revalidation-00000000-0000-4000-8000-000000000000',
        });
      },
    );

    renderPage();

    fireEvent.click(screen.getByRole('button', { name: 'Revalidate' }));

    expect(screen.getByRole('status')).toHaveTextContent('Latest revalidation');
    expect(screen.getByRole('status')).toHaveTextContent('Completed');
    expect(screen.getByRole('status')).toHaveTextContent('network recon scan');
    expect(screen.getByRole('status')).toHaveTextContent('keep');
    expect(screen.getByRole('status')).toHaveTextContent('COMPLETED');
  });

  it('refreshes template validation metadata after a live revalidation completes', async () => {
    setupStore({
      templates: [
        {
          ...templateA,
          validation: {
            status: 'live-verified',
            recommendation: 'keep',
            terminalStatus: 'COMPLETED',
            artifactsCount: 1,
            verifiedAt: '2026-06-21T06:00:00.000Z',
            rationale: 'Live execution completed before the latest template update.',
            isCurrent: false,
          },
        } as Template,
      ],
    });
    mockLatestRevalidationJob = {
      auditId: 'template-revalidation-00000000-0000-4000-8000-000000000003',
      templateId: 'tmpl-001',
      templateName: 'network recon scan',
      status: 'completed',
      command: 'bun run template-library:audit -- --name "network recon scan" --force',
      outputDir:
        '.cache/template-revalidations/template-revalidation-00000000-0000-4000-8000-000000000003',
      startedAt: '2026-06-21T06:00:00.000Z',
      outputFiles: {
        marker:
          '.cache/template-revalidations/template-revalidation-00000000-0000-4000-8000-000000000003/revalidation-job.json',
        stdout:
          '.cache/template-revalidations/template-revalidation-00000000-0000-4000-8000-000000000003/stdout.log',
        stderr:
          '.cache/template-revalidations/template-revalidation-00000000-0000-4000-8000-000000000003/stderr.log',
        reportJson:
          '.cache/template-revalidations/template-revalidation-00000000-0000-4000-8000-000000000003/template-live-audit.json',
        reportMarkdown:
          '.cache/template-revalidations/template-revalidation-00000000-0000-4000-8000-000000000003/template-live-audit.md',
      },
      report: {
        generatedAt: '2026-06-21T06:30:00.000Z',
        resultCount: 1,
        recommendations: ['keep'],
        terminalStatuses: ['COMPLETED'],
      },
    };
    mockRevalidateMutate.mockImplementation(
      (_templateId: string, options?: { onSuccess?: (data: any) => void }) => {
        options?.onSuccess?.({
          auditId: 'template-revalidation-00000000-0000-4000-8000-000000000003',
          templateId: 'tmpl-001',
          templateName: 'network recon scan',
          status: 'started',
          command: 'bun run template-library:audit -- --name "network recon scan" --force',
          outputDir:
            '.cache/template-revalidations/template-revalidation-00000000-0000-4000-8000-000000000003',
        });
      },
    );

    renderPage();

    fireEvent.click(screen.getByRole('button', { name: 'Revalidate' }));

    await waitFor(() => expect(mockRefetch).toHaveBeenCalledTimes(1));
  });

  it('refreshes template validation metadata when a recent revalidation completes', async () => {
    setupStore();
    mockRevalidationJobs = [
      {
        auditId: 'template-revalidation-00000000-0000-4000-8000-000000000004',
        templateId: 'tmpl-001',
        templateName: 'network recon scan',
        status: 'completed',
        command: 'bun run template-library:audit -- --name "network recon scan" --force',
        outputDir:
          '.cache/template-revalidations/template-revalidation-00000000-0000-4000-8000-000000000004',
        startedAt: '2026-06-21T06:00:00.000Z',
        outputFiles: {
          marker:
            '.cache/template-revalidations/template-revalidation-00000000-0000-4000-8000-000000000004/revalidation-job.json',
          stdout:
            '.cache/template-revalidations/template-revalidation-00000000-0000-4000-8000-000000000004/stdout.log',
          stderr:
            '.cache/template-revalidations/template-revalidation-00000000-0000-4000-8000-000000000004/stderr.log',
          reportJson:
            '.cache/template-revalidations/template-revalidation-00000000-0000-4000-8000-000000000004/template-live-audit.json',
          reportMarkdown:
            '.cache/template-revalidations/template-revalidation-00000000-0000-4000-8000-000000000004/template-live-audit.md',
        },
        report: {
          generatedAt: '2026-06-21T06:30:00.000Z',
          resultCount: 1,
          recommendations: ['keep'],
          terminalStatuses: ['COMPLETED'],
        },
      },
    ];

    renderPage();

    await waitFor(() => expect(mockRefetch).toHaveBeenCalledTimes(1));
  });

  it('renders recent revalidation history from the backend', () => {
    setupStore();
    mockRevalidationJobs = [
      {
        auditId: 'template-revalidation-00000000-0000-4000-8000-000000000001',
        templateId: 'tmpl-001',
        templateName: 'network recon scan',
        status: 'completed',
        command: 'bun run template-library:audit -- --name "network recon scan" --force',
        outputDir:
          '.cache/template-revalidations/template-revalidation-00000000-0000-4000-8000-000000000001',
        startedAt: '2026-06-21T06:00:00.000Z',
        outputFiles: {
          marker:
            '.cache/template-revalidations/template-revalidation-00000000-0000-4000-8000-000000000001/revalidation-job.json',
          stdout:
            '.cache/template-revalidations/template-revalidation-00000000-0000-4000-8000-000000000001/stdout.log',
          stderr:
            '.cache/template-revalidations/template-revalidation-00000000-0000-4000-8000-000000000001/stderr.log',
          reportJson:
            '.cache/template-revalidations/template-revalidation-00000000-0000-4000-8000-000000000001/template-live-audit.json',
          reportMarkdown:
            '.cache/template-revalidations/template-revalidation-00000000-0000-4000-8000-000000000001/template-live-audit.md',
        },
        report: {
          generatedAt: '2026-06-21T06:30:00.000Z',
          resultCount: 1,
          recommendations: ['keep'],
          terminalStatuses: ['COMPLETED'],
        },
      },
      {
        auditId: 'template-revalidation-00000000-0000-4000-8000-000000000002',
        templateId: 'tmpl-002',
        templateName: 'compliance audit',
        status: 'started',
        command: 'bun run template-library:audit -- --name "compliance audit" --force',
        outputDir:
          '.cache/template-revalidations/template-revalidation-00000000-0000-4000-8000-000000000002',
        startedAt: '2026-06-21T07:00:00.000Z',
        outputFiles: {
          marker:
            '.cache/template-revalidations/template-revalidation-00000000-0000-4000-8000-000000000002/revalidation-job.json',
          stdout:
            '.cache/template-revalidations/template-revalidation-00000000-0000-4000-8000-000000000002/stdout.log',
          stderr:
            '.cache/template-revalidations/template-revalidation-00000000-0000-4000-8000-000000000002/stderr.log',
          reportJson:
            '.cache/template-revalidations/template-revalidation-00000000-0000-4000-8000-000000000002/template-live-audit.json',
          reportMarkdown:
            '.cache/template-revalidations/template-revalidation-00000000-0000-4000-8000-000000000002/template-live-audit.md',
        },
        report: null,
      },
    ];

    renderPage();

    expect(screen.getByRole('region', { name: 'Recent revalidations' })).toBeInTheDocument();
    expect(screen.getByText('Recent revalidations')).toBeInTheDocument();
    expect(screen.getByText('network recon scan')).toBeInTheDocument();
    expect(screen.getByText('compliance audit')).toBeInTheDocument();
    expect(screen.getByText('keep / COMPLETED')).toBeInTheDocument();
    expect(screen.getByText('Live audit running')).toBeInTheDocument();
  });

  it('shows stderr log tail for a recent revalidation job', () => {
    setupStore();
    mockRevalidationJobs = [
      {
        auditId: 'template-revalidation-00000000-0000-4000-8000-000000000001',
        templateId: 'tmpl-001',
        templateName: 'network recon scan',
        status: 'completed',
        command: 'bun run template-library:audit -- --name "network recon scan" --force',
        outputDir:
          '.cache/template-revalidations/template-revalidation-00000000-0000-4000-8000-000000000001',
        startedAt: '2026-06-21T06:00:00.000Z',
        outputFiles: {
          marker:
            '.cache/template-revalidations/template-revalidation-00000000-0000-4000-8000-000000000001/revalidation-job.json',
          stdout:
            '.cache/template-revalidations/template-revalidation-00000000-0000-4000-8000-000000000001/stdout.log',
          stderr:
            '.cache/template-revalidations/template-revalidation-00000000-0000-4000-8000-000000000001/stderr.log',
          reportJson:
            '.cache/template-revalidations/template-revalidation-00000000-0000-4000-8000-000000000001/template-live-audit.json',
          reportMarkdown:
            '.cache/template-revalidations/template-revalidation-00000000-0000-4000-8000-000000000001/template-live-audit.md',
        },
        report: {
          generatedAt: '2026-06-21T06:30:00.000Z',
          resultCount: 1,
          recommendations: ['fix'],
          terminalStatuses: ['FAILED'],
        },
      },
    ];
    mockRevalidationLogTail = {
      auditId: 'template-revalidation-00000000-0000-4000-8000-000000000001',
      stream: 'stderr',
      content: 'failed to run template audit',
      bytes: 28,
      maxBytes: 4096,
      truncated: false,
    };

    renderPage();

    fireEvent.click(screen.getByRole('button', { name: 'Logs' }));

    expect(screen.getByRole('region', { name: 'Revalidation logs' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Revalidation logs' })).toHaveTextContent('stderr');
    expect(screen.getByText('failed to run template audit')).toBeInTheDocument();
  });

  it('allows revalidation for templates that have not been live checked', () => {
    setupStore({
      templates: [
        {
          ...templateA,
          validation: {
            status: 'unknown',
            recommendation: 'unknown',
            terminalStatus: null,
            artifactsCount: null,
            verifiedAt: null,
            rationale: 'No live validation ledger entry found for this template.',
            isCurrent: false,
          },
        } as Template,
      ],
    });

    renderPage();

    expect(screen.getByText('Not live checked')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Revalidate' }));

    expect(mockRevalidateMutate.mock.calls[0]?.[0]).toBe('tmpl-001');
  });

  it('shows credential-gated templates separately from unknown validation', () => {
    setupStore({
      templates: [
        {
          ...templateA,
          validation: {
            status: 'requires-secrets',
            recommendation: 'review',
            terminalStatus: null,
            artifactsCount: null,
            verifiedAt: null,
            rationale:
              'Template is credential-gated and requires live secrets before execution: DISCORD_WEBHOOK_URL.',
            isCurrent: true,
          },
          requiredSecrets: [
            {
              name: 'DISCORD_WEBHOOK_URL',
              type: 'string',
              description: 'Discord Incoming Webhook URL for scan notifications',
            },
          ],
        } as Template,
        {
          ...templateB,
          id: 'tmpl-unknown',
          name: 'unknown validation template',
          validation: {
            status: 'unknown',
            recommendation: 'unknown',
            artifactsCount: null,
            verifiedAt: null,
            rationale: 'No validation found.',
            isCurrent: false,
          },
        } as Template,
      ],
    });

    renderPage();

    expect(screen.getByText('Requires secrets')).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Requires secrets (1)' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Unknown validation (1)' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('option', { name: 'Requires secrets (1)' }));

    expect(screen.getByText('Network Recon Scan')).toBeInTheDocument();
    expect(screen.queryByText('Unknown Validation Template')).not.toBeInTheDocument();
  });

  it('does not render live-audit guidance for current live-verified templates', () => {
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

    expect(screen.queryByText('Revalidate')).not.toBeInTheDocument();
  });

  it('renders validation filter option counts', () => {
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
            rationale: 'Live execution completed.',
            isCurrent: true,
          },
        },
        {
          ...templateB,
          id: 'tmpl-stale',
          name: 'stale live template',
          validation: {
            status: 'live-verified',
            recommendation: 'keep',
            terminalStatus: 'COMPLETED',
            artifactsCount: 1,
            verifiedAt: '2026-06-21T06:00:00.000Z',
            rationale: 'Live execution completed before the latest update.',
            isCurrent: false,
          },
        },
        {
          ...templateB,
          id: 'tmpl-fix',
          name: 'needs fix template',
          validation: {
            status: 'needs-fix',
            recommendation: 'fix',
            terminalStatus: 'FAILED',
            artifactsCount: 0,
            verifiedAt: '2026-06-21T07:15:23.121Z',
            rationale: 'Live execution failed.',
            isCurrent: true,
          },
        },
        {
          ...templateB,
          id: 'tmpl-review',
          name: 'review candidate template',
          validation: {
            status: 'needs-review',
            recommendation: 'review',
            terminalStatus: 'COMPLETED',
            artifactsCount: 0,
            verifiedAt: '2026-06-21T07:15:23.121Z',
            rationale: 'Needs human review.',
            isCurrent: true,
          },
        },
        {
          ...templateB,
          id: 'tmpl-unknown',
          name: 'unknown validation template',
          validation: {
            status: 'unknown',
            recommendation: 'unknown',
            artifactsCount: null,
            verifiedAt: null,
            rationale: 'No validation found.',
            isCurrent: false,
          },
        },
      ],
    });

    renderPage();

    expect(screen.getByRole('option', { name: 'All validation (5)' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Live verified (1)' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Validation stale (1)' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Needs fix (1)' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Needs review (1)' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Unknown validation (1)' })).toBeInTheDocument();
  });

  it('filters templates to current live-verified validations', () => {
    setupStore({
      templates: [
        {
          ...templateA,
          name: 'current live template',
          validation: {
            status: 'live-verified',
            recommendation: 'keep',
            terminalStatus: 'COMPLETED',
            artifactsCount: 1,
            verifiedAt: '2026-06-21T07:15:23.121Z',
            rationale: 'Live execution completed.',
            isCurrent: true,
          },
        },
        {
          ...templateB,
          name: 'stale live template',
          validation: {
            status: 'live-verified',
            recommendation: 'keep',
            terminalStatus: 'COMPLETED',
            artifactsCount: 1,
            verifiedAt: '2026-06-21T06:00:00.000Z',
            rationale: 'Live execution completed before the latest update.',
            isCurrent: false,
          },
        },
        {
          ...templateB,
          id: 'tmpl-003',
          name: 'unknown validation template',
          validation: {
            status: 'unknown',
            recommendation: 'unknown',
            artifactsCount: null,
            verifiedAt: null,
            rationale: 'No validation found.',
            isCurrent: false,
          },
        },
      ],
    });
    renderPage();

    fireEvent.click(screen.getByRole('option', { name: 'Live verified (1)' }));

    expect(screen.getByText('Current Live Template')).toBeInTheDocument();
    expect(screen.queryByText('Stale Live Template')).not.toBeInTheDocument();
    expect(screen.queryByText('Unknown Validation Template')).not.toBeInTheDocument();
  });

  it('filters templates to needs-review validations', () => {
    setupStore({
      templates: [
        templateA,
        {
          ...templateB,
          name: 'review candidate template',
          validation: {
            status: 'needs-review',
            recommendation: 'review',
            terminalStatus: 'COMPLETED',
            artifactsCount: 0,
            verifiedAt: '2026-06-21T07:15:23.121Z',
            rationale: 'Needs human review.',
            isCurrent: true,
          },
        },
      ],
    });
    renderPage();

    fireEvent.click(screen.getByRole('option', { name: 'Needs review (1)' }));

    expect(screen.getByText('Review Candidate Template')).toBeInTheDocument();
    expect(screen.queryByText('Network Recon Scan')).not.toBeInTheDocument();
  });

  it('filters stale validations without including unknown validations', () => {
    setupStore({
      templates: [
        {
          ...templateA,
          name: 'stale live template',
          validation: {
            status: 'live-verified',
            recommendation: 'keep',
            terminalStatus: 'COMPLETED',
            artifactsCount: 1,
            verifiedAt: '2026-06-21T06:00:00.000Z',
            rationale: 'Live execution completed before the latest update.',
            isCurrent: false,
          },
        },
        {
          ...templateB,
          name: 'unknown validation template',
          validation: {
            status: 'unknown',
            recommendation: 'unknown',
            artifactsCount: null,
            verifiedAt: null,
            rationale: 'No validation found.',
            isCurrent: false,
          },
        },
      ],
    });
    renderPage();

    fireEvent.click(screen.getByRole('option', { name: 'Validation stale (1)' }));

    expect(screen.getByText('Stale Live Template')).toBeInTheDocument();
    expect(screen.queryByText('Unknown Validation Template')).not.toBeInTheDocument();
  });

  it('clears the validation filter', () => {
    setupStore({
      templates: [
        {
          ...templateA,
          name: 'current live template',
          validation: {
            status: 'live-verified',
            recommendation: 'keep',
            terminalStatus: 'COMPLETED',
            artifactsCount: 1,
            verifiedAt: '2026-06-21T07:15:23.121Z',
            rationale: 'Live execution completed.',
            isCurrent: true,
          },
        },
        {
          ...templateB,
          name: 'unknown validation template',
          validation: {
            status: 'unknown',
            recommendation: 'unknown',
            artifactsCount: null,
            verifiedAt: null,
            rationale: 'No validation found.',
            isCurrent: false,
          },
        },
      ],
    });
    renderPage();

    fireEvent.click(screen.getByRole('option', { name: 'Live verified (1)' }));
    expect(screen.queryByText('Unknown Validation Template')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));

    expect(screen.getByText('Current Live Template')).toBeInTheDocument();
    expect(screen.getByText('Unknown Validation Template')).toBeInTheDocument();
  });
});
