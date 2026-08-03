import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import type { Node as ReactFlowNode } from '@xyflow/react';

import type { FrontendNodeData } from '@/schemas/node';

const update = mock(async () => ({
  id: 'workflow-1',
  name: 'Operator rename',
  description: '',
  currentVersionId: '22222222-2222-4222-8222-222222222222',
  currentVersion: 2,
  graph: { successCriteria: [] },
}));
const updateMetadata = mock(async () => ({ id: 'workflow-1' }));

mock.module('@/services/api', () => ({
  API_BASE_URL: 'http://localhost:3211',
  api: {
    workflows: {
      create: mock(async () => ({})),
      update,
      updateMetadata,
    },
  },
}));

mock.module('@/features/analytics/events', () => ({
  Events: { WorkflowCreated: 'workflow.created', WorkflowSaved: 'workflow.saved' },
  track: mock(() => {}),
}));

const { useDesignWorkflowPersistence } = await import('../useDesignWorkflowPersistence');

const BASE_VERSION_ID = '11111111-1111-4111-8111-111111111111';
const node: ReactFlowNode<FrontendNodeData> = {
  id: 'entry',
  type: 'workflow',
  position: { x: 0, y: 0 },
  data: {
    label: 'Entry point',
    componentId: 'core.workflow.entrypoint',
    componentSlug: 'core.workflow.entrypoint',
    config: { params: {}, inputOverrides: {} },
    inputs: {},
    status: 'idle',
  },
};

beforeEach(() => {
  update.mockClear();
  updateMetadata.mockClear();
});

afterEach(cleanup);

describe('useDesignWorkflowPersistence Operator version fence', () => {
  it('uses the full versioned update for metadata-only drafts and clears draft context on success', async () => {
    const onExpectedVersionSaveSuccess = mock(() => {});
    const common = {
      canManageWorkflows: true,
      isNewWorkflow: false,
      designNodes: [node],
      designEdges: [],
      designNodesRef: { current: [node] },
      designEdgesRef: { current: [] },
      designSavedSnapshotRef: { current: null },
      markDirty: mock(() => {}),
      markClean: mock(() => {}),
      setWorkflowId: mock(() => {}),
      setMetadata: mock(() => {}),
      navigate: mock(() => {}),
      toast: mock(() => {}),
      computeGraphSignature: () => 'unchanged-graph',
      expectedVersionId: BASE_VERSION_ID,
      onExpectedVersionSaveSuccess,
    };

    const { result, rerender } = renderHook(
      ({ name, isDirty }: { name: string; isDirty: boolean }) =>
        useDesignWorkflowPersistence({
          ...common,
          isDirty,
          metadata: {
            id: 'workflow-1',
            name,
            description: '',
            currentVersionId: BASE_VERSION_ID,
            currentVersion: 1,
            successCriteria: [],
          },
        }),
      { initialProps: { name: 'Base workflow', isDirty: false } },
    );

    await waitFor(() => expect(result.current.lastSavedMetadata?.name).toBe('Base workflow'));
    rerender({ name: 'Operator rename', isDirty: true });
    await waitFor(() => expect(result.current.hasMetadataChanges).toBe(true));

    await act(async () => {
      await result.current.handleSave(false);
    });

    expect(updateMetadata).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith(
      'workflow-1',
      expect.objectContaining({ name: 'Operator rename' }),
      { expectedVersionId: BASE_VERSION_ID },
    );
    expect(onExpectedVersionSaveSuccess).toHaveBeenCalledTimes(1);
  });

  it('persists success criteria by creating a workflow version', async () => {
    const common = {
      canManageWorkflows: true,
      isNewWorkflow: false,
      designNodes: [node],
      designEdges: [],
      designNodesRef: { current: [node] },
      designEdgesRef: { current: [] },
      designSavedSnapshotRef: { current: null },
      markDirty: mock(() => {}),
      markClean: mock(() => {}),
      setWorkflowId: mock(() => {}),
      setMetadata: mock(() => {}),
      navigate: mock(() => {}),
      toast: mock(() => {}),
      computeGraphSignature: () => 'unchanged-graph',
    };
    const criterion = {
      id: 'findings',
      title: 'Produces findings',
      kind: 'finding_count' as const,
      minimum: 1,
    };
    const { result, rerender } = renderHook(
      ({ successCriteria, isDirty }) =>
        useDesignWorkflowPersistence({
          ...common,
          isDirty,
          metadata: {
            id: 'workflow-1',
            name: 'Base workflow',
            description: '',
            currentVersionId: BASE_VERSION_ID,
            currentVersion: 1,
            successCriteria,
          },
        }),
      { initialProps: { successCriteria: [] as (typeof criterion)[], isDirty: false } },
    );

    await waitFor(() => expect(result.current.lastSavedMetadata?.successCriteria).toEqual([]));
    rerender({ successCriteria: [criterion], isDirty: true });
    await act(async () => {
      await result.current.handleSave(false);
    });

    expect(updateMetadata).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith(
      'workflow-1',
      expect.objectContaining({ successCriteria: [criterion] }),
      { expectedVersionId: undefined },
    );
  });
});
