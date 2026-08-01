import {
  getRecommendedLlmModel,
  LLM_PROVIDER_CATALOG,
  LLM_PROVIDER_IDS,
  type LlmModelProvider,
  type LlmModelOption,
} from '@sentris/shared';

export type AgentModelProvider = LlmModelProvider;

export const AGENT_MODEL_COMPONENT_IDS = new Set(['core.ai.opencode', 'core.ai.claude-code']);

export const AGENT_MODEL_PROVIDER_OPTIONS = LLM_PROVIDER_IDS.map((provider) => ({
  label: LLM_PROVIDER_CATALOG[provider].label,
  value: provider,
}));

export const AGENT_MODEL_OPTIONS_BY_PROVIDER = LLM_PROVIDER_IDS.reduce<
  Record<AgentModelProvider, readonly LlmModelOption[]>
>((options, provider) => {
  options[provider] = LLM_PROVIDER_CATALOG[provider].models;
  return options;
}, {} as Record<AgentModelProvider, readonly LlmModelOption[]>);

export const DEFAULT_AGENT_MODEL_BY_COMPONENT: Record<
  string,
  { provider: AgentModelProvider; modelId: string }
> = {
  'core.ai.agent': {
    provider: 'openai',
    modelId: getRecommendedLlmModel('openai'),
  },
  'core.ai.opencode': {
    provider: 'openai',
    modelId: getRecommendedLlmModel('openai'),
  },
  'core.ai.claude-code': {
    provider: 'anthropic',
    modelId: getRecommendedLlmModel('anthropic'),
  },
} satisfies Record<string, { provider: AgentModelProvider; modelId: string }>;

export type ClaudeEffortLevel = 'default' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export const CLAUDE_EFFORT_LEVEL_OPTIONS: {
  label: string;
  value: ClaudeEffortLevel;
  description: string;
}[] = [
  {
    label: 'Default (model default)',
    value: 'default',
    description: 'Use the model default (high) — full capability, no override.',
  },
  { label: 'Low', value: 'low', description: 'Fastest and cheapest; simpler tasks.' },
  { label: 'Medium', value: 'medium', description: 'Balanced speed, cost, and quality.' },
  { label: 'High', value: 'high', description: 'High capability (API default).' },
  {
    label: 'Extra high (xhigh)',
    value: 'xhigh',
    description: 'Deep, long-horizon agentic and coding work.',
  },
  {
    label: 'Max (maximum capability)',
    value: 'max',
    description: 'Absolute maximum capability, no token constraints.',
  },
];

export function isClaudeEffortLevel(value: unknown): value is ClaudeEffortLevel {
  return CLAUDE_EFFORT_LEVEL_OPTIONS.some((option) => option.value === value);
}
