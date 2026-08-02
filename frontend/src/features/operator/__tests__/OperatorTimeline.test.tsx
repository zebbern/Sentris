import { afterEach, describe, expect, it, mock } from 'bun:test';
import { cleanup, fireEvent, screen } from '@testing-library/react';
import type { OperatorActionView, OperatorMessageView } from '@sentris/shared';

import { renderWithProviders } from '@/test/render-with-providers';

import { OperatorTimeline } from '../OperatorTimeline';

afterEach(cleanup);

const messages: OperatorMessageView[] = [
  {
    id: 'message-1',
    sessionId: 'session-1',
    turnId: 'turn-1',
    sequence: 1,
    role: 'user',
    content: 'Cancel the current run',
    createdAt: '2026-08-02T10:00:00.000Z',
  },
  {
    id: 'message-2',
    sessionId: 'session-1',
    turnId: 'turn-1',
    sequence: 2,
    role: 'assistant',
    content: 'I found the active run.',
    createdAt: '2026-08-02T10:00:01.000Z',
  },
];

const pendingAction: OperatorActionView = {
  id: 'action-1',
  sessionId: 'session-1',
  turnId: 'turn-1',
  toolCallId: 'tool-1',
  commandName: 'cancel_run',
  effect: 'consequential',
  approvalMode: 'ask',
  approvalRequired: true,
  status: 'pending_approval',
  version: 4,
  arguments: { runId: 'sentris-run-1' },
  result: null,
  error: null,
  runId: 'sentris-run-1',
  createdAt: '2026-08-02T10:00:00.500Z',
  decidedAt: null,
  completedAt: null,
};

describe('OperatorTimeline', () => {
  it('renders durable messages, approval controls, and a linked run', () => {
    const onDecision = mock(() => {});

    renderWithProviders(
      <OperatorTimeline
        messages={messages}
        actions={[pendingAction]}
        isActive
        onDecision={onDecision}
      />,
      { initialEntries: ['/operator/session-1'] },
    );

    expect(screen.getByText('Cancel the current run')).toBeInTheDocument();
    expect(screen.getByText('I found the active run.')).toBeInTheDocument();
    expect(screen.getByText('Needs approval')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /workflow run/i })).toHaveAttribute(
      'href',
      '/runs/sentris-run-1',
    );
    expect(screen.getByText('Operator is working')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    expect(onDecision).toHaveBeenCalledWith(pendingAction, 'approved');

    fireEvent.click(screen.getByRole('button', { name: 'Reject' }));
    expect(onDecision).toHaveBeenCalledWith(pendingAction, 'rejected');
  });

  it('disables the proposal save action after a succeeded apply for the same draft', () => {
    const draftId = '11111111-1111-4111-8111-111111111111';
    const proposalAction: OperatorActionView = {
      ...pendingAction,
      id: 'proposal-action',
      commandName: 'propose_workflow_draft',
      status: 'succeeded',
      approvalRequired: false,
      result: {
        kind: 'workflow-draft',
        draftId,
        mode: 'create',
        workflowId: null,
        baseVersionId: null,
        name: 'Operator workflow',
        digest: 'Create a workflow',
        validation: { valid: true, errors: [] },
        diff: {
          metadataChanged: ['name'],
          addedNodeIds: ['entry'],
          removedNodeIds: [],
          changedNodeIds: [],
          addedEdgeIds: [],
          removedEdgeIds: [],
          changedEdgeIds: [],
        },
      },
    };
    const applyAction: OperatorActionView = {
      ...pendingAction,
      id: 'apply-action',
      commandName: 'apply_workflow_draft',
      status: 'succeeded',
      approvalRequired: false,
      result: {
        kind: 'workflow-applied',
        draftId,
        workflowId: '22222222-2222-4222-8222-222222222222',
        versionId: '33333333-3333-4333-8333-333333333333',
        version: 1,
        created: true,
        name: 'Operator workflow',
      },
    };

    renderWithProviders(
      <OperatorTimeline
        messages={[]}
        actions={[proposalAction, applyAction]}
        isActive={false}
        onDecision={mock(() => {})}
      />,
      { initialEntries: ['/operator/session-1'] },
    );

    expect(screen.getByRole('button', { name: 'Saved' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: /save version/i })).not.toBeInTheDocument();
  });

  it('renders a compact edit proposal through the existing draft review card', () => {
    const draftId = '11111111-1111-4111-8111-111111111111';
    const proposalAction: OperatorActionView = {
      ...pendingAction,
      id: 'edit-proposal-action',
      commandName: 'propose_workflow_edits',
      status: 'succeeded',
      approvalRequired: false,
      arguments: {
        workflowId: '22222222-2222-4222-8222-222222222222',
        baseVersionId: '33333333-3333-4333-8333-333333333333',
        operations: [
          {
            operation: 'patch_node',
            nodeId: 'agent',
            setParameters: { modelId: 'gemini-2.5-pro' },
          },
        ],
      },
      result: {
        kind: 'workflow-draft',
        draftId,
        mode: 'update',
        workflowId: '22222222-2222-4222-8222-222222222222',
        baseVersionId: '33333333-3333-4333-8333-333333333333',
        name: 'Operator workflow',
        digest: 'edit-digest',
        validation: { valid: true, errors: [] },
        diff: {
          metadataChanged: [],
          addedNodeIds: [],
          removedNodeIds: [],
          changedNodeIds: ['agent'],
          addedEdgeIds: [],
          removedEdgeIds: [],
          changedEdgeIds: [],
        },
      },
    };

    renderWithProviders(
      <OperatorTimeline
        messages={[]}
        actions={[proposalAction]}
        isActive={false}
        onDecision={mock(() => {})}
      />,
      { initialEntries: ['/operator/session-1'] },
    );

    expect(screen.getByText('Draft workflow edits')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /save version/i })).toBeEnabled();
  });

  it('starts the saved improved version with the original run inputs only after a click', () => {
    const onRunCommand = mock(() => {});
    const sourceRunId = 'sentris-run-source';
    const workflowId = '22222222-2222-4222-8222-222222222222';
    const versionId = '33333333-3333-4333-8333-333333333333';
    const applyAction: OperatorActionView = {
      ...pendingAction,
      id: 'apply-improvement-action',
      commandName: 'apply_workflow_draft',
      status: 'succeeded',
      approvalRequired: false,
      result: {
        kind: 'workflow-applied',
        draftId: '11111111-1111-4111-8111-111111111111',
        workflowId,
        versionId,
        version: 2,
        created: false,
        name: 'Improved workflow',
        sourceRunId,
      },
    };

    renderWithProviders(
      <OperatorTimeline
        messages={[]}
        actions={[applyAction]}
        isActive={false}
        onDecision={mock(() => {})}
        onRunCommand={onRunCommand}
      />,
      { initialEntries: ['/operator/session-1'] },
    );

    expect(onRunCommand).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /run improved version/i }));
    expect(onRunCommand).toHaveBeenCalledWith({
      message: `Run improved workflow version ${versionId} using inputs from run ${sourceRunId}`,
      directCommand: {
        commandName: 'run_workflow',
        arguments: { workflowId, versionId, sourceRunId, inputs: {} },
      },
    });
  });
});
