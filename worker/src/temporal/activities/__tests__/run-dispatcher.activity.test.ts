import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test';

import { markRunStartedActivity, prepareRunPayloadActivity } from '../run-dispatcher.activity';

const originalEnv = { ...process.env };

describe('prepareRunPayloadActivity', () => {
  beforeEach(() => {
    process.env.INTERNAL_SERVICE_TOKEN = 'worker-token';
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({
        runId: 'run-1',
        workflowId: 'd2f0976a-d340-4ed9-bf72-f885c7d913a3',
        workflowVersionId: '44c4e8b2-5485-41aa-b66c-45b7994d2632',
        workflowVersion: 1,
        organizationId: 'org-1',
        definition: {},
        inputs: {},
        trigger: { type: 'manual', label: 'Manual run' },
        inputPreview: { runtimeInputs: {}, nodeOverrides: {} },
      }),
      text: async () => '',
    } as Response);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    for (const key of Object.keys(process.env)) {
      if (!(key in originalEnv)) {
        // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
        delete process.env[key];
      }
    }
    Object.assign(process.env, originalEnv);
  });

  it('calls the versioned internal run endpoint', async () => {
    await prepareRunPayloadActivity({
      workflowId: 'd2f0976a-d340-4ed9-bf72-f885c7d913a3',
      inputs: {},
    });

    const url = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(new URL(String(url)).pathname).toBe('/api/v1/internal/runs');
  });

  it('forwards the scope identity when preparing a child run', async () => {
    await prepareRunPayloadActivity({
      workflowId: 'd2f0976a-d340-4ed9-bf72-f885c7d913a3',
      inputs: {},
      scopeId: 'scope-1',
    });

    const request = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(JSON.parse(String(request?.body))).toEqual(
      expect.objectContaining({
        scopeId: 'scope-1',
      }),
    );
  });

  it('records the Temporal run id through the tenant-authenticated internal endpoint', async () => {
    await markRunStartedActivity({
      runId: 'run-1',
      temporalRunId: 'temporal-run-1',
      organizationId: 'org-1',
    });

    const requestMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    const [url, request] = requestMock.mock.calls[0];
    expect(new URL(String(url)).pathname).toBe('/api/v1/internal/runs/run-1/started');
    expect(request?.headers).toEqual(
      expect.objectContaining({
        'X-Internal-Token': 'worker-token',
        'X-Organization-Id': 'org-1',
      }),
    );
    expect(JSON.parse(String(request?.body))).toEqual({
      temporalRunId: 'temporal-run-1',
    });
  });

  it('does not fall back to a default tenant for a started callback', async () => {
    await expect(
      markRunStartedActivity({
        runId: 'run-1',
        temporalRunId: 'temporal-run-1',
        organizationId: null,
      }),
    ).rejects.toThrow('organizationId');

    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('is replayable after a post-start persistence failure', async () => {
    const requestMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    requestMock
      .mockResolvedValueOnce({
        ok: false,
        status: 503,
        statusText: 'Service Unavailable',
        text: async () => 'database unavailable',
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => ({
          runId: 'run-1',
          temporalRunId: 'temporal-run-1',
          duplicate: true,
        }),
        text: async () => '',
      } as Response);
    const input = {
      runId: 'run-1',
      temporalRunId: 'temporal-run-1',
      organizationId: 'org-1',
    };

    await expect(markRunStartedActivity(input)).rejects.toThrow('database unavailable');
    await expect(markRunStartedActivity(input)).resolves.toEqual(
      expect.objectContaining({ duplicate: true }),
    );

    expect(requestMock).toHaveBeenCalledTimes(2);
    expect(requestMock.mock.calls[0][0]).toBe(requestMock.mock.calls[1][0]);
    expect(requestMock.mock.calls[0][1]?.body).toBe(requestMock.mock.calls[1][1]?.body);
  });

  it('recovers when the first HTTP result is ambiguous after the backend may have committed', async () => {
    const requestMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    requestMock
      .mockRejectedValueOnce(new TypeError('fetch failed after request dispatch'))
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => ({
          runId: 'run-1',
          workflowId: 'd2f0976a-d340-4ed9-bf72-f885c7d913a3',
          temporalRunId: 'temporal-run-1',
          duplicate: true,
        }),
        text: async () => '',
      } as Response);
    const input = {
      runId: 'run-1',
      temporalRunId: 'temporal-run-1',
      organizationId: 'org-1',
    };

    await expect(markRunStartedActivity(input)).rejects.toThrow(
      'fetch failed after request dispatch',
    );
    await expect(markRunStartedActivity(input)).resolves.toEqual(
      expect.objectContaining({
        runId: 'run-1',
        temporalRunId: 'temporal-run-1',
        duplicate: true,
      }),
    );

    expect(requestMock).toHaveBeenCalledTimes(2);
    expect(requestMock.mock.calls[0][0]).toBe(requestMock.mock.calls[1][0]);
    expect(requestMock.mock.calls[0][1]?.body).toBe(requestMock.mock.calls[1][1]?.body);
  });
});
