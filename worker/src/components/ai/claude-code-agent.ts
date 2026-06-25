import { z } from 'zod';
import { randomUUID } from 'crypto';
import {
  componentRegistry,
  ComponentRetryPolicy,
  runComponentWithRunner,
  defineComponent,
  inputs,
  outputs,
  parameters,
  port,
  param,
  ServiceError,
  ContainerError,
  stripAnsiCodes,
  coerceBooleanFromText,
  coerceJsonFromText,
} from '@sentris/component-sdk';
import { LLMProviderSchema, llmProviderContractName } from '@sentris/contracts';
import { IsolatedContainerVolume } from '../../utils/isolated-volume';
import { getGatewaySessionToken } from './utils';
import {
  assertSkillsResolved,
  buildAgentPrompt,
  normalizeStructuredAgentOutput,
  buildClaudeMcpConfig,
  buildClaudeRunCommand,
  buildClaudeSettings,
  buildClaudeAuthEnv,
  buildClaudeModelEnv,
  buildClaudeEffortEnv,
  buildSupplementaryFiles,
  fetchAgentSkills,
  formatClaudeAuthErrorHint,
  type ClaudeAuthModel,
  mapAutoApprove,
  materializeSkillsToVolume,
  extractStructuredAgentJson,
  assertStructuredAgentOutput,
  sanitizeClaudeCodeReport,
} from './agent-runner-utils';
import { AgentStreamRecorder } from './agent-stream-recorder';

const AGENT_PLUGIN_OPTIONS = [
  { label: 'Oh My ClaudeCode', value: 'oh-my-claudecode' },
  { label: 'Superpowers', value: 'superpowers' },
] as const;

const inputSchema = inputs({
  task: port(
    z.string().min(1, 'Task cannot be empty').describe('The investigation task to perform.'),
    {
      label: 'Task',
      description: 'The main objective for the Claude Code agent.',
    },
  ),
  context: port(
    z.unknown().optional().describe('Contextual data (JSON) to assist the investigation.'),
    {
      label: 'Context',
      description: 'Optional JSON data providing context (alerts, logs, previous findings).',
      connectionType: { kind: 'primitive', name: 'json' },
      allowAny: true,
      reason: 'Context is a dynamic JSON object.',
    },
  ),
  model: port(
    LLMProviderSchema()
      .default({
        provider: 'anthropic',
        modelId: 'claude-sonnet-4-6',
      })
      .describe('Model configuration for the agent.'),
    {
      label: 'Model',
      description: 'LLM provider configuration (Anthropic recommended).',
      connectionType: { kind: 'contract', name: llmProviderContractName, credential: true },
    },
  ),
  tools: port(z.unknown().optional().describe('Anchor for tool-mode nodes.'), {
    label: 'Connected Tools',
    description: 'Connect tool-mode nodes here to expose them to the agent.',
    allowAny: true,
    reason: 'Tool-mode port acts as a graph anchor; payloads are not consumed directly.',
    connectionType: { kind: 'contract', name: 'mcp.tool' },
  }),
  trigger: port(z.unknown().optional().describe('Optional no-op gate input.'), {
    label: 'Trigger',
    description: 'Optional graph gate input; payloads are accepted but not consumed directly.',
    allowAny: true,
    reason: 'Trigger gates route execution without adding investigation context.',
  }),
  supplementaryInputA: port(
    z.string().optional().describe('Optional supplementary text written to supplementary-a.txt.'),
    {
      label: 'Supplementary Input A',
      description:
        'Optional text or data written to /workspace/supplementary-a.txt for the agent to read.',
    },
  ),
  supplementaryInputB: port(
    z.string().optional().describe('Optional supplementary text written to supplementary-b.txt.'),
    {
      label: 'Supplementary Input B',
      description:
        'Optional text or data written to /workspace/supplementary-b.txt for the agent to read.',
    },
  ),
});

const parameterSchema = parameters({
  systemPrompt: param(
    z.string().default('').describe('Optional investigator prompt template override.'),
    {
      label: 'System Prompt',
      editor: 'textarea',
      rows: 5,
      description: 'Override the default investigator prompt template.',
    },
  ),
  autoApprove: param(z.boolean().default(true).describe('Automatically approve agent actions.'), {
    label: 'Auto Approve',
    editor: 'boolean',
    description: 'If true, the agent runs without permission prompts.',
  }),
  providerConfig: param(
    coerceJsonFromText(z.record(z.string(), z.unknown()).default({})).describe(
      'Additional Claude Code settings merged into settings.json.',
    ),
    {
      label: 'Provider Config',
      editor: 'json',
      description: 'Additional settings merged into settings.json.',
    },
  ),
  skillIds: param(z.array(z.string().uuid()).default([]).describe('Agent skill IDs to inject.'), {
    label: 'Agent Skills',
    editor: 'multi-select',
    options: [],
    description: 'Select org Agent Skills to materialize under .claude/skills/.',
  }),
  enablePlugins: param(
    z
      .array(z.enum(['oh-my-claudecode', 'superpowers']))
      .default([])
      .describe('Optional Claude Code plugins to enable.'),
    {
      label: 'Plugins',
      editor: 'multi-select',
      options: [...AGENT_PLUGIN_OPTIONS],
      description: 'Enable pre-installed Claude Code plugins (when available in the image).',
    },
  ),
  structuredOutput: param(
    coerceBooleanFromText()
      .default(false)
      .describe('Fail the node when stdout is not parseable JSON.'),
    {
      label: 'Structured Output',
      editor: 'boolean',
      description:
        'When enabled, the agent must return parseable JSON or the run fails immediately.',
    },
  ),
  requiredOutputKeys: param(
    z.array(z.string().min(1)).default([]).describe('Required top-level keys in JSON output.'),
    {
      label: 'Required Output Keys',
      editor: 'json',
      description:
        'When structured output is enabled, fail if any listed keys are missing or invalid (e.g. candidates must be a non-empty array).',
    },
  ),
});

const outputSchema = outputs({
  report: port(z.string(), {
    label: 'Report',
    description: 'The final markdown report generated by the agent.',
  }),
  rawOutput: port(z.string(), {
    label: 'Raw Output',
    description: 'Full stdout/stderr logs from the agent execution.',
  }),
  agentRunId: port(z.string(), {
    label: 'Agent Run ID',
    description: 'Unique identifier for replaying this Claude Code session in the Agent tab.',
  }),
});

const CLAUDE_CODE_TIMEOUT_SECONDS = Number.parseInt(
  process.env.CLAUDE_CODE_TIMEOUT_SECONDS ?? '7200',
  10,
);
const AGENT_TRACE_TEXT_CHUNK_SIZE = 16_000;
const CLAUDE_FAILURE_TAIL_LENGTH = 2_000;

function toClaudeAuthModel(model: unknown): ClaudeAuthModel | undefined {
  if (!isRecord(model) || model.provider !== 'anthropic') {
    return undefined;
  }

  return {
    authMode: model.authMode === 'subscription_oauth' ? 'subscription_oauth' : 'api_key',
    apiKey: typeof model.apiKey === 'string' ? model.apiKey : undefined,
    oauthToken: typeof model.oauthToken === 'string' ? model.oauthToken : undefined,
  };
}

function getClaudeEffort(model: unknown): string | undefined {
  if (!isRecord(model) || model.provider !== 'anthropic') {
    return undefined;
  }

  return typeof model.effort === 'string' && model.effort.length > 0 ? model.effort : undefined;
}

function summarizeClaudeFailureOutput(output: unknown): string {
  if (typeof output !== 'string') {
    return '';
  }

  const cleaned = stripAnsiCodes(output)
    .replace(/\r/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .join('\n');

  if (!cleaned) {
    return '';
  }

  return cleaned.length > CLAUDE_FAILURE_TAIL_LENGTH
    ? cleaned.slice(-CLAUDE_FAILURE_TAIL_LENGTH)
    : cleaned;
}

const definition = defineComponent({
  id: 'core.ai.claude-code',
  label: 'Claude Code Agent',
  category: 'ai',
  runner: {
    kind: 'docker',
    image: 'ghcr.io/zebbern/claude-code:latest',
    entrypoint: 'claude',
    network: 'bridge' as const,
    command: ['--help'],
    timeoutSeconds: CLAUDE_CODE_TIMEOUT_SECONDS,
  },
  inputs: inputSchema,
  outputs: outputSchema,
  parameters: parameterSchema,
  docs: 'Runs the Claude Code CLI agent for autonomous investigations using connected MCP tools.',
  retryPolicy: {
    maxAttempts: 1,
    initialIntervalSeconds: 2,
    maximumIntervalSeconds: 10,
    backoffCoefficient: 2,
    nonRetryableErrorTypes: ['ValidationError', 'ConfigurationError'],
  } satisfies ComponentRetryPolicy,
  ui: {
    slug: 'claude-code-agent',
    version: '1.0.0',
    type: 'process',
    category: 'ai',
    description: 'Autonomous investigation agent powered by Claude Code CLI.',
    icon: 'Bot',
    author: {
      name: 'SentrisAI',
      type: 'sentris',
    },
  },
  async execute({ inputs, params }, context) {
    const { task, context: taskContext, model, supplementaryInputA, supplementaryInputB } = inputs;
    const {
      systemPrompt,
      providerConfig,
      autoApprove,
      skillIds,
      enablePlugins,
      structuredOutput,
      requiredOutputKeys,
    } = params;

    const { connectedToolNodeIds, organizationId } = context.metadata;
    const orgId = organizationId ?? context.organizationId ?? null;
    const agentRunId = `${context.runId}:${context.componentRef}:${randomUUID()}`;
    const agentStream = new AgentStreamRecorder(context, agentRunId);

    let gatewayToken = '';
    const connectedToolIds = connectedToolNodeIds ?? [];
    if (connectedToolIds.length > 0) {
      try {
        gatewayToken = await getGatewaySessionToken(context.runId, orgId, connectedToolIds);
      } catch (error: unknown) {
        context.logger.error(`[ClaudeCode] Failed to generate gateway token: ${error}`);
      }
    }

    const skills = await fetchAgentSkills(orgId, skillIds ?? []);
    assertSkillsResolved(skillIds ?? [], skills);

    const { claudeSkipPermissions } = mapAutoApprove(autoApprove ?? true);

    const settings = {
      ...buildClaudeSettings(claudeSkipPermissions),
      ...(providerConfig ?? {}),
    };

    const claudeAuthModel = toClaudeAuthModel(model);
    const providerEnv = {
      ...buildClaudeAuthEnv(claudeAuthModel),
      ...buildClaudeModelEnv(
        isRecord(model) && typeof model.modelId === 'string'
          ? { modelId: model.modelId }
          : undefined,
      ),
      ...buildClaudeEffortEnv(getClaudeEffort(model)),
    };
    const contextJson = JSON.stringify(taskContext ?? {}, null, 2);
    const supplementaryFiles = buildSupplementaryFiles({
      supplementaryInputA,
      supplementaryInputB,
    });
    const finalPrompt = buildAgentPrompt({
      task,
      systemPrompt,
      taskContext,
      supplementaryFiles: Object.keys(supplementaryFiles),
      structuredOutput: structuredOutput ?? false,
    });

    const tenantId = context.organizationId ?? 'default-tenant';
    const volume = new IsolatedContainerVolume(tenantId, context.runId);

    try {
      const wrapperScript = [
        '#!/bin/sh',
        'set -e',
        'cd /workspace',
        'echo "[ClaudeCode] Starting agent run..." >&2',
        buildClaudeRunCommand({
          skipPermissions: claudeSkipPermissions,
          enablePlugins: enablePlugins ?? [],
        }),
        '',
      ].join('\n');

      await volume.initialize({
        'context.json': contextJson,
        '.mcp.json': JSON.stringify(buildClaudeMcpConfig(gatewayToken), null, 2),
        'settings.json': JSON.stringify(settings, null, 2),
        'prompt.txt': finalPrompt,
        'run.sh': wrapperScript,
        ...supplementaryFiles,
        ...materializeSkillsToVolume(skills, 'claude'),
      });

      const runnerConfig = {
        ...definition.runner,
        entrypoint: '/bin/sh',
        command: ['/workspace/run.sh'],
        network: 'bridge' as const,
        env: providerEnv,
        volumes: [volume.getVolumeConfig('/workspace', false)],
        workingDir: '/workspace',
      };

      context.emitProgress({
        message: 'Running Claude Code agent...',
        level: 'info',
        data: {
          agentRunId,
          agentStatus: 'running',
        },
      });
      agentStream.emitMessageStart();

      const runnerResult = await runComponentWithRunner(
        runnerConfig,
        async (raw) => raw,
        {},
        context,
      ).catch((error: unknown) => {
        if (error instanceof ContainerError) {
          const terminalOutput = summarizeClaudeFailureOutput(error.details?.stdout);
          const message = terminalOutput
            ? `Claude Code container failed: ${terminalOutput}`
            : error.message;
          throw new ServiceError(message, {
            cause: error,
            details: {
              ...(error.details ?? {}),
              tool: 'claude-code',
              terminalOutput,
            },
          });
        }
        throw error;
      });

      let stdout = '';
      let stderr = '';
      let exitCode = 0;

      if (typeof runnerResult === 'string') {
        stdout = runnerResult;
      } else if (isRecord(runnerResult)) {
        stdout = (runnerResult.stdout as string) || (runnerResult.raw as string) || '';
        stderr = (runnerResult.stderr as string) || '';
        exitCode = typeof runnerResult.exitCode === 'number' ? runnerResult.exitCode : 0;
      }

      const rawOutput = stderr ? `STDERR:\n${stderr.slice(0, 32_768)}` : '';

      if (exitCode !== 0) {
        const authHint = formatClaudeAuthErrorHint(stderr, claudeAuthModel);
        const baseMessage = stderr
          ? `Claude Code exited with code ${exitCode}: ${stderr}`
          : `Claude Code exited with code ${exitCode}`;
        throw new ServiceError(authHint ? `${baseMessage}. ${authHint}` : baseMessage, {
          details: { exitCode, stderr, stdout, tool: 'claude-code' },
        });
      }

      let structured = extractStructuredAgentJson(stdout);
      if (structuredOutput && structured === null) {
        throw new ServiceError('Claude Code did not return parseable JSON', {
          details: {
            tool: 'claude-code',
            stdoutPreview: stdout.slice(0, 4000),
          },
        });
      }

      if (structuredOutput && structured !== null && requiredOutputKeys.length > 0) {
        structured = normalizeStructuredAgentOutput(structured, requiredOutputKeys);
        try {
          assertStructuredAgentOutput(structured, requiredOutputKeys);
        } catch (error) {
          throw new ServiceError(
            error instanceof Error ? error.message : 'Structured agent output validation failed',
            {
              details: {
                tool: 'claude-code',
                requiredOutputKeys,
                stdoutPreview: stdout.slice(0, 4000),
              },
            },
          );
        }
      }

      const report =
        structuredOutput && structured !== null
          ? JSON.stringify(structured)
          : sanitizeClaudeCodeReport(stdout);

      emitAgentText(agentStream, report);
      agentStream.emitFinish('stop', report);
      context.emitProgress({
        message: 'Claude Code agent completed.',
        level: 'info',
        data: {
          agentRunId,
          agentStatus: 'completed',
        },
      });

      return outputSchema.parse({
        report,
        rawOutput,
        agentRunId,
      });
    } finally {
      await volume.cleanup();
    }
  },
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function emitAgentText(agentStream: AgentStreamRecorder, text: string): void {
  if (!text.trim()) {
    return;
  }
  for (let offset = 0; offset < text.length; offset += AGENT_TRACE_TEXT_CHUNK_SIZE) {
    agentStream.emitTextDelta(text.slice(offset, offset + AGENT_TRACE_TEXT_CHUNK_SIZE));
  }
}

componentRegistry.register(definition);
