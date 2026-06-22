import { describe, expect, it } from 'bun:test';

import {
  hasRuntimeInputValue,
  parseRuntimeInputValue,
  type RuntimeInputDefinition,
} from '../scheduleTypes';

describe('schedule runtime input helpers', () => {
  it('parses boolean runtime inputs as booleans', () => {
    const input: RuntimeInputDefinition = {
      id: 'includeDevDependencies',
      label: 'Include dev dependencies',
      type: 'boolean',
      required: false,
    };

    expect(parseRuntimeInputValue(input, true)).toBe(true);
    expect(parseRuntimeInputValue(input, false)).toBe(false);
    expect(parseRuntimeInputValue(input, 'true')).toBe(true);
    expect(parseRuntimeInputValue(input, 'false')).toBe(false);
  });

  it('treats false as a present runtime input value', () => {
    expect(hasRuntimeInputValue(false)).toBe(true);
  });
});
