import { afterEach, describe, expect, it, mock } from 'bun:test';
import { cleanup, render, screen } from '@testing-library/react';

let mockSelectedNodeId: string | null = null;
const mockSelectNode = mock((_nodeId: string | null) => {});
const mockSetInspectorTab = mock((_tab: string) => {});

mock.module('@/store/executionTimelineStore', () => ({
  useExecutionTimelineStore: (selector: any) =>
    selector({
      selectedNodeId: mockSelectedNodeId,
      selectNode: mockSelectNode,
      events: [],
    }),
}));

mock.module('@/store/workflowUiStore', () => ({
  useWorkflowUiStore: (selector: any) =>
    selector({
      setInspectorTab: mockSetInspectorTab,
    }),
}));

mock.module('@/hooks/useWorkflowExecution', () => ({
  useWorkflowExecution: () => ({ runId: null, status: null }),
}));

mock.module('@/hooks/queries/useRunQueries', () => ({
  getRunByIdFromCache: () => ({ status: 'COMPLETED' }),
}));

mock.module('@/hooks/queries/useExecutionQueries', () => ({
  useExecutionResult: () => ({
    data: { result: { outputs: {} } },
    isLoading: false,
    error: null,
    refetch: mock(async () => undefined),
  }),
  useExecutionNodeIO: () => ({
    data: {
      nodes: [
        {
          nodeRef: 'claude_hunter',
          componentId: 'core.ai.claude-code',
          outputs: {
            report: '{"title":"Unbounded TIFF IFD recursion","severity":"high"}',
            rawOutput: '',
          },
          inputs: {
            task: 'Review utif2 for CVE-worthy issues',
          },
        },
      ],
    },
  }),
}));

const { AgentTracePanel } = await import('../AgentTracePanel');

describe('AgentTracePanel', () => {
  afterEach(() => {
    cleanup();
    mockSelectedNodeId = null;
    mockSelectNode.mockClear();
    mockSetInspectorTab.mockClear();
  });

  it('shows stored Claude Code node reports when no replayable agent run id exists', () => {
    render(<AgentTracePanel runId="run-1" />);

    expect(screen.getByText('claude_hunter')).toBeTruthy();
    expect(screen.getByText('Stored Claude Code output')).toBeTruthy();
    expect(screen.getByText('Agent Prompt')).toBeTruthy();
    expect(screen.getByText('Review utif2 for CVE-worthy issues')).toBeTruthy();
    expect(screen.getByText('Final Answer')).toBeTruthy();
    expect(
      screen.getByText('{"title":"Unbounded TIFF IFD recursion","severity":"high"}'),
    ).toBeTruthy();
  });
});
