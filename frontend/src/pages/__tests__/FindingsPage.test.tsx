import { describe, it, beforeEach, afterEach, afterAll, expect, mock } from 'bun:test';
import { screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { createSelectMock } from '@/test/mocks/radix-select';
import { createAuthStoreMock } from '@/test/mocks/auth-store';
import { realModuleExports, restoreMockedModules } from '@/test/restore-mocks';
import { renderWithProviders } from '@/test/render-with-providers';
import type { FindingsResponse, FindingItem } from '@/services/api/findings';
import type { FindingsQueryParams } from '@/services/api';

// --- Mock select components (passthrough for test rendering) ---
realModuleExports('@/components/ui/select');
mock.module('@/components/ui/select', createSelectMock);

// --- Mutable mock state for findings queries ---
const mockQueryState: {
  data: FindingsResponse | undefined;
  isLoading: boolean;
  error: Error | null;
} = {
  data: undefined,
  isLoading: false,
  error: null,
};
const mockFindingsQueryParams: FindingsQueryParams[] = [];

realModuleExports('@/hooks/queries/useFindingsQueries');
mock.module('@/hooks/queries/useFindingsQueries', () => ({
  useFindingsQuery: (params: FindingsQueryParams) => {
    mockFindingsQueryParams.push(params);
    return {
      data: mockQueryState.data,
      isLoading: mockQueryState.isLoading,
      error: mockQueryState.error,
      refetch: mock(),
    };
  },
  useBulkTriageMutation: () => ({ mutate: mock(), isPending: false }),
  useOrgMembersQuery: () => ({ data: { members: [] } }),
}));

// --- Auth store ---
realModuleExports('@/store/authStore');
mock.module('@/store/authStore', () => createAuthStoreMock());

realModuleExports('@/features/findings/FindingDetailSheet');
mock.module('@/features/findings/FindingDetailSheet', () => ({
  FindingDetailSheet: ({ findingId, isOpen }: { findingId: string | null; isOpen: boolean }) =>
    isOpen ? <div role="dialog">detail:{findingId}</div> : null,
}));

// Import component AFTER all mock.module() calls
import { FindingsPage } from '@/pages/FindingsPage';

// --- Fixtures ---
const makeFinding = (overrides: Partial<FindingItem> = {}): FindingItem => ({
  id: 'finding-001',
  timestamp: '2025-06-15T12:00:00.000Z',
  severity: 'high',
  name: 'SQL Injection Detected',
  asset_key: 'example.com',
  workflow_name: 'Web Vulnerability Scan',
  workflow_id: 'wf-1',
  run_id: 'run-abc123',
  component_id: 'comp-1',
  node_ref: 'node-1',
  ...overrides,
});

const POPULATED_RESPONSE: FindingsResponse = {
  items: [
    makeFinding(),
    makeFinding({
      id: 'finding-002',
      severity: 'critical',
      name: 'RCE via Log4Shell',
      asset_key: 'api.example.com',
      workflow_name: 'Infrastructure Scan',
      run_id: 'run-def456',
    }),
  ],
  total: 2,
  page: 1,
  pageSize: 25,
  availability: 'available',
  paginationMode: 'cursor',
  currentCursor: 'pit-1-start',
  nextCursor: null,
  schemaCoverage: { canonical: 2, legacy: 0, invalid: 0 },
};

const EMPTY_RESPONSE: FindingsResponse = {
  items: [],
  total: 0,
  page: 1,
  pageSize: 25,
  availability: 'available',
  paginationMode: 'cursor',
  currentCursor: 'pit-empty-start',
  nextCursor: null,
  schemaCoverage: { canonical: 0, legacy: 0, invalid: 0 },
};

// --- Helpers ---
interface MockQueryOverrides {
  data?: FindingsResponse;
  isLoading?: boolean;
  error?: Error | null;
}

const setupStore = (overrides: MockQueryOverrides = {}) => {
  mockQueryState.data = overrides.data ?? undefined;
  mockQueryState.isLoading = overrides.isLoading ?? false;
  mockQueryState.error = overrides.error ?? null;
  mockFindingsQueryParams.length = 0;
};

const renderPage = (initialPath = '/findings') =>
  renderWithProviders(<FindingsPage />, { initialEntries: [initialPath] });

// --- Tests ---
describe('FindingsPage', () => {
  beforeEach(() => {
    cleanup();
    setupStore();
  });

  afterEach(() => {
    cleanup();
  });

  afterAll(() =>
    restoreMockedModules([
      '@/components/ui/select',
      '@/hooks/queries/useFindingsQueries',
      '@/store/authStore',
      '@/features/findings/FindingDetailSheet',
    ]),
  );

  it('omits the redundant page heading and top-bar controls supplied by AppLayout', () => {
    setupStore();
    renderPage();

    expect(screen.queryByRole('heading', { level: 2, name: /^Findings$/ })).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/Search findings/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: /Table/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: /Kanban/i })).not.toBeInTheDocument();
  });

  it('passes ?search= URL param to the findings query after debounce', async () => {
    setupStore({ data: POPULATED_RESPONSE });
    renderPage('/findings?search=sql');

    await waitFor(() => {
      const latestParams = mockFindingsQueryParams[mockFindingsQueryParams.length - 1];
      expect(latestParams?.search).toBe('sql');
    });
  });

  it('renders loading skeletons when isLoading is true and no data', () => {
    setupStore({ isLoading: true });
    renderPage();

    const container = document.querySelector('[aria-busy="true"]');
    expect(container).toBeTruthy();
  });

  it('renders empty state when data has zero items', () => {
    setupStore({ data: EMPTY_RESPONSE });
    renderPage();

    expect(screen.getByText('No findings found')).toBeInTheDocument();
  });

  it('renders finding rows with name and severity badge', () => {
    setupStore({ data: POPULATED_RESPONSE });
    renderPage();

    expect(screen.getByText('SQL Injection Detected')).toBeInTheDocument();
    expect(screen.getByText('RCE via Log4Shell')).toBeInTheDocument();

    // Severity badges
    expect(screen.getAllByText('High').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Critical').length).toBeGreaterThanOrEqual(1);
  });

  it('renders asset and workflow columns', () => {
    setupStore({ data: POPULATED_RESPONSE });
    renderPage();

    expect(screen.getByText('example.com')).toBeInTheDocument();
    expect(screen.getByText('api.example.com')).toBeInTheDocument();
    expect(screen.getByText('Web Vulnerability Scan')).toBeInTheDocument();
    expect(screen.getByText('Infrastructure Scan')).toBeInTheDocument();
  });

  it('renders run ID column with truncated IDs', () => {
    setupStore({ data: POPULATED_RESPONSE });
    renderPage();

    // run_id is truncated to first 8 chars
    expect(screen.getByText('run-abc1')).toBeInTheDocument();
    expect(screen.getByText('run-def4')).toBeInTheDocument();
  });

  it('shows ErrorBanner when error is set', () => {
    setupStore({ error: new Error('Failed to load findings') });
    renderPage();

    expect(screen.getByText('Failed to load findings')).toBeInTheDocument();
  });

  it('shows pagination info when items are present', () => {
    setupStore({ data: POPULATED_RESPONSE });
    renderPage();

    expect(screen.getByText(/Showing 1–2 of 2/)).toBeInTheDocument();
    expect(screen.getByText(/Page 1 of 1/)).toBeInTheDocument();
  });

  it('uses the signed backend cursor for the next table page', () => {
    setupStore({
      data: {
        ...POPULATED_RESPONSE,
        total: 10_001,
        paginationMode: 'cursor',
        nextCursor: 'opaque-page-2',
      },
    });
    renderPage();

    let latestParams = mockFindingsQueryParams[mockFindingsQueryParams.length - 1];
    expect(latestParams?.paginationMode).toBe('cursor');
    expect(latestParams?.cursor).toBeUndefined();

    fireEvent.click(screen.getByRole('button', { name: /Next/i }));

    latestParams = mockFindingsQueryParams[mockFindingsQueryParams.length - 1];
    expect(latestParams?.page).toBe(2);
    expect(latestParams?.cursor).toBe('opaque-page-2');
  });

  it('returns to page 1 and moves forward on the same signed PIT history', () => {
    setupStore({
      data: {
        ...POPULATED_RESPONSE,
        total: 26,
        paginationMode: 'cursor',
        currentCursor: 'pit-1-start',
        nextCursor: 'pit-1-page-2',
      },
    });
    const view = renderPage();

    fireEvent.click(screen.getByRole('button', { name: /Next/i }));
    let latestParams = mockFindingsQueryParams[mockFindingsQueryParams.length - 1];
    expect(latestParams?.page).toBe(2);
    expect(latestParams?.cursor).toBe('pit-1-page-2');

    mockQueryState.data = {
      ...POPULATED_RESPONSE,
      total: 26,
      page: 2,
      currentCursor: 'pit-1-page-2',
      nextCursor: null,
    };
    view.rerender(<FindingsPage />);
    fireEvent.click(screen.getByRole('button', { name: /Previous/i }));
    latestParams = mockFindingsQueryParams[mockFindingsQueryParams.length - 1];
    expect(latestParams?.page).toBe(1);
    expect(latestParams?.cursor).toBe('pit-1-start');

    mockQueryState.data = {
      ...POPULATED_RESPONSE,
      total: 26,
      page: 1,
      currentCursor: 'pit-1-start',
      nextCursor: 'pit-1-page-2',
    };
    view.rerender(<FindingsPage />);
    fireEvent.click(screen.getByRole('button', { name: /Next/i }));
    latestParams = mockFindingsQueryParams[mockFindingsQueryParams.length - 1];
    expect(latestParams?.page).toBe(2);
    expect(latestParams?.cursor).toBe('pit-1-page-2');
  });

  it('tracks select-all against the current cursor page instead of selection count alone', () => {
    setupStore({
      data: {
        ...POPULATED_RESPONSE,
        total: 4,
        nextCursor: 'opaque-page-2',
      },
    });
    renderPage();

    const selectAll = screen.getByRole('checkbox', {
      name: 'Select all findings on this page',
    });
    fireEvent.click(selectAll);
    expect(selectAll).toBeChecked();

    mockQueryState.data = {
      ...POPULATED_RESPONSE,
      items: [
        makeFinding({ id: 'finding-003', name: 'Third finding' }),
        makeFinding({ id: 'finding-004', name: 'Fourth finding' }),
      ],
      total: 4,
      page: 2,
      nextCursor: null,
    };
    fireEvent.click(screen.getByRole('button', { name: /Next/i }));

    expect(
      screen.getByRole('checkbox', {
        name: 'Select all findings on this page',
      }),
    ).not.toBeChecked();
  });

  it('shows empty state message for filtered results', () => {
    // The empty state checks if hasFilters — but since we can't set filter state
    // externally in this test, just verify the default empty state message
    setupStore({ data: EMPTY_RESPONSE });
    renderPage();

    expect(
      screen.getByText(/Security findings will appear here once your workflows produce results/),
    ).toBeInTheDocument();
  });

  it('renders table headers', () => {
    setupStore({ data: POPULATED_RESPONSE });
    renderPage();

    expect(screen.getByText('Timestamp')).toBeInTheDocument();
    // "Severity" appears both in the filter dropdown and table header
    expect(screen.getAllByText('Severity').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Name')).toBeInTheDocument();
    expect(screen.getByText('Asset')).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Workflow' })).toBeInTheDocument();
    expect(screen.getByText('Run ID')).toBeInTheDocument();
  });

  it('uses signed cursor pagination and discloses Kanban page completeness', () => {
    setupStore({
      data: {
        ...POPULATED_RESPONSE,
        total: 250,
        pageSize: 100,
        nextCursor: 'opaque-kanban-page-2',
      },
    });
    renderPage('/findings?view=kanban');

    let latestParams = mockFindingsQueryParams[mockFindingsQueryParams.length - 1];
    expect(screen.getByRole('region', { name: /Kanban board/i })).toBeInTheDocument();
    expect(latestParams?.page).toBe(1);
    expect(latestParams?.pageSize).toBe(100);
    expect(latestParams?.paginationMode).toBe('cursor');
    expect(screen.getByText(/Showing 1–2 of 250/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Next/i }));

    latestParams = mockFindingsQueryParams[mockFindingsQueryParams.length - 1];
    expect(latestParams?.page).toBe(2);
    expect(latestParams?.cursor).toBe('opaque-kanban-page-2');
  });

  it('surfaces degraded projection and schema coverage instead of presenting full trust', () => {
    setupStore({
      data: {
        ...POPULATED_RESPONSE,
        availability: 'degraded',
        projectionHealth: {
          availability: 'degraded',
          completedAt: null,
          reconciledThrough: '2026-07-26T12:00:00.000Z',
          reason: 'projection_events_pending',
        },
        schemaCoverage: { canonical: 1, legacy: 0, invalid: 1 },
      },
    });

    renderPage();

    const status = screen.getByRole('status', { name: /Findings data quality/i });
    expect(status).toHaveTextContent(/degraded/i);
    expect(status).toHaveTextContent(/projection events pending/i);
    expect(status).toHaveTextContent(/1 canonical, 0 legacy, 1 invalid/i);
  });

  it('applies a URL target scope and opens a URL-addressed finding', async () => {
    setupStore({ data: POPULATED_RESPONSE });
    renderPage('/findings?scopeId=scope-001&findingId=finding-001');

    const latestParams = mockFindingsQueryParams[mockFindingsQueryParams.length - 1];
    expect(latestParams?.scopeId).toBe('scope-001');
    expect(await screen.findByRole('dialog')).toHaveTextContent('detail:finding-001');
  });
});
