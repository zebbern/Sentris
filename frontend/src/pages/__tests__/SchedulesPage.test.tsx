import { describe, it, beforeEach, afterEach, expect, mock } from 'bun:test';
import { fireEvent, render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { WorkflowSchedule } from '@sentris/shared';
import { createDialogMock, createAlertDialogMock } from '@/test/mocks/dialog';
import { createAuthStoreMock } from '@/test/mocks/auth-store';

// --- Mock dialog components (passthrough for test rendering) ---
mock.module('@/components/ui/dialog', createDialogMock);
mock.module('@/components/ui/alert-dialog', createAlertDialogMock);

// --- Mutable mock state for schedule queries ---
const mockQueryState: {
  schedules: WorkflowSchedule[];
  isLoading: boolean;
  error: Error | null;
  pauseSchedule: any;
  resumeSchedule: any;
  runSchedule: any;
  deleteSchedule: any;
} = {
  schedules: [],
  isLoading: false,
  error: null,
  pauseSchedule: mock().mockResolvedValue(undefined),
  resumeSchedule: mock().mockResolvedValue(undefined),
  runSchedule: mock().mockResolvedValue(undefined),
  deleteSchedule: mock().mockResolvedValue(undefined),
};

mock.module('@/hooks/queries/useScheduleQueries', () => ({
  useSchedules: () => ({
    data: mockQueryState.schedules,
    isLoading: mockQueryState.isLoading,
    error: mockQueryState.error,
  }),
  usePauseSchedule: () => ({
    mutateAsync: mockQueryState.pauseSchedule,
  }),
  useResumeSchedule: () => ({
    mutateAsync: mockQueryState.resumeSchedule,
  }),
  useRunSchedule: () => ({
    mutateAsync: mockQueryState.runSchedule,
  }),
  useDeleteSchedule: () => ({
    mutateAsync: mockQueryState.deleteSchedule,
  }),
}));

// --- Mock workflow queries ---
const mockWorkflows = [
  { id: 'wf-111', name: 'Scan Network' },
  { id: 'wf-222', name: 'Deploy App' },
];

mock.module('@/hooks/queries/useWorkflowQueries', () => ({
  useWorkflowsSummary: () => ({
    data: mockWorkflows,
    isLoading: false,
  }),
}));

const mockInvalidateQueries = mock().mockResolvedValue(undefined);

mock.module('@tanstack/react-query', () => ({
  useQueryClient: () => ({
    invalidateQueries: mockInvalidateQueries,
  }),
}));

// --- Mock ScheduleEditorDrawer as a no-op stub ---
mock.module('@/components/schedules/ScheduleEditorDrawer', () => ({
  ScheduleEditorDrawer: () => null,
}));

// --- Auth store ---
mock.module('@/store/authStore', () => createAuthStoreMock());

// Import component AFTER all mock.module() calls
import { SchedulesPage } from '@/pages/SchedulesPage';

// --- Fixtures ---
const ISO = '2024-06-15T12:00:00.000Z';

const baseSchedule: WorkflowSchedule = {
  id: 'sched-001',
  workflowId: 'wf-111',
  workflowVersionId: null,
  workflowVersion: null,
  name: 'Nightly Scan',
  description: 'Runs every night',
  cronExpression: '0 2 * * *',
  timezone: 'UTC',
  humanLabel: 'Every day at 2 AM',
  overlapPolicy: 'skip',
  catchupWindowSeconds: 0,
  status: 'active',
  lastRunAt: ISO,
  nextRunAt: '2024-06-16T02:00:00.000Z',
  inputPayload: { runtimeInputs: {}, nodeOverrides: {} },
  temporalScheduleId: null,
  temporalSnapshot: {},
  organizationId: 'org-001',
  createdAt: ISO,
  updatedAt: ISO,
};

const pausedSchedule: WorkflowSchedule = {
  ...baseSchedule,
  id: 'sched-002',
  name: 'Weekly Deploy',
  workflowId: 'wf-222',
  status: 'paused',
  cronExpression: '0 9 * * 1',
  humanLabel: 'Every Monday at 9 AM',
};

// --- Helpers ---
interface MockQueryOverrides {
  schedules?: WorkflowSchedule[];
  isLoading?: boolean;
  error?: Error | null;
  pauseSchedule?: (...args: any[]) => Promise<void>;
  resumeSchedule?: (...args: any[]) => Promise<void>;
  runSchedule?: (...args: any[]) => Promise<void>;
  deleteSchedule?: (...args: any[]) => Promise<void>;
}

const setupStore = (overrides: MockQueryOverrides = {}) => {
  mockQueryState.schedules = overrides.schedules ?? [baseSchedule, pausedSchedule];
  mockQueryState.isLoading = overrides.isLoading ?? false;
  mockQueryState.error = overrides.error ?? null;
  mockQueryState.pauseSchedule = overrides.pauseSchedule ?? mock().mockResolvedValue(undefined);
  mockQueryState.resumeSchedule = overrides.resumeSchedule ?? mock().mockResolvedValue(undefined);
  mockQueryState.runSchedule = overrides.runSchedule ?? mock().mockResolvedValue(undefined);
  mockQueryState.deleteSchedule = overrides.deleteSchedule ?? mock().mockResolvedValue(undefined);
  mockInvalidateQueries.mockClear();

  return mockQueryState;
};

const renderPage = () =>
  render(
    <MemoryRouter>
      <SchedulesPage />
    </MemoryRouter>,
  );

// --- Tests ---
describe('SchedulesPage', () => {
  beforeEach(() => {
    cleanup();
    setupStore();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders loading skeletons when isLoading is true and no data', () => {
    setupStore({ isLoading: true, schedules: [] });
    renderPage();

    // The skeleton rows should render (4 skeleton rows)
    const container = document.querySelector('[aria-busy="true"]');
    expect(container).toBeTruthy();
  });

  it('renders empty state with "No schedules found" when data is empty', () => {
    setupStore({ schedules: [] });
    renderPage();

    expect(screen.getByText('No schedules found')).toBeInTheDocument();
  });

  it('renders schedule rows showing name, status badge, and action buttons', () => {
    setupStore();
    renderPage();

    // Schedule names
    expect(screen.getByText('Nightly Scan')).toBeInTheDocument();
    expect(screen.getByText('Weekly Deploy')).toBeInTheDocument();

    // Status badges
    expect(screen.getByText('Active')).toBeInTheDocument();
    expect(screen.getByText('Paused')).toBeInTheDocument();

    // Action buttons (Run buttons for both schedules)
    const runButtons = screen.getAllByRole('button', { name: /Run/i });
    expect(runButtons.length).toBeGreaterThanOrEqual(2);
  });

  it('shows ErrorBanner when error is set', () => {
    setupStore({ error: new Error('Failed to load schedules') });
    renderPage();

    expect(screen.getByText('Failed to load schedules')).toBeInTheDocument();
  });

  it('clicking Run button calls runScheduleMutation.mutateAsync with schedule id', async () => {
    const runSchedule = mock().mockResolvedValue(undefined);
    setupStore({ runSchedule });
    renderPage();

    // Find Run buttons — each schedule row has one
    const runButtons = screen.getAllByRole('button', { name: /Run/i });
    fireEvent.click(runButtons[0]);

    expect(runSchedule).toHaveBeenCalledTimes(1);
    expect(runSchedule).toHaveBeenCalledWith(baseSchedule.id);
  });

  it('clicking Pause button calls pauseScheduleMutation.mutateAsync with schedule id', async () => {
    const pauseSchedule = mock().mockResolvedValue(undefined);
    setupStore({ pauseSchedule });
    renderPage();

    // Find the Pause button (active schedule shows "Pause")
    const pauseButtons = screen.getAllByRole('button', { name: /Pause/i });
    fireEvent.click(pauseButtons[0]);

    expect(pauseSchedule).toHaveBeenCalledTimes(1);
    expect(pauseSchedule).toHaveBeenCalledWith(baseSchedule.id);
  });

  it('clicking Resume button on paused schedule calls resumeScheduleMutation.mutateAsync', async () => {
    const resumeSchedule = mock().mockResolvedValue(undefined);
    // Only paused schedule so we can target its resume button
    setupStore({ schedules: [pausedSchedule], resumeSchedule });
    renderPage();

    const resumeButtons = screen.getAllByRole('button', { name: /Resume/i });
    fireEvent.click(resumeButtons[0]);

    expect(resumeSchedule).toHaveBeenCalledTimes(1);
    expect(resumeSchedule).toHaveBeenCalledWith(pausedSchedule.id);
  });

  it('clicking Delete button shows confirm dialog, confirming calls deleteScheduleMutation.mutateAsync', async () => {
    const deleteSchedule = mock().mockResolvedValue(undefined);
    setupStore({ schedules: [baseSchedule], deleteSchedule });
    renderPage();

    // Click the Delete icon button (aria-label)
    const deleteButton = screen.getByRole('button', { name: /Delete schedule/i });
    fireEvent.click(deleteButton);

    // Wait for the confirm dialog to appear
    await screen.findByRole('alertdialog');

    // The confirm dialog renders "Delete" as the confirmLabel inside alertdialog
    const actionButtons = screen.getAllByRole('button', { name: /Delete/i });
    const confirmActionBtn = actionButtons.find(
      (btn) => btn.closest('[role="alertdialog"]') !== null,
    );
    expect(confirmActionBtn).toBeTruthy();
    fireEvent.click(confirmActionBtn!);
    // Give the async handler time to resolve
    await new Promise((r) => setTimeout(r, 10));
    expect(deleteSchedule).toHaveBeenCalledTimes(1);
    expect(deleteSchedule).toHaveBeenCalledWith(baseSchedule.id);
  });

  it('search input filters schedules by name', () => {
    setupStore();
    renderPage();

    // Both schedules present initially
    expect(screen.getByText('Nightly Scan')).toBeInTheDocument();
    expect(screen.getByText('Weekly Deploy')).toBeInTheDocument();

    // Type in search
    const searchInput = screen.getByPlaceholderText(/Filter by schedule or workflow/i);
    fireEvent.change(searchInput, { target: { value: 'Nightly' } });

    // Only matching schedule remains
    expect(screen.getByText('Nightly Scan')).toBeInTheDocument();
    expect(screen.queryByText('Weekly Deploy')).not.toBeInTheDocument();
  });

  it('search input filters schedules by workflow name', () => {
    setupStore();
    renderPage();

    const searchInput = screen.getByPlaceholderText(/Filter by schedule or workflow/i);
    fireEvent.change(searchInput, { target: { value: 'Deploy App' } });

    // Only the schedule linked to "Deploy App" workflow remains
    expect(screen.queryByText('Nightly Scan')).not.toBeInTheDocument();
    expect(screen.getByText('Weekly Deploy')).toBeInTheDocument();
  });
});
