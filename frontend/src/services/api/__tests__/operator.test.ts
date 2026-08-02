import { beforeEach, describe, expect, it, mock, vi } from 'bun:test';

const httpGet = vi.fn();
const httpPatch = vi.fn();
const httpPost = vi.fn();

mock.module('@/services/api/client', () => ({
  httpGet,
  httpPatch,
  httpPost,
}));

import { operatorApi } from '../operator';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('operatorApi', () => {
  it('uses the durable session endpoints', async () => {
    httpGet.mockResolvedValueOnce([]).mockResolvedValueOnce({ id: 'session/1' });
    httpPost.mockResolvedValueOnce({ id: 'session-1' });
    httpPatch.mockResolvedValueOnce({ id: 'session-1' });

    await operatorApi.listSessions();
    await operatorApi.getSession('session/1');
    await operatorApi.createSession({
      approvalMode: 'ask',
      model: {
        provider: 'gemini',
        modelId: 'gemini-3.6-flash',
        apiKeySecretId: '11111111-1111-4111-8111-111111111111',
        baseUrl: null,
      },
    });
    await operatorApi.updateSession('session-1', { approvalMode: 'auto' });

    expect(httpGet).toHaveBeenNthCalledWith(1, '/operator/sessions');
    expect(httpGet).toHaveBeenNthCalledWith(2, '/operator/sessions/session%2F1');
    expect(httpPost).toHaveBeenCalledWith('/operator/sessions', expect.any(Object));
    expect(httpPatch).toHaveBeenCalledWith('/operator/sessions/session-1', {
      approvalMode: 'auto',
    });
  });

  it('submits turns and versioned action decisions', async () => {
    httpPost.mockResolvedValue({});

    await operatorApi.createTurn('session-1', {
      clientTurnId: '22222222-2222-4222-8222-222222222222',
      message: 'Run the workflow',
      context: { path: '/operator/session-1' },
    });
    await operatorApi.decideAction('action/1', {
      decision: 'approved',
      expectedVersion: 3,
    });

    expect(httpPost).toHaveBeenNthCalledWith(1, '/operator/sessions/session-1/turns', {
      clientTurnId: '22222222-2222-4222-8222-222222222222',
      message: 'Run the workflow',
      context: { path: '/operator/session-1' },
    });
    expect(httpPost).toHaveBeenNthCalledWith(2, '/operator/actions/action%2F1/decision', {
      decision: 'approved',
      expectedVersion: 3,
    });
  });
});
