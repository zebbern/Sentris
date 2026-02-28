import { describe, it, beforeEach, afterEach, expect, mock } from 'bun:test';
import { fireEvent, render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { Template, TemplateCategory } from '@/types/templates';

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

// ---------------------------------------------------------------------------
// Module mocks (BEFORE component import)
// ---------------------------------------------------------------------------

// --- DnD-kit: passthrough mocks ---
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
  rectSortingStrategy: {},
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

// --- Sortable card components: passthrough ---
mock.module('@/components/ui/sortable-card', () => ({
  SortableCard: ({ children, id }: any) => {
    const handleProps = { listeners: {}, attributes: {} };
    return (
      <div data-testid={`sortable-card-${id}`}>
        {typeof children === 'function' ? children({ handleProps }) : children}
      </div>
    );
  },
  CardDragHandle: () => <div />,
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

// --- Dialog mock ---
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

// --- Tooltip mock ---
mock.module('@/components/ui/tooltip', () => ({
  Tooltip: ({ children }: any) => <>{children}</>,
  TooltipContent: ({ children }: any) => <span>{children}</span>,
  TooltipProvider: ({ children }: any) => <>{children}</>,
  TooltipTrigger: ({ children }: any) => <>{children}</>,
}));

// --- Select mock ---
mock.module('@/components/ui/select', () => ({
  Select: ({ children }: any) => <div data-testid="select-wrapper">{children}</div>,
  SelectContent: ({ children }: any) => <div>{children}</div>,
  SelectItem: ({ children, value }: any) => <option value={value}>{children}</option>,
  SelectTrigger: ({ children, ...props }: any) => <div {...props}>{children}</div>,
  SelectValue: ({ placeholder }: any) => <span>{placeholder}</span>,
}));

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
mock.module('@/store/authStore', () => ({
  useAuthStore: (selector?: (state: any) => any) => {
    const state = {
      token: 'test-token',
      userId: 'user-1',
      organizationId: 'org-001',
      roles: mockRoles,
      provider: 'local' as const,
    };
    return selector ? selector(state) : state;
  },
}));

// --- Auth utility ---
mock.module('@/utils/auth', () => ({
  hasAdminRole: (roles: string[]) => roles.includes('ADMIN'),
}));

// --- Toast ---
const mockToast = mock((_opts: any) => {});
mock.module('@/components/ui/use-toast', () => ({
  useToast: () => ({ toast: mockToast }),
}));

// --- Analytics events ---
mock.module('@/features/analytics/events', () => ({
  track: mock(() => {}),
  Events: { TemplateUseClicked: 'template_use_clicked' },
}));

// --- UseTemplateModal / WorkflowPreview (stub) ---
mock.module('@/features/templates/UseTemplateModal', () => ({
  UseTemplateModal: () => null,
}));

mock.module('@/features/templates/WorkflowPreview', () => ({
  WorkflowPreview: () => <div data-testid="workflow-preview">preview</div>,
}));

// --- humanizeApiError ---
mock.module('@/lib/humanizeApiError', () => ({
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
  author: 'shipsec',
  repository: 'shipsec/templates',
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
  repository: 'shipsec/templates',
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
    expect(screen.getByPlaceholderText('Search templates...')).toBeInTheDocument();
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

    const searchInput = screen.getByPlaceholderText('Search templates...');
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

    // templateA author "shipsec" -> "S", templateB author "contrib-user" -> "C"
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
});
