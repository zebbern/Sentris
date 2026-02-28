import { describe, it, expect } from 'bun:test';
import type { Parameter } from '@/schemas/component';
import { shouldShowParameter, isHeaderToggleParameter } from '../parameterUtils';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeParam(overrides: Partial<Parameter> & { id: string }): Parameter {
  return {
    type: 'text',
    label: overrides.id,
    ...overrides,
  } as Parameter;
}

// ---------------------------------------------------------------------------
// shouldShowParameter
// ---------------------------------------------------------------------------

describe('shouldShowParameter', () => {
  it('returns true when parameter has no visibleWhen conditions', () => {
    const param = makeParam({ id: 'name' });
    expect(shouldShowParameter(param, {})).toBe(true);
  });

  it('returns true when visibleWhen is undefined', () => {
    const param = makeParam({ id: 'name', visibleWhen: undefined });
    expect(shouldShowParameter(param, { other: 'value' })).toBe(true);
  });

  it('returns false when visibleWhen exists but allParameters is undefined', () => {
    const param = makeParam({ id: 'name', visibleWhen: { toggle: true } });
    expect(shouldShowParameter(param, undefined)).toBe(false);
  });

  it('returns true when all visibleWhen conditions are met', () => {
    const param = makeParam({ id: 'name', visibleWhen: { mode: 'advanced' } });
    expect(shouldShowParameter(param, { mode: 'advanced' })).toBe(true);
  });

  it('returns false when a visibleWhen condition is not met', () => {
    const param = makeParam({ id: 'name', visibleWhen: { mode: 'advanced' } });
    expect(shouldShowParameter(param, { mode: 'basic' })).toBe(false);
  });

  it('returns false when visibleWhen key is missing from allParameters', () => {
    const param = makeParam({ id: 'name', visibleWhen: { toggle: true } });
    expect(shouldShowParameter(param, {})).toBe(false);
  });

  it('checks all conditions (AND logic) — returns false if any fails', () => {
    const param = makeParam({ id: 'name', visibleWhen: { a: true, b: 'yes' } });
    expect(shouldShowParameter(param, { a: true, b: 'no' })).toBe(false);
  });

  it('checks all conditions (AND logic) — returns true when all match', () => {
    const param = makeParam({ id: 'name', visibleWhen: { a: true, b: 'yes' } });
    expect(shouldShowParameter(param, { a: true, b: 'yes' })).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// isHeaderToggleParameter
// ---------------------------------------------------------------------------

describe('isHeaderToggleParameter', () => {
  it('returns false for non-boolean parameters', () => {
    const param = makeParam({ id: 'name', type: 'text' });
    const allParams = [param, makeParam({ id: 'other', visibleWhen: { name: 'x' } })];
    expect(isHeaderToggleParameter(param, allParams)).toBe(false);
  });

  it('returns false when allComponentParameters is undefined', () => {
    const param = makeParam({ id: 'toggle', type: 'boolean' });
    expect(isHeaderToggleParameter(param, undefined)).toBe(false);
  });

  it('returns false when no other parameter references this parameter in visibleWhen', () => {
    const param = makeParam({ id: 'toggle', type: 'boolean' });
    const other = makeParam({ id: 'other', type: 'text' });
    expect(isHeaderToggleParameter(param, [param, other])).toBe(false);
  });

  it('returns true when another parameter has visibleWhen referencing this parameter', () => {
    const toggle = makeParam({ id: 'enableAuth', type: 'boolean' });
    const dependent = makeParam({
      id: 'authToken',
      type: 'text',
      visibleWhen: { enableAuth: true },
    });
    expect(isHeaderToggleParameter(toggle, [toggle, dependent])).toBe(true);
  });

  it('returns true even when the reference uses a falsy expected value', () => {
    const toggle = makeParam({ id: 'disableCache', type: 'boolean' });
    const dependent = makeParam({
      id: 'cacheTtl',
      type: 'number',
      visibleWhen: { disableCache: false },
    });
    expect(isHeaderToggleParameter(toggle, [toggle, dependent])).toBe(true);
  });
});
