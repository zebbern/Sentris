import { describe, expect, it } from 'bun:test';

import { getApiBaseUrl } from '../api-base';

describe('E2E API target resolution', () => {
  it('uses an explicit production-proxy API base without changing the selected instance', () => {
    expect(
      getApiBaseUrl({
        SENTRIS_INSTANCE: '4',
        E2E_API_BASE_URL: 'http://127.0.0.1:8088/api/v1/',
      }),
    ).toBe('http://127.0.0.1:8088/api/v1');
  });

  it('derives the development backend port from the explicit instance by default', () => {
    expect(getApiBaseUrl({ SENTRIS_INSTANCE: '3' })).toBe(
      'http://127.0.0.1:3511/api/v1',
    );
  });

  it('rejects a non-HTTP override', () => {
    expect(() =>
      getApiBaseUrl({
        SENTRIS_INSTANCE: '0',
        E2E_API_BASE_URL: 'file:///tmp/not-an-api',
      }),
    ).toThrow('E2E_API_BASE_URL must use http or https');
  });
});
