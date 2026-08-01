import { describe, expect, it } from 'bun:test';
import { LLM_PROVIDER_IDS } from '@sentris/shared';

import { isAgentModelProviderValue } from '../AgentModelConfig';

describe('AgentModelConfig provider selection', () => {
  it('accepts every provider from the canonical catalog', () => {
    for (const provider of LLM_PROVIDER_IDS) {
      expect(isAgentModelProviderValue(provider)).toBe(true);
    }
    expect(isAgentModelProviderValue('not-a-provider')).toBe(false);
  });
});
