import { describe, it, beforeEach, afterEach, expect, mock } from 'bun:test';
import { screen, cleanup, fireEvent } from '@testing-library/react';
import { renderWithProviders } from '@/test/render-with-providers';

// --- Mutable mock state ---
const mockPoliciesState: {
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

const mockMutateFn = mock();
const mockMutationState: {
  mutate: ReturnType<typeof mock>;
  isPending: boolean;
} = {
  mutate: mockMutateFn,
  isPending: false,
};

mock.module('@/hooks/queries/useTriageAnalyticsQueries', () => ({
  useSlaPolicies: () => ({
    data: mockPoliciesState.data,
    isLoading: mockPoliciesState.isLoading,
    isError: mockPoliciesState.isError,
    error: mockPoliciesState.error,
    refetch: mockPoliciesState.refetch,
  }),
  useUpsertSlaPolicies: () => ({
    mutate: mockMutationState.mutate,
    isPending: mockMutationState.isPending,
  }),
}));

// Import after mocks
import { SlaPolicySettings } from '@/features/triage-analytics/SlaPolicySettings';

// --- Helpers ---
const setupState = (overrides: Partial<typeof mockPoliciesState> = {}) => {
  mockPoliciesState.data = overrides.data ?? undefined;
  mockPoliciesState.isLoading = overrides.isLoading ?? false;
  mockPoliciesState.isError = overrides.isError ?? false;
  mockPoliciesState.error = overrides.error ?? null;
  mockPoliciesState.refetch = overrides.refetch ?? mock();
  mockMutationState.mutate = mock();
  mockMutationState.isPending = false;
};

const renderSettings = () => renderWithProviders(<SlaPolicySettings />);

// --- Tests ---
describe('SlaPolicySettings', () => {
  beforeEach(() => {
    cleanup();
    setupState();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders SLA Policy Settings title', () => {
    setupState({
      data: { policies: [] },
    });
    renderSettings();

    expect(screen.getByText('SLA Policy Settings')).toBeInTheDocument();
  });

  it('renders form with existing policy values pre-populated', () => {
    setupState({
      data: {
        policies: [
          { id: '1', severity: 'critical', deadlineHours: 24, createdAt: '', updatedAt: '' },
          { id: '2', severity: 'high', deadlineHours: 72, createdAt: '', updatedAt: '' },
        ],
      },
    });
    renderSettings();

    // Click to expand the collapsible section (defaultOpen=false)
    const sectionButton = screen.getByText('SLA Policy Settings');
    fireEvent.click(sectionButton);

    // Check for severity labels
    expect(screen.getByText('Critical')).toBeInTheDocument();
    expect(screen.getByText('High')).toBeInTheDocument();
    expect(screen.getByText('Medium')).toBeInTheDocument();
    expect(screen.getByText('Low')).toBeInTheDocument();
    expect(screen.getByText('Info')).toBeInTheDocument();
  });

  it('renders five severity input fields', () => {
    setupState({
      data: { policies: [] },
    });
    renderSettings();

    // Expand the section
    fireEvent.click(screen.getByText('SLA Policy Settings'));

    const criticalInput = screen.getByLabelText('Critical');
    const highInput = screen.getByLabelText('High');
    const mediumInput = screen.getByLabelText('Medium');
    const lowInput = screen.getByLabelText('Low');
    const infoInput = screen.getByLabelText('Info');

    expect(criticalInput).toBeInTheDocument();
    expect(highInput).toBeInTheDocument();
    expect(mediumInput).toBeInTheDocument();
    expect(lowInput).toBeInTheDocument();
    expect(infoInput).toBeInTheDocument();
  });

  it('shows loading skeletons when isLoading is true', () => {
    setupState({ isLoading: true });
    renderSettings();

    // Expand the section
    fireEvent.click(screen.getByText('SLA Policy Settings'));

    // Should not show the severity labels yet
    expect(screen.queryByLabelText('Critical')).not.toBeInTheDocument();
  });

  it('shows error banner when isError is true', () => {
    setupState({ isError: true, error: new Error('Policy fetch failed') });
    renderSettings();

    // Expand the section
    fireEvent.click(screen.getByText('SLA Policy Settings'));

    expect(screen.getByText('Policy fetch failed')).toBeInTheDocument();
  });

  it('Save button is disabled initially (not dirty)', () => {
    setupState({
      data: { policies: [] },
    });
    renderSettings();

    // Expand the section
    fireEvent.click(screen.getByText('SLA Policy Settings'));

    const saveButton = screen.getByRole('button', { name: /Save Policies/i });
    expect(saveButton).toBeDisabled();
  });

  it('shows helpful description text', () => {
    setupState({
      data: { policies: [] },
    });
    renderSettings();

    // Expand the section
    fireEvent.click(screen.getByText('SLA Policy Settings'));

    expect(screen.getByText(/Set remediation deadline hours per severity/)).toBeInTheDocument();
  });
});
