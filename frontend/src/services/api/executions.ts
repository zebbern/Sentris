import type { RunArtifactsResponse } from '@sentris/shared';
import { apiClient, getAuthHeaders, API_BASE_URL, API_V1_URL, type ApiResponse } from './client';

export interface TerminalChunkResponse {
  runId: string;
  cursor?: string;
  chunks: {
    nodeRef: string;
    stream: string;
    chunkIndex: number;
    payload: string;
    recordedAt: string;
    deltaMs?: number;
    origin?: string;
    runnerKind?: string;
  }[];
}

export const executionsApi = {
  start: async (
    workflowId: string,
    options?: {
      inputs?: Record<string, unknown>;
      versionId?: string;
      version?: number;
      scopeId?: string | null;
    },
  ): Promise<{ executionId: string }> => {
    const payload = options
      ? {
          inputs: options.inputs,
          versionId: options.versionId,
          version: options.version,
          scopeId: options.scopeId ?? undefined,
        }
      : undefined;
    const response = (await apiClient.runWorkflow(workflowId, payload)) as ApiResponse<{
      runId?: string;
    }>;
    if (response.error) {
      const error = response.error;
      const errorMessage =
        typeof error === 'object' && error.message
          ? error.message
          : typeof error === 'string'
            ? error
            : 'Failed to start execution';
      throw new Error(errorMessage);
    }
    return { executionId: response.data?.runId || '' };
  },

  getStatus: async (executionId: string) => {
    const response = await apiClient.getWorkflowRunStatus(executionId);
    if (response.error) throw new Error('Failed to fetch execution status');
    return response.data;
  },

  getTrace: async (executionId: string) => {
    const response = await apiClient.getWorkflowRunTrace(executionId);
    if (response.error) throw new Error('Failed to fetch execution logs');
    return response.data;
  },

  getConfig: async (executionId: string) => {
    const response = await apiClient.getWorkflowRunConfig(executionId);
    if (response.error || !response.data) {
      throw new Error('Failed to fetch run configuration');
    }
    return response.data;
  },

  getResult: async (executionId: string) => {
    const response = await apiClient.getWorkflowRunResult(executionId);
    if (response.error || !response.data) {
      throw new Error('Failed to fetch run result');
    }
    return response.data;
  },

  getEvents: async (executionId: string) => {
    const response = await apiClient.getWorkflowRunEvents(executionId);
    if (response.error) throw new Error('Failed to fetch events');
    return response.data || [];
  },

  getDataFlows: async (executionId: string) => {
    const response = await apiClient.getWorkflowRunDataFlows(executionId);
    if (response.error) throw new Error('Failed to fetch data flows');
    return response.data || [];
  },

  getTerminalChunks: async (
    executionId: string,
    params?: {
      nodeRef?: string;
      stream?: string;
      cursor?: string;
      startTime?: Date;
      endTime?: Date;
    },
  ): Promise<TerminalChunkResponse> => {
    const headers = await getAuthHeaders();
    const url = new URL(`${API_V1_URL}/workflows/runs/${executionId}/terminal`);
    if (params?.nodeRef) url.searchParams.set('nodeRef', params.nodeRef);
    if (params?.stream) url.searchParams.set('stream', params.stream);
    if (params?.cursor) url.searchParams.set('cursor', params.cursor);
    if (params?.startTime) url.searchParams.set('startTime', params.startTime.toISOString());
    if (params?.endTime) url.searchParams.set('endTime', params.endTime.toISOString());
    const response = await fetch(url.toString(), { headers, credentials: 'include' });
    if (!response.ok) {
      throw new Error('Failed to fetch terminal chunks');
    }
    return (await response.json()) as TerminalChunkResponse;
  },

  getArtifacts: async (executionId: string): Promise<RunArtifactsResponse> => {
    const response = (await apiClient.getWorkflowRunArtifacts(
      executionId,
    )) as ApiResponse<RunArtifactsResponse>;
    if (response.error || !response.data) {
      throw new Error('Failed to fetch run artifacts');
    }
    return response.data;
  },

  downloadArtifact: async (executionId: string, artifactId: string): Promise<Blob> => {
    // Use direct fetch instead of typed client due to OpenAPI spec mismatch
    // (path uses {artifactId} but parameter is named 'id')
    const headers = await getAuthHeaders();
    const response = await fetch(
      `${API_BASE_URL}/api/v1/workflows/runs/${executionId}/artifacts/${artifactId}/download`,
      { headers, credentials: 'include' },
    );
    if (!response.ok) {
      throw new Error('Failed to download artifact');
    }
    return await response.blob();
  },

  stream: async (
    executionId: string,
    options?: {
      cursor?: string;
      temporalRunId?: string;
      terminalCursor?: string;
      logCursor?: string;
    },
  ): Promise<EventSource> => {
    // Use fetch-based SSE client that supports custom headers (including Authorization)
    const { FetchEventSource } = await import('@/utils/sse-client');

    // Build URL with query params
    const params = new URLSearchParams();
    if (options?.cursor) params.set('cursor', options.cursor);
    if (options?.temporalRunId) params.set('temporalRunId', options.temporalRunId);
    if (options?.terminalCursor) params.set('terminalCursor', options.terminalCursor);
    if (options?.logCursor) params.set('logCursor', options.logCursor);
    const query = params.toString();
    const url = `${API_V1_URL}/workflows/runs/${executionId}/stream${query ? `?${query}` : ''}`;

    const headers = await getAuthHeaders();

    return new FetchEventSource(url, { headers, withCredentials: true });
  },

  cancel: async (executionId: string) => {
    const response = await apiClient.cancelWorkflowRun(executionId);
    if (response.error) throw new Error('Failed to cancel execution');
    return { success: true };
  },

  listRuns: async (options?: {
    workflowId?: string;
    status?: string;
    scopeId?: string;
    limit?: number;
    offset?: number;
  }) => {
    const response = await apiClient.listWorkflowRuns(options);
    if (response.error) throw new Error('Failed to fetch runs');
    return response.data || { runs: [] };
  },

  getRun: async (runId: string) => {
    const response = await apiClient.getWorkflowRun(runId);
    if (response.error) throw new Error('Failed to fetch run');
    if (!response.data) throw new Error('Run not found');
    return response.data;
  },

  getChildRuns: async (runId: string) => {
    const response = await apiClient.listWorkflowRunChildren(runId);
    if (response.error) throw new Error('Failed to fetch child runs');
    return response.data || { runs: [] };
  },

  listNodeIO: async (runId: string) => {
    const response = await apiClient.listWorkflowRunNodeIO(runId);
    if (response.error) throw new Error('Failed to fetch node I/O');
    return response.data || [];
  },

  getNodeIO: async (runId: string, nodeRef: string, full?: boolean) => {
    const response = await apiClient.getWorkflowNodeIO(runId, nodeRef, { full });
    if (response.error) throw new Error('Failed to fetch node I/O details');
    return response.data;
  },

  getLogs: async (
    runId: string,
    options?: {
      nodeRef?: string;
      stream?: 'stdout' | 'stderr' | 'console';
      level?: 'debug' | 'info' | 'warn' | 'error';
      limit?: number;
      cursor?: string;
      startTime?: string;
      endTime?: string;
    },
  ) => {
    const response = await apiClient.getWorkflowRunLogs(runId, options);
    if (response.error) {
      throw new Error('Failed to fetch logs');
    }
    return response.data as {
      runId: string;
      logs: {
        id: string;
        runId: string;
        nodeId: string;
        level: 'debug' | 'info' | 'warn' | 'error';
        message: string;
        timestamp: string;
      }[];
      totalCount: number;
      hasMore: boolean;
      nextCursor?: string;
    };
  },
};
