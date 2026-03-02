import { describe, it, afterEach, expect, mock } from 'bun:test';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import type { WorkflowSchedule } from '@sentris/shared';

// Mock the tooltip components to avoid Radix DOM issues in jsdom
mock.module('@/components/ui/tooltip', () => ({
  TooltipProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipTrigger: ({
    children,
    asChild,
    ...rest
  }: {
    children: React.ReactNode;
    asChild?: boolean;
    [k: string]: unknown;
  }) => (asChild ? <>{children}</> : <span {...rest}>{children}</span>),
  TooltipContent: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="tooltip-content">{children}</div>
  ),
}));

// Mock the schedules-utils since they are pure formatting
mock.module('../schedules-utils', () => ({
  formatScheduleTimestamp: (v?: string | null) => (v ? `Formatted: ${v}` : 'Not scheduled'),
  scheduleStatusVariant: {
    active: 'default' as const,
    paused: 'secondary' as const,
    error: 'destructive' as const,
  },
}));

const { WorkflowSchedulesSummaryBar, WorkflowSchedulesSidebar } =
  await import('../WorkflowSchedulesPanel');

function createSchedule(overrides: Partial<WorkflowSchedule> = {}): WorkflowSchedule {
  return {
    id: `sched-${Math.random().toString(36).slice(2, 6)}`,
    workflowId: 'wf-1',
    workflowVersionId: null,
    workflowVersion: null,
    name: 'Daily Scan',
    description: null,
    cronExpression: '0 0 * * *',
    timezone: 'UTC',
    humanLabel: null,
    overlapPolicy: 'skip',
    catchupWindowSeconds: 0,
    status: 'active',
    lastRunAt: null,
    nextRunAt: '2026-03-02T00:00:00Z',
    inputPayload: {},
    temporalScheduleId: null,
    temporalSnapshot: {},
    organizationId: null,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// WorkflowSchedulesSummaryBar
// ---------------------------------------------------------------------------
describe('WorkflowSchedulesSummaryBar', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders loading state', () => {
    render(
      <WorkflowSchedulesSummaryBar
        schedules={[]}
        isLoading={true}
        onCreate={mock(() => {})}
        onExpand={mock(() => {})}
        onViewAll={mock(() => {})}
      />,
    );

    expect(screen.getByText('Loading…')).toBeInTheDocument();
  });

  it('renders error message', () => {
    render(
      <WorkflowSchedulesSummaryBar
        schedules={[]}
        isLoading={false}
        error="Failed to load"
        onCreate={mock(() => {})}
        onExpand={mock(() => {})}
        onViewAll={mock(() => {})}
      />,
    );

    expect(screen.getByText('Failed to load')).toBeInTheDocument();
  });

  it('renders "No schedules" when list is empty', () => {
    render(
      <WorkflowSchedulesSummaryBar
        schedules={[]}
        isLoading={false}
        onCreate={mock(() => {})}
        onExpand={mock(() => {})}
        onViewAll={mock(() => {})}
      />,
    );

    expect(screen.getByText('No schedules')).toBeInTheDocument();
  });

  it('renders counts by status', () => {
    const schedules = [
      createSchedule({ status: 'active' }),
      createSchedule({ status: 'active' }),
      createSchedule({ status: 'paused' }),
      createSchedule({ status: 'error' }),
    ];

    render(
      <WorkflowSchedulesSummaryBar
        schedules={schedules}
        isLoading={false}
        onCreate={mock(() => {})}
        onExpand={mock(() => {})}
        onViewAll={mock(() => {})}
      />,
    );

    expect(screen.getByText('2 active')).toBeInTheDocument();
    expect(screen.getByText('1 paused')).toBeInTheDocument();
    expect(screen.getByText('1 error')).toBeInTheDocument();
  });

  it('fires onCreate when New button is clicked', () => {
    const onCreate = mock(() => {});
    render(
      <WorkflowSchedulesSummaryBar
        schedules={[]}
        isLoading={false}
        onCreate={onCreate}
        onExpand={mock(() => {})}
        onViewAll={mock(() => {})}
      />,
    );

    fireEvent.click(screen.getByText('New'));
    expect(onCreate).toHaveBeenCalled();
  });

  it('fires onExpand when Manage button is clicked', () => {
    const onExpand = mock(() => {});
    render(
      <WorkflowSchedulesSummaryBar
        schedules={[]}
        isLoading={false}
        onCreate={mock(() => {})}
        onExpand={onExpand}
        onViewAll={mock(() => {})}
      />,
    );

    fireEvent.click(screen.getByText('Manage'));
    expect(onExpand).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// WorkflowSchedulesSidebar
// ---------------------------------------------------------------------------
describe('WorkflowSchedulesSidebar', () => {
  afterEach(() => {
    cleanup();
  });

  function createSidebarProps(overrides: Record<string, unknown> = {}) {
    return {
      schedules: [] as WorkflowSchedule[],
      isLoading: false,
      error: undefined as string | null | undefined,
      onClose: mock(() => {}),
      onCreate: mock(() => {}),
      onManage: mock(() => {}),
      onEdit: mock(() => {}),
      onAction: mock(() => Promise.resolve()),
      onDelete: mock(() => Promise.resolve()),
      ...overrides,
    };
  }

  it('renders Schedules title and count badge', () => {
    const schedules = [createSchedule(), createSchedule()];
    const props = createSidebarProps({ schedules });
    render(<WorkflowSchedulesSidebar {...props} />);

    expect(screen.getByText('Schedules')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  it('renders loading state', () => {
    const props = createSidebarProps({ isLoading: true });
    render(<WorkflowSchedulesSidebar {...props} />);

    expect(screen.getByText('Loading schedules…')).toBeInTheDocument();
  });

  it('renders error message', () => {
    const props = createSidebarProps({ error: 'Server error' });
    render(<WorkflowSchedulesSidebar {...props} />);

    expect(screen.getByText('Server error')).toBeInTheDocument();
  });

  it('renders empty state message when no schedules', () => {
    const props = createSidebarProps();
    render(<WorkflowSchedulesSidebar {...props} />);

    expect(
      screen.getByText('No schedules yet. Create one to run this workflow automatically.'),
    ).toBeInTheDocument();
  });

  it('renders schedule name and status badge', () => {
    const schedules = [createSchedule({ name: 'Nightly Scan', status: 'active' })];
    const props = createSidebarProps({ schedules });
    render(<WorkflowSchedulesSidebar {...props} />);

    // Name appears both in the label span and the tooltip content
    const nameElements = screen.getAllByText('Nightly Scan');
    expect(nameElements.length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('active')).toBeInTheDocument();
  });

  it('renders formatted next run time', () => {
    const schedules = [createSchedule({ nextRunAt: '2026-03-05T12:00:00Z' })];
    const props = createSidebarProps({ schedules });
    render(<WorkflowSchedulesSidebar {...props} />);

    expect(screen.getByText('Next: Formatted: 2026-03-05T12:00:00Z')).toBeInTheDocument();
  });

  it('renders schedule description when present', () => {
    const schedules = [createSchedule({ description: 'Runs every night at midnight' })];
    const props = createSidebarProps({ schedules });
    render(<WorkflowSchedulesSidebar {...props} />);

    expect(screen.getByText('Runs every night at midnight')).toBeInTheDocument();
  });

  it('fires onClose when close button is clicked', () => {
    const onClose = mock(() => {});
    const props = createSidebarProps({ onClose });
    render(<WorkflowSchedulesSidebar {...props} />);

    fireEvent.click(screen.getByLabelText('Close schedules panel'));
    expect(onClose).toHaveBeenCalled();
  });

  it('fires onCreate when New button is clicked', () => {
    const onCreate = mock(() => {});
    const props = createSidebarProps({ onCreate });
    render(<WorkflowSchedulesSidebar {...props} />);

    fireEvent.click(screen.getByText('New'));
    expect(onCreate).toHaveBeenCalled();
  });

  it('fires onManage when View page button is clicked', () => {
    const onManage = mock(() => {});
    const props = createSidebarProps({ onManage });
    render(<WorkflowSchedulesSidebar {...props} />);

    fireEvent.click(screen.getByText('View page'));
    expect(onManage).toHaveBeenCalled();
  });

  it('fires onEdit when edit button is clicked', () => {
    const schedule = createSchedule({ id: 'sched-99', name: 'Edit Me' });
    const onEdit = mock(() => {});
    const props = createSidebarProps({ schedules: [schedule], onEdit });
    render(<WorkflowSchedulesSidebar {...props} />);

    fireEvent.click(screen.getByLabelText('Edit schedule'));
    expect(onEdit).toHaveBeenCalledWith(schedule);
  });

  it('fires onDelete when delete button is clicked', () => {
    const schedule = createSchedule({ id: 'sched-del', name: 'Delete Me' });
    const onDelete = mock(() => Promise.resolve());
    const props = createSidebarProps({ schedules: [schedule], onDelete });
    render(<WorkflowSchedulesSidebar {...props} />);

    fireEvent.click(screen.getByLabelText('Delete schedule'));
    expect(onDelete).toHaveBeenCalledWith(schedule);
  });

  it('shows Pause action for active schedules', () => {
    const schedules = [createSchedule({ status: 'active' })];
    const props = createSidebarProps({ schedules });
    render(<WorkflowSchedulesSidebar {...props} />);

    expect(screen.getByLabelText('Pause')).toBeInTheDocument();
  });

  it('shows Resume action for paused schedules', () => {
    const schedules = [createSchedule({ status: 'paused' })];
    const props = createSidebarProps({ schedules });
    render(<WorkflowSchedulesSidebar {...props} />);

    expect(screen.getByLabelText('Resume')).toBeInTheDocument();
  });

  it('fires onAction with pause when Pause button is clicked on active schedule', async () => {
    const schedule = createSchedule({ status: 'active' });
    const onAction = mock(() => Promise.resolve());
    const props = createSidebarProps({ schedules: [schedule], onAction });
    render(<WorkflowSchedulesSidebar {...props} />);

    fireEvent.click(screen.getByLabelText('Pause'));
    await waitFor(() => {
      expect(onAction).toHaveBeenCalledWith(schedule, 'pause');
    });
  });

  it('fires onAction with run when Run now button is clicked', async () => {
    const schedule = createSchedule({ status: 'active' });
    const onAction = mock(() => Promise.resolve());
    const props = createSidebarProps({ schedules: [schedule], onAction });
    render(<WorkflowSchedulesSidebar {...props} />);

    fireEvent.click(screen.getByLabelText('Run now'));
    await waitFor(() => {
      expect(onAction).toHaveBeenCalledWith(schedule, 'run');
    });
  });
});
