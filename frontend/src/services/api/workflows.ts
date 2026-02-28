import type { components } from '@shipsec/backend-client';
import { apiClient, getAuthHeaders, API_V1_URL, type ApiResponse } from './client';

type WorkflowResponseDto = components['schemas']['WorkflowResponseDto'];
type CreateWorkflowRequestDto = components['schemas']['CreateWorkflowRequestDto'];
type UpdateWorkflowRequestDto = components['schemas']['UpdateWorkflowRequestDto'];
type WorkflowVersionResponse = components['schemas']['WorkflowVersionResponseDto'];

export interface WorkflowSummary {
  id: string;
  name: string;
  description: string | null;
  organizationId: string | null;
  isSystem: boolean;
  templateId: string | null;
  lastRun: string | null;
  latestRunStatus: string | null;
  runCount: number;
  nodeCount: number;
  createdAt: string;
  updatedAt: string;
}

export const workflowsApi = {
  list: async (): Promise<WorkflowResponseDto[]> => {
    const response = await apiClient.listWorkflows();
    if (response.error) throw new Error('Failed to fetch workflows');
    return response.data || [];
  },

  listSummary: async (): Promise<WorkflowSummary[]> => {
    const headers = await getAuthHeaders();
    const response = await fetch(`${API_V1_URL}/workflows/summary`, { headers });
    if (!response.ok) throw new Error('Failed to fetch workflow summaries');
    return response.json();
  },

  get: async (id: string): Promise<WorkflowResponseDto> => {
    const response = await apiClient.getWorkflow(id);
    if (response.error) throw new Error('Failed to fetch workflow');
    if (!response.data) throw new Error('Workflow not found');
    return response.data;
  },

  getVersion: async (workflowId: string, versionId: string): Promise<WorkflowVersionResponse> => {
    const response = await apiClient.getWorkflowVersion(workflowId, versionId);
    if (response.error || !response.data) {
      throw new Error('Failed to fetch workflow version');
    }
    return response.data;
  },

  getRuntimeInputs: async (workflowId: string) => {
    const response = await apiClient.getWorkflowRuntimeInputs(workflowId);
    if (response.error || !response.data) {
      throw new Error('Failed to fetch workflow runtime inputs');
    }
    return response.data;
  },

  create: async (workflow: CreateWorkflowRequestDto): Promise<WorkflowResponseDto> => {
    const response = (await apiClient.createWorkflow(workflow)) as ApiResponse<WorkflowResponseDto>;
    if (response.error) {
      const err = response.error;
      const errorMessage =
        typeof err === 'object' && err.message
          ? err.message
          : typeof err === 'string'
            ? err
            : 'Failed to create workflow';
      throw new Error(errorMessage);
    }
    if (!response.data) throw new Error('Workflow creation failed');
    return response.data;
  },

  update: async (id: string, workflow: UpdateWorkflowRequestDto): Promise<WorkflowResponseDto> => {
    const response = (await apiClient.updateWorkflow(
      id,
      workflow,
    )) as ApiResponse<WorkflowResponseDto>;
    if (response.error) {
      const err = response.error;
      const errorMessage =
        typeof err === 'object' && err.message
          ? err.message
          : typeof err === 'string'
            ? err
            : 'Failed to update workflow';
      throw new Error(errorMessage);
    }
    if (!response.data) throw new Error('Workflow update failed');
    return response.data;
  },

  updateMetadata: async (
    id: string,
    metadata: { name: string; description?: string | null },
  ): Promise<WorkflowResponseDto> => {
    const response = await apiClient.updateWorkflowMetadata(id, metadata);
    if (response.error) throw new Error('Failed to update workflow metadata');
    if (!response.data) throw new Error('Workflow update failed');
    return response.data;
  },

  delete: async (id: string): Promise<void> => {
    const response = await apiClient.deleteWorkflow(id);
    if (response.error) throw new Error('Failed to delete workflow');
  },

  commit: async (id: string) => {
    const response: any = await apiClient.commitWorkflow(id);
    if (response.error) {
      const message = response.error?.message || 'Failed to commit workflow';
      throw new Error(message);
    }
    return response.data;
  },

  run: async (id: string, body?: { inputs?: Record<string, unknown> }) => {
    const response: any = await apiClient.runWorkflow(id, body);
    if (response.error) {
      const message = response.error?.message || 'Failed to run workflow';
      throw new Error(message);
    }
    return response.data;
  },
};
