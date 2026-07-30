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
  coerceJsonFromText,
  stripAnsiCodes,
} from '@sentris/component-sdk';
import { LLMProviderSchema, llmProviderContractName } from '@sentris/contracts';
import { IsolatedContainerVolume } from '../../utils/isolated-volume';
import { prepareAgentGatewayAccess } from './agent-tool-access';
import {
  assertSkillsResolved,
  buildAgentPrompt,
  buildProviderEnv,
  buildSupplementaryFiles,
  fetchAgentSkills,
  getOpenCodeModelString,
  mapAutoApprove,
  materializeSkillsToVolume,
  mergeOpenCodePlugins,
  resolveGatewayMcpConfig,
} from './agent-runner-utils';
import { AgentStreamRecorder } from './agent-stream-recorder';
import {
  AGENT_EXECUTION_PROFILE_OPTIONS,
  DEFAULT_AGENT_EXECUTION_PROFILE,
  getAgentExecutionProfileConfig,
} from './agent-execution-profile';

const AGENT_PLUGIN_OPTIONS = [
  { label: 'Oh My ClaudeCode', value: 'oh-my-claudecode' },
  { label: 'Superpowers', value: 'superpowers' },
] as const;

const inputSchema = inputs({
  task: port(
    z.string().min(1, 'Task cannot be empty').describe('The investigation task to perform.'),
    {
      label: 'Task',
      description: 'The main objective for the OpenCode agent (e.g. "Investigate these alerts").',
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
        provider: 'openai',
        modelId: 'gpt-4o',
      })
      .describe('Model configuration for the agent.'),
    {
      label: 'Model',
      description: 'LLM provider configuration.',
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
        'Optional text or data written to /workspace/supplementary-a.txt for the agent to read (e.g. scanner JSON).',
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
    description: 'If true, the agent runs without user intervention.',
  }),
  providerConfig: param(
    coerceJsonFromText(z.record(z.string(), z.unknown()).default({})).describe(
      'Additional OpenCode provider configuration.',
    ),
    {
      label: 'Provider Config',
      editor: 'json',
      description: 'Additional configuration merged into opencode.jsonc.',
    },
  ),
  skillIds: param(z.array(z.string().uuid()).default([]).describe('Agent skill IDs to inject.'), {
    label: 'Agent Skills',
    editor: 'multi-select',
    options: [],
    description: 'Select org Agent Skills to materialize under .opencode/skills/.',
  }),
  enablePlugins: param(
    z
      .array(z.enum(['oh-my-claudecode', 'superpowers']))
      .default([])
      .describe('Optional OpenCode plugins to enable.'),
    {
      label: 'Plugins',
      editor: 'multi-select',
      options: [...AGENT_PLUGIN_OPTIONS],
      description: 'Enable pre-installed OpenCode plugins (when available in the image).',
    },
  ),
  executionProfile: param(
    z
      .enum(['fast', 'investigate', 'deep'])
      .default(DEFAULT_AGENT_EXECUTION_PROFILE)
      .describe('Execution budget for agent duration and container resources.'),
    {
      label: 'Execution Profile',
      editor: 'select',
      options: [...AGENT_EXECUTION_PROFILE_OPTIONS],
      description: 'Choose fast, investigative, or deep autonomous execution capacity.',
    },
  ),
  toolAvailability: param(
    z
      .enum(['required', 'best-effort'])
      .default('required')
      .describe('How to handle unavailable MCP tools.'),
    {
      label: 'Tool Availability',
      editor: 'select',
      options: [
        { label: 'Required', value: 'required' },
        { label: 'Best effort', value: 'best-effort' },
      ],
      description:
        'Fail when connected tools are unavailable, or continue with built-in capabilities.',
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
    description: 'Unique identifier for replaying this OpenCode session in the Agent tab.',
  }),
  toolStatus: port(
    z.object({
      requested: z.boolean(),
      status: z.enum(['not-requested', 'configured', 'degraded']),
      connectedNodeCount: z.number().int().nonnegative(),
      availableToolCount: z.number().int().nonnegative().optional(),
      message: z.string().optional(),
    }),
    {
      label: 'Tool Status',
      description: 'Whether connected MCP tools were requested and configured for this agent run.',
      connectionType: { kind: 'primitive', name: 'json' },
    },
  ),
});

const AGENT_TRACE_TEXT_CHUNK_SIZE = 16_000;

function getOpenCodeTimeoutSeconds(profileTimeoutSeconds: number): number {
  const configuredTimeout = process.env.OPENCODE_TIMEOUT_SECONDS;
  if (configuredTimeout === undefined) {
    return profileTimeoutSeconds;
  }

  const timeoutSeconds = Number.parseInt(configuredTimeout, 10);
  return Number.isFinite(timeoutSeconds) && timeoutSeconds > 0
    ? timeoutSeconds
    : profileTimeoutSeconds;
}

const definition = defineComponent({
  id: 'core.ai.opencode',
  label: 'OpenCode Agent',
  category: 'ai',
  runner: {
    kind: 'docker',
    image: 'ghcr.io/zebbern/opencode:latest',
    entrypoint: 'opencode',
    network: 'bridge' as const,
    command: ['help'],
    timeoutSeconds: getAgentExecutionProfileConfig(DEFAULT_AGENT_EXECUTION_PROFILE)
      .runnerTimeoutSeconds,
  },
  inputs: inputSchema,
  outputs: outputSchema,
  parameters: parameterSchema,
  docs: 'Runs the OpenCode agent to perform autonomous investigations using connected tools.',
  retryPolicy: {
    maxAttempts: 1,
    initialIntervalSeconds: 2,
    maximumIntervalSeconds: 10,
    backoffCoefficient: 2,
    nonRetryableErrorTypes: ['ValidationError', 'ConfigurationError'],
  } satisfies ComponentRetryPolicy,
  ui: {
    slug: 'opencode-agent',
    version: '1.0.0',
    type: 'process',
    category: 'ai',
    description: 'Autonomous coding and investigation agent.',
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
      executionProfile,
      toolAvailability,
    } = params;
    const profile = getAgentExecutionProfileConfig(executionProfile);

    const { connectedToolNodeIds, organizationId } = context.metadata;
    const orgId = organizationId ?? context.organizationId ?? null;
    const agentRunId = `${context.runId}:${context.componentRef}:${randomUUID()}`;
    const agentStream = new AgentStreamRecorder(context, agentRunId);

    const gatewayAccess = await prepareAgentGatewayAccess({
      runId: context.runId,
      organizationId: orgId,
      connectedToolNodeIds,
      ttlSeconds: profile.mcpTokenTtlSeconds,
      toolAvailability,
      onDegraded: (message) => {
        context.logger.warn(`[OpenCode] Connected MCP tools are unavailable: ${message}`);
        context.emitProgress({
          message: `Connected MCP tools are unavailable: ${message}`,
          level: 'warn',
        });
      },
    });

    const skills = await fetchAgentSkills(orgId, skillIds ?? []);
    assertSkillsResolved(skillIds ?? [], skills);

    const { opencodePermission } = mapAutoApprove(autoApprove ?? true);

    const providerConfigForOpenCode: Record<string, unknown> = {
      ...(model?.provider === 'zai-coding-plan' && model.apiKey
        ? {
            'zai-coding-plan': {
              options: {
                apiKey: model.apiKey,
              },
            },
          }
        : {}),
    };

    const opencodeConfig = {
      ...resolveGatewayMcpConfig(gatewayAccess.gatewayToken),
      provider: providerConfigForOpenCode,
      model: getOpenCodeModelString(model),
      permission: opencodePermission,
      ...mergeOpenCodePlugins(providerConfig ?? {}, enablePlugins ?? []),
    };

    const providerEnv = buildProviderEnv(model);
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
      toolStatus: gatewayAccess.toolStatus,
    });

    const tenantId = context.organizationId ?? 'default-tenant';
    const volume = new IsolatedContainerVolume(tenantId, context.runId);

    try {
      const wrapperScript = [
        '#!/bin/sh',
        'set -e',
        'cd /workspace',
        'echo "[OpenCode] Listing MCP tools before run..."',
        'opencode mcp list --log-level ERROR > /tmp/mcp_tools.txt 2>&1',
        'cat /tmp/mcp_tools.txt',
        'echo "[OpenCode] === Full tool list output above ==="',
        'echo "[OpenCode] Starting agent run..."',
        'opencode run --log-level ERROR "$(cat /workspace/prompt.txt)"',
        '',
      ].join('\n');

      const opencodeConfigJson = JSON.stringify(opencodeConfig, null, 2);
      await volume.initialize({
        'context.json': contextJson,
        'opencode.jsonc': opencodeConfigJson,
        'opencode.json': opencodeConfigJson,
        'prompt.txt': finalPrompt,
        'run.sh': wrapperScript,
        ...supplementaryFiles,
        ...materializeSkillsToVolume(skills, 'opencode'),
      });

      const runnerConfig = {
        ...definition.runner,
        timeoutSeconds: getOpenCodeTimeoutSeconds(profile.runnerTimeoutSeconds),
        memoryLimit: profile.memoryLimit,
        cpuLimit: profile.cpuLimit,
        pidsLimit: profile.pidsLimit,
        entrypoint: '/bin/sh',
        command: ['/workspace/run.sh'],
        network: 'bridge' as const,
        env: providerEnv,
        volumes: [volume.getVolumeConfig('/workspace', false)],
        workingDir: '/workspace',
      };

      context.emitProgress({
        message: 'Running OpenCode agent...',
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
      );

      let stdout = '';
      let stderr = '';

      if (typeof runnerResult === 'string') {
        stdout = runnerResult;
      } else if (isRecord(runnerResult)) {
        stdout = (runnerResult.stdout as string) || (runnerResult.raw as string) || '';
        stderr = (runnerResult.stderr as string) || '';
      }

      const report = sanitizeOpenCodeReport(stdout);
      emitAgentText(agentStream, report);
      agentStream.emitFinish('stop', report);
      context.emitProgress({
        message: 'OpenCode agent completed.',
        level: 'info',
        data: {
          agentRunId,
          agentStatus: 'completed',
        },
      });

      return outputSchema.parse({
        report,
        rawOutput: `STDOUT:\n${stdout}\n\nSTDERR:\n${stderr}`,
        agentRunId,
        toolStatus: gatewayAccess.toolStatus,
      });
    } finally {
      await agentStream.settleWithoutChangingExecution();
      await volume.cleanup();
    }
  },
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sanitizeOpenCodeReport(stdout: string): string {
  return stripAnsiCodes(stdout)
    .split(/\r?\n/)
    .filter((line) => !/^\[OpenCode\]/i.test(line.trim()))
    .join('\n')
    .trim();
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
