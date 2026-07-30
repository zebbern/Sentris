import { describe, expect, it, mock } from 'bun:test';

import { notifyBackendRunFinalized } from '../run-finalizer';

describe('notifyBackendRunFinalized', () => {
  it('posts a tenant-bound terminal callback to the configured backend', async () => {
    const fetchImpl = mock(
      async (_input: string | URL | Request, _init?: RequestInit) =>
        new Response(null, { status: 204 }),
    );

    await notifyBackendRunFinalized(
      {
        runId: 'run/with spaces',
        organizationId: 'org-1',
        status: 'COMPLETED',
        completedAt: '2026-07-26T12:00:00.000Z',
      },
      {
        env: {
          BACKEND_URL: 'http://backend:3211/',
          INTERNAL_SERVICE_TOKEN: 'internal-token',
        },
        fetchImpl,
      },
    );

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe('http://backend:3211/api/v1/internal/runs/run%2Fwith%20spaces/finalize');
    expect(init?.method).toBe('POST');
    expect(init?.headers).toEqual({
      'Content-Type': 'application/json',
      'X-Internal-Token': 'internal-token',
      'X-Organization-Id': 'org-1',
    });
    expect(JSON.parse(String(init?.body))).toEqual({
      status: 'COMPLETED',
      completedAt: '2026-07-26T12:00:00.000Z',
    });
  });

  it('fails before making a request when callback credentials are absent', async () => {
    const fetchImpl = mock(
      async (_input: string | URL | Request, _init?: RequestInit) =>
        new Response(null, { status: 204 }),
    );

    await expect(
      notifyBackendRunFinalized(
        {
          runId: 'run-1',
          organizationId: 'org-1',
          status: 'FAILED',
        },
        {
          env: { BACKEND_URL: 'http://backend:3211' },
          fetchImpl,
        },
      ),
    ).rejects.toThrow('INTERNAL_SERVICE_TOKEN');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('fails closed when the run has no organization context', async () => {
    const fetchImpl = mock(
      async (_input: string | URL | Request, _init?: RequestInit) =>
        new Response(null, { status: 204 }),
    );

    await expect(
      notifyBackendRunFinalized(
        {
          runId: 'run-1',
          organizationId: null,
          status: 'FAILED',
        },
        {
          env: {
            BACKEND_URL: 'http://backend:3211',
            INTERNAL_SERVICE_TOKEN: 'internal-token',
          },
          fetchImpl,
        },
      ),
    ).rejects.toThrow('organizationId');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('surfaces backend rejection so Temporal can retry the activity', async () => {
    const fetchImpl = mock(
      async (_input: string | URL | Request, _init?: RequestInit) =>
        new Response(null, { status: 503 }),
    );

    await expect(
      notifyBackendRunFinalized(
        {
          runId: 'run-1',
          organizationId: 'org-1',
          status: 'FAILED',
        },
        {
          env: {
            BACKEND_URL: 'http://backend:3211',
            INTERNAL_SERVICE_TOKEN: 'internal-token',
          },
          fetchImpl,
        },
      ),
    ).rejects.toThrow('503');
  });
});
