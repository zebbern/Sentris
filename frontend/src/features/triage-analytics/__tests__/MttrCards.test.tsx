import { describe, it, beforeEach, afterEach, expect, mock } from 'bun:test';
import { screen, cleanup } from '@testing-library/react';
import { renderWithProviders } from '@/test/render-with-providers';

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
  useMttr: () => ({
    data: mockQueryState.data,
    isLoading: mockQueryState.isLoading,
    isError: mockQueryState.isError,
    error: mockQueryState.error,
    refetch: mockQueryState.refetch,
  }),
}));

// Import after mocks
import { MttrCards } from '@/features/triage-analytics/MttrCards';

// --- Helpers ---
const setupState = (overrides: Partial<typeof mockQueryState> = {}) => {
  mockQueryState.data = overrides.data ?? undefined;
  mockQueryState.isLoading = overrides.isLoading ?? false;
  mockQueryState.isError = overrides.isError ?? false;
  mockQueryState.error = overrides.error ?? null;
  mockQueryState.refetch = overrides.refetch ?? mock();
};

const renderCards = () => renderWithProviders(<MttrCards period="30d" />);

// --- Tests ---
describe('MttrCards', () => {
  beforeEach(() => {
    cleanup();
    setupState();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders one card per severity', () => {
    setupState({
      data: {
        severities: [
          { severity: 'critical', mttrSeconds: 3600, resolvedCount: 5 },
          { severity: 'high', mttrSeconds: 7200, resolvedCount: 3 },
          { severity: 'medium', mttrSeconds: null, resolvedCount: 0 },
          { severity: 'low', mttrSeconds: 86400, resolvedCount: 1 },
          { severity: 'info', mttrSeconds: null, resolvedCount: 0 },
        ],
      },
    });
    renderCards();

    expect(screen.getByText('Critical')).toBeInTheDocument();
    expect(screen.getByText('High')).toBeInTheDocument();
    expect(screen.getByText('Medium')).toBeInTheDocument();
    expect(screen.getByText('Low')).toBeInTheDocument();
    expect(screen.getByText('Info')).toBeInTheDocument();
  });

  it('displays "N/A" for null mttrSeconds', () => {
    setupState({
      data: {
        severities: [
          { severity: 'critical', mttrSeconds: null, resolvedCount: 0 },
          { severity: 'high', mttrSeconds: null, resolvedCount: 0 },
          { severity: 'medium', mttrSeconds: null, resolvedCount: 0 },
          { severity: 'low', mttrSeconds: null, resolvedCount: 0 },
          { severity: 'info', mttrSeconds: null, resolvedCount: 0 },
        ],
      },
    });
    renderCards();

    const naElements = screen.getAllByText('N/A');
    expect(naElements.length).toBe(5);
  });

  it('formats seconds to human-readable duration', () => {
    setupState({
      data: {
        severities: [
          { severity: 'critical', mttrSeconds: 90000, resolvedCount: 2 }, // 1d 1h
          { severity: 'high', mttrSeconds: 3600, resolvedCount: 1 }, // 1h
          { severity: 'medium', mttrSeconds: 300, resolvedCount: 1 }, // 5m
          { severity: 'low', mttrSeconds: null, resolvedCount: 0 },
          { severity: 'info', mttrSeconds: null, resolvedCount: 0 },
        ],
      },
    });
    renderCards();

    expect(screen.getByText('1d 1h')).toBeInTheDocument();
    expect(screen.getByText('1h')).toBeInTheDocument();
    expect(screen.getByText('5m')).toBeInTheDocument();
  });

  it('displays resolved count per severity', () => {
    setupState({
      data: {
        severities: [
          { severity: 'critical', mttrSeconds: 3600, resolvedCount: 10 },
          { severity: 'high', mttrSeconds: null, resolvedCount: 0 },
          { severity: 'medium', mttrSeconds: null, resolvedCount: 0 },
          { severity: 'low', mttrSeconds: null, resolvedCount: 0 },
          { severity: 'info', mttrSeconds: null, resolvedCount: 0 },
        ],
      },
    });
    renderCards();

    expect(screen.getByText('10 resolved')).toBeInTheDocument();
    expect(screen.getAllByText('0 resolved').length).toBe(4);
  });

  it('shows loading skeletons when isLoading is true', () => {
    setupState({ isLoading: true });
    renderCards();

    const container = screen.getByLabelText('Mean time to remediate loading');
    expect(container).toBeInTheDocument();
  });

  it('shows error banner when isError is true', () => {
    setupState({ isError: true, error: new Error('Server error') });
    renderCards();

    expect(screen.getByText('Server error')).toBeInTheDocument();
  });

  it('renders aria-label for MTTR container', () => {
    setupState({
      data: {
        severities: [
          { severity: 'critical', mttrSeconds: 3600, resolvedCount: 1 },
          { severity: 'high', mttrSeconds: null, resolvedCount: 0 },
          { severity: 'medium', mttrSeconds: null, resolvedCount: 0 },
          { severity: 'low', mttrSeconds: null, resolvedCount: 0 },
          { severity: 'info', mttrSeconds: null, resolvedCount: 0 },
        ],
      },
    });
    renderCards();

    expect(screen.getByLabelText('Mean time to remediate per severity')).toBeInTheDocument();
  });
});
