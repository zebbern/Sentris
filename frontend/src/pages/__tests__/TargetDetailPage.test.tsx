import { describe, it, beforeEach, afterEach, expect, mock, afterAll } from 'bun:test';
import { restoreMockedModules, realModuleExports } from '@/test/restore-mocks';
import { fireEvent, screen, cleanup } from '@testing-library/react';
import { renderWithProviders } from '@/test/render-with-providers';
import type { Scope } from '@/types/scopes';
import type { ExecutionRun } from '@/hooks/queries/useRunQueries';

// --- Mock isolation ---
mock.module('@/hooks/useDocumentTitle', () => ({ useDocumentTitle: () => {} }));

// --- Mock useParams (route param), keep the rest of react-router-dom real ---
mock.module('react-router-dom', () => ({
  ...realModuleExports('react-router-dom'),
  useParams: () => ({ id: 'scope-001' }),
}));

// --- Mock Tabs (Radix primitives use pointer events that jsdom doesn't emulate well) ---
let tabChangeCallback: ((value: string) => void) | null = null;

mock.module('@/components/ui/tabs', () => ({
  Tabs: ({
    value,
    onValueChange,
    children,
    ...props
  }: {
    value: string;
    onValueChange: (v: string) => void;
    children: React.ReactNode;
  }) => {
    tabChangeCallback = onValueChange;
    return (
      <div data-testid="tabs" data-value={value} {...props}>
        {children}
      </div>
    );
  },
  TabsList: ({ children, ...props }: any) => <div {...props}>{children}</div>,
  TabsTrigger: ({
    value,
    children,
    disabled,
    ...props
  }: {
    value: string;
    children: React.ReactNode;
    disabled?: boolean;
  }) => (
    <button
      role="tab"
      data-value={value}
      disabled={disabled}
      onClick={() => !disabled && tabChangeCallback?.(value)}
      {...props}
    >
      {children}
    </button>
  ),
  TabsContent: ({ value, children, ...props }: { value: string; children: React.ReactNode }) => (
    <div data-tab-content={value} {...props}>
      {children}
    </div>
  ),
}));

// --- Mutable mock state for scope + runs queries ---
const mockState: {
  scope: Scope | undefined;
  isLoadingScope: boolean;
  runs: ExecutionRun[];
  isLoadingRuns: boolean;
} = {
  scope: undefined,
  isLoadingScope: false,
  runs: [],
  isLoadingRuns: false,
};

mock.module('@/hooks/queries/useScopeQueries', () => ({
  useScope: () => ({ data: mockState.scope, isLoading: mockState.isLoadingScope, error: null }),
  useScopeRuns: () => ({ data: { runs: mockState.runs }, isLoading: mockState.isLoadingRuns }),
}));

// Import AFTER mocks
import { TargetDetailPage } from '@/pages/TargetDetailPage';

// --- Fixtures ---
const ISO = '2024-06-15T12:00:00.000Z';

const scope: Scope = {
  id: 'scope-001',
  organizationId: 'org-001',
  name: 'Contoso Ltd',
  description: 'Primary target',
  domains: ['contoso.com', 'app.contoso.com'],
  repos: ['contoso/infra'],
  ipRanges: [],
  runtimeValues: {},
  createdBy: null,
  createdAt: ISO,
  updatedAt: ISO,
};

const makeRun = (o: Partial<ExecutionRun> = {}): ExecutionRun => ({
  id: 'run-001',
  workflowId: 'wf-001',
  workflowName: 'Scan Pipeline',
  status: 'COMPLETED',
  startTime: ISO,
  endTime: '2024-06-15T12:05:00.000Z',
  duration: 120_000,
  nodeCount: 4,
  eventCount: 12,
  createdAt: ISO,
  isLive: false,
  workflowVersionId: 'v1',
  workflowVersion: 1,
  triggerType: 'manual',
  triggerSource: null,
  triggerLabel: 'Manual run',
  inputPreview: { runtimeInputs: {}, nodeOverrides: {} },
  ...o,
});

const setup = (o: Partial<typeof mockState> = {}) => {
  mockState.scope = o.scope ?? scope;
  mockState.isLoadingScope = o.isLoadingScope ?? false;
  mockState.runs = o.runs ?? [];
  mockState.isLoadingRuns = o.isLoadingRuns ?? false;
};

const renderPage = () =>
  renderWithProviders(<TargetDetailPage />, { initialEntries: ['/targets/scope-001'] });

// --- Teardown ---
afterAll(() =>
  restoreMockedModules([
    '@/hooks/useDocumentTitle',
    'react-router-dom',
    '@/components/ui/tabs',
    '@/hooks/queries/useScopeQueries',
  ]),
);

// --- Tests ---
describe('TargetDetailPage', () => {
  beforeEach(() => {
    cleanup();
    setup();
  });
  afterEach(cleanup);

  it('renders the scope name and Overview tab with its domains', () => {
    renderPage();
    expect(screen.getByText('Contoso Ltd')).toBeInTheDocument();
    expect(screen.getByText('contoso.com')).toBeInTheDocument();
    expect(screen.getByText('app.contoso.com')).toBeInTheDocument();
  });

  it('shows a run row with its status text on the Run History tab', () => {
    setup({ runs: [makeRun()] });
    renderPage();
    fireEvent.click(screen.getByRole('tab', { name: /run history/i }));
    expect(screen.getByText('Scan Pipeline')).toBeInTheDocument();
    expect(screen.getByText('Completed')).toBeInTheDocument();
  });

  it('shows "No runs yet" empty state when there are no runs', () => {
    setup({ runs: [] });
    renderPage();
    fireEvent.click(screen.getByRole('tab', { name: /run history/i }));
    expect(screen.getByText('No runs yet')).toBeInTheDocument();
  });
});
