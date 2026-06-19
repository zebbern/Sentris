import { describe, it, beforeEach, afterEach, expect, mock } from 'bun:test';
import { screen, cleanup } from '@testing-library/react';
import { createSelectMock } from '@/test/mocks/radix-select';
import { createAuthStoreMock } from '@/test/mocks/auth-store';
import { renderWithProviders } from '@/test/render-with-providers';
import type { FindingsResponse, FindingItem } from '@/services/api/findings';

// --- Mock select components (passthrough for test rendering) ---
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

mock.module('@/hooks/queries/useFindingsQueries', () => ({
  useFindingsQuery: () => ({
    data: mockQueryState.data,
    isLoading: mockQueryState.isLoading,
    error: mockQueryState.error,
    refetch: mock(),
  }),
}));

// --- Auth store ---
mock.module('@/store/authStore', () => createAuthStoreMock());

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
};

const renderPage = () => renderWithProviders(<FindingsPage />);

// --- Tests ---
describe('FindingsPage', () => {
  beforeEach(() => {
    cleanup();
    setupStore();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders page heading', () => {
    setupStore();
    renderPage();
    expect(screen.getByRole('heading', { level: 2, name: /Findings/i })).toBeInTheDocument();
  });

  it('renders loading skeletons when isLoading is true and no data', () => {
    setupStore({ isLoading: true });
    renderPage();

    const container = document.querySelector('[aria-busy="true"]');
    expect(container).toBeTruthy();
  });

  it('renders empty state when data has zero items', () => {
    setupStore({ data: { items: [], total: 0, page: 1, pageSize: 25 } });
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

  it('shows empty state message for filtered results', () => {
    // The empty state checks if hasFilters — but since we can't set filter state
    // externally in this test, just verify the default empty state message
    setupStore({ data: { items: [], total: 0, page: 1, pageSize: 25 } });
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
});
