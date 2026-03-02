import { describe, it, expect, afterEach, mock } from 'bun:test';
import { render, screen, cleanup } from '@testing-library/react';

// ---------------------------------------------------------------------------
// Mock utilities that RunInfoDisplay depends on
// ---------------------------------------------------------------------------

const mockFormatDuration = mock((ms: number) => `${ms}ms`);
const mockFormatStartTime = mock((ts: string) => `started-${ts}`);
const mockGetTriggerDisplay = mock((_type?: string | null, _label?: string | null) => ({
  icon: '▶',
  label: 'Manual run',
  variant: 'secondary' as const,
}));
const mockGetStatusBadgeClassFromStatus = mock(
  (_status: string, extra?: string) => `status-badge ${extra ?? ''}`,
);
const mockIsRunLive = mock((_run?: any) => false);

mock.module('@/utils/timeFormat', () => ({
  formatDuration: mockFormatDuration,
  formatStartTime: mockFormatStartTime,
}));

mock.module('@/utils/triggerDisplay', () => ({
  getTriggerDisplay: mockGetTriggerDisplay,
}));

mock.module('@/utils/statusBadgeStyles', () => ({
  getStatusBadgeClassFromStatus: mockGetStatusBadgeClassFromStatus,
}));

mock.module('@/features/workflow-builder/utils/executionRuns', () => ({
  isRunLive: mockIsRunLive,
}));

// Dynamic import with query param to bypass stale mock.module from ExecutionInspector.test.tsx
// @ts-expect-error — query parameter creates a separate module cache entry
const { RunInfoDisplay } = await import('../RunInfoDisplay?unmocked');
import type { ExecutionRun } from '@/hooks/queries/useRunQueries';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRun(overrides: Partial<ExecutionRun> = {}): ExecutionRun {
  return {
    id: 'run-1',
    workflowId: 'wf-1',
    workflowName: 'Test Workflow',
    status: 'COMPLETED' as any,
    startTime: '2026-01-01T00:00:00Z',
    endTime: '2026-01-01T00:01:00Z',
    duration: 60_000,
    nodeCount: 3,
    eventCount: 12,
    createdAt: '2026-01-01T00:00:00Z',
    isLive: false,
    workflowVersionId: 'v1',
    workflowVersion: 2,
    triggerType: 'manual',
    triggerSource: null,
    triggerLabel: 'Manual run',
    inputPreview: { runtimeInputs: {}, nodeOverrides: {} },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('RunInfoDisplay', () => {
  afterEach(() => {
    cleanup();
    mockFormatDuration.mockClear();
    mockFormatStartTime.mockClear();
    mockGetTriggerDisplay.mockClear();
    mockGetStatusBadgeClassFromStatus.mockClear();
    mockIsRunLive.mockClear();
    mockIsRunLive.mockReturnValue(false);
  });

  it('renders start time, event count, and duration', () => {
    const run = makeRun({ eventCount: 42, duration: 5000 });
    render(<RunInfoDisplay run={run} />);

    expect(screen.getByText('started-2026-01-01T00:00:00Z')).toBeTruthy();
    expect(screen.getByText('42 events')).toBeTruthy();
    expect(screen.getByText('5000ms')).toBeTruthy();
  });

  it('omits duration when not available', () => {
    const run = makeRun({ duration: undefined });
    render(<RunInfoDisplay run={run} />);

    expect(screen.queryByText(/ms$/)).toBeNull();
  });

  it('shows status badge with correct status text', () => {
    const run = makeRun({ status: 'FAILED' as any });
    render(<RunInfoDisplay run={run} />);

    expect(screen.getByText('FAILED')).toBeTruthy();
    expect(mockGetStatusBadgeClassFromStatus).toHaveBeenCalledWith('FAILED', expect.any(String));
  });

  it('shows version badge for run with workflowVersion', () => {
    const run = makeRun({ workflowVersion: 5 });
    render(<RunInfoDisplay run={run} />);

    expect(screen.getByText('v5')).toBeTruthy();
  });

  it('applies amber styling when version differs from current workflow version', () => {
    const run = makeRun({ workflowVersion: 3 });
    render(<RunInfoDisplay run={run} currentWorkflowVersion={5} />);

    const versionBadge = screen.getByText('v3');
    expect(versionBadge.closest('[class]')?.className).toContain('amber');
  });

  it('does not apply amber styling when versions match', () => {
    const run = makeRun({ workflowVersion: 5 });
    render(<RunInfoDisplay run={run} currentWorkflowVersion={5} />);

    const versionBadge = screen.getByText('v5');
    expect(versionBadge.closest('[class]')?.className).not.toContain('amber');
  });

  it('hides badges when showBadges is false', () => {
    const run = makeRun({ workflowVersion: 2 });
    render(<RunInfoDisplay run={run} showBadges={false} />);

    expect(screen.queryByText('v2')).toBeNull();
    expect(screen.queryByText('COMPLETED')).toBeNull();
  });

  it('shows Live badge when run is live', () => {
    mockIsRunLive.mockReturnValue(true);
    const run = makeRun({ isLive: true, status: 'RUNNING' as any });
    render(<RunInfoDisplay run={run} />);

    expect(screen.getByText('Live')).toBeTruthy();
  });

  it('does not show Live badge when run is not live', () => {
    mockIsRunLive.mockReturnValue(false);
    const run = makeRun();
    render(<RunInfoDisplay run={run} />);

    expect(screen.queryByText('Live')).toBeNull();
  });
});
