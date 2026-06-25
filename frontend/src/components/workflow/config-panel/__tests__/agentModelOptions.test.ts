import { describe, expect, it } from 'bun:test';

import { CLAUDE_EFFORT_LEVEL_OPTIONS, isClaudeEffortLevel } from '../agentModelOptions';

describe('agentModelOptions', () => {
  it('includes Max in Claude effort level options', () => {
    expect(CLAUDE_EFFORT_LEVEL_OPTIONS.map((option) => option.value)).toEqual([
      'default',
      'low',
      'medium',
      'high',
      'xhigh',
      'max',
    ]);
    expect(CLAUDE_EFFORT_LEVEL_OPTIONS.find((option) => option.value === 'max')?.label).toContain(
      'Max',
    );
  });

  it('accepts max as a valid effort level', () => {
    expect(isClaudeEffortLevel('max')).toBe(true);
  });
});
