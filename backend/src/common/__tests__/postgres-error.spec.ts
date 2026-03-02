import { describe, expect, it } from 'bun:test';

import { getPostgresErrorCode, PG_ERROR } from '../postgres-error';

describe('getPostgresErrorCode', () => {
  it('extracts .code from a direct error object', () => {
    const error = { code: '23505', message: 'duplicate key' };
    expect(getPostgresErrorCode(error)).toBe('23505');
  });

  it('extracts .cause.code from a DrizzleQueryError-style wrapper', () => {
    const error = {
      message: 'Drizzle query failed',
      cause: { code: '23503', detail: 'Key not found' },
    };
    expect(getPostgresErrorCode(error)).toBe('23503');
  });

  it('prefers direct .code over .cause.code', () => {
    const error = {
      code: '23505',
      cause: { code: '23503' },
    };
    expect(getPostgresErrorCode(error)).toBe('23505');
  });

  it('falls back to .cause.code when direct .code is not a string', () => {
    const error = {
      code: 42, // numeric, not a string
      cause: { code: '23503' },
    };
    expect(getPostgresErrorCode(error)).toBe('23503');
  });

  it('returns undefined for null', () => {
    expect(getPostgresErrorCode(null)).toBeUndefined();
  });

  it('returns undefined for undefined', () => {
    expect(getPostgresErrorCode(undefined)).toBeUndefined();
  });

  it('returns undefined for non-object values', () => {
    expect(getPostgresErrorCode('string')).toBeUndefined();
    expect(getPostgresErrorCode(42)).toBeUndefined();
    expect(getPostgresErrorCode(true)).toBeUndefined();
  });

  it('returns undefined for objects without .code or .cause.code', () => {
    expect(getPostgresErrorCode({})).toBeUndefined();
    expect(getPostgresErrorCode({ message: 'oops' })).toBeUndefined();
  });

  it('returns undefined when .cause exists but has no .code', () => {
    const error = { cause: { message: 'something' } };
    expect(getPostgresErrorCode(error)).toBeUndefined();
  });

  it('returns undefined when .cause is a primitive', () => {
    expect(getPostgresErrorCode({ cause: 'string-cause' })).toBeUndefined();
    expect(getPostgresErrorCode({ cause: null })).toBeUndefined();
  });
});

describe('PG_ERROR constants', () => {
  it('has the correct SQLSTATE code for UNIQUE_VIOLATION', () => {
    expect(PG_ERROR.UNIQUE_VIOLATION).toBe('23505');
  });

  it('has the correct SQLSTATE code for FOREIGN_KEY_VIOLATION', () => {
    expect(PG_ERROR.FOREIGN_KEY_VIOLATION).toBe('23503');
  });
});
