import { describe, expect, it } from 'bun:test';

import { LLM_PROVIDER_CATALOG, LLM_PROVIDER_IDS } from '@sentris/shared';
import {
  AGENT_MODEL_OPTIONS_BY_PROVIDER,
  AGENT_MODEL_PROVIDER_OPTIONS,
  CLAUDE_EFFORT_LEVEL_OPTIONS,
  isClaudeEffortLevel,
} from '../agentModelOptions';

describe('agentModelOptions', () => {
  it('derives provider and model editor options from the shared catalog', () => {
    expect(AGENT_MODEL_PROVIDER_OPTIONS).toEqual(
      LLM_PROVIDER_IDS.map((provider) => ({
        label: LLM_PROVIDER_CATALOG[provider].label,
        value: provider,
      })),
    );
    for (const provider of LLM_PROVIDER_IDS) {
      expect(AGENT_MODEL_OPTIONS_BY_PROVIDER[provider]).toEqual(LLM_PROVIDER_CATALOG[provider].models);
    }
  });

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
