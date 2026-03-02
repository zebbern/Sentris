import { describe, expect, it } from 'bun:test';

import { normalizeRuntimeInputs } from '../runtimeInputUtils';

describe('normalizeRuntimeInputs', () => {
  it('returns the array directly when given an array', () => {
    const input = [1, 2, 3];
    expect(normalizeRuntimeInputs(input)).toEqual([1, 2, 3]);
  });

  it('preserves array of objects', () => {
    const input = [{ key: 'host', value: 'example.com' }];
    expect(normalizeRuntimeInputs(input)).toEqual([{ key: 'host', value: 'example.com' }]);
  });

  it('parses a JSON string containing an array', () => {
    const input = JSON.stringify(['a', 'b', 'c']);
    expect(normalizeRuntimeInputs(input)).toEqual(['a', 'b', 'c']);
  });

  it('returns empty array for a JSON string containing a non-array', () => {
    const input = JSON.stringify({ key: 'value' });
    expect(normalizeRuntimeInputs(input)).toEqual([]);
  });

  it('returns empty array for invalid JSON string', () => {
    expect(normalizeRuntimeInputs('not-json')).toEqual([]);
  });

  it('returns empty array for empty string', () => {
    expect(normalizeRuntimeInputs('')).toEqual([]);
  });

  it('returns empty array for null', () => {
    expect(normalizeRuntimeInputs(null)).toEqual([]);
  });

  it('returns empty array for undefined', () => {
    expect(normalizeRuntimeInputs(undefined)).toEqual([]);
  });

  it('returns empty array for a number', () => {
    expect(normalizeRuntimeInputs(42)).toEqual([]);
  });

  it('returns empty array for a boolean', () => {
    expect(normalizeRuntimeInputs(true)).toEqual([]);
  });

  it('returns empty array for an object (non-array, non-string)', () => {
    expect(normalizeRuntimeInputs({ key: 'value' })).toEqual([]);
  });

  it('returns the empty array as-is', () => {
    expect(normalizeRuntimeInputs([])).toEqual([]);
  });
});
