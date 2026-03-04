import { describe, it, beforeEach, afterEach, expect, mock } from 'bun:test';
import { screen, cleanup } from '@testing-library/react';
import { renderWithProviders } from '@/test/render-with-providers';

// --- Mock recharts to avoid SVG rendering issues in test environment ---
mock.module('recharts', () => ({
  AreaChart: ({ children }: any) => <div data-testid="area-chart">{children}</div>,
  Area: ({ dataKey }: any) => <div data-testid={`area-${dataKey}`} />,
  XAxis: () => <div />,
  YAxis: () => <div />,
  Tooltip: () => <div />,
  ResponsiveContainer: ({ children }: any) => <div>{children}</div>,
  CartesianGrid: () => <div />,
  Legend: () => <div />,
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
  usePostureTrend: () => ({
    data: mockQueryState.data,
    isLoading: mockQueryState.isLoading,
    isError: mockQueryState.isError,
    error: mockQueryState.error,
    refetch: mockQueryState.refetch,
  }),
}));

// Import after mocks
import { PostureTrendChart } from '@/features/triage-analytics/PostureTrendChart';

// --- Helpers ---
const setupState = (overrides: Partial<typeof mockQueryState> = {}) => {
  mockQueryState.data = overrides.data ?? undefined;
  mockQueryState.isLoading = overrides.isLoading ?? false;
  mockQueryState.isError = overrides.isError ?? false;
  mockQueryState.error = overrides.error ?? null;
  mockQueryState.refetch = overrides.refetch ?? mock();
};

const renderChart = () => renderWithProviders(<PostureTrendChart period="30d" />);

// --- Tests ---
describe('PostureTrendChart', () => {
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
        buckets: [{ date: '2026-03-01', critical: 1, high: 0, medium: 0, low: 0, info: 0 }],
      },
    });
    renderChart();

    expect(screen.getByText('Posture Trend')).toBeInTheDocument();
  });

  it('shows loading skeleton when isLoading is true', () => {
    setupState({ isLoading: true });
    renderChart();

    expect(screen.getByText('Posture Trend')).toBeInTheDocument();
    // Skeleton is rendered but chart area is not
    expect(screen.queryByTestId('area-chart')).not.toBeInTheDocument();
  });

  it('shows empty state when data has no buckets', () => {
    setupState({ data: { buckets: [] } });
    renderChart();

    expect(screen.getByText('No posture trend data for this period')).toBeInTheDocument();
  });

  it('shows empty state when all bucket values are zero', () => {
    setupState({
      data: {
        buckets: [
          { date: '2026-03-01', critical: 0, high: 0, medium: 0, low: 0, info: 0 },
          { date: '2026-03-02', critical: 0, high: 0, medium: 0, low: 0, info: 0 },
        ],
      },
    });
    renderChart();

    expect(screen.getByText('No posture trend data for this period')).toBeInTheDocument();
  });

  it('renders area chart with provided data', () => {
    setupState({
      data: {
        buckets: [
          { date: '2026-03-01', critical: 5, high: 3, medium: 2, low: 1, info: 0 },
          { date: '2026-03-02', critical: 4, high: 2, medium: 1, low: 0, info: 1 },
        ],
      },
    });
    renderChart();

    expect(screen.getByTestId('area-chart')).toBeInTheDocument();
    expect(screen.getByTestId('area-critical')).toBeInTheDocument();
    expect(screen.getByTestId('area-high')).toBeInTheDocument();
    expect(screen.getByTestId('area-medium')).toBeInTheDocument();
    expect(screen.getByTestId('area-low')).toBeInTheDocument();
    expect(screen.getByTestId('area-info')).toBeInTheDocument();
  });

  it('shows error banner when isError is true', () => {
    setupState({ isError: true, error: new Error('Network failure') });
    renderChart();

    expect(screen.getByText('Network failure')).toBeInTheDocument();
  });

  it('renders aria-label attribute on chart container', () => {
    setupState({
      data: {
        buckets: [{ date: '2026-03-01', critical: 1, high: 0, medium: 0, low: 0, info: 0 }],
      },
    });
    renderChart();

    const container = screen.getByLabelText(
      'Posture trend chart showing findings by severity over time',
    );
    expect(container).toBeInTheDocument();
  });
});
