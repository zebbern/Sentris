export type AgentExecutionProfile = 'fast' | 'investigate' | 'deep';

export const DEFAULT_AGENT_EXECUTION_PROFILE: AgentExecutionProfile = 'investigate';

export const AGENT_EXECUTION_PROFILES = {
  fast: {
    activityTimeout: '10 minutes',
    runnerTimeoutSeconds: 600,
    mcpTokenTtlSeconds: 900,
    memoryLimit: '512m',
    cpuLimit: '1',
    pidsLimit: 256,
    defaultStepLimit: 8,
  },
  investigate: {
    activityTimeout: '45 minutes',
    runnerTimeoutSeconds: 2700,
    mcpTokenTtlSeconds: 3600,
    memoryLimit: '2g',
    cpuLimit: '2',
    pidsLimit: 512,
    defaultStepLimit: 24,
  },
  deep: {
    activityTimeout: '135 minutes',
    runnerTimeoutSeconds: 7200,
    mcpTokenTtlSeconds: 10800,
    memoryLimit: '4g',
    cpuLimit: '4',
    pidsLimit: 1024,
    defaultStepLimit: 64,
  },
} as const;

export type AgentExecutionProfileConfig = (typeof AGENT_EXECUTION_PROFILES)[AgentExecutionProfile];
export type AgentActivityTimeout = AgentExecutionProfileConfig['activityTimeout'];

export const AGENT_EXECUTION_PROFILE_OPTIONS = [
  { label: 'Fast', value: 'fast' },
  { label: 'Investigate', value: 'investigate' },
  { label: 'Deep', value: 'deep' },
] as const;

const AGENT_COMPONENT_IDS = ['core.ai.agent', 'core.ai.opencode', 'core.ai.claude-code'] as const;

export function resolveAgentExecutionProfile(value: unknown): AgentExecutionProfile {
  if (
    typeof value === 'string' &&
    Object.prototype.hasOwnProperty.call(AGENT_EXECUTION_PROFILES, value)
  ) {
    return value as AgentExecutionProfile;
  }

  return DEFAULT_AGENT_EXECUTION_PROFILE;
}

export function getAgentExecutionProfileConfig(value: unknown): AgentExecutionProfileConfig {
  return AGENT_EXECUTION_PROFILES[resolveAgentExecutionProfile(value)];
}

export function getActivityStartToCloseTimeout(
  componentId: string,
  params: Record<string, unknown>,
): AgentActivityTimeout {
  if (!AGENT_COMPONENT_IDS.includes(componentId as (typeof AGENT_COMPONENT_IDS)[number])) {
    return '10 minutes';
  }

  return getAgentExecutionProfileConfig(params.executionProfile).activityTimeout;
}
