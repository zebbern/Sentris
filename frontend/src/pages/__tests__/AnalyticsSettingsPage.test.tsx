import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { AnalyticsSettingsResponse } from '@/services/api';
import { createAuthStoreMock } from '@/test/mocks/auth-store';

// ---------------------------------------------------------------------------
// Mutable mock state
// ---------------------------------------------------------------------------

let mockRoles: string[] = ['ADMIN'];
let mockSettings: AnalyticsSettingsResponse | undefined;
let mockIsLoading = false;
let mockError: Error | null = null;
let mockRefetch = mock(() => {});
let mockMutateAsync = mock(async (_input: any) => mockSettings!);
let mockMutationPending = false;
let mockMutationError: Error | null = null;

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

mock.module('@/store/authStore', () => createAuthStoreMock({ roles: () => mockRoles }));

mock.module('@/hooks/queries/useAnalyticsSettingsQueries', () => ({
  useAnalyticsSettings: () => ({
    data: mockSettings,
    isLoading: mockIsLoading,
    error: mockError,
    refetch: mockRefetch,
  }),
  useUpdateAnalyticsSettings: () => ({
    mutateAsync: mockMutateAsync,
    isPending: mockMutationPending,
    isError: !!mockMutationError,
    error: mockMutationError,
  }),
}));

const mockToast = mock((_opts: any) => {});
mock.module('@/components/ui/use-toast', () => ({
  useToast: () => ({ toast: mockToast }),
}));

import { AnalyticsSettingsPage } from '../AnalyticsSettingsPage';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const baseSettings: AnalyticsSettingsResponse = {
  organizationId: 'org-1',
  subscriptionTier: 'pro',
  analyticsRetentionDays: 30,
  maxRetentionDays: 90,
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-06-15T12:00:00.000Z',
};

const renderPage = () =>
  render(
    <MemoryRouter>
      <AnalyticsSettingsPage />
    </MemoryRouter>,
  );

const resetMocks = () => {
  mockRoles = ['ADMIN'];
  mockSettings = { ...baseSettings };
  mockIsLoading = false;
  mockError = null;
  mockRefetch = mock(() => {});
  mockMutateAsync = mock(async () => mockSettings!);
  mockMutationPending = false;
  mockMutationError = null;
  mockToast.mockClear();
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AnalyticsSettingsPage', () => {
  beforeEach(() => {
    cleanup();
    resetMocks();
  });

  afterEach(cleanup);

  // --- Loading state ---

  it('renders skeleton while loading', () => {
    mockIsLoading = true;
    mockSettings = undefined;

    const { container } = renderPage();

    // Skeletons use Skeleton component with specific classes
    const skeletons = container.querySelectorAll('[class*="animate-pulse"]');
    expect(skeletons.length).toBeGreaterThan(0);
  });

  // --- Error state ---

  it('shows ErrorBanner when API returns an error', () => {
    mockError = new Error('Network failure');
    mockSettings = undefined;

    renderPage();

    expect(screen.getByText('Network failure')).toBeTruthy();
    expect(screen.getByText('Try again')).toBeTruthy();
  });

  it('calls refetch when Try again is clicked on error banner', () => {
    mockError = new Error('Server error');
    mockSettings = undefined;

    renderPage();

    fireEvent.click(screen.getByText('Try again'));
    expect(mockRefetch).toHaveBeenCalledTimes(1);
  });

  // --- Admin form rendering ---

  it('shows retention input for admin users', () => {
    renderPage();

    const input = screen.getByLabelText('Retention Period (days)');
    expect(input).toBeTruthy();
    expect((input as HTMLInputElement).value).toBe('30');
  });

  it('shows Save Changes button for admin users', () => {
    renderPage();

    expect(screen.getByText('Save Changes')).toBeTruthy();
  });

  it('shows tier badge', () => {
    renderPage();

    expect(screen.getByText('Pro')).toBeTruthy();
  });

  // --- Non-admin read-only view ---

  it('shows read-only retention value for non-admin users', () => {
    mockRoles = ['VIEWER'];

    renderPage();

    expect(screen.getByText('30 days')).toBeTruthy();
    // No input should be present
    expect(screen.queryByLabelText('Retention Period (days)')).toBeNull();
  });

  it('shows admin-only notice for non-admin users', () => {
    mockRoles = ['VIEWER'];

    renderPage();

    expect(screen.getByText(/only administrators can modify analytics settings/i)).toBeTruthy();
  });

  it('does not show Save button for non-admin users', () => {
    mockRoles = ['VIEWER'];

    renderPage();

    expect(screen.queryByText('Save Changes')).toBeNull();
  });

  // --- Validation ---

  it('shows validation error when retention exceeds tier max', () => {
    renderPage();

    const input = screen.getByLabelText('Retention Period (days)');
    fireEvent.change(input, { target: { value: '100' } });

    expect(screen.getByText('Retention days cannot exceed 90 for your tier.')).toBeTruthy();
  });

  it('shows validation error for value less than 1', () => {
    renderPage();

    const input = screen.getByLabelText('Retention Period (days)');
    fireEvent.change(input, { target: { value: '0' } });

    expect(screen.getByText('Retention days must be at least 1.')).toBeTruthy();
  });

  it('shows validation error for empty input', () => {
    renderPage();

    const input = screen.getByLabelText('Retention Period (days)');
    fireEvent.change(input, { target: { value: '' } });

    expect(screen.getByText('Retention days must be at least 1.')).toBeTruthy();
  });

  // --- Save button state ---

  it('disables Save button when there are no unsaved changes', () => {
    renderPage();

    const saveButton = screen.getByText('Save Changes').closest('button')!;
    expect(saveButton.disabled).toBe(true);
  });

  it('enables Save button after changing retention value', () => {
    renderPage();

    const input = screen.getByLabelText('Retention Period (days)');
    fireEvent.change(input, { target: { value: '45' } });

    const saveButton = screen.getByText('Save Changes').closest('button')!;
    expect(saveButton.disabled).toBe(false);
  });

  it('disables Save button when validation error exists', () => {
    renderPage();

    const input = screen.getByLabelText('Retention Period (days)');
    fireEvent.change(input, { target: { value: '200' } });

    const saveButton = screen.getByText('Save Changes').closest('button')!;
    expect(saveButton.disabled).toBe(true);
  });

  it('disables Save button while mutation is pending', () => {
    mockMutationPending = true;

    renderPage();

    // Change value to enable the button normally
    const input = screen.getByLabelText('Retention Period (days)');
    fireEvent.change(input, { target: { value: '45' } });

    // Button text changes to "Saving…" and should be disabled
    const saveButton = screen.getByText('Saving…').closest('button')!;
    expect(saveButton.disabled).toBe(true);
  });

  // --- Save success ---

  it('calls mutateAsync and shows success toast on save', async () => {
    renderPage();

    const input = screen.getByLabelText('Retention Period (days)');
    fireEvent.change(input, { target: { value: '60' } });

    const saveButton = screen.getByText('Save Changes').closest('button')!;
    fireEvent.click(saveButton);

    // Wait for the async handler
    await new Promise((r) => setTimeout(r, 0));

    expect(mockMutateAsync).toHaveBeenCalledWith({ analyticsRetentionDays: 60 });
    expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Settings saved' }));
  });

  // --- Subscription & Limits section ---

  it('renders the tier limits table', () => {
    renderPage();

    expect(screen.getByText('Free')).toBeTruthy();
    expect(screen.getByText('Pro')).toBeTruthy();
    expect(screen.getByText('Enterprise')).toBeTruthy();
    expect(screen.getByText('30 days')).toBeTruthy();
    expect(screen.getByText('90 days')).toBeTruthy();
    expect(screen.getByText('365 days')).toBeTruthy();
  });

  it('shows "Current" badge next to the active tier', () => {
    renderPage();

    expect(screen.getByText('Current')).toBeTruthy();
  });
});
