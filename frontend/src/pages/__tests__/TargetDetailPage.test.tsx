import { describe, it, beforeEach, afterEach, expect, mock, afterAll } from 'bun:test';
import { restoreMockedModules, realModuleExports } from '@/test/restore-mocks';
import { fireEvent, screen, cleanup } from '@testing-library/react';
import { renderWithProviders } from '@/test/render-with-providers';
import type { Scope } from '@/types/scopes';
import type { ScopeRunSummary } from '@/hooks/queries/useScopeQueries';
import type {
  FindingItem,
  FindingProjectionHealth,
  FindingSchemaCoverage,
} from '@/services/api/findings';
import { useAuthStore } from '@/store/authStore';

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
  scopeError: Error | null;
  runs: ScopeRunSummary[];
  isLoadingRuns: boolean;
  runsError: Error | null;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  findings: FindingItem[];
  isLoadingFindings: boolean;
  hasNextFindingsPage: boolean;
  findingsAvailability: 'available' | 'degraded' | undefined;
  findingsDegradedReasons: string[];
  findingsProjectionHealth: FindingProjectionHealth | undefined;
  findingsSchemaCoverage: FindingSchemaCoverage | undefined;
} = {
  scope: undefined,
  isLoadingScope: false,
  scopeError: null,
  runs: [],
  isLoadingRuns: false,
  runsError: null,
  hasNextPage: false,
  isFetchingNextPage: false,
  findings: [],
  isLoadingFindings: false,
  hasNextFindingsPage: false,
  findingsAvailability: undefined,
  findingsDegradedReasons: [],
  findingsProjectionHealth: undefined,
  findingsSchemaCoverage: undefined,
};
const fetchNextPage = mock(() => Promise.resolve());
const fetchNextFindingsPage = mock(() => Promise.resolve());
const useAssetRunComparison = mock(
  (_scopeId: string, baselineRunId: string | null, currentRunId: string | null) => ({
    data:
      baselineRunId && currentRunId
        ? {
            scopeId: 'scope-001',
            workflowId: 'wf-001',
            baselineRunId,
            currentRunId,
            baselineCoverage: {
              completedComponents: ['sentris.subfinder.run', 'sentris.httpx.scan'],
              failedComponents: [],
            },
            currentCoverage: {
              completedComponents: ['sentris.subfinder.run'],
              failedComponents: ['sentris.httpx.scan'],
            },
            summary: { observed: 1, notObserved: 1, notScanned: 1 },
            items: [
              {
                assetType: 'subdomain',
                assetValue: 'gone.example.com',
                sourceComponentIds: ['sentris.subfinder.run'],
                baselineObserved: true,
                currentObserved: false,
                observationStatus: 'not-observed',
                change: 'missing',
              },
              {
                assetType: 'http-probe',
                assetValue: 'https://unscanned.example.com',
                sourceComponentIds: ['sentris.httpx.scan'],
                baselineObserved: true,
                currentObserved: false,
                observationStatus: 'not-scanned',
                change: 'missing',
              },
            ],
          }
        : undefined,
    isLoading: false,
    error: null,
  }),
);

mock.module('@/hooks/queries/useScopeQueries', () => ({
  useScope: () => ({
    data: mockState.scope,
    isLoading: mockState.isLoadingScope,
    error: mockState.scopeError,
  }),
  useScopeRuns: () => ({
    data: mockState.runs,
    isLoading: mockState.isLoadingRuns,
    error: mockState.runsError,
    hasNextPage: mockState.hasNextPage,
    isFetchingNextPage: mockState.isFetchingNextPage,
    fetchNextPage,
  }),
  useTargetAssets: () => ({ data: [], isLoading: false, error: null }),
  useAssetRunComparison,
  useTargetFindings: () => ({
    data: mockState.findings,
    isLoading: mockState.isLoadingFindings,
    error: null,
    availability: mockState.findingsAvailability,
    degradedReasons: mockState.findingsDegradedReasons,
    projectionHealth: mockState.findingsProjectionHealth,
    schemaCoverage: mockState.findingsSchemaCoverage,
    hasNextPage: mockState.hasNextFindingsPage,
    isFetchingNextPage: false,
    fetchNextPage: fetchNextFindingsPage,
  }),
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

const makeRun = (o: Partial<ScopeRunSummary> = {}): ScopeRunSummary => ({
  id: 'run-001',
  workflowId: 'wf-001',
  workflowName: 'Scan Pipeline',
  status: 'COMPLETED',
  startTime: ISO,
  duration: 120_000,
  triggerLabel: 'Manual run',
  ...o,
});

const setup = (o: Partial<typeof mockState> = {}) => {
  mockState.scope = Object.prototype.hasOwnProperty.call(o, 'scope') ? o.scope : scope;
  mockState.isLoadingScope = o.isLoadingScope ?? false;
  mockState.scopeError = o.scopeError ?? null;
  mockState.runs = o.runs ?? [];
  mockState.isLoadingRuns = o.isLoadingRuns ?? false;
  mockState.runsError = o.runsError ?? null;
  mockState.hasNextPage = o.hasNextPage ?? false;
  mockState.isFetchingNextPage = o.isFetchingNextPage ?? false;
  mockState.findings = o.findings ?? [];
  mockState.isLoadingFindings = o.isLoadingFindings ?? false;
  mockState.hasNextFindingsPage = o.hasNextFindingsPage ?? false;
  mockState.findingsAvailability = o.findingsAvailability;
  mockState.findingsDegradedReasons = o.findingsDegradedReasons ?? [];
  mockState.findingsProjectionHealth = o.findingsProjectionHealth;
  mockState.findingsSchemaCoverage = o.findingsSchemaCoverage;
  fetchNextPage.mockClear();
  fetchNextFindingsPage.mockClear();
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
    useAuthStore.getState().setRoles(['ADMIN']);
    setup();
  });
  afterEach(cleanup);

  it('renders the scope name and Overview tab with its domains', () => {
    renderPage();
    expect(screen.getByText('Contoso Ltd')).toBeInTheDocument();
    expect(screen.getByText('contoso.com')).toBeInTheDocument();
    expect(screen.getByText('app.contoso.com')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /run target/i })).toHaveAttribute(
      'href',
      '/workflows?scopeId=scope-001&launch=1',
    );
  });

  it('shows a run row with its status text on the Run History tab', () => {
    setup({ runs: [makeRun()] });
    renderPage();
    fireEvent.click(screen.getByRole('tab', { name: /run history/i }));
    expect(screen.getByText('Scan Pipeline')).toBeInTheDocument();
    expect(screen.getByText('Completed')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /open run run-001/i })).toHaveAttribute(
      'href',
      '/runs/run-001',
    );
    expect(screen.getByRole('link', { name: /rescan with scan pipeline/i })).toHaveAttribute(
      'href',
      '/workflows/wf-001?scopeId=scope-001&launch=1',
    );
  });

  it('does not present workflow launch dead ends to members', () => {
    useAuthStore.getState().setRoles(['MEMBER']);
    setup({ runs: [makeRun()] });
    renderPage();

    expect(screen.queryByRole('link', { name: /run target/i })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: /run history/i }));
    expect(
      screen.queryByRole('link', { name: /rescan with scan pipeline/i }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /open run run-001/i })).toBeInTheDocument();
  });

  it('shows "No runs yet" empty state when there are no runs', () => {
    setup({ runs: [] });
    renderPage();
    fireEvent.click(screen.getByRole('tab', { name: /run history/i }));
    expect(screen.getByText('No runs yet')).toBeInTheDocument();
  });

  it('shows target query failure as unavailable instead of not found', () => {
    setup({ scope: undefined, scopeError: new Error('scope service offline') });
    renderPage();

    expect(screen.getByRole('alert')).toHaveTextContent(
      /Target is unavailable: scope service offline/i,
    );
    expect(screen.queryByText('Target not found.')).not.toBeInTheDocument();
  });

  it('shows run-history query failure as unavailable instead of an empty history', () => {
    setup({ runs: [], runsError: new Error('run service offline') });
    renderPage();
    fireEvent.click(screen.getByRole('tab', { name: /run history/i }));

    expect(screen.getByRole('alert')).toHaveTextContent(
      /Run history is unavailable: run service offline/i,
    );
    expect(screen.queryByText('No runs yet')).not.toBeInTheDocument();
  });

  it('loads the next page of run history on demand', () => {
    setup({ runs: [makeRun()], hasNextPage: true });
    renderPage();
    fireEvent.click(screen.getByRole('tab', { name: /run history/i }));

    fireEvent.click(screen.getByRole('button', { name: /load more runs/i }));
    expect(fetchNextPage).toHaveBeenCalledTimes(1);
  });

  it('compares the latest two runs without confusing unscanned assets with missing observations', () => {
    setup({
      runs: [
        makeRun({ id: 'current-run' }),
        makeRun({ id: 'baseline-run', startTime: '2024-06-14T12:00:00.000Z' }),
      ],
    });
    renderPage();
    fireEvent.click(screen.getByRole('tab', { name: /run history/i }));

    fireEvent.click(screen.getByRole('button', { name: /compare latest two runs/i }));

    expect(useAssetRunComparison).toHaveBeenLastCalledWith(
      'scope-001',
      'baseline-run',
      'current-run',
    );
    expect(screen.getByText('gone.example.com')).toBeInTheDocument();
    expect(screen.getByText('https://unscanned.example.com')).toBeInTheDocument();
    expect(screen.getAllByText('Not observed').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Not scanned').length).toBeGreaterThanOrEqual(1);
  });

  it('shows scope-filtered findings with a stable deep link', () => {
    setup({
      findings: [
        {
          id: 'finding-001',
          timestamp: ISO,
          severity: 'high',
          name: 'Exposed admin interface',
          asset_key: 'admin.contoso.com',
        },
      ],
    });
    renderPage();
    fireEvent.click(screen.getByRole('tab', { name: /findings/i }));

    expect(screen.getByText('Exposed admin interface')).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: /open finding exposed admin interface/i }),
    ).toHaveAttribute('href', '/findings?scopeId=scope-001&findingId=finding-001');
  });

  it('shows the degraded reason alongside the zero-findings state', () => {
    setup({
      findings: [],
      findingsAvailability: 'degraded',
      findingsDegradedReasons: ['projection_events_pending'],
      findingsProjectionHealth: {
        availability: 'degraded',
        completedAt: '2026-07-26T12:01:00.000Z',
        reconciledThrough: '2026-07-26T12:00:00.000Z',
        reason: 'projection_events_pending',
      },
      findingsSchemaCoverage: { canonical: 0, legacy: 2, invalid: 1 },
    });
    renderPage();
    fireEvent.click(screen.getByRole('tab', { name: /findings/i }));

    expect(screen.getByText('No findings yet')).toBeInTheDocument();
    const dataQuality = screen.getByRole('status', { name: /Target findings data quality/i });
    expect(dataQuality).toHaveTextContent(/projection events pending/i);
    expect(dataQuality).toHaveTextContent(/0 canonical, 2 legacy, 1 invalid/i);
    expect(dataQuality).toHaveTextContent(/2026-07-26T12:00:00.000Z/);
    expect(dataQuality).toHaveTextContent(/2026-07-26T12:01:00.000Z/);
  });
});
