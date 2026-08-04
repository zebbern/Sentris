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

  it('opens configure-and-run from a structured saved workflow list', () => {
    const onRunSavedWorkflow = mock(() => {});
    const workflowId = '22222222-2222-4222-8222-222222222222';
    const listAction: OperatorActionView = {
      ...pendingAction,
      id: 'list-workflows-action',
      commandName: 'list_workflows',
      effect: 'read',
      status: 'succeeded',
      approvalRequired: false,
      runId: null,
      arguments: { limit: 25 },
      result: [
        {
          id: workflowId,
          name: 'npm package investigation',
          description: 'Investigate one npm package',
          organizationId: 'organization-1',
          lastRun: null,
          latestRunStatus: null,
          runCount: 3,
          nodeCount: 8,
          createdAt: '2026-08-01T10:00:00.000Z',
          updatedAt: '2026-08-02T10:00:00.000Z',
          tags: ['npm'],
        },
      ],
    };

    renderWithProviders(
      <OperatorTimeline
        messages={[]}
        actions={[listAction]}
        isActive={false}
        onDecision={mock(() => {})}
        onRunSavedWorkflow={onRunSavedWorkflow}
      />,
      { initialEntries: ['/operator/session-1'] },
    );

    expect(screen.getByRole('link', { name: 'npm package investigation' })).toHaveAttribute(
      'href',
      `/workflows/${workflowId}`,
    );
    expect(screen.queryByText('Result')).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByRole('button', { name: 'Configure and run npm package investigation' }),
    );
    expect(onRunSavedWorkflow).toHaveBeenCalledWith({
      workflowId,
      name: 'npm package investigation',
    });
  });

  it('preserves the inspected immutable workflow version when configuring a run', () => {
    const onRunSavedWorkflow = mock(() => {});
    const workflowId = '22222222-2222-4222-8222-222222222222';
    const versionId = '33333333-3333-4333-8333-333333333333';
    const inspectionAction: OperatorActionView = {
      ...pendingAction,
      id: 'inspect-workflow-action',
      commandName: 'get_workflow',
      effect: 'read',
      status: 'succeeded',
      approvalRequired: false,
      runId: null,
      arguments: { workflowId, version: 4 },
      result: {
        id: workflowId,
        name: 'npm package investigation',
        description: 'Investigate one npm package',
        versionId,
        version: 4,
        runtimeInputs: [
          {
            id: 'packageSpec',
            label: 'npm package and optional version',
            type: 'text',
            required: true,
            hasDefaultValue: false,
          },
        ],
        nodeCount: 8,
        edgeCount: 7,
        editableGraph: null,
        credentialPlaceholder: '__SENTRIS_PRESERVE_CREDENTIAL__',
        nodes: [{ id: 'entry', type: 'core.workflow.entrypoint', label: 'Start' }],
      },
    };

    renderWithProviders(
      <OperatorTimeline
        messages={[]}
        actions={[inspectionAction]}
        isActive={false}
        onDecision={mock(() => {})}
        onRunSavedWorkflow={onRunSavedWorkflow}
      />,
      { initialEntries: ['/operator/session-1'] },
    );

    expect(screen.getByText('Version 4 · 8 nodes · 1 input')).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole('button', { name: 'Configure and run npm package investigation' }),
    );
    expect(onRunSavedWorkflow).toHaveBeenCalledWith({
      workflowId,
      name: 'npm package investigation',
      versionId,
      version: 4,
    });
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

  it('routes an invalid draft through the durable revision handoff', () => {
    const draftId = '11111111-1111-4111-8111-111111111111';
    const proposalAction: OperatorActionView = {
      ...pendingAction,
      id: 'invalid-proposal-action',
      commandName: 'propose_workflow_draft',
      status: 'succeeded',
      approvalRequired: false,
      result: {
        kind: 'workflow-draft',
        draftId,
        mode: 'create',
        workflowId: null,
        baseVersionId: null,
        name: 'Invalid workflow',
        digest: 'invalid-digest',
        validation: { valid: false, errors: ['entry.output cannot connect to scanner.input'] },
        diff: {
          metadataChanged: ['name'],
          addedNodeIds: ['entry', 'scanner'],
          removedNodeIds: [],
          changedNodeIds: [],
          addedEdgeIds: ['entry-scanner'],
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

    expect(screen.getByRole('link', { name: /revise with operator/i })).toHaveAttribute(
      'href',
      `/operator/session-1?reviseDraftId=${draftId}`,
    );
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

  it('renders a structured run comparison and offers revision of the candidate', () => {
    const onRunCommand = mock(() => {});
    const comparisonAction: OperatorActionView = {
      ...pendingAction,
      id: 'compare-action',
      commandName: 'compare_runs',
      effect: 'read',
      status: 'succeeded',
      approvalRequired: false,
      runId: null,
      arguments: {
        sourceRunId: 'sentris-run-source',
        candidateRunId: 'sentris-run-candidate',
      },
      result: {
        kind: 'run-comparison',
        assessment: 'improved',
        comparable: true,
        source: {
          runId: 'sentris-run-source',
          workflowId: '22222222-2222-4222-8222-222222222222',
          workflowVersionId: '33333333-3333-4333-8333-333333333333',
          status: 'FAILED',
          durationMs: 10_000,
          trace: { availability: 'available', failedEventCount: 2 },
          findings: { availability: 'available', total: 1 },
        },
        candidate: {
          runId: 'sentris-run-candidate',
          workflowId: '22222222-2222-4222-8222-222222222222',
          workflowVersionId: '44444444-4444-4444-8444-444444444444',
          status: 'COMPLETED',
          durationMs: 8_000,
          trace: { availability: 'available', failedEventCount: 0 },
          findings: { availability: 'available', total: 2 },
        },
        changes: {
          statusChanged: true,
          failedEventCountDelta: -2,
          findingTotalDelta: 1,
          durationDeltaMs: -2_000,
        },
        successCriteria: {
          benchmarkVersionId: '44444444-4444-4444-8444-444444444444',
          criteria: [
            {
              criterion: {
                id: 'report',
                title: 'Produces an investigation report',
                kind: 'output_assertion',
                nodeRef: 'agent',
                path: '/report',
                operator: 'not_empty',
              },
              source: { outcome: 'failed', message: 'The declared output was empty' },
              candidate: {
                outcome: 'passed',
                message: 'The declared output was not empty',
              },
              assessment: 'improved',
            },
          ],
        },
        caveats: ['Finding and duration changes are observations, not proof of workflow quality.'],
      },
    };

    renderWithProviders(
      <OperatorTimeline
        messages={[]}
        actions={[comparisonAction]}
        isActive={false}
        onDecision={mock(() => {})}
        onRunCommand={onRunCommand}
      />,
      { initialEntries: ['/operator/session-1'] },
    );

    expect(screen.getAllByText('Improved')).toHaveLength(2);
    expect(screen.getByText('Failure events')).toBeInTheDocument();
    expect(screen.getByText('-2')).toBeInTheDocument();
    expect(screen.getByText('Declared success criteria')).toBeInTheDocument();
    expect(screen.getByText('Produces an investigation report')).toBeInTheDocument();
    expect(screen.getByText('Source failed → Candidate passed')).toBeInTheDocument();
    expect(screen.queryByText(/"kind": "run-comparison"/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Keep candidate' }));
    expect(onRunCommand).toHaveBeenCalledWith({
      message:
        'Keep candidate workflow version 44444444-4444-4444-8444-444444444444 from run sentris-run-candidate',
      directCommand: {
        commandName: 'promote_workflow_version',
        arguments: {
          workflowId: '22222222-2222-4222-8222-222222222222',
          versionId: '44444444-4444-4444-8444-444444444444',
          baseVersionId: '33333333-3333-4333-8333-333333333333',
          candidateRunId: 'sentris-run-candidate',
        },
      },
    });
    onRunCommand.mockClear();

    fireEvent.click(screen.getByRole('button', { name: 'Revise again' }));
    expect(onRunCommand).toHaveBeenCalledWith({
      message:
        'Try another evidence-based improvement from candidate run sentris-run-candidate, then rerun and compare it.',
      journey: { kind: 'improve_run', sourceRunId: 'sentris-run-candidate' },
    });
  });

  it('renders recorded run evidence with deterministic finding and artifact actions', () => {
    const onRunCommand = mock(() => {});
    const runId = 'sentris-run-evidence';
    const findingId = 'fo_v1_operator-evidence';
    const inspectionAction: OperatorActionView = {
      ...pendingAction,
      id: 'inspection-action',
      commandName: 'get_run',
      effect: 'read',
      status: 'succeeded',
      approvalRequired: false,
      runId: null,
      arguments: { runId },
      result: {
        run: {
          id: runId,
          workflowId: '22222222-2222-4222-8222-222222222222',
          status: 'COMPLETED',
        },
        status: { status: 'COMPLETED' },
        terminal: true,
        diagnostics: {
          trace: { availability: 'available', totalEvents: 12, failedEventCount: 1 },
          findings: {
            availability: 'available',
            total: 1,
            items: [{ id: findingId, name: 'Exposed package token', severity: 'high' }],
          },
          artifacts: {
            availability: 'available',
            total: 1,
            items: [
              {
                id: '77777777-7777-4777-8777-777777777777',
                runId,
                workflowId: '22222222-2222-4222-8222-222222222222',
                workflowVersionId: '33333333-3333-4333-8333-333333333333',
                componentRef: 'report',
                fileId: '88888888-8888-4888-8888-888888888888',
                name: 'report.json',
                mimeType: 'application/json',
                size: 512,
                destinations: ['run'],
                createdAt: '2026-08-02T10:01:00.000Z',
              },
            ],
          },
        },
      },
    };
    const summaryMessage: OperatorMessageView = {
      id: 'summary-message',
      sessionId: 'session-1',
      turnId: inspectionAction.turnId,
      sequence: 3,
      role: 'assistant',
      content: 'The run completed with one finding and one artifact.',
      createdAt: '2026-08-02T10:00:02.000Z',
    };

    renderWithProviders(
      <OperatorTimeline
        messages={[summaryMessage]}
        actions={[inspectionAction]}
        isActive={false}
        onDecision={mock(() => {})}
        onRunCommand={onRunCommand}
      />,
      { initialEntries: ['/operator/session-1'] },
    );

    expect(screen.getByRole('region', { name: 'Recorded run results' })).toBeInTheDocument();
    expect(screen.getByText('Exposed package token')).toBeInTheDocument();
    expect(screen.getByText('report.json')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /view all/i })).toHaveAttribute(
      'href',
      `/findings?runId=${runId}`,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Inspect' }));
    expect(onRunCommand).toHaveBeenCalledWith({
      message: `Inspect finding ${findingId}`,
      directCommand: {
        commandName: 'get_finding',
        arguments: { findingId },
      },
    });
  });
});
