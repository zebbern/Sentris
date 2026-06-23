import { afterEach, describe, expect, it } from 'bun:test';
import { getApiBaseUrl, getE2EInstance } from './api-base';

const ORIGINAL_SENTRIS_INSTANCE = process.env.SENTRIS_INSTANCE;
const ORIGINAL_E2E_INSTANCE = process.env.E2E_INSTANCE;

function restoreInstanceEnv() {
  if (ORIGINAL_SENTRIS_INSTANCE === undefined) {
    delete process.env.SENTRIS_INSTANCE;
  } else {
    process.env.SENTRIS_INSTANCE = ORIGINAL_SENTRIS_INSTANCE;
  }

  if (ORIGINAL_E2E_INSTANCE === undefined) {
    delete process.env.E2E_INSTANCE;
  } else {
    process.env.E2E_INSTANCE = ORIGINAL_E2E_INSTANCE;
  }
}

describe('E2E API base helper', () => {
  afterEach(() => {
    restoreInstanceEnv();
  });

  it('prefers SENTRIS_INSTANCE over stale E2E_INSTANCE', () => {
    process.env.SENTRIS_INSTANCE = '3';
    process.env.E2E_INSTANCE = '1';

    expect(getE2EInstance()).toBe(3);
    expect(getApiBaseUrl()).toBe('http://127.0.0.1:3511/api/v1');
  });

  it('keeps E2E_INSTANCE as a legacy fallback when SENTRIS_INSTANCE is absent', () => {
    delete process.env.SENTRIS_INSTANCE;
    process.env.E2E_INSTANCE = '2';

    expect(getE2EInstance()).toBe(2);
    expect(getApiBaseUrl()).toBe('http://127.0.0.1:3411/api/v1');
  });
});
