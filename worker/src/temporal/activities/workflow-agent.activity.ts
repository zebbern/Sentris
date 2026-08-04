import '../../components';

import { createHash } from 'node:crypto';
import { Context } from '@temporalio/activity';
import {
  ConfigurationError,
  NotFoundError,
  TEMPORAL_SPILL_THRESHOLD_BYTES,
  ValidationError,
  componentRegistry,
  type AgentTracePart,
  type IFileStorageService,
} from '@sentris/component-sdk';
import { LLMProviderSchema, type LlmProviderConfig } from '@sentris/contracts';
import {
  CapabilityGrantSchema,
  DurableMcpCapabilityCatalogSnapshotSchema,
  DurableMcpOperationInvocationManifestSchema,
  ExecutionScopeSchema,
  JsonObjectSchema,
  MCP_CAPABILITY_CONTRACT_VERSION,
  McpOperationSchema,
  McpOperationDispatchPlanSchema,
  McpOperationResultSchema,
  PromptDescriptorSchema,
  ResourceDescriptorSchema,
  ResourceTemplateDescriptorSchema,
  SecretEncryption,
  ToolDescriptorSchema,
  parseMasterKey,
  type ExecutionScope,
  type JsonObject,
  type McpOperation,
  type McpOperationResult,
  type PromptDescriptor,
  type ResourceDescriptor,
  type ResourceTemplateDescriptor,
  type ToolDescriptor,
} from '@sentris/shared';
import {
  jsonSchema,
  modelMessageSchema,
  streamText,
  tool,
  type ModelMessage,
  type ToolResultPart,
  type ToolSet,
} from 'ai';
import { z } from 'zod';

import {
  aiAgentInputSchema,
  aiAgentParameterSchema,
  ensureAgentModelName,
  selectAgentApiKey,
} from '../../components/ai/ai-agent';
import {
  getToolAvailabilityPrompt,
  type AgentToolStatus,
} from '../../components/ai/agent-tool-access';
import { getAgentExecutionProfileConfig } from '../../components/ai/agent-execution-profile';
import {
  createSentrisLanguageModel,
  resolveSentrisProviderBaseUrl,
  type SentrisModelFactories,
} from '../../components/ai/model-factory';
import { assertProviderModelFinished } from '../../components/ai/model-finish';
import { buildBackendApiUrl } from '../../common/backend-url';
import {
  createLightweightSummary,
  maskSecretInputs,
  maskSecretOutputs,
} from '../utils/component-output';
import { recordNodeIoWithoutChangingExecution } from '../utils/node-io-delivery';
import type {
  WorkflowAgentCheckpointInput,
  WorkflowAgentFailureInput,
  WorkflowAgentFinalizeInput,
  WorkflowAgentModelStepInput,
  WorkflowAgentModelStepOutput,
  WorkflowAgentSetupInput,
  WorkflowAgentSetupOutput,
  WorkflowAgentStateRef,
  WorkflowAgentToolCall,
  WorkflowAgentToolDispatchInput,
  WorkflowAgentToolExecutionOutput,
  WorkflowAgentToolPreparationInput,
  WorkflowAgentToolPreparationOutput,
  WorkflowAgentToolReconcileInput,
  WorkflowAgentTurnInput,
} from '../workflow-agent-types';
import { unspill } from './spill-resolver';
import { validateRequiredInputs } from './input-validator';
import {
  dispatchMcpOperationActivity,
  prepareMcpOperationActivity,
  reconcileMcpOperationActivity,
} from './mcp-invocation.activity';
import { getComponentActivityServices } from './run-component.activity';

const STORED_STATE_VERSION = 1 as const;
const MAX_STATE_CHAIN_DEPTH = 300;
const MAX_TOOL_CALLS_PER_MODEL_STEP = 32;
const TOOL_RESULT_ERROR_LIMIT = 8_000;
const AGENT_TRACE_STEP_STRIDE = 100_000;
const AGENT_TRACE_MODEL_OFFSET = 10_000;
const AGENT_TRACE_TOOL_INPUT_OFFSET = 50_000;
const AGENT_TRACE_TOOL_OUTPUT_OFFSET = 60_000;
const AGENT_TRACE_FINISH_SEQUENCE = 90_000_000;

interface WorkflowAgentActivityOverrides {
  fetchImpl?: typeof fetch;
  streamTextImpl?: typeof streamText;
  modelFactories?: SentrisModelFactories;
}

let activityOverrides: WorkflowAgentActivityOverrides = {};

/** Test/runtime injection seam; production uses the installed AI SDK and global fetch. */
export function initializeWorkflowAgentActivityOverrides(
  overrides: WorkflowAgentActivityOverrides = {},
): void {
  activityOverrides = overrides;
}

const toolStatusSchema = z
  .object({
    requested: z.boolean(),
    status: z.enum(['not-requested', 'configured', 'degraded']),
    connectedNodeCount: z.number().int().nonnegative(),
    availableToolCount: z.number().int().nonnegative().optional(),
    availableResourceCount: z.number().int().nonnegative().optional(),
    availablePromptCount: z.number().int().nonnegative().optional(),
    message: z.string().optional(),
  })
  .strict();

const modelActivityTimeoutSchema = z
  .enum(['10 minutes', '45 minutes', '135 minutes'])
  .default('45 minutes');

const credentialSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('secret'), secretId: z.string().min(1) }).strict(),
  z
    .object({
      kind: z.literal('sealed'),
      ciphertext: z.string().min(1),
      iv: z.string().min(1),
      authTag: z.string().min(1),
      keyId: z.string().min(1),
    })
    .strict(),
]);

const storedToolCallSchema = z
  .object({
    modelToolCallId: z.string().min(1),
    toolName: z.string().min(1),
    sourceId: z.string().min(1),
    arguments: JsonObjectSchema,
    authorizationTarget: z.string().min(1).optional(),
    operation: McpOperationSchema.optional(),
  })
  .strict();

const authorityRefSchema = z
  .object({
    scope: ExecutionScopeSchema,
    capabilitySnapshotId: z.string().uuid(),
  })
  .strict();

const storedRootStateSchema = z
  .object({
    version: z.literal(STORED_STATE_VERSION),
    kind: z.literal('root'),
    stateId: z.string().uuid(),
    agentRunId: z.string().min(1),
    runId: z.string().min(1),
    nodeRef: z.string().min(1),
    sessionId: z.string().uuid(),
    systemPrompt: z.string(),
    messages: z.array(modelMessageSchema),
    memorySize: z.number().int().min(2).max(50),
    temperature: z.number().min(0).max(2),
    maxTokens: z.number().int().positive(),
    stepLimit: z.number().int().min(1).max(128),
    toolTimeoutMs: z.number().int().positive(),
    modelActivityTimeout: modelActivityTimeoutSchema,
    model: LLMProviderSchema(),
    credential: credentialSchema,
    tools: z.array(ToolDescriptorSchema),
    resources: z.array(ResourceDescriptorSchema).default([]),
    resourceTemplates: z.array(ResourceTemplateDescriptorSchema).default([]),
    prompts: z.array(PromptDescriptorSchema).default([]),
    toolStatus: toolStatusSchema,
    authority: authorityRefSchema.optional(),
    startDeliveryCompleted: z.boolean(),
  })
  .strict();

const storedModelDeltaSchema = z
  .object({
    version: z.literal(STORED_STATE_VERSION),
    kind: z.literal('model'),
    stateId: z.string().uuid(),
    rootFileId: z.string().uuid(),
    previousFileId: z.string().uuid(),
    agentRunId: z.string().min(1),
    step: z.number().int().nonnegative(),
    messages: z.array(modelMessageSchema),
    responseText: z.string(),
    finishReason: z.string(),
    toolCalls: z.array(storedToolCallSchema).max(MAX_TOOL_CALLS_PER_MODEL_STEP),
  })
  .strict();

const storedToolDeltaSchema = z
  .object({
    version: z.literal(STORED_STATE_VERSION),
    kind: z.literal('tool'),
    stateId: z.string().uuid(),
    rootFileId: z.string().uuid(),
    previousFileId: z.string().uuid(),
    agentRunId: z.string().min(1),
    step: z.number().int().nonnegative(),
    messages: z.array(modelMessageSchema),
  })
  .strict();

const storedStateSchema = z.discriminatedUnion('kind', [
  storedRootStateSchema,
  storedModelDeltaSchema,
  storedToolDeltaSchema,
]);

const storedDispatchPlanSchema = z
  .object({
    version: z.literal(STORED_STATE_VERSION),
    agentRunId: z.string().min(1),
    rootFileId: z.string().uuid(),
    plan: McpOperationDispatchPlanSchema,
  })
  .strict();

type StoredRootState = z.infer<typeof storedRootStateSchema>;
type StoredState = z.infer<typeof storedStateSchema>;
type StoredModelDelta = z.infer<typeof storedModelDeltaSchema>;

const runAuthorityResponseSchema = z
  .object({
    grant: CapabilityGrantSchema,
    snapshot: DurableMcpCapabilityCatalogSnapshotSchema,
    manifest: DurableMcpOperationInvocationManifestSchema,
  })
  .strict();

export async function workflowAgentSetupActivity(
  input: WorkflowAgentSetupInput,
): Promise<WorkflowAgentSetupOutput> {
  const heartbeatTimer = startPeriodicHeartbeat('workflow-agent:setup');
  try {
    return await setupWorkflowAgent(input);
  } finally {
    clearInterval(heartbeatTimer);
  }
}

async function setupWorkflowAgent(
  input: WorkflowAgentSetupInput,
): Promise<WorkflowAgentSetupOutput> {
  const scopedStorage = requireStorage(input.component.organizationId ?? null);
  const component = requireAgentComponent();
  const existing = await readOptionalJson(
    scopedStorage,
    input.initialStateFileId,
    storedRootStateSchema,
  );
  if (existing) {
    assertStoredOwnership(existing, input);
    if (existing.startDeliveryCompleted) return setupOutput(existing);
    await recordAgentStarted(input, component);
    const completed = { ...existing, startDeliveryCompleted: true };
    await writeJson(scopedStorage, completed.stateId, 'workflow-agent-root.json', completed);
    return setupOutput(completed);
  }

  const resolvedInputs = { ...input.component.inputs };
  const resolvedParams = { ...input.component.params };
  const warnings = [...(input.component.warnings ?? [])];
  const cache = new Map<string, unknown>();
  await unspill(
    resolvedInputs,
    'Input',
    scopedStorage,
    cache,
    warnings,
    input.component.organizationId ?? null,
  );
  await unspill(
    resolvedParams,
    'Parameter',
    scopedStorage,
    cache,
    warnings,
    input.component.organizationId ?? null,
  );
  validateRequiredInputs(
    warnings,
    component,
    resolvedParams,
    undefined,
    input.component.action.ref,
  );

  const parsedInputs = aiAgentInputSchema.parse(resolvedInputs);
  const parsedParams = aiAgentParameterSchema.parse(resolvedParams);
  const userInput = parsedInputs.userInput.trim();
  if (!userInput) {
    throw new ValidationError('AI Agent requires a non-empty user input.');
  }

  const provider = parsedInputs.chatModel.provider;
  const model: LlmProviderConfig = {
    ...parsedInputs.chatModel,
    modelId: ensureAgentModelName(provider, parsedInputs.chatModel.modelId),
    ...(resolveSentrisProviderBaseUrl(provider, parsedInputs.chatModel.baseUrl)
      ? { baseUrl: resolveSentrisProviderBaseUrl(provider, parsedInputs.chatModel.baseUrl) }
      : {}),
  };
  const credential = await resolveCredential(input, model, parsedInputs.modelApiKey);
  const profile = getAgentExecutionProfileConfig(parsedParams.executionProfile);
  const stepLimit = parsedParams.stepLimit ?? profile.defaultStepLimit;
  const incomingMessages = normalizeIncomingMessages(
    parsedInputs.conversationState?.messages ?? [],
  );
  const previousSystem = firstSystemMessage(parsedInputs.conversationState?.messages ?? []);
  const systemPrompt = parsedParams.systemPrompt.trim() || previousSystem;
  const messages = trimModelMessages(
    [...incomingMessages, { role: 'user', content: userInput }],
    parsedParams.memorySize,
  );
  const sessionId = parsedInputs.conversationState?.sessionId ?? input.initialStateFileId;
  const capability = await prepareCapabilityAccess(input, parsedParams.toolAvailability);
  const root = storedRootStateSchema.parse({
    version: STORED_STATE_VERSION,
    kind: 'root',
    stateId: input.initialStateFileId,
    agentRunId: input.agentRunId,
    runId: input.component.runId,
    nodeRef: input.component.action.ref,
    sessionId,
    systemPrompt: `${systemPrompt}${getToolAvailabilityPrompt(capability.toolStatus)}`,
    messages,
    memorySize: parsedParams.memorySize,
    temperature: parsedParams.temperature,
    maxTokens: parsedParams.maxTokens,
    stepLimit,
    toolTimeoutMs: profile.runnerTimeoutSeconds * 1_000,
    modelActivityTimeout: profile.activityTimeout,
    model: withoutResolvedCredential(model),
    credential,
    tools: capability.tools,
    resources: capability.resources,
    resourceTemplates: capability.resourceTemplates,
    prompts: capability.prompts,
    toolStatus: capability.toolStatus,
    ...(capability.authority ? { authority: capability.authority } : {}),
    startDeliveryCompleted: false,
  });
  throwIfActivityCancelled();
  await writeJson(scopedStorage, input.initialStateFileId, 'workflow-agent-root.json', root);
  await recordAgentStarted(input, component);
  const completed = { ...root, startDeliveryCompleted: true };
  await writeJson(scopedStorage, completed.stateId, 'workflow-agent-root.json', completed);
  return setupOutput(completed);
}

async function recordAgentStarted(
  input: WorkflowAgentSetupInput,
  component: ReturnType<typeof requireAgentComponent>,
): Promise<void> {
  throwIfActivityCancelled();
  await recordNodeIoWithoutChangingExecution(() =>
    getComponentActivityServices().nodeIO?.recordStart({
      runId: input.component.runId,
      nodeRef: input.component.action.ref,
      workflowId: input.component.workflowId,
      organizationId: input.component.organizationId ?? null,
      componentId: input.component.action.componentId,
      inputs: maskSecretInputs(component, {
        ...input.component.inputs,
        ...input.component.params,
      }) as Record<string, unknown>,
    }),
  );
  await recordTraceWithoutChangingExecution(input, {
    eventId: `trace:${input.component.runId}:workflow-agent:${input.agentRunId}:started`,
    type: 'NODE_STARTED',
    level: 'info',
  });
  await recordTraceWithoutChangingExecution(input, {
    eventId: `trace:${input.component.runId}:workflow-agent:${input.agentRunId}:progress-started`,
    type: 'NODE_PROGRESS',
    level: 'info',
    message: 'AI agent session started',
    data: {
      agentRunId: input.agentRunId,
      agentStatus: 'started',
    },
  });
  await publishAgentPart(input, 1, {
    type: 'message-start',
    messageId: input.agentRunId,
    role: 'assistant',
  });
}

export async function workflowAgentModelStepActivity(
  input: WorkflowAgentModelStepInput,
): Promise<WorkflowAgentModelStepOutput> {
  const heartbeatTimer = startPeriodicHeartbeat(`workflow-agent:model:${input.step}:waiting`);
  try {
    return await runWorkflowAgentModelStep(input);
  } finally {
    clearInterval(heartbeatTimer);
  }
}

async function runWorkflowAgentModelStep(
  input: WorkflowAgentModelStepInput,
): Promise<WorkflowAgentModelStepOutput> {
  const scopedStorage = requireStorage(input.component.organizationId ?? null);
  const outputStateFileId = activityAttemptFileId(
    input.outputStateFileId,
    Context.current().info.attempt,
  );
  const existing = await readOptionalJson(scopedStorage, outputStateFileId, storedModelDeltaSchema);
  if (existing) {
    assertStoredOwnership(existing, input);
    return modelStepOutput(existing);
  }

  const { root, messages } = await loadConversation(scopedStorage, input.state, input);
  const apiKey = await resolveCredentialValue(root, input.component.organizationId ?? null);
  const modelConfig = { ...root.model, apiKey } as LlmProviderConfig;
  const languageModel = createSentrisLanguageModel(
    modelConfig,
    selectAgentApiKey(modelConfig.provider, modelConfig),
    activityOverrides.modelFactories,
  );
  const modelOperations = buildModelOperations(root);
  const tools = buildModelTools(modelOperations);
  const activityContext = Context.current();
  const result = (activityOverrides.streamTextImpl ?? streamText)({
    model: languageModel,
    system: root.systemPrompt || undefined,
    messages,
    temperature: root.temperature,
    maxOutputTokens: root.maxTokens,
    maxRetries: 0,
    abortSignal: activityContext.cancellationSignal,
    ...(Object.keys(tools).length > 0 ? { tools, toolChoice: 'auto' as const } : {}),
  });

  const traceBase = AGENT_TRACE_MODEL_OFFSET + input.step * AGENT_TRACE_STEP_STRIDE;
  let textSequence = traceBase + 1;
  let textStarted = false;
  for await (const part of result.fullStream) {
    activityContext.heartbeat(`workflow-agent:model:${input.step}:${part.type}`);
    if (part.type === 'text-delta') {
      if (!textStarted) {
        textStarted = true;
        await publishAgentPart(input, textSequence++, {
          type: 'data-text-start',
          data: { id: `${input.agentRunId}:text:${input.step}` },
        });
      }
      await publishAgentPart(input, textSequence++, {
        type: 'text-delta',
        id: `${input.agentRunId}:text:${input.step}`,
        textDelta: part.text,
      });
    } else if (part.type === 'error') {
      throw part.error;
    }
  }
  if (textStarted) {
    await publishAgentPart(input, textSequence, {
      type: 'data-text-end',
      data: { id: `${input.agentRunId}:text:${input.step}` },
    });
  }

  const [responseText, finishReason, rawFinishReason, response, rawToolCalls] = await Promise.all([
    result.text,
    result.finishReason,
    result.rawFinishReason,
    result.response,
    result.toolCalls,
  ]);
  assertProviderModelFinished({ finishReason: String(finishReason), rawFinishReason }, 'AI Agent');
  if (rawToolCalls.length > MAX_TOOL_CALLS_PER_MODEL_STEP) {
    throw new ValidationError(
      `AI Agent requested ${rawToolCalls.length} tools in one model step; the maximum is ${MAX_TOOL_CALLS_PER_MODEL_STEP}.`,
    );
  }
  const descriptors = new Map(
    modelOperations.map((descriptor) => [descriptor.modelName, descriptor]),
  );
  const toolCalls: WorkflowAgentToolCall[] = rawToolCalls.map((call) => {
    const descriptor = descriptors.get(call.toolName);
    if (!descriptor) {
      throw new ValidationError(`AI Agent requested an unavailable tool: ${call.toolName}`);
    }
    const argumentsResult = JsonObjectSchema.safeParse(call.input);
    if (!argumentsResult.success) {
      throw new ValidationError(`AI Agent produced invalid input for tool: ${call.toolName}`);
    }
    return {
      modelToolCallId: call.toolCallId,
      toolName: call.toolName,
      sourceId: descriptor.sourceId,
      arguments: argumentsResult.data,
      authorizationTarget: descriptor.authorizationTarget,
      operation: descriptor.toOperation(argumentsResult.data),
    };
  });
  await Promise.all(
    toolCalls.map((call, index) =>
      publishAgentPart(input, traceBase + AGENT_TRACE_TOOL_INPUT_OFFSET + index, {
        type: 'tool-input-available',
        toolCallId: call.modelToolCallId,
        toolName: call.toolName,
        input: call.arguments,
      }),
    ),
  );
  const responseMessages = z.array(modelMessageSchema).parse(response.messages);
  const delta = storedModelDeltaSchema.parse({
    version: STORED_STATE_VERSION,
    kind: 'model',
    stateId: outputStateFileId,
    rootFileId: input.state.rootFileId,
    previousFileId: input.state.fileId,
    agentRunId: input.agentRunId,
    step: input.step,
    messages: responseMessages,
    responseText,
    finishReason: String(finishReason),
    toolCalls,
  });
  throwIfActivityCancelled();
  await writeJson(scopedStorage, delta.stateId, 'workflow-agent-model-step.json', delta);
  return modelStepOutput(delta);
}

export async function workflowAgentPrepareToolActivity(
  input: WorkflowAgentToolPreparationInput,
): Promise<WorkflowAgentToolPreparationOutput> {
  const scopedStorage = requireStorage(input.component.organizationId ?? null);
  const existingResult = await readOptionalJson(
    scopedStorage,
    input.resultFileId,
    McpOperationResultSchema,
  );
  if (existingResult) {
    await publishToolResult(input, existingResult);
    return { kind: 'terminal', result: compactToolResult(input.resultFileId, existingResult) };
  }
  const existingPlan = await readOptionalJson(
    scopedStorage,
    input.planFileId,
    storedDispatchPlanSchema,
  );
  if (existingPlan) {
    assertPlanOwnership(existingPlan, input);
    return { kind: 'prepared', planFileId: input.planFileId, resultFileId: input.resultFileId };
  }

  const modelDelta = await readRequiredJson(
    scopedStorage,
    input.state.fileId,
    storedModelDeltaSchema,
  );
  assertStoredOwnership(modelDelta, input);
  const root = await readRequiredJson(scopedStorage, input.state.rootFileId, storedRootStateSchema);
  assertStoredOwnership(root, input);
  if (!root.authority || !sameAuthority(root.authority, input.authority)) {
    throw new ValidationError('AI Agent tool authority did not match its immutable root state.');
  }
  const call = modelDelta.toolCalls[input.toolIndex];
  if (!call) {
    throw new ValidationError(`AI Agent tool call index ${input.toolIndex} does not exist.`);
  }
  const request = {
    invocationId: input.invocationId,
    scope: input.authority.scope,
    capabilitySnapshotId: input.authority.capabilitySnapshotId,
    sourceId: call.sourceId,
    authorizationTarget: call.authorizationTarget ?? call.toolName,
    operation:
      call.operation ??
      ({
        kind: 'tool-call' as const,
        name: call.toolName,
        arguments: call.arguments,
      } satisfies McpOperation),
    requestedAt: input.requestedAt,
    deadlineAt: input.deadlineAt,
  };
  const outcome = await prepareMcpOperationActivity(request);
  if (outcome.kind === 'terminal') {
    await writeJson(
      scopedStorage,
      input.resultFileId,
      'workflow-agent-tool-result.json',
      outcome.result,
    );
    await publishToolResult(input, outcome.result);
    return {
      kind: 'terminal',
      result: compactToolResult(input.resultFileId, outcome.result),
    };
  }
  await writeJson(scopedStorage, input.planFileId, 'workflow-agent-tool-plan.json', {
    version: STORED_STATE_VERSION,
    agentRunId: input.agentRunId,
    rootFileId: input.state.rootFileId,
    plan: outcome.plan,
  });
  return { kind: 'prepared', planFileId: input.planFileId, resultFileId: input.resultFileId };
}

export async function workflowAgentDispatchToolActivity(
  input: WorkflowAgentToolDispatchInput,
): Promise<WorkflowAgentToolExecutionOutput> {
  const scopedStorage = requireStorage(input.component.organizationId ?? null);
  const existing = await readOptionalJson(
    scopedStorage,
    input.resultFileId,
    McpOperationResultSchema,
  );
  if (existing) {
    await publishToolResult(input, existing);
    return compactToolResult(input.resultFileId, existing);
  }
  const storedPlan = await readRequiredJson(
    scopedStorage,
    input.planFileId,
    storedDispatchPlanSchema,
  );
  assertPlanOwnership(storedPlan, input);
  const result = await dispatchMcpOperationActivity(storedPlan.plan);
  await writeJson(scopedStorage, input.resultFileId, 'workflow-agent-tool-result.json', result);
  await publishToolResult(input, result);
  return compactToolResult(input.resultFileId, result);
}

export async function workflowAgentReconcileToolActivity(
  input: WorkflowAgentToolReconcileInput,
): Promise<WorkflowAgentToolExecutionOutput> {
  const scopedStorage = requireStorage(input.component.organizationId ?? null);
  const existing = await readOptionalJson(
    scopedStorage,
    input.resultFileId,
    McpOperationResultSchema,
  );
  if (existing) {
    await publishToolResult(input, existing);
    return compactToolResult(input.resultFileId, existing);
  }
  const storedPlan = await readRequiredJson(
    scopedStorage,
    input.planFileId,
    storedDispatchPlanSchema,
  );
  assertPlanOwnership(storedPlan, input);
  const result = await reconcileMcpOperationActivity({
    ref: storedPlan.plan.ref,
    cause: input.cause,
    message: toolReconciliationMessage(input.cause),
    completedAt: new Date().toISOString(),
  });
  await writeJson(scopedStorage, input.resultFileId, 'workflow-agent-tool-result.json', result);
  await publishToolResult(input, result);
  return compactToolResult(input.resultFileId, result);
}

export async function workflowAgentCheckpointActivity(
  input: WorkflowAgentCheckpointInput,
): Promise<WorkflowAgentStateRef> {
  throwIfActivityCancelled();
  const scopedStorage = requireStorage(input.component.organizationId ?? null);
  const existing = await readOptionalJson(
    scopedStorage,
    input.outputStateFileId,
    storedToolDeltaSchema,
  );
  if (existing) {
    assertStoredOwnership(existing, input);
    return { fileId: existing.stateId, rootFileId: existing.rootFileId };
  }
  const modelDelta = await readRequiredJson(
    scopedStorage,
    input.state.fileId,
    storedModelDeltaSchema,
  );
  assertStoredOwnership(modelDelta, input);
  if (modelDelta.toolCalls.length !== input.executions.length) {
    throw new ValidationError('AI Agent tool execution count did not match the model response.');
  }
  const results = await Promise.all(
    input.executions.map((execution) =>
      readRequiredJson(scopedStorage, execution.resultFileId, McpOperationResultSchema),
    ),
  );
  const toolMessage: ModelMessage = {
    role: 'tool',
    content: modelDelta.toolCalls.map((call, index) => ({
      type: 'tool-result',
      toolCallId: call.modelToolCallId,
      toolName: call.toolName,
      output: toToolResultOutput(results[index]!),
    })),
  };
  const delta = storedToolDeltaSchema.parse({
    version: STORED_STATE_VERSION,
    kind: 'tool',
    stateId: input.outputStateFileId,
    rootFileId: input.state.rootFileId,
    previousFileId: input.state.fileId,
    agentRunId: input.agentRunId,
    step: input.step,
    messages: [toolMessage],
  });
  throwIfActivityCancelled();
  await writeJson(scopedStorage, delta.stateId, 'workflow-agent-tool-checkpoint.json', delta);
  return { fileId: delta.stateId, rootFileId: delta.rootFileId };
}

export async function workflowAgentFinalizeActivity(
  input: WorkflowAgentFinalizeInput,
): Promise<{ output: unknown }> {
  throwIfActivityCancelled();
  const scopedStorage = requireStorage(input.component.organizationId ?? null);
  const component = requireAgentComponent();
  const { root, messages, latestResponseText, latestFinishReason } = await loadConversation(
    scopedStorage,
    input.state,
    input,
  );
  const conversationMessages: { role: string; content: unknown }[] = [
    ...(root.systemPrompt
      ? [{ role: 'system', content: stripToolAvailabilityPrompt(root.systemPrompt) }]
      : []),
    ...trimModelMessages(messages, root.memorySize),
  ];
  let output: unknown = {
    responseText: latestResponseText,
    conversationState: {
      sessionId: root.sessionId,
      messages: conversationMessages,
    },
    agentRunId: input.agentRunId,
    toolStatus: input.toolStatus,
  };
  const serialized = JSON.stringify(output);
  if (Buffer.byteLength(serialized, 'utf8') > TEMPORAL_SPILL_THRESHOLD_BYTES) {
    await scopedStorage.uploadFile(
      input.outputFileId,
      'workflow-agent-output.json',
      Buffer.from(serialized),
      'application/json',
    );
    output = {
      __spilled__: true,
      storageRef: input.outputFileId,
      originalSize: Buffer.byteLength(serialized, 'utf8'),
    };
  }
  throwIfActivityCancelled();
  await recordNodeIoWithoutChangingExecution(() =>
    getComponentActivityServices().nodeIO?.recordCompletion({
      runId: input.component.runId,
      nodeRef: input.component.action.ref,
      organizationId: input.component.organizationId ?? null,
      componentId: input.component.action.componentId,
      outputs: maskSecretOutputs(component, output) as Record<string, unknown>,
      status: 'completed',
    }),
  );
  await recordTraceWithoutChangingExecution(input, {
    eventId: `trace:${input.component.runId}:workflow-agent:${input.agentRunId}:completed`,
    type: 'NODE_COMPLETED',
    level: 'info',
    outputSummary: createLightweightSummary(component, output),
  });
  await publishAgentPart(input, AGENT_TRACE_FINISH_SEQUENCE, {
    type: 'finish',
    finishReason: latestFinishReason,
    responseText: latestResponseText,
  });
  return { output };
}

export async function workflowAgentFailActivity(input: WorkflowAgentFailureInput): Promise<void> {
  const message = redactCredentialText(input.error).slice(0, TOOL_RESULT_ERROR_LIMIT);
  await recordNodeIoWithoutChangingExecution(() =>
    getComponentActivityServices().nodeIO?.recordCompletion({
      runId: input.component.runId,
      nodeRef: input.component.action.ref,
      organizationId: input.component.organizationId ?? null,
      componentId: input.component.action.componentId,
      outputs: {},
      status: 'failed',
      errorMessage: message,
    }),
  );
  await recordTraceWithoutChangingExecution(input, {
    eventId: `trace:${input.component.runId}:workflow-agent:${input.agentRunId}:failed`,
    type: 'NODE_FAILED',
    level: 'error',
    error: message,
  });
  await publishAgentPart(input, AGENT_TRACE_FINISH_SEQUENCE, {
    type: 'finish',
    finishReason: input.cancelled ? 'other' : 'error',
    responseText: message,
  });
}

async function prepareCapabilityAccess(
  input: WorkflowAgentSetupInput,
  availability: 'required' | 'best-effort',
): Promise<{
  tools: ToolDescriptor[];
  resources: ResourceDescriptor[];
  resourceTemplates: ResourceTemplateDescriptor[];
  prompts: PromptDescriptor[];
  toolStatus: AgentToolStatus;
  authority?: { scope: ExecutionScope; capabilitySnapshotId: string };
}> {
  const allowedNodeIds = input.component.metadata?.connectedToolNodeIds ?? [];
  if (allowedNodeIds.length === 0) {
    return {
      tools: [],
      resources: [],
      resourceTemplates: [],
      prompts: [],
      toolStatus: {
        requested: false,
        status: 'not-requested',
        connectedNodeCount: 0,
      },
    };
  }
  try {
    const token = process.env.INTERNAL_SERVICE_TOKEN?.trim();
    if (!token) throw new Error('internal service authentication is not configured');
    const context = Context.current();
    context.heartbeat('workflow-agent:authority:request');
    const response = await (activityOverrides.fetchImpl ?? fetch)(
      buildBackendApiUrl('internal/mcp/run-authority'),
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Internal-Token': token,
        },
        body: JSON.stringify({
          runId: input.component.runId,
          organizationId: input.component.organizationId ?? null,
          invokingNodeId: input.component.action.ref,
        }),
        signal: context.cancellationSignal,
      },
    );
    context.heartbeat('workflow-agent:authority:response');
    if (!response.ok) {
      throw new Error(`run authority returned HTTP ${response.status}`);
    }
    const authority = runAuthorityResponseSchema.parse(await response.json());
    if (
      authority.snapshot.version !== MCP_CAPABILITY_CONTRACT_VERSION ||
      authority.manifest.version !== MCP_CAPABILITY_CONTRACT_VERSION
    ) {
      throw new Error('run authority did not return the durable MCP contract');
    }
    const availableResourceCount =
      authority.snapshot.resources.length + authority.snapshot.resourceTemplates.length;
    const availableCapabilityCount =
      authority.snapshot.tools.length + availableResourceCount + authority.snapshot.prompts.length;
    if (availableCapabilityCount === 0) {
      throw new Error('capability snapshot contained zero usable capabilities');
    }
    return {
      tools: authority.snapshot.tools,
      resources: authority.snapshot.resources,
      resourceTemplates: authority.snapshot.resourceTemplates,
      prompts: authority.snapshot.prompts,
      toolStatus: {
        requested: true,
        status: 'configured',
        connectedNodeCount: allowedNodeIds.length,
        availableToolCount: authority.snapshot.tools.length,
        availableResourceCount,
        availablePromptCount: authority.snapshot.prompts.length,
      },
      authority: {
        scope: authority.snapshot.scope,
        capabilitySnapshotId: authority.snapshot.id,
      },
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    if (availability === 'required') {
      throw new ConfigurationError(
        `Connected MCP capabilities are required but unavailable: ${message}`,
        { configKey: 'toolAvailability' },
      );
    }
    return {
      tools: [],
      resources: [],
      resourceTemplates: [],
      prompts: [],
      toolStatus: {
        requested: true,
        status: 'degraded',
        connectedNodeCount: allowedNodeIds.length,
        message,
      },
    };
  }
}

async function resolveCredential(
  input: WorkflowAgentSetupInput,
  model: LlmProviderConfig,
  legacyModelApiKey?: string,
): Promise<z.infer<typeof credentialSchema>> {
  if (model.provider === 'anthropic' && model.authMode === 'subscription_oauth') {
    throw new ConfigurationError(
      'Anthropic subscription OAuth is not supported by AI SDK Agent. Select an Anthropic API key credential instead.',
      { configKey: 'authMode' },
    );
  }
  if (model.apiKey?.trim()) return sealCredential(model.apiKey.trim());
  if (model.apiKeySecretId?.trim()) {
    return { kind: 'secret', secretId: model.apiKeySecretId.trim() };
  }
  const override = input.component.inputOverrides?.modelApiKey;
  if (typeof override === 'string' && override.trim()) {
    return { kind: 'secret', secretId: override.trim() };
  }
  if (legacyModelApiKey?.trim()) {
    return sealCredential(legacyModelApiKey.trim());
  }
  throw new ConfigurationError(
    `No stored credential is configured for "${model.provider}". Select one in Model & API Key or connect a provider node.`,
    { configKey: 'apiKey' },
  );
}

async function resolveCredentialValue(
  root: StoredRootState,
  organizationId: string | null,
): Promise<string> {
  if (root.credential.kind === 'sealed') {
    return credentialEncryption().decrypt(root.credential);
  }
  const secrets = getComponentActivityServices().secrets?.forOrganization(organizationId);
  const secret = await secrets?.get(root.credential.secretId);
  if (!secret?.value.trim()) {
    throw new ConfigurationError(
      `The stored credential selected for "${root.model.provider}" could not be resolved. Reselect it in Model & API Key.`,
      { configKey: 'apiKeySecretId' },
    );
  }
  return secret.value;
}

async function sealCredential(value: string): Promise<z.infer<typeof credentialSchema>> {
  const sealed = await credentialEncryption().encrypt(value);
  return { kind: 'sealed', ...sealed };
}

function credentialEncryption(): SecretEncryption {
  const masterKey = process.env.SECRET_STORE_MASTER_KEY;
  if (!masterKey) {
    throw new ConfigurationError(
      'SECRET_STORE_MASTER_KEY is required to protect inline AI provider credentials.',
      { configKey: 'SECRET_STORE_MASTER_KEY' },
    );
  }
  return new SecretEncryption(parseMasterKey(masterKey));
}

function withoutResolvedCredential(model: LlmProviderConfig): LlmProviderConfig {
  const sanitized = { ...model } as Record<string, unknown>;
  delete sanitized.apiKey;
  delete sanitized.oauthToken;
  return LLMProviderSchema().parse(sanitized);
}

interface WorkflowAgentModelOperation {
  modelName: string;
  description: string;
  inputSchema: Record<string, unknown>;
  sourceId: string;
  authorizationTarget: string;
  toOperation: (input: JsonObject) => McpOperation;
}

function buildModelOperations(root: StoredRootState): WorkflowAgentModelOperation[] {
  const operations: WorkflowAgentModelOperation[] = root.tools.map((descriptor) => ({
    modelName: descriptor.canonicalName,
    description: descriptor.description ?? descriptor.displayName,
    inputSchema: descriptor.inputSchema,
    sourceId: descriptor.source.sourceId,
    authorizationTarget: descriptor.canonicalName,
    toOperation: (input) => ({
      kind: 'tool-call',
      name: descriptor.canonicalName,
      arguments: input,
    }),
  }));
  const claimedNames = new Set(operations.map((operation) => operation.modelName));

  for (const descriptor of root.resources) {
    operations.push(
      claimModelOperation(claimedNames, {
        modelName: modelOperationName(
          'read_resource',
          descriptor.name,
          descriptor.sourceId,
          descriptor.uri,
        ),
        description: `Read the MCP resource "${descriptor.name}" at ${descriptor.uri}.${descriptor.description ? ` ${descriptor.description}` : ''}`,
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        sourceId: descriptor.sourceId,
        authorizationTarget: descriptor.uri,
        toOperation: () => ({ kind: 'resource-read', uri: descriptor.uri }),
      }),
    );
  }
  for (const descriptor of root.resourceTemplates) {
    operations.push(
      claimModelOperation(claimedNames, {
        modelName: modelOperationName(
          'read_resource',
          descriptor.name,
          descriptor.sourceId,
          descriptor.uriTemplate,
        ),
        description: `Read an MCP resource matching ${descriptor.uriTemplate}.${descriptor.description ? ` ${descriptor.description}` : ''}`,
        inputSchema: {
          type: 'object',
          properties: {
            uri: {
              type: 'string',
              description: `A fully expanded resource URI matching ${descriptor.uriTemplate}`,
            },
          },
          required: ['uri'],
          additionalProperties: false,
        },
        sourceId: descriptor.sourceId,
        authorizationTarget: descriptor.uriTemplate,
        toOperation: (input) => {
          const uri = input.uri;
          if (typeof uri !== 'string' || uri.trim().length === 0) {
            throw new ValidationError(`AI Agent produced an invalid URI for ${descriptor.name}.`);
          }
          return { kind: 'resource-read', uri: uri.trim() };
        },
      }),
    );
  }
  for (const descriptor of root.prompts) {
    const properties = Object.fromEntries(
      descriptor.arguments.map((argument) => [
        argument.name,
        {
          type: 'string',
          ...(argument.description ? { description: argument.description } : {}),
        },
      ]),
    );
    operations.push(
      claimModelOperation(claimedNames, {
        modelName: modelOperationName(
          'get_prompt',
          descriptor.name,
          descriptor.sourceId,
          descriptor.name,
        ),
        description: `Retrieve the MCP prompt "${descriptor.name}".${descriptor.description ? ` ${descriptor.description}` : ''}`,
        inputSchema: {
          type: 'object',
          properties,
          required: descriptor.arguments
            .filter((argument) => argument.required === true)
            .map((argument) => argument.name),
          additionalProperties: false,
        },
        sourceId: descriptor.sourceId,
        authorizationTarget: descriptor.name,
        toOperation: (input) => {
          const args = Object.fromEntries(
            Object.entries(input).map(([name, value]) => {
              if (typeof value !== 'string') {
                throw new ValidationError(
                  `AI Agent produced a non-string argument for MCP prompt ${descriptor.name}.`,
                );
              }
              return [name, value];
            }),
          );
          return { kind: 'prompt-get', name: descriptor.name, arguments: args };
        },
      }),
    );
  }
  return operations;
}

function claimModelOperation(
  claimedNames: Set<string>,
  operation: WorkflowAgentModelOperation,
): WorkflowAgentModelOperation {
  if (claimedNames.has(operation.modelName)) {
    throw new ConfigurationError(`MCP model operation name collision: ${operation.modelName}`);
  }
  claimedNames.add(operation.modelName);
  return operation;
}

function modelOperationName(
  kind: 'read_resource' | 'get_prompt',
  label: string,
  sourceId: string,
  target: string,
): string {
  const slug = label
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 48);
  const hash = createHash('sha256')
    .update(`${kind}\0${sourceId}\0${target}`)
    .digest('hex')
    .slice(0, 12);
  return `sentris_mcp_${kind}_${slug || 'capability'}_${hash}`;
}

function buildModelTools(descriptors: WorkflowAgentModelOperation[]): ToolSet {
  return Object.fromEntries(
    descriptors.map((descriptor) => [
      descriptor.modelName,
      tool({
        description: descriptor.description,
        inputSchema: jsonSchema<JsonObject>(descriptor.inputSchema),
      }),
    ]),
  ) as ToolSet;
}

function normalizeIncomingMessages(messages: { role: string; content: unknown }[]): ModelMessage[] {
  const normalized: ModelMessage[] = [];
  for (const candidate of messages) {
    if (candidate.role === 'system') continue;
    const parsed = modelMessageSchema.safeParse(candidate);
    if (parsed.success) {
      normalized.push(parsed.data);
      continue;
    }
    if (candidate.role === 'tool') {
      const record = isRecord(candidate.content) ? candidate.content : {};
      normalized.push({
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: typeof record.toolCallId === 'string' ? record.toolCallId : 'legacy',
            toolName: typeof record.toolName === 'string' ? record.toolName : 'tool',
            output: toJsonToolOutput(record.output ?? record.result),
          },
        ],
      });
      continue;
    }
    if (candidate.role === 'user' || candidate.role === 'assistant') {
      normalized.push({
        role: candidate.role,
        content:
          typeof candidate.content === 'string'
            ? candidate.content
            : JSON.stringify(candidate.content ?? ''),
      });
    }
  }
  return normalized;
}

function firstSystemMessage(messages: { role: string; content: unknown }[]): string {
  const system = messages.find((message) => message.role === 'system');
  if (!system) return '';
  return typeof system.content === 'string' ? system.content : JSON.stringify(system.content ?? '');
}

function trimModelMessages(messages: ModelMessage[], maximum: number): ModelMessage[] {
  if (messages.length <= maximum) return messages;
  const groups: ModelMessage[][] = [];
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index]!;
    if (
      message.role === 'assistant' &&
      Array.isArray(message.content) &&
      message.content.some((part) => part.type === 'tool-call') &&
      messages[index + 1]?.role === 'tool'
    ) {
      groups.push([message, messages[index + 1]!]);
      index += 1;
    } else {
      groups.push([message]);
    }
  }
  const selected: ModelMessage[][] = [];
  let count = 0;
  for (let index = groups.length - 1; index >= 0; index -= 1) {
    const group = groups[index]!;
    if (count > 0 && count + group.length > maximum) break;
    selected.unshift(group);
    count += group.length;
    if (count >= maximum) break;
  }
  return selected.flat();
}

async function loadConversation(
  storage: IFileStorageService,
  stateRef: WorkflowAgentStateRef,
  owner: WorkflowAgentTurnInput,
): Promise<{
  root: StoredRootState;
  messages: ModelMessage[];
  latestResponseText: string;
  latestFinishReason: string;
}> {
  const root = await readRequiredJson(storage, stateRef.rootFileId, storedRootStateSchema);
  assertStoredOwnership(root, owner);
  if (stateRef.fileId === stateRef.rootFileId) {
    return { root, messages: root.messages, latestResponseText: '', latestFinishReason: 'stop' };
  }
  const deltaMessages: ModelMessage[][] = [];
  let latestResponseText = '';
  let latestFinishReason = 'stop';
  let foundLatestModel = false;
  let currentFileId = stateRef.fileId;
  for (let depth = 0; depth < MAX_STATE_CHAIN_DEPTH; depth += 1) {
    const state = await readRequiredJson(storage, currentFileId, storedStateSchema);
    assertStoredOwnership(state, owner);
    if (state.kind === 'root') {
      if (state.stateId !== root.stateId) throw new Error('AI Agent state root did not match');
      return {
        root,
        messages: trimModelMessages(
          [...root.messages, ...deltaMessages.reverse().flat()],
          root.memorySize,
        ),
        latestResponseText,
        latestFinishReason,
      };
    }
    if (state.rootFileId !== root.stateId) throw new Error('AI Agent state chain changed roots');
    deltaMessages.push(state.messages);
    if (state.kind === 'model' && !foundLatestModel) {
      latestResponseText = state.responseText;
      latestFinishReason = state.finishReason;
      foundLatestModel = true;
    }
    currentFileId = state.previousFileId;
  }
  throw new Error('AI Agent state chain exceeded its bounded depth');
}

function setupOutput(root: StoredRootState): WorkflowAgentSetupOutput {
  return {
    state: { fileId: root.stateId, rootFileId: root.stateId },
    stepLimit: root.stepLimit,
    toolTimeoutMs: root.toolTimeoutMs,
    modelActivityTimeout: root.modelActivityTimeout,
    toolStatus: root.toolStatus,
    ...(root.authority ? { authority: root.authority } : {}),
  };
}

function modelStepOutput(delta: StoredModelDelta): WorkflowAgentModelStepOutput {
  return {
    state: { fileId: delta.stateId, rootFileId: delta.rootFileId },
    finishReason: delta.finishReason,
    toolCalls: delta.toolCalls.map(({ modelToolCallId, toolName }) => ({
      modelToolCallId,
      toolName,
    })),
  };
}

function toToolResultOutput(result: McpOperationResult): ToolResultPart['output'] {
  if (result.kind === 'completed') return { type: 'json', value: result.output };
  return { type: 'error-text', value: result.message.slice(0, TOOL_RESULT_ERROR_LIMIT) };
}

function toJsonToolOutput(value: unknown): ToolResultPart['output'] {
  const parsed = z.json().safeParse(value);
  return parsed.success
    ? { type: 'json', value: parsed.data }
    : { type: 'text', value: JSON.stringify(value ?? null) };
}

async function publishToolResult(
  input: WorkflowAgentToolDispatchInput,
  result: McpOperationResult,
): Promise<void> {
  const modelDelta = await readRequiredJson(
    requireStorage(input.component.organizationId ?? null),
    input.state.fileId,
    storedModelDeltaSchema,
  );
  const call = modelDelta.toolCalls[input.toolIndex];
  if (!call) return;
  const sequence =
    AGENT_TRACE_MODEL_OFFSET +
    input.step * AGENT_TRACE_STEP_STRIDE +
    AGENT_TRACE_TOOL_OUTPUT_OFFSET +
    input.toolIndex;
  if (result.kind === 'completed') {
    await publishAgentPart(input, sequence, {
      type: 'tool-output-available',
      toolCallId: call.modelToolCallId,
      toolName: call.toolName,
      output: result.output,
    });
  } else {
    await publishAgentPart(input, sequence, {
      type: 'data-tool-error',
      data: {
        toolCallId: call.modelToolCallId,
        toolName: call.toolName,
        error: result.message,
      },
    });
  }
}

function assertPlanOwnership(
  storedPlan: z.infer<typeof storedDispatchPlanSchema>,
  input: WorkflowAgentToolDispatchInput,
): void {
  if (
    storedPlan.agentRunId !== input.agentRunId ||
    storedPlan.rootFileId !== input.state.rootFileId
  ) {
    throw new Error('AI Agent dispatch plan ownership did not match the activity input');
  }
}

function toolReconciliationMessage(cause: 'failure' | 'deadline' | 'cancelled'): string {
  switch (cause) {
    case 'deadline':
      return 'AI Agent tool dispatch exceeded its deadline without a confirmed response';
    case 'cancelled':
      return 'AI Agent tool dispatch was cancelled without a confirmed response';
    case 'failure':
      return 'AI Agent tool dispatch did not confirm a terminal result';
  }
}

function compactToolResult(
  resultFileId: string,
  result: McpOperationResult,
): WorkflowAgentToolExecutionOutput {
  return {
    resultFileId,
    kind: result.kind,
    ...(result.kind === 'completed' ? {} : { message: result.message }),
  };
}

function sameAuthority(
  left: { scope: ExecutionScope; capabilitySnapshotId: string },
  right: { scope: ExecutionScope; capabilitySnapshotId: string },
): boolean {
  return (
    left.capabilitySnapshotId === right.capabilitySnapshotId &&
    JSON.stringify(left.scope) === JSON.stringify(right.scope)
  );
}

function requireStorage(organizationId: string | null): IFileStorageService {
  const storage = getComponentActivityServices().storage;
  if (!storage) throw new Error('AI Agent durable state storage is not initialized');
  return storage.forOrganization(organizationId);
}

function requireAgentComponent() {
  const component = componentRegistry.get('core.ai.agent');
  if (!component) throw new Error('AI Agent component is not registered');
  return component;
}

async function readOptionalJson<T>(
  storage: IFileStorageService,
  fileId: string,
  schema: z.ZodType<T>,
): Promise<T | undefined> {
  try {
    return await readRequiredJson(storage, fileId, schema);
  } catch (error: unknown) {
    if (
      error instanceof NotFoundError ||
      (error instanceof Error && error.name === 'NotFoundError')
    ) {
      return undefined;
    }
    throw error;
  }
}

async function readRequiredJson<T>(
  storage: IFileStorageService,
  fileId: string,
  schema: z.ZodType<T>,
): Promise<T> {
  const file = await storage.downloadFile(fileId);
  return schema.parse(JSON.parse(file.buffer.toString('utf8')));
}

async function writeJson(
  storage: IFileStorageService,
  fileId: string,
  fileName: string,
  value: unknown,
): Promise<void> {
  await storage.uploadFile(
    fileId,
    fileName,
    Buffer.from(JSON.stringify(value)),
    'application/json',
  );
}

function assertStoredOwnership(
  state: Pick<StoredState, 'agentRunId'> & Partial<Pick<StoredRootState, 'runId' | 'nodeRef'>>,
  input: WorkflowAgentTurnInput,
): void {
  if (
    state.agentRunId !== input.agentRunId ||
    (state.runId !== undefined && state.runId !== input.component.runId) ||
    (state.nodeRef !== undefined && state.nodeRef !== input.component.action.ref)
  ) {
    throw new Error('AI Agent durable state ownership did not match the activity input');
  }
}

async function publishAgentPart(
  input: WorkflowAgentTurnInput,
  sequence: number,
  part: AgentTracePart,
): Promise<void> {
  const envelope = {
    eventId: `${input.agentRunId}:${sequence}`,
    agentRunId: input.agentRunId,
    workflowRunId: input.component.runId,
    workflowId: input.component.workflowId,
    organizationId: input.component.organizationId ?? null,
    nodeRef: input.component.action.ref,
    sequence,
    timestamp: new Date().toISOString(),
    part,
  };
  try {
    const publisher = getComponentActivityServices().agentTracePublisher;
    if (publisher) {
      await publisher.publish(envelope);
      return;
    }
    await recordTraceWithoutChangingExecution(input, {
      eventId: `trace:${input.component.runId}:workflow-agent-fallback:${input.agentRunId}:${sequence}`,
      type: 'NODE_PROGRESS',
      level: 'info',
      message: `[AgentTraceFallback] ${part.type}`,
      data: envelope,
    });
  } catch (error: unknown) {
    console.error('[WorkflowAgent] Agent trace delivery failed without changing execution', error);
  }
}

async function recordTraceWithoutChangingExecution(
  input: WorkflowAgentTurnInput,
  event: Record<string, unknown>,
): Promise<void> {
  try {
    await getComponentActivityServices().trace?.record({
      ...event,
      runId: input.component.runId,
      workflowId: input.component.workflowId,
      organizationId: input.component.organizationId ?? null,
      nodeRef: input.component.action.ref,
      timestamp: new Date().toISOString(),
      context: {
        activityId: Context.current().info.activityId,
        attempt: Context.current().info.attempt,
        streamId: input.component.metadata?.streamId,
        organizationId: input.component.organizationId ?? null,
      },
    } as never);
  } catch (error: unknown) {
    console.error('[WorkflowAgent] Trace delivery failed without changing execution', error);
  }
}

function stripToolAvailabilityPrompt(value: string): string {
  const marker = '\n\n# Tool Availability\n';
  const index = value.indexOf(marker);
  return index >= 0 ? value.slice(0, index) : value;
}

function startPeriodicHeartbeat(message: string): ReturnType<typeof setInterval> {
  const context = Context.current();
  context.heartbeat(message);
  const timer = setInterval(() => context.heartbeat(message), 5_000);
  timer.unref?.();
  return timer;
}

function throwIfActivityCancelled(): void {
  const signal = Context.current().cancellationSignal;
  if (signal.aborted) {
    throw signal.reason ?? new Error('Activity cancelled');
  }
}

function activityAttemptFileId(baseId: string, attempt: number): string {
  if (attempt <= 1) return baseId;
  const bytes = createHash('sha256')
    .update(`workflow-agent-state\0${baseId}\0${attempt}`)
    .digest()
    .subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function redactCredentialText(value: string): string {
  return value
    .replace(
      /(["']?(?:api[_-]?key|access[_-]?token|refresh[_-]?token|authorization|secret|token)["']?\s*[:=]\s*)(?:"[^"]*"|'[^']*'|(?:Bearer|Basic)\s+[^\s,;}]+|[^\s,;}]+)/gi,
      '$1[REDACTED]',
    )
    .replace(/\b(Bearer|Basic)\s+[^\s"',;}]+/gi, '$1 [REDACTED]')
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, '[REDACTED]');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
