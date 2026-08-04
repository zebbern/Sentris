import { afterEach, describe, expect, it, mock } from 'bun:test';
import { cleanup, fireEvent, screen } from '@testing-library/react';
import type {
  OperatorWorkflowApplyResult,
  OperatorWorkflowDraftDetail,
  OperatorWorkflowDraftResult,
  WorkflowGraph,
} from '@sentris/shared';

import { renderWithProviders } from '@/test/render-with-providers';

import { OperatorWorkflowDraftCard } from '../OperatorWorkflowDraftCard';

afterEach(cleanup);

const SESSION_ID = '041a0b9d-8ead-469c-868b-9f20cf4485c0';
const DRAFT_ID = '11111111-1111-4111-8111-111111111111';
const WORKFLOW_ID = '22222222-2222-4222-8222-222222222222';
const VERSION_ID = '33333333-3333-4333-8333-333333333333';
const ACTION_ID = '44444444-4444-4444-8444-444444444444';
const SOURCE_RUN_ID = 'sentris-run-source';

function graph(name: string, nodeLabel: string): WorkflowGraph {
  return {
    name,
    description: '',
    nodes: [
      {
        id: 'entry',
        type: 'core.workflow.entrypoint',
        position: { x: 0, y: 0 },
        data: {
          label: nodeLabel,
          config: { params: {}, inputOverrides: {} },
        },
      },
    ],
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
  };
}

function proposal(valid = true): OperatorWorkflowDraftResult {
  return {
    kind: 'workflow-draft',
    draftId: DRAFT_ID,
    mode: 'update',
    workflowId: WORKFLOW_ID,
    baseVersionId: VERSION_ID,
    name: 'NPM package investigation',
    digest: 'Add an AI review step after package metadata collection.',
    validation: {
      valid,
      errors: valid ? [] : ['Agent model credential is required'],
    },
    diff: {
      metadataChanged: [],
      successCriteriaChanged: false,
      addedNodeIds: ['agent'],
      removedNodeIds: [],
      changedNodeIds: [],
      addedEdgeIds: ['metadata-agent'],
      removedEdgeIds: [],
      changedEdgeIds: [],
    },
  };
}

function detail(result = proposal()): OperatorWorkflowDraftDetail {
  return {
    ...result,
    proposalActionId: ACTION_ID,
    sessionId: SESSION_ID,
    baseGraph: graph(result.name, 'Current entry'),
    proposedGraph: graph(result.name, 'Proposed entry'),
  };
}

describe('OperatorWorkflowDraftCard', () => {
  it('shows the durable graph comparison and dispatches Save version', () => {
    const result = proposal();
    const onApply = mock(() => {});

    renderWithProviders(
      <OperatorWorkflowDraftCard
        sessionId={SESSION_ID}
        result={result}
        detail={detail(result)}
        onApply={onApply}
      />,
    );

    expect(screen.getByText('Current')).toBeInTheDocument();
    expect(screen.getByText('Proposed')).toBeInTheDocument();
    expect(screen.getByText('Validated')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /open in builder/i })).toHaveAttribute(
      'href',
      `/workflows/${WORKFLOW_ID}?operatorSessionId=${SESSION_ID}&draftId=${DRAFT_ID}`,
    );

    fireEvent.click(screen.getByRole('button', { name: /save version/i }));
    expect(onApply).toHaveBeenCalledWith(result);
  });

  it('keeps invalid proposals reviewable but prevents saving them', () => {
    const result = proposal(false);

    renderWithProviders(
      <OperatorWorkflowDraftCard
        sessionId={SESSION_ID}
        result={result}
        detail={detail(result)}
        onApply={mock(() => {})}
      />,
    );

    expect(screen.getByText('Needs fixes')).toBeInTheDocument();
    expect(screen.getByText('Agent model credential is required')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /save version/i })).toBeDisabled();
    expect(screen.getByRole('link', { name: /open in builder/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /revise with operator/i })).toHaveAttribute(
      'href',
      `/operator/${SESSION_ID}?reviseDraftId=${DRAFT_ID}`,
    );
  });

  it('links an applied draft to its immutable saved workflow version', () => {
    const result: OperatorWorkflowApplyResult = {
      kind: 'workflow-applied',
      draftId: DRAFT_ID,
      workflowId: WORKFLOW_ID,
      versionId: VERSION_ID,
      version: 4,
      created: false,
      staged: false,
      name: 'NPM package investigation',
    };
    const onRunSavedVersion = mock(() => {});

    renderWithProviders(
      <OperatorWorkflowDraftCard
        sessionId={SESSION_ID}
        result={result}
        onApply={mock(() => {})}
        onRunSavedVersion={onRunSavedVersion}
      />,
    );

    expect(screen.getByText('Saved as v4')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /open workflow/i })).toHaveAttribute(
      'href',
      `/workflows/${WORKFLOW_ID}`,
    );
    fireEvent.click(screen.getByRole('button', { name: /run now/i }));
    expect(onRunSavedVersion).toHaveBeenCalledWith(result);
    expect(screen.queryByRole('button', { name: /run improved version/i })).not.toBeInTheDocument();
  });

  it('offers an explicit rerun for a saved improvement while preserving the source run', () => {
    const result: OperatorWorkflowApplyResult = {
      kind: 'workflow-applied',
      draftId: DRAFT_ID,
      workflowId: WORKFLOW_ID,
      versionId: VERSION_ID,
      version: 5,
      created: false,
      staged: true,
      name: 'NPM package investigation',
      sourceRunId: SOURCE_RUN_ID,
    };
    const onRunImprovedVersion = mock(() => {});

    const { rerender } = renderWithProviders(
      <OperatorWorkflowDraftCard
        sessionId={SESSION_ID}
        result={result}
        onApply={mock(() => {})}
        onRunImprovedVersion={onRunImprovedVersion}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /run improved version/i }));
    expect(onRunImprovedVersion).toHaveBeenCalledWith(result);

    rerender(
      <OperatorWorkflowDraftCard
        sessionId={SESSION_ID}
        result={result}
        disabled
        onApply={mock(() => {})}
        onRunImprovedVersion={onRunImprovedVersion}
      />,
    );
    expect(screen.getByRole('button', { name: /run improved version/i })).toBeDisabled();
  });

  it('replaces the proposal save action with a disabled Saved state after apply', () => {
    const onApply = mock(() => {});

    renderWithProviders(
      <OperatorWorkflowDraftCard
        sessionId={SESSION_ID}
        result={proposal()}
        detail={detail()}
        applied
        onApply={onApply}
      />,
    );

    expect(screen.getByRole('button', { name: 'Saved' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: /save version/i })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Saved' }));
    expect(onApply).not.toHaveBeenCalled();
  });
});
