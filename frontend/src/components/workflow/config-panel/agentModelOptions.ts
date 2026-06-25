export type AgentModelProvider =
  | 'anthropic'
  | 'openai'
  | 'gemini'
  | 'openrouter'
  | 'zai-coding-plan';

export const AGENT_MODEL_COMPONENT_IDS = new Set(['core.ai.opencode', 'core.ai.claude-code']);

export const AGENT_MODEL_PROVIDER_OPTIONS: { label: string; value: AgentModelProvider }[] = [
  { label: 'Anthropic', value: 'anthropic' },
  { label: 'OpenAI', value: 'openai' },
  { label: 'Gemini', value: 'gemini' },
  { label: 'OpenRouter', value: 'openrouter' },
  { label: 'Z.AI Coding Plan', value: 'zai-coding-plan' },
];

export const AGENT_MODEL_OPTIONS_BY_PROVIDER: Record<
  AgentModelProvider,
  { label: string; value: string }[]
> = {
  anthropic: [
    { label: 'Claude Opus 4.8', value: 'claude-opus-4-8' },
    { label: 'Claude Sonnet 4.6', value: 'claude-sonnet-4-6' },
    { label: 'Claude Haiku 4.5', value: 'claude-haiku-4-5' },
    { label: 'Claude Opus 4.7', value: 'claude-opus-4-7' },
    { label: 'Claude Opus 4.6', value: 'claude-opus-4-6' },
  ],
  openai: [
    { label: 'GPT-5.2', value: 'gpt-5.2' },
    { label: 'GPT-5.2 Pro', value: 'gpt-5.2-pro' },
    { label: 'GPT-5.1', value: 'gpt-5.1' },
    { label: 'GPT-5', value: 'gpt-5' },
    { label: 'GPT-5 Mini', value: 'gpt-5-mini' },
  ],
  gemini: [
    { label: 'Gemini 3 Pro (Preview)', value: 'gemini-3-pro-preview' },
    { label: 'Gemini 3 Flash (Preview)', value: 'gemini-3-flash-preview' },
    { label: 'Gemini 2.5 Pro', value: 'gemini-2.5-pro' },
    { label: 'Gemini 2.5 Flash', value: 'gemini-2.5-flash' },
  ],
  openrouter: [
    { label: 'OpenRouter Auto', value: 'openrouter/auto' },
    { label: 'Anthropic Claude 3.5 Sonnet', value: 'anthropic/claude-3.5-sonnet' },
  ],
  'zai-coding-plan': [{ label: 'GLM-4.7', value: 'glm-4.7' }],
};

export const DEFAULT_AGENT_MODEL_BY_COMPONENT: Record<
  string,
  { provider: AgentModelProvider; modelId: string }
> = {
  'core.ai.claude-code': { provider: 'anthropic', modelId: 'claude-sonnet-4-6' },
  'core.ai.opencode': { provider: 'anthropic', modelId: 'claude-sonnet-4-6' },
};

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
