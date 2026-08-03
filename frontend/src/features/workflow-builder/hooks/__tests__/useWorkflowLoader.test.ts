import { describe, expect, it } from 'bun:test';
import type { OperatorWorkflowDraftDetail, WorkflowGraph } from '@sentris/shared';

import { getOperatorDraftTargetError } from '../useWorkflowLoader';
import {
  materializeOperatorDraftGraph,
  OPERATOR_CREDENTIAL_PLACEHOLDER,
} from '../../operatorDraftHydration';

const WORKFLOW_ID = '22222222-2222-4222-8222-222222222222';
const VERSION_ID = '33333333-3333-4333-8333-333333333333';

const graph: WorkflowGraph = {
  name: 'Draft workflow',
  description: '',
  nodes: [
    {
      id: 'entry',
      type: 'core.workflow.entrypoint',
      position: { x: 0, y: 0 },
      data: { label: 'Entry point', config: { params: {}, inputOverrides: {} } },
    },
  ],
  edges: [],
  viewport: { x: 0, y: 0, zoom: 1 },
};

function draft(overrides: Partial<OperatorWorkflowDraftDetail> = {}): OperatorWorkflowDraftDetail {
  return {
    kind: 'workflow-draft',
    draftId: '11111111-1111-4111-8111-111111111111',
    proposalActionId: '44444444-4444-4444-8444-444444444444',
    sessionId: '55555555-5555-4555-8555-555555555555',
    mode: 'update',
    workflowId: WORKFLOW_ID,
    baseVersionId: VERSION_ID,
    name: graph.name,
    digest: 'Add one step',
    validation: { valid: true, errors: [] },
    diff: {
      metadataChanged: [],
      successCriteriaChanged: false,
      addedNodeIds: [],
      removedNodeIds: [],
      changedNodeIds: [],
      addedEdgeIds: [],
      removedEdgeIds: [],
      changedEdgeIds: [],
    },
    proposedGraph: graph,
    baseGraph: graph,
    ...overrides,
  };
}

describe('Operator draft Builder target validation', () => {
  it('accepts a reload-safe update draft only for its exact target and base version', () => {
    expect(
      getOperatorDraftTargetError(draft(), {
        id: WORKFLOW_ID,
        isNewWorkflow: false,
        currentVersionId: VERSION_ID,
      }),
    ).toBeNull();
  });

  it('rejects an update draft when the saved workflow advanced after proposal', () => {
    expect(
      getOperatorDraftTargetError(draft(), {
        id: WORKFLOW_ID,
        isNewWorkflow: false,
        currentVersionId: '66666666-6666-4666-8666-666666666666',
      }),
    ).toContain('changed since this draft was proposed');
  });

  it('accepts a create draft on /workflows/new and rejects it on another workflow', () => {
    const createDraft = draft({
      mode: 'create',
      workflowId: null,
      baseVersionId: null,
      baseGraph: null,
    });

    expect(getOperatorDraftTargetError(createDraft, { id: 'new', isNewWorkflow: true })).toBeNull();
    expect(
      getOperatorDraftTargetError(createDraft, {
        id: WORKFLOW_ID,
        isNewWorkflow: false,
        currentVersionId: VERSION_ID,
      }),
    ).toContain('does not belong');
  });
});

describe('Operator draft Builder credential hydration', () => {
  it('restores update placeholders from the matching persisted node before editing', () => {
    const base = {
      ...graph,
      nodes: graph.nodes.map((node) => ({
        ...node,
        data: {
          ...node.data,
          config: { params: { apiKey: 'saved-key' }, inputOverrides: {} },
        },
      })),
    };
    const proposed = {
      ...graph,
      nodes: graph.nodes.map((node) => ({
        ...node,
        data: {
          ...node.data,
          config: {
            params: { apiKey: OPERATOR_CREDENTIAL_PLACEHOLDER, prompt: 'Review package' },
            inputOverrides: {},
          },
        },
      })),
    };

    const materialized = materializeOperatorDraftGraph(proposed, base, 'update');

    expect(materialized.nodes[0].data.config.params).toEqual({
      apiKey: 'saved-key',
      prompt: 'Review package',
    });
    expect(JSON.stringify(materialized)).not.toContain(OPERATOR_CREDENTIAL_PLACEHOLDER);
  });

  it('keeps create credentials empty and rejects inline credential values', () => {
    const withCredential = (apiKey: string): WorkflowGraph => ({
      ...graph,
      nodes: graph.nodes.map((node) => ({
        ...node,
        data: {
          ...node.data,
          config: { params: { apiKey }, inputOverrides: {} },
        },
      })),
    });

    const materialized = materializeOperatorDraftGraph(
      withCredential(OPERATOR_CREDENTIAL_PLACEHOLDER),
      null,
      'create',
    );
    expect(materialized.nodes[0].data.config.params.apiKey).toBe('');
    expect(() =>
      materializeOperatorDraftGraph(withCredential('inline-key'), null, 'create'),
    ).toThrow('cannot contain inline credentials');
  });

  it('rejects an update placeholder without a persisted base credential', () => {
    const proposed: WorkflowGraph = {
      ...graph,
      nodes: graph.nodes.map((node) => ({
        ...node,
        data: {
          ...node.data,
          config: {
            params: { apiKey: OPERATOR_CREDENTIAL_PLACEHOLDER },
            inputOverrides: {},
          },
        },
      })),
    };

    expect(() => materializeOperatorDraftGraph(proposed, graph, 'update')).toThrow(
      'has no saved base value',
    );
  });

  it('does not restore credentials across a component type change', () => {
    const base = {
      ...graph,
      nodes: graph.nodes.map((node) => ({
        ...node,
        data: {
          ...node.data,
          config: { params: { apiKey: 'saved-key' }, inputOverrides: {} },
        },
      })),
    };
    const proposed = {
      ...graph,
      nodes: graph.nodes.map((node) => ({
        ...node,
        type: 'core.http.request',
        data: {
          ...node.data,
          config: {
            params: { apiKey: OPERATOR_CREDENTIAL_PLACEHOLDER },
            inputOverrides: {},
          },
        },
      })),
    };

    expect(() => materializeOperatorDraftGraph(proposed, base, 'update')).toThrow(
      'has no saved base value',
    );
  });

  it('does not reintroduce an omitted generic credential field', () => {
    const base = {
      ...graph,
      nodes: graph.nodes.map((node) => ({
        ...node,
        data: {
          ...node.data,
          config: { params: { apiKey: 'saved-key', prompt: 'Old' }, inputOverrides: {} },
        },
      })),
    };
    const proposed = {
      ...graph,
      nodes: graph.nodes.map((node) => ({
        ...node,
        data: {
          ...node.data,
          config: { params: { prompt: 'Updated' }, inputOverrides: {} },
        },
      })),
    };

    const materialized = materializeOperatorDraftGraph(proposed, base, 'update');

    expect(materialized.nodes[0].data.config.params).toEqual({ prompt: 'Updated' });
  });
});
