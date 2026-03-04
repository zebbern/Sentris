import { describe, it, beforeEach, afterEach, expect, mock } from 'bun:test';
import { screen, cleanup } from '@testing-library/react';
import { renderWithProviders } from '@/test/render-with-providers';

// --- Mock recharts ---
mock.module('recharts', () => ({
  PieChart: ({ children }: any) => <div data-testid="pie-chart">{children}</div>,
  Pie: ({ children }: any) => <div data-testid="pie">{children}</div>,
  Cell: ({ fill }: any) => <div data-testid="cell" data-fill={fill} />,
  ResponsiveContainer: ({ children }: any) => <div>{children}</div>,
  Legend: () => <div data-testid="legend" />,
  Tooltip: () => <div />,
}));

// --- Mutable mock state ---
const mockQueryState: {
  data: any;
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
  refetch: ReturnType<typeof mock>;
} = {
  data: undefined,
  isLoading: false,
  isError: false,
  error: null,
  refetch: mock(),
};

mock.module('@/hooks/queries/useTriageAnalyticsQueries', () => ({
  useStatusDistribution: () => ({
    data: mockQueryState.data,
    isLoading: mockQueryState.isLoading,
    isError: mockQueryState.isError,
    error: mockQueryState.error,
    refetch: mockQueryState.refetch,
  }),
}));

// Import after mocks
import { StatusDistributionChart } from '@/features/triage-analytics/StatusDistributionChart';

// --- Helpers ---
const setupState = (overrides: Partial<typeof mockQueryState> = {}) => {
  mockQueryState.data = overrides.data ?? undefined;
  mockQueryState.isLoading = overrides.isLoading ?? false;
  mockQueryState.isError = overrides.isError ?? false;
  mockQueryState.error = overrides.error ?? null;
  mockQueryState.refetch = overrides.refetch ?? mock();
};

const renderChart = () => renderWithProviders(<StatusDistributionChart />);

// --- Tests ---
describe('StatusDistributionChart', () => {
  beforeEach(() => {
    cleanup();
    setupState();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders heading text', () => {
    setupState({
      data: {
        statuses: [
          { status: 'new', count: 5 },
          { status: 'triaged', count: 3 },
        ],
        total: 8,
      },
    });
    renderChart();

    expect(screen.getByText('Status Distribution')).toBeInTheDocument();
  });

  it('renders pie chart with status segments having positive counts', () => {
    setupState({
      data: {
        statuses: [
          { status: 'new', count: 10 },
          { status: 'triaged', count: 5 },
          { status: 'in_progress', count: 0 },
          { status: 'fixed', count: 3 },
          { status: 'verified', count: 0 },
          { status: 'wont_fix', count: 0 },
          { status: 'accepted_risk', count: 0 },
        ],
        total: 18,
      },
    });
    renderChart();

    expect(screen.getByTestId('pie-chart')).toBeInTheDocument();
    // Only statuses with count > 0 are rendered as cells
    const cells = screen.getAllByTestId('cell');
    expect(cells.length).toBe(3); // new, triaged, fixed
  });

  it('shows empty state when total is 0', () => {
    setupState({
      data: {
        statuses: [
          { status: 'new', count: 0 },
          { status: 'triaged', count: 0 },
          { status: 'in_progress', count: 0 },
          { status: 'fixed', count: 0 },
          { status: 'verified', count: 0 },
          { status: 'wont_fix', count: 0 },
          { status: 'accepted_risk', count: 0 },
        ],
        total: 0,
      },
    });
    renderChart();

    expect(screen.getByText('No findings to display')).toBeInTheDocument();
  });

  it('shows loading skeleton when isLoading is true', () => {
    setupState({ isLoading: true });
    renderChart();

    expect(screen.getByText('Status Distribution')).toBeInTheDocument();
    expect(screen.queryByTestId('pie-chart')).not.toBeInTheDocument();
  });

  it('shows error banner when isError is true', () => {
    setupState({ isError: true, error: new Error('Connection error') });
    renderChart();

    expect(screen.getByText('Connection error')).toBeInTheDocument();
  });

  it('displays total count', () => {
    setupState({
      data: {
        statuses: [
          { status: 'new', count: 10 },
          { status: 'triaged', count: 5 },
          { status: 'in_progress', count: 0 },
          { status: 'fixed', count: 0 },
          { status: 'verified', count: 0 },
          { status: 'wont_fix', count: 0 },
          { status: 'accepted_risk', count: 0 },
        ],
        total: 15,
      },
    });
    renderChart();

    expect(screen.getByText('15 total')).toBeInTheDocument();
  });

  it('renders aria-label with total count', () => {
    setupState({
      data: {
        statuses: [{ status: 'new', count: 5 }],
        total: 5,
      },
    });
    renderChart();

    const container = screen.getByLabelText('Status distribution chart — 5 total findings');
    expect(container).toBeInTheDocument();
  });
});
