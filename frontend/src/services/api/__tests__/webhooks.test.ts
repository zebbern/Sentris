import { describe, it, expect, vi, mock, beforeEach } from 'bun:test';

const testWebhookScriptMock = vi.fn();

mock.module('@/services/api/client', () => ({
  apiClient: {
    testWebhookScript: testWebhookScriptMock,
  },
}));

import { webhooksApi } from '../webhooks';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('webhooksApi.testScript', () => {
  it('returns parsed script test results', async () => {
    testWebhookScriptMock.mockResolvedValueOnce({
      data: {
        success: true,
        parsedData: { message: 'ok' },
        errorMessage: null,
      },
    });

    const result = await webhooksApi.testScript({
      script: 'export async function script() { return { message: "ok" }; }',
      payload: { message: 'Hello World' },
      headers: { 'content-type': 'application/json' },
    });

    expect(testWebhookScriptMock).toHaveBeenCalledWith({
      parsingScript: 'export async function script() { return { message: "ok" }; }',
      testPayload: { message: 'Hello World' },
      testHeaders: { 'content-type': 'application/json' },
    });
    expect(result).toEqual({
      success: true,
      parsedData: { message: 'ok' },
      errorMessage: null,
    });
  });

  it('throws backend error message when script testing fails at the API layer', async () => {
    testWebhookScriptMock.mockResolvedValueOnce({
      error: {
        message: 'Missing authentication - provide session cookie or Basic Auth',
        statusCode: 401,
      },
    });

    await expect(
      webhooksApi.testScript({
        script: 'export async function script() { return {}; }',
        payload: { message: 'Hello World' },
        headers: { 'content-type': 'application/json' },
      }),
    ).rejects.toThrow('Missing authentication - provide session cookie or Basic Auth');
  });
});
