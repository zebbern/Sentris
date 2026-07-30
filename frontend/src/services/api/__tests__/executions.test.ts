import { beforeEach, describe, expect, it, mock } from 'bun:test';

const getWorkflowRunLogs = mock(() =>
  Promise.resolve({
    data: {
      runId: 'run-1',
      logs: [],
      totalCount: 0,
      hasMore: false,
    },
    error: undefined,
  }),
);
const getAuthHeaders = mock(() =>
  Promise.resolve({
    'X-Organization-Id': 'org-b',
  }),
);

let latestStreamOptions: { headers?: Record<string, string>; withCredentials?: boolean } | null =
  null;
class MockFetchEventSource {
  constructor(
    _url: string,
    options: { headers?: Record<string, string>; withCredentials?: boolean },
  ) {
    latestStreamOptions = options;
  }
}

mock.module('@/services/api/client', () => ({
  apiClient: {
    getWorkflowRunLogs,
  },
  getAuthHeaders,
  API_BASE_URL: 'http://localhost:3211',
  API_V1_URL: 'http://localhost:3211/api/v1',
}));
mock.module('@/utils/sse-client', () => ({ FetchEventSource: MockFetchEventSource }));

import { executionsApi } from '../executions';

beforeEach(() => {
  getWorkflowRunLogs.mockClear();
  getAuthHeaders.mockClear();
  latestStreamOptions = null;
});

describe('executionsApi local session transport', () => {
  it('uses the shared credentialed API client for run logs', async () => {
    await executionsApi.getLogs('run-1', { limit: 25 });

    expect(getWorkflowRunLogs).toHaveBeenCalledWith('run-1', { limit: 25 });
  });

  it('uses the same fail-closed auth headers for execution streams', async () => {
    await executionsApi.stream('run-1');

    expect(getAuthHeaders).toHaveBeenCalledTimes(1);
    expect(latestStreamOptions).toEqual({
      headers: { 'X-Organization-Id': 'org-b' },
      withCredentials: true,
    });
  });
});
