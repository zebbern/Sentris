import { beforeEach, describe, expect, it, mock } from 'bun:test';
import type { components } from '@sentris/backend-client';

const updateWorkflow = mock(async (_id: string, _body: unknown) => ({
  data: { id: 'workflow-1' },
}));

mock.module('@/services/api/client', () => ({
  apiClient: { updateWorkflow },
  getAuthHeaders: async () => ({}),
  API_V1_URL: 'http://localhost:3211/api/v1',
}));

const { workflowsApi } = await import('../workflows');

type UpdateWorkflowRequest = components['schemas']['UpdateWorkflowRequestDto'];

const graph: UpdateWorkflowRequest = {
  name: 'Operator update',
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

beforeEach(() => {
  updateWorkflow.mockClear();
});

describe('workflowsApi.update', () => {
  it('adds the optional expected version to the update request body', async () => {
    const expectedVersionId = '11111111-1111-4111-8111-111111111111';

    await workflowsApi.update('workflow-1', graph, { expectedVersionId });

    expect(updateWorkflow).toHaveBeenCalledWith('workflow-1', {
      ...graph,
      expectedVersionId,
    });
  });
});
