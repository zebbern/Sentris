import { describe, expect, test } from 'bun:test';

import {
  AGENT_EXECUTION_PROFILE_OPTIONS,
  DEFAULT_AGENT_EXECUTION_PROFILE,
  getAgentExecutionProfileConfig,
  resolveAgentExecutionProfile,
} from '../agent-execution-profile';

describe('agent execution profiles', () => {
  test.each([
    {
      profile: 'fast',
      expected: {
        activityTimeout: '10 minutes',
        runnerTimeoutSeconds: 600,
        mcpTokenTtlSeconds: 900,
        memoryLimit: '512m',
        cpuLimit: '1',
        pidsLimit: 256,
        defaultStepLimit: 8,
      },
    },
    {
      profile: 'investigate',
      expected: {
        activityTimeout: '45 minutes',
        runnerTimeoutSeconds: 2700,
        mcpTokenTtlSeconds: 3600,
        memoryLimit: '2g',
        cpuLimit: '2',
        pidsLimit: 512,
        defaultStepLimit: 24,
      },
    },
    {
      profile: 'deep',
      expected: {
        activityTimeout: '135 minutes',
        runnerTimeoutSeconds: 7200,
        mcpTokenTtlSeconds: 10800,
        memoryLimit: '4g',
        cpuLimit: '4',
        pidsLimit: 1024,
        defaultStepLimit: 64,
      },
    },
  ])('returns the configured limits for $profile', ({ profile, expected }) => {
    expect(getAgentExecutionProfileConfig(profile)).toEqual(expected);
  });

  test('defaults invalid and missing values to investigate', () => {
    expect(DEFAULT_AGENT_EXECUTION_PROFILE).toBe('investigate');
    expect(resolveAgentExecutionProfile('extended')).toBe('investigate');
    expect(resolveAgentExecutionProfile(undefined)).toBe('investigate');
    expect(resolveAgentExecutionProfile({ profile: 'deep' })).toBe('investigate');
  });

  test('exposes the selectable profiles', () => {
    expect(AGENT_EXECUTION_PROFILE_OPTIONS.map((option) => option.value)).toEqual([
      'fast',
      'investigate',
      'deep',
    ]);
  });
});
