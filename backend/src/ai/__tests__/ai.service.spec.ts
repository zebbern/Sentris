import { afterEach, describe, expect, it, vi } from 'bun:test';

import { DEFAULT_ORGANIZATION_ID } from '../../auth/constants';
import type { AuthContext } from '../../auth/types';
import { AiService } from '../ai.service';
import type { SecretsService } from '../../secrets/secrets.service';

const authContext: AuthContext = {
  userId: 'tester',
  organizationId: DEFAULT_ORGANIZATION_ID,
  roles: ['ADMIN'],
  isAuthenticated: true,
  provider: 'test',
};

function makeSecrets(value: string | Error): SecretsService {
  return {
    getSecretValue: vi.fn(async () => {
      if (value instanceof Error) {
        throw value;
      }
      return { secretId: 'secret-1', version: 1, value };
    }),
  } as unknown as SecretsService;
}

describe('AiService.listAnthropicModels', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('returns live models from the Anthropic API', async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        data: [
          { id: 'claude-opus-4-8', display_name: 'Claude Opus 4.8', type: 'model' },
          { id: 'claude-sonnet-4-6', display_name: 'Claude Sonnet 4.6', type: 'model' },
        ],
      }),
    })) as unknown as typeof fetch;

    const service = new AiService(makeSecrets('sk-ant-test'));
    const result = await service.listAnthropicModels(authContext, 'secret-1');

    expect(result.source).toBe('live');
    expect(result.models).toEqual([
      { id: 'claude-opus-4-8', label: 'Claude Opus 4.8' },
      { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
    ]);

    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    const [, init] = fetchMock.mock.calls[0];
    expect((init as RequestInit).headers).toMatchObject({
      'x-api-key': 'sk-ant-test',
      'anthropic-version': '2023-06-01',
    });
  });

  it('returns error source when the API rejects the key', async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: false,
      status: 401,
      text: async () => 'invalid x-api-key',
    })) as unknown as typeof fetch;

    const service = new AiService(makeSecrets('bad-key'));
    const result = await service.listAnthropicModels(authContext, 'secret-1');

    expect(result.source).toBe('error');
    expect(result.models).toEqual([]);
    expect(result.error).toContain('401');
  });

  it('returns error source when the secret cannot be resolved', async () => {
    const service = new AiService(makeSecrets(new Error('secret not found')));
    const result = await service.listAnthropicModels(authContext, 'missing');

    expect(result.source).toBe('error');
    expect(result.models).toEqual([]);
    expect(result.error).toContain('secret not found');
  });
});
