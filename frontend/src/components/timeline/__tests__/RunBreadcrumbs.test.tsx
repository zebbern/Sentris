import { describe, it, expect, afterEach, mock } from 'bun:test';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { realModuleExports } from '@/test/restore-mocks';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockNavigate = mock(() => {});

mock.module('react-router-dom', () => ({
  ...realModuleExports('react-router-dom'),
  useNavigate: () => mockNavigate,
}));

let mockParentRunData: Record<string, unknown> | undefined = undefined;
let mockIsLoading = false;

mock.module('@/hooks/queries/useExecutionQueries', () => ({
  useExecutionRun: (_id: string | null) => ({
    data: mockParentRunData,
    isLoading: mockIsLoading,
  }),
}));

import { RunBreadcrumbs } from '../RunBreadcrumbs';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRun(
  overrides: Partial<{
    id: string;
    workflowId: string;
    workflowName: string;
    parentRunId: string | null;
    parentNodeRef: string | null;
  }> = {},
) {
  return {
    id: 'child-run-1',
    workflowId: 'wf-child',
    workflowName: 'Child Workflow',
    parentRunId: 'parent-run-1',
    parentNodeRef: null,
    ...overrides,
  };
}

function resetMocks() {
  mockParentRunData = undefined;
  mockIsLoading = false;
  mockNavigate.mockClear();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('RunBreadcrumbs', () => {
  afterEach(() => {
    cleanup();
    resetMocks();
  });

  it('returns null when run has no parentRunId', () => {
    const run = makeRun({ parentRunId: null });
    const { container } = render(<RunBreadcrumbs currentRun={run} />);

    expect(container.innerHTML).toBe('');
  });

  it('returns null when currentRun is null', () => {
    const { container } = render(<RunBreadcrumbs currentRun={null} />);

    expect(container.innerHTML).toBe('');
  });

  it('shows loading state while parent data is fetching', () => {
    mockIsLoading = true;
    const run = makeRun();
    render(<RunBreadcrumbs currentRun={run} />);

    expect(screen.getByText('loading...')).toBeTruthy();
  });

  it('shows parent workflow name when data is loaded (inline variant)', () => {
    mockParentRunData = {
      id: 'parent-run-1',
      workflowId: 'wf-parent',
      workflowName: 'Parent Workflow',
    };
    const run = makeRun();
    render(<RunBreadcrumbs currentRun={run} variant="inline" />);

    expect(screen.getByText('Sub-workflow of')).toBeTruthy();
    expect(screen.getByText('Parent Workflow')).toBeTruthy();
  });

  it('shows parent workflow name in floating variant', () => {
    mockParentRunData = {
      id: 'parent-run-1',
      workflowId: 'wf-parent',
      workflowName: 'Parent Workflow',
    };
    const run = makeRun();
    render(<RunBreadcrumbs currentRun={run} variant="floating" />);

    expect(screen.getByText('Child of')).toBeTruthy();
    expect(screen.getByText('Parent Workflow')).toBeTruthy();
  });

  it('navigates to parent run on click', () => {
    mockParentRunData = {
      id: 'parent-run-1',
      workflowId: 'wf-parent',
      workflowName: 'Parent Workflow',
    };
    const run = makeRun();
    render(<RunBreadcrumbs currentRun={run} />);

    fireEvent.click(screen.getByText('Parent Workflow'));
    expect(mockNavigate).toHaveBeenCalledWith('/workflows/wf-parent/runs/parent-run-1');
  });

  it('shows truncated run ID when parent data is not available', () => {
    mockParentRunData = undefined;
    mockIsLoading = false;
    const run = makeRun({ parentRunId: 'aaa-bbb-ccc-ddd-eee' });
    render(<RunBreadcrumbs currentRun={run} />);

    expect(screen.getByText('aaa-bbb-ccc')).toBeTruthy();
  });

  it('shows parentNodeRef when present (inline)', () => {
    mockParentRunData = {
      id: 'parent-run-1',
      workflowId: 'wf-parent',
      workflowName: 'Parent Workflow',
    };
    const run = makeRun({ parentNodeRef: 'sub-workflow-node' });
    render(<RunBreadcrumbs currentRun={run} variant="inline" />);

    expect(screen.getByText('sub-workflow-node')).toBeTruthy();
  });

  it('shows parentNodeRef when present (floating)', () => {
    mockParentRunData = {
      id: 'parent-run-1',
      workflowId: 'wf-parent',
      workflowName: 'Parent Workflow',
    };
    const run = makeRun({ parentNodeRef: 'agent-node-1' });
    render(<RunBreadcrumbs currentRun={run} variant="floating" />);

    expect(screen.getByText('agent-node-1')).toBeTruthy();
  });

  it('defaults to "Parent Workflow" when workflowName is missing', () => {
    mockParentRunData = {
      id: 'parent-run-1',
      workflowId: 'wf-parent',
    };
    const run = makeRun();
    render(<RunBreadcrumbs currentRun={run} />);

    expect(screen.getByText('Parent Workflow')).toBeTruthy();
  });
});
