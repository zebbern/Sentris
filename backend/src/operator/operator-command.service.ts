import { isDeepStrictEqual } from 'node:util';
import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';

import {
  OPERATOR_COMMAND_DEFINITIONS,
  JsonValueSchema,
  OperatorRunComparisonResultSchema,
  OperatorRunInputProposalResultSchema,
  OperatorPlanProposalResultSchema,
  OperatorUserInputResultSchema,
  OperatorListWorkflowsResultSchema,
  OperatorListWorkflowTemplatesResultSchema,
  OperatorWorkflowInspectionResultSchema,
  OperatorWorkflowPromotionResultSchema,
  MCP_CAPABILITY_CONTRACT_VERSION,
  McpOperationSchema,
  TERMINAL_STATUSES,
  describeWorkflowRuntimeInputs,
  extractWorkflowRuntimeInputDefinitions,
  formatWorkflowRuntimeInputValidationError,
  hasWorkflowRuntimeInputDefault,
  validateWorkflowRuntimeInputs,
  type JsonValue,
  type McpOperation,
  type McpOperationInvocationRequest,
  type OperatorCommandInputMap,
  type OperatorCommandName,
  type OperatorRunComparisonAssessment,
  type OperatorRunComparisonEvidence,
  type OperatorRunAgentActivityEvidence,
  type OperatorRunInputChanges,
  type TraceEventPayload,
  type WorkflowRuntimeInputDefinition,
  type WorkflowSuccessCriterion,
  type WorkflowGraph,
} from '@sentris/shared';

import type { AuthContext } from '../auth/types';
import { FindingsQuerySchema } from '../analytics/dto/findings-query.dto';
import { FindingsQueryService } from '../analytics/findings-query.service';
import { FindingTriageService } from '../findings/finding-triage.service';
import { ArtifactsService } from '../storage/artifacts.service';
import { AgentTraceService } from '../agent-trace/agent-trace.service';
import { TraceService } from '../trace/trace.service';
import { WorkflowsService } from '../workflows/workflows.service';
import { TemplateService } from '../templates/templates.service';
import { OperatorMcpAuthorityService } from './operator-mcp-authority.service';
import {
  OPERATOR_PRESERVE_CREDENTIAL,
  OperatorWorkflowAuthoringService,
} from './operator-workflow-authoring.service';
import { compareWorkflowSuccessCriteria } from './operator-run-success-criteria';

const MAX_COMMAND_RESULT_CHARS = 60_000;
const MAX_RUN_FAILED_TRACE_EVENTS = 8;
const MAX_RUN_RECENT_TRACE_EVENTS = 8;
const MAX_RUN_FINDINGS = 10;
const MAX_RUN_ARTIFACTS = 10;
const MAX_RUN_AGENT_TURNS = 8;
const MAX_RUN_AGENT_OPERATIONS = 12;
const MAX_RUN_RESULT_CHARS = 10_000;
const MAX_RUN_FINDING_CHARS = 1_000;
const MAX_RUN_AGENT_IO_CHARS = 2_000;
const MAX_EVIDENCE_TEXT_CHARS = 400;
const MAX_EVIDENCE_VALUE_CHARS = 600;

type RunTraceEvidence =
  | {
      availability: 'available';
      totalEvents: number;
      failedEventCount: number;
      failed: Record<string, unknown>[];
      recent: Record<string, unknown>[];
    }
  | { availability: 'unavailable'; error: string };

type RunFindingEvidence =
  | {
      availability: 'available' | 'degraded' | 'unavailable';
      total: number;
      degradedReasons: string[];
      items: unknown[];
    }
  | { availability: 'unavailable'; total: null; items: []; error: string };

type RunArtifactEvidence =
  | {
      availability: 'available';
      total: number;
      items: Awaited<ReturnType<ArtifactsService['listRunArtifacts']>>['artifacts'];
    }
  | { availability: 'unavailable'; total: null; items: []; error: string };

function toBoundedJson(value: unknown, maxCharacters = MAX_COMMAND_RESULT_CHARS): unknown {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) return null;
  if (serialized.length <= maxCharacters) {
    return JSON.parse(serialized) as unknown;
  }
  return {
    truncated: true,
    originalCharacters: serialized.length,
    preview: serialized.slice(0, maxCharacters),
  };
}

function effectiveRuntimeInputValue(
  definition: WorkflowRuntimeInputDefinition,
  inputs: Record<string, unknown>,
): unknown {
  const supplied = inputs[definition.id];
  if ((supplied === undefined || supplied === null) && hasWorkflowRuntimeInputDefault(definition)) {
    return definition.defaultValue;
  }
  return supplied;
}

function optionalJsonValue(value: unknown): JsonValue | undefined {
  if (value === undefined) return undefined;
  return JsonValueSchema.parse(value);
}

function materializeRunInputChanges(input: {
  definitions: WorkflowRuntimeInputDefinition[];
  sourceInputs: Record<string, unknown>;
  inputChanges: OperatorRunInputChanges;
}): {
  inputs: Record<string, unknown>;
  diffs: {
    operation: 'set' | 'unset';
    inputId: string;
    label: string;
    type: Exclude<WorkflowRuntimeInputDefinition['type'], 'secret'>;
    before?: JsonValue;
    after?: JsonValue;
  }[];
} {
  const definitionsById = new Map(
    input.definitions.map((definition) => [definition.id, definition]),
  );
  const inputs = { ...input.sourceInputs };
  const diffs: {
    operation: 'set' | 'unset';
    inputId: string;
    label: string;
    type: Exclude<WorkflowRuntimeInputDefinition['type'], 'secret'>;
    before?: JsonValue;
    after?: JsonValue;
  }[] = [];

  const applyChange = (operation: 'set' | 'unset', inputId: string, value?: unknown) => {
    const definition = definitionsById.get(inputId);
    if (!definition) {
      throw new BadRequestException(`Unknown workflow runtime input "${inputId}"`);
    }
    if (definition.type === 'secret') {
      throw new BadRequestException(
        `Secret workflow runtime input "${inputId}" is preserved and cannot be changed by Operator`,
      );
    }

    const before = optionalJsonValue(effectiveRuntimeInputValue(definition, inputs));
    if (operation === 'set') {
      inputs[inputId] = JsonValueSchema.parse(value);
    } else {
      Reflect.deleteProperty(inputs, inputId);
    }
    const after = optionalJsonValue(effectiveRuntimeInputValue(definition, inputs));
    if (isDeepStrictEqual(before, after)) return;

    diffs.push({
      operation,
      inputId,
      label: definition.label,
      type: definition.type,
      ...(before !== undefined ? { before } : {}),
      ...(after !== undefined ? { after } : {}),
    });
  };

  for (const change of input.inputChanges.set) {
    applyChange('set', change.inputId, change.value);
  }
  for (const inputId of input.inputChanges.unset) {
    applyChange('unset', inputId);
  }

  const validation = validateWorkflowRuntimeInputs(input.definitions, inputs);
  if (!validation.valid) {
    throw new BadRequestException(formatWorkflowRuntimeInputValidationError(validation));
  }
  if (diffs.length === 0) {
    throw new BadRequestException('The proposed runtime-input operations do not change the run');
  }
  return { inputs, diffs };
}

function truncateEvidenceText(value: string | undefined): string | undefined {
  if (value === undefined || value.length <= MAX_EVIDENCE_TEXT_CHARS) return value;
  return `${value.slice(0, MAX_EVIDENCE_TEXT_CHARS)}…`;
}

function toBoundedEvidenceValue(value: unknown): unknown {
  if (value === undefined) return undefined;
  const serialized = JSON.stringify(value);
  if (serialized === undefined) return null;
  if (serialized.length <= MAX_EVIDENCE_VALUE_CHARS) {
    return JSON.parse(serialized) as unknown;
  }
  return {
    truncated: true,
    originalCharacters: serialized.length,
    preview: serialized.slice(0, MAX_EVIDENCE_VALUE_CHARS),
  };
}

function toBoundedEvidenceSummary(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  const serialized = typeof value === 'string' ? value : JSON.stringify(value);
  if (serialized === undefined) return undefined;
  return serialized.length <= MAX_EVIDENCE_VALUE_CHARS
    ? serialized
    : `${serialized.slice(0, MAX_EVIDENCE_VALUE_CHARS)}…`;
}

function compactTraceEvent(
  event: TraceEventPayload,
  includeDiagnosticDetails = true,
): Record<string, unknown> {
  return {
    sequence: event.id,
    nodeId: event.nodeId,
    type: event.type,
    level: event.level,
    timestamp: event.timestamp,
    ...(event.message && { message: truncateEvidenceText(event.message) }),
    ...(event.error && {
      error: {
        message: truncateEvidenceText(event.error.message),
        ...(event.error.type && { type: event.error.type }),
        ...(event.error.code && { code: event.error.code }),
        ...(includeDiagnosticDetails &&
          event.error.details && {
            details: toBoundedEvidenceValue(event.error.details),
          }),
        ...(includeDiagnosticDetails &&
          event.error.fieldErrors && {
            fieldErrors: toBoundedEvidenceValue(event.error.fieldErrors),
          }),
      },
    }),
    ...(includeDiagnosticDetails &&
      event.metadata?.failure && {
        failure: toBoundedEvidenceValue(event.metadata.failure),
      }),
    ...(includeDiagnosticDetails &&
      event.outputSummary && {
        outputSummary: toBoundedEvidenceValue(event.outputSummary),
      }),
  };
}

function errorMessage(error: unknown): string {
  return (
    truncateEvidenceText(error instanceof Error ? error.message : String(error)) ?? 'Unknown error'
  );
}

function nullableDelta(source: number | null, candidate: number | null): number | null {
  return source === null || candidate === null ? null : candidate - source;
}

function assessRunComparison(
  source: OperatorRunComparisonEvidence,
  candidate: OperatorRunComparisonEvidence,
  comparable: boolean,
  successCriteriaAssessment?: OperatorRunComparisonAssessment,
): OperatorRunComparisonAssessment {
  if (!comparable) return 'inconclusive';
  if (source.status !== candidate.status) {
    if (candidate.status === 'COMPLETED') return 'improved';
    if (source.status === 'COMPLETED') return 'regressed';
    return 'inconclusive';
  }
  if (successCriteriaAssessment) return successCriteriaAssessment;
  const failureDelta = nullableDelta(
    source.trace.failedEventCount,
    candidate.trace.failedEventCount,
  );
  if (failureDelta === null) return 'inconclusive';
  if (failureDelta < 0) return 'improved';
  if (failureDelta > 0) return 'regressed';
  return 'unchanged';
}

function extractSuccessfulOutputs(result: unknown): Record<string, unknown> | null {
  if (
    result === null ||
    typeof result !== 'object' ||
    (result as { success?: unknown }).success !== true
  ) {
    return null;
  }
  const outputs = (result as { outputs?: unknown }).outputs;
  return outputs !== null && typeof outputs === 'object' && !Array.isArray(outputs)
    ? (outputs as Record<string, unknown>)
    : null;
}

function assertNever(value: never): never {
  throw new Error(`Unsupported Operator command: ${String(value)}`);
}

@Injectable()
export class OperatorCommandService {
  constructor(
    private readonly workflowsService: WorkflowsService,
    private readonly findingsQueryService: FindingsQueryService,
    private readonly findingTriageService: FindingTriageService,
    private readonly operatorMcpAuthorityService: OperatorMcpAuthorityService,
    private readonly operatorWorkflowAuthoringService: OperatorWorkflowAuthoringService,
    private readonly traceService: TraceService,
    private readonly artifactsService: ArtifactsService,
    private readonly agentTraceService: AgentTraceService,
    private readonly templateService: TemplateService,
  ) {}

  async execute(input: {
    commandName: OperatorCommandName;
    arguments: Record<string, unknown>;
    auth: AuthContext;
    sessionId: string;
    turnId: string;
    turnCreatedAt: string;
    actionId: string;
    actionRequestedAt: string;
    storedResult?: unknown;
  }): Promise<{
    result: unknown;
    runId?: string;
    mcpOperationRequest?: McpOperationInvocationRequest;
  }> {
    switch (input.commandName) {
      case 'request_user_input':
        return { result: OperatorUserInputResultSchema.parse(input.storedResult) };
      case 'list_workflows':
        return this.listWorkflows(
          OPERATOR_COMMAND_DEFINITIONS.list_workflows.inputSchema.parse(input.arguments),
          input.auth,
        );
      case 'get_workflow':
        return this.getWorkflow(
          OPERATOR_COMMAND_DEFINITIONS.get_workflow.inputSchema.parse(input.arguments),
          input.auth,
        );
      case 'list_workflow_templates':
        return this.listWorkflowTemplates(
          OPERATOR_COMMAND_DEFINITIONS.list_workflow_templates.inputSchema.parse(input.arguments),
        );
      case 'list_components':
        return this.listComponents(
          OPERATOR_COMMAND_DEFINITIONS.list_components.inputSchema.parse(input.arguments),
        );
      case 'get_component':
        return this.getComponent(
          OPERATOR_COMMAND_DEFINITIONS.get_component.inputSchema.parse(input.arguments),
        );
      case 'get_workflow_draft':
        return this.getWorkflowDraft(
          OPERATOR_COMMAND_DEFINITIONS.get_workflow_draft.inputSchema.parse(input.arguments),
          input.auth,
          input.sessionId,
        );
      case 'propose_workflow_from_template':
        return this.proposeWorkflowFromTemplate(
          OPERATOR_COMMAND_DEFINITIONS.propose_workflow_from_template.inputSchema.parse(
            input.arguments,
          ),
          input.actionId,
        );
      case 'propose_workflow_draft':
        return this.proposeWorkflowDraft(
          OPERATOR_COMMAND_DEFINITIONS.propose_workflow_draft.inputSchema.parse(input.arguments),
          input.auth,
          input.actionId,
        );
      case 'propose_workflow_edits':
        return this.proposeWorkflowEdits(
          OPERATOR_COMMAND_DEFINITIONS.propose_workflow_edits.inputSchema.parse(input.arguments),
          input.auth,
          input.actionId,
        );
      case 'revise_workflow_draft':
        return this.reviseWorkflowDraft(
          OPERATOR_COMMAND_DEFINITIONS.revise_workflow_draft.inputSchema.parse(input.arguments),
          input.auth,
          input.sessionId,
          input.actionId,
        );
      case 'apply_workflow_draft':
        return this.applyWorkflowDraft(
          OPERATOR_COMMAND_DEFINITIONS.apply_workflow_draft.inputSchema.parse(input.arguments),
          input.auth,
          input.sessionId,
        );
      case 'promote_workflow_version':
        return this.promoteWorkflowVersion(
          OPERATOR_COMMAND_DEFINITIONS.promote_workflow_version.inputSchema.parse(input.arguments),
          input.auth,
        );
      case 'list_runs':
        return this.listRuns(
          OPERATOR_COMMAND_DEFINITIONS.list_runs.inputSchema.parse(input.arguments),
          input.auth,
        );
      case 'get_run':
        return this.getRun(
          OPERATOR_COMMAND_DEFINITIONS.get_run.inputSchema.parse(input.arguments),
          input.auth,
        );
      case 'compare_runs':
        return this.compareRuns(
          OPERATOR_COMMAND_DEFINITIONS.compare_runs.inputSchema.parse(input.arguments),
          input.auth,
        );
      case 'propose_run_input_changes':
        return this.proposeRunInputChanges(
          OPERATOR_COMMAND_DEFINITIONS.propose_run_input_changes.inputSchema.parse(input.arguments),
          input.auth,
        );
      case 'propose_operator_plan':
        return this.proposeOperatorPlan(
          OPERATOR_COMMAND_DEFINITIONS.propose_operator_plan.inputSchema.parse(input.arguments),
          input.actionId,
        );
      case 'run_workflow':
        return this.runWorkflow(
          OPERATOR_COMMAND_DEFINITIONS.run_workflow.inputSchema.parse(input.arguments),
          input.auth,
          input.sessionId,
          input.actionId,
        );
      case 'cancel_run':
        return this.cancelRun(
          OPERATOR_COMMAND_DEFINITIONS.cancel_run.inputSchema.parse(input.arguments),
          input.auth,
        );
      case 'retry_run':
        return this.retryRun(
          OPERATOR_COMMAND_DEFINITIONS.retry_run.inputSchema.parse(input.arguments),
          input.auth,
          input.sessionId,
          input.actionId,
        );
      case 'list_findings':
        return this.listFindings(
          OPERATOR_COMMAND_DEFINITIONS.list_findings.inputSchema.parse(input.arguments),
          input.auth,
        );
      case 'get_finding':
        return this.getFinding(
          OPERATOR_COMMAND_DEFINITIONS.get_finding.inputSchema.parse(input.arguments),
          input.auth,
        );
      case 'update_finding_triage':
        return this.updateFindingTriage(
          OPERATOR_COMMAND_DEFINITIONS.update_finding_triage.inputSchema.parse(input.arguments),
          input.auth,
        );
      case 'list_mcp_servers':
        return this.listMcpServers(
          OPERATOR_COMMAND_DEFINITIONS.list_mcp_servers.inputSchema.parse(input.arguments),
          input.auth,
        );
      case 'list_mcp_capabilities':
        return this.listMcpCapabilities(
          OPERATOR_COMMAND_DEFINITIONS.list_mcp_capabilities.inputSchema.parse(input.arguments),
          input.auth,
          input.sessionId,
          input.turnId,
          input.turnCreatedAt,
        );
      case 'invoke_mcp_tool':
        return this.createMcpToolOperation(
          OPERATOR_COMMAND_DEFINITIONS.invoke_mcp_tool.inputSchema.parse(input.arguments),
          input,
        );
      case 'read_mcp_resource':
        return this.createMcpResourceOperation(
          OPERATOR_COMMAND_DEFINITIONS.read_mcp_resource.inputSchema.parse(input.arguments),
          input,
        );
      case 'get_mcp_prompt':
        return this.createMcpPromptOperation(
          OPERATOR_COMMAND_DEFINITIONS.get_mcp_prompt.inputSchema.parse(input.arguments),
          input,
        );
      default:
        return assertNever(input.commandName);
    }
  }

  private async listWorkflows(
    input: OperatorCommandInputMap['list_workflows'],
    auth: AuthContext,
  ): Promise<{ result: unknown }> {
    const workflows = await this.workflowsService.listSummary(auth);
    const search = input.search?.toLowerCase();
    const filtered = search
      ? workflows.filter(
          (workflow) =>
            workflow.name.toLowerCase().includes(search) ||
            workflow.description?.toLowerCase().includes(search),
        )
      : workflows;
    return {
      result: toBoundedJson(
        OperatorListWorkflowsResultSchema.parse(filtered.slice(0, input.limit)),
      ),
    };
  }

  private async getWorkflow(
    input: OperatorCommandInputMap['get_workflow'],
    auth: AuthContext,
  ): Promise<{ result: unknown }> {
    const { workflow, version, definition } =
      await this.workflowsService.getCompiledWorkflowContext(
        input.workflowId,
        {
          ...(input.versionId ? { versionId: input.versionId } : {}),
          ...(input.version ? { version: input.version } : {}),
        },
        auth,
      );
    const graph = version.graph;
    const runtimeInputs = describeWorkflowRuntimeInputs(
      extractWorkflowRuntimeInputDefinitions(definition),
    );
    let editableGraph: unknown = null;
    let authoringUnavailable: string | undefined;
    try {
      editableGraph = this.operatorWorkflowAuthoringService.projectGraph(graph);
    } catch (error: unknown) {
      authoringUnavailable =
        error instanceof Error
          ? error.message
          : 'Workflow graph is too large for Operator authoring';
    }
    return {
      result: OperatorWorkflowInspectionResultSchema.parse({
        id: workflow.id,
        name: workflow.name,
        description: workflow.description,
        versionId: version.id,
        version: version.version,
        runtimeInputs,
        nodeCount: graph.nodes.length,
        edgeCount: graph.edges.length,
        editableGraph,
        credentialPlaceholder: OPERATOR_PRESERVE_CREDENTIAL,
        ...(authoringUnavailable ? { authoringUnavailable } : {}),
        nodes: graph.nodes.slice(0, 50).map((node: WorkflowGraph['nodes'][number]) => ({
          id: node.id,
          type: node.type,
          label:
            typeof (node.data as { label?: unknown }).label === 'string'
              ? (node.data as { label: string }).label
              : null,
        })),
      }),
    };
  }

  private proposeOperatorPlan(
    input: OperatorCommandInputMap['propose_operator_plan'],
    actionId: string,
  ): { result: unknown } {
    return {
      result: OperatorPlanProposalResultSchema.parse({
        kind: 'operator-plan',
        planId: actionId,
        title: input.title,
        ...(input.summary ? { summary: input.summary } : {}),
        steps: input.steps.map((step) => ({
          ...step,
          effect: OPERATOR_COMMAND_DEFINITIONS[step.commandName].effect,
        })),
      }),
    };
  }

  private listComponents(input: OperatorCommandInputMap['list_components']): { result: unknown } {
    return {
      result: toBoundedJson({
        components: this.operatorWorkflowAuthoringService.listComponents(input),
      }),
    };
  }

  private async listWorkflowTemplates(
    input: OperatorCommandInputMap['list_workflow_templates'],
  ): Promise<{ result: unknown }> {
    const catalog = await this.templateService.listTemplateCatalog(input);
    return {
      result: toBoundedJson(OperatorListWorkflowTemplatesResultSchema.parse(catalog)),
    };
  }

  private getComponent(input: OperatorCommandInputMap['get_component']): { result: unknown } {
    return { result: toBoundedJson(this.operatorWorkflowAuthoringService.getComponent(input)) };
  }

  private async getWorkflowDraft(
    input: OperatorCommandInputMap['get_workflow_draft'],
    auth: AuthContext,
    sessionId: string,
  ): Promise<{ result: unknown }> {
    return {
      result: await this.operatorWorkflowAuthoringService.getDraftDetail({
        draftId: input.draftId,
        sessionId,
        auth,
      }),
    };
  }

  private async proposeWorkflowDraft(
    input: OperatorCommandInputMap['propose_workflow_draft'],
    auth: AuthContext,
    actionId: string,
  ): Promise<{ result: unknown }> {
    return {
      result: await this.operatorWorkflowAuthoringService.propose({
        arguments: input,
        auth,
        actionId,
      }),
    };
  }

  private async proposeWorkflowFromTemplate(
    input: OperatorCommandInputMap['propose_workflow_from_template'],
    actionId: string,
  ): Promise<{ result: unknown }> {
    const materialized = await this.templateService.materializeTemplateGraph(input.templateId, {
      workflowName: input.name,
      description: input.description,
      runtimeInputDefaults: input.runtimeInputDefaults,
    });
    return {
      result: await this.operatorWorkflowAuthoringService.proposeFromTemplate({
        graph: materialized.graph,
        templateId: materialized.template.id,
        templateName: materialized.template.name,
        actionId,
      }),
    };
  }

  private async proposeWorkflowEdits(
    input: OperatorCommandInputMap['propose_workflow_edits'],
    auth: AuthContext,
    actionId: string,
  ): Promise<{ result: unknown }> {
    return {
      result: await this.operatorWorkflowAuthoringService.proposeEdits({
        arguments: input,
        auth,
        actionId,
      }),
    };
  }

  private async reviseWorkflowDraft(
    input: OperatorCommandInputMap['revise_workflow_draft'],
    auth: AuthContext,
    sessionId: string,
    actionId: string,
  ): Promise<{ result: unknown }> {
    return {
      result: await this.operatorWorkflowAuthoringService.revise({
        arguments: input,
        auth,
        sessionId,
        actionId,
      }),
    };
  }

  private async applyWorkflowDraft(
    input: OperatorCommandInputMap['apply_workflow_draft'],
    auth: AuthContext,
    sessionId: string,
  ): Promise<{ result: unknown }> {
    return {
      result: await this.operatorWorkflowAuthoringService.apply({
        arguments: input,
        auth,
        sessionId,
      }),
    };
  }

  private async promoteWorkflowVersion(
    input: OperatorCommandInputMap['promote_workflow_version'],
    auth: AuthContext,
  ): Promise<{ result: unknown }> {
    const candidateRun = await this.workflowsService.getRun(input.candidateRunId, auth);
    if (
      candidateRun.workflowId !== input.workflowId ||
      candidateRun.workflowVersionId !== input.versionId
    ) {
      throw new ConflictException(
        `Candidate run ${input.candidateRunId} does not reference workflow version ${input.versionId}`,
      );
    }
    if (!(TERMINAL_STATUSES as readonly string[]).includes(candidateRun.status)) {
      throw new ConflictException(
        `Candidate run ${input.candidateRunId} is still ${candidateRun.status}; wait before keeping it`,
      );
    }
    const promoted = await this.workflowsService.promoteVersion(
      input.workflowId,
      input.versionId,
      auth,
      {
        candidateRunId: input.candidateRunId,
        expectedCurrentVersionId: input.baseVersionId,
      },
    );
    return {
      result: OperatorWorkflowPromotionResultSchema.parse({
        kind: 'workflow-version-promoted',
        workflowId: promoted.workflowId,
        versionId: promoted.id,
        version: promoted.version,
        name: promoted.name,
        candidateRunId: input.candidateRunId,
        alreadyCurrent: promoted.alreadyCurrent,
      }),
    };
  }

  private async listRuns(
    input: OperatorCommandInputMap['list_runs'],
    auth: AuthContext,
  ): Promise<{ result: unknown }> {
    const result = await this.workflowsService.listRuns(auth, {
      workflowId: input.workflowId,
      status: input.status,
      limit: input.limit,
    });
    return { result: toBoundedJson({ runs: result.runs.slice(0, input.limit) }) };
  }

  private async getRun(
    input: OperatorCommandInputMap['get_run'],
    auth: AuthContext,
  ): Promise<{ result: unknown }> {
    const run = await this.workflowsService.getRun(input.runId, auth);
    const status = await this.workflowsService.getRunStatus(input.runId, run.temporalRunId, auth);
    const terminal = (TERMINAL_STATUSES as readonly string[]).includes(status.status);
    const agentActivity = await this.getRunAgentActivityEvidence(
      input.runId,
      input.includeAgentIo === true,
    );
    const links = {
      workflow: `/workflows/${encodeURIComponent(run.workflowId)}`,
      run: `/workflows/${encodeURIComponent(run.workflowId)}/runs/${encodeURIComponent(input.runId)}`,
      ...(agentActivity.availability === 'available' &&
      agentActivity.operations.some((operation) => operation.capability?.sourceName)
        ? { mcpLibrary: '/mcp-library' as const }
        : {}),
    };
    if (!terminal) {
      return { result: toBoundedJson({ run, status, terminal, agentActivity, links }) };
    }

    const [result, trace, findings, artifacts, invocation] = await Promise.all([
      this.workflowsService.getRunResult(input.runId, run.temporalRunId, auth),
      this.getRunTraceEvidence(input.runId, auth),
      this.getRunFindingEvidence(input.runId, auth),
      this.getRunArtifactEvidence(input.runId, auth),
      this.getRunInputInspection(input.runId, auth),
    ]);
    return {
      result: toBoundedJson({
        run,
        status,
        terminal,
        result: toBoundedJson(result, MAX_RUN_RESULT_CHARS),
        agentActivity,
        links,
        diagnostics: { trace, findings, artifacts },
        invocation,
      }),
    };
  }

  private async getRunAgentActivityEvidence(
    runId: string,
    includeIo: boolean,
  ): Promise<OperatorRunAgentActivityEvidence> {
    try {
      const summary = await this.agentTraceService.summarizeRunCapabilityActivity(runId, {
        maxAgentRuns: MAX_RUN_AGENT_TURNS,
        maxOperations: MAX_RUN_AGENT_OPERATIONS,
      });
      return {
        availability: 'available',
        capturedOperationCount: summary.operations.length,
        truncated: summary.truncated,
        agentRuns: summary.agentRuns,
        operations: summary.operations.map((operation) => ({
          agentRunId: operation.agentRunId,
          nodeRef: operation.nodeRef,
          toolCallId: operation.toolCallId,
          toolName: operation.toolName,
          ...(operation.capability ? { capability: operation.capability } : {}),
          status: operation.status,
          startedAt: operation.startedAt,
          ...(operation.finishedAt ? { finishedAt: operation.finishedAt } : {}),
          ...(operation.durationMs !== undefined ? { durationMs: operation.durationMs } : {}),
          ...(operation.input !== undefined
            ? { inputSummary: toBoundedEvidenceSummary(operation.input) }
            : {}),
          ...(operation.output !== undefined
            ? { outputSummary: toBoundedEvidenceSummary(operation.output) }
            : {}),
          ...(operation.error !== undefined
            ? { errorSummary: toBoundedEvidenceSummary(operation.error) }
            : {}),
          ...(includeIo && operation.input !== undefined
            ? { input: toBoundedJson(operation.input, MAX_RUN_AGENT_IO_CHARS) }
            : {}),
          ...(includeIo && operation.output !== undefined
            ? { output: toBoundedJson(operation.output, MAX_RUN_AGENT_IO_CHARS) }
            : {}),
          ...(includeIo && operation.error !== undefined
            ? { error: toBoundedJson(operation.error, MAX_RUN_AGENT_IO_CHARS) }
            : {}),
        })),
      };
    } catch (error: unknown) {
      return {
        availability: 'unavailable',
        capturedOperationCount: 0,
        truncated: false,
        agentRuns: [],
        operations: [],
        error: errorMessage(error),
      };
    }
  }

  private async getRunInputInspection(
    runId: string,
    auth: AuthContext,
  ): Promise<Record<string, unknown>> {
    try {
      const config = await this.workflowsService.getRunConfig(runId, auth);
      if (!config.workflowVersionId) {
        return {
          available: false,
          reason: 'The run does not reference an immutable workflow version',
        };
      }
      const { definition } = await this.workflowsService.getCompiledWorkflowContext(
        config.workflowId,
        { versionId: config.workflowVersionId },
        auth,
      );
      const definitions = extractWorkflowRuntimeInputDefinitions(definition);
      if (definitions.length === 0) {
        return {
          available: false,
          versionId: config.workflowVersionId,
          reason: 'The workflow version does not declare a runtime-input contract',
        };
      }

      const inputs: Record<string, JsonValue> = {};
      for (const definition of definitions) {
        const value = effectiveRuntimeInputValue(definition, config.inputs);
        if (value === undefined) continue;
        inputs[definition.id] =
          definition.type === 'secret'
            ? OPERATOR_PRESERVE_CREDENTIAL
            : JsonValueSchema.parse(value);
      }
      return {
        available: true,
        versionId: config.workflowVersionId,
        runtimeInputs: describeWorkflowRuntimeInputs(definitions),
        inputs,
        credentialPlaceholder: OPERATOR_PRESERVE_CREDENTIAL,
      };
    } catch (error: unknown) {
      return {
        available: false,
        reason: errorMessage(error),
      };
    }
  }

  private async loadSourceRunInputContext(sourceRunId: string, auth: AuthContext) {
    const [sourceRun, config] = await Promise.all([
      this.workflowsService.getRun(sourceRunId, auth),
      this.workflowsService.getRunConfig(sourceRunId, auth),
    ]);
    if (!(TERMINAL_STATUSES as readonly string[]).includes(sourceRun.status)) {
      throw new ConflictException(
        `Workflow run ${sourceRunId} is still ${sourceRun.status}; wait for it to finish before changing its inputs`,
      );
    }
    if (config.workflowId !== sourceRun.workflowId) {
      throw new ConflictException(`Workflow run ${sourceRunId} has inconsistent stored config`);
    }
    if (!config.workflowVersionId) {
      throw new ConflictException(
        `Workflow run ${sourceRunId} does not reference an immutable workflow version`,
      );
    }

    const { definition } = await this.workflowsService.getCompiledWorkflowContext(
      config.workflowId,
      { versionId: config.workflowVersionId },
      auth,
    );
    const definitions = extractWorkflowRuntimeInputDefinitions(definition);
    if (definitions.length === 0) {
      throw new BadRequestException(
        `Workflow run ${sourceRunId} has no declared runtime-input contract to validate`,
      );
    }
    return { sourceRun, config, definitions };
  }

  private async proposeRunInputChanges(
    input: OperatorCommandInputMap['propose_run_input_changes'],
    auth: AuthContext,
  ): Promise<{ result: unknown }> {
    const { config, definitions } = await this.loadSourceRunInputContext(input.sourceRunId, auth);
    const proposal = materializeRunInputChanges({
      definitions,
      sourceInputs: config.inputs,
      inputChanges: input.inputChanges,
    });
    return {
      result: OperatorRunInputProposalResultSchema.parse({
        kind: 'run-input-proposal',
        sourceRunId: input.sourceRunId,
        workflowId: config.workflowId,
        versionId: config.workflowVersionId,
        sourceScopePreserved: true,
        changes: proposal.diffs,
        inputChanges: input.inputChanges,
      }),
    };
  }

  private async getRunTraceEvidence(runId: string, auth: AuthContext): Promise<RunTraceEvidence> {
    try {
      const summary = await this.traceService.summarizeRun(
        runId,
        {
          failedLimit: MAX_RUN_FAILED_TRACE_EVENTS,
          recentLimit: MAX_RUN_RECENT_TRACE_EVENTS,
        },
        auth,
      );
      return {
        availability: 'available',
        totalEvents: summary.totalEvents,
        failedEventCount: summary.failedEventCount,
        failed: summary.failed.map((event) => compactTraceEvent(event)),
        recent: summary.recent.map((event) => compactTraceEvent(event, false)),
      };
    } catch (error) {
      return {
        availability: 'unavailable',
        error: errorMessage(error),
      };
    }
  }

  private async getRunFindingEvidence(
    runId: string,
    auth: AuthContext,
  ): Promise<RunFindingEvidence> {
    try {
      const page = await this.findingsQueryService.listFindings(
        auth,
        FindingsQuerySchema.parse({
          runId,
          page: 1,
          pageSize: MAX_RUN_FINDINGS,
          sortOrder: 'desc',
          paginationMode: 'offset',
        }),
      );
      return {
        availability: page.availability,
        total: page.total,
        degradedReasons: page.degradedReasons,
        items: page.items.map(({ raw: _raw, ...finding }) =>
          toBoundedJson(finding, MAX_RUN_FINDING_CHARS),
        ),
      };
    } catch (error) {
      return {
        availability: 'unavailable',
        total: null,
        items: [],
        error: errorMessage(error),
      };
    }
  }

  private async getRunArtifactEvidence(
    runId: string,
    auth: AuthContext,
  ): Promise<RunArtifactEvidence> {
    try {
      const response = await this.artifactsService.listRunArtifacts(auth, runId);
      return {
        availability: 'available',
        total: response.artifacts.length,
        items: response.artifacts
          .slice(0, MAX_RUN_ARTIFACTS)
          .map(({ metadata: _metadata, organizationId: _organizationId, ...item }) => item),
      };
    } catch (error) {
      return {
        availability: 'unavailable',
        total: null,
        items: [],
        error: errorMessage(error),
      };
    }
  }

  private async compareRuns(
    input: OperatorCommandInputMap['compare_runs'],
    auth: AuthContext,
  ): Promise<{ result: unknown }> {
    const [sourceRun, candidateRun, sourceConfig, candidateConfig] = await Promise.all([
      this.workflowsService.getRun(input.sourceRunId, auth),
      this.workflowsService.getRun(input.candidateRunId, auth),
      this.workflowsService.getRunConfig(input.sourceRunId, auth),
      this.workflowsService.getRunConfig(input.candidateRunId, auth),
    ]);
    if (
      sourceRun.workflowId !== candidateRun.workflowId ||
      sourceConfig.workflowId !== sourceRun.workflowId ||
      candidateConfig.workflowId !== candidateRun.workflowId
    ) {
      throw new ConflictException('Run comparison requires two runs from the same workflow');
    }
    for (const run of [sourceRun, candidateRun]) {
      if (!(TERMINAL_STATUSES as readonly string[]).includes(run.status)) {
        throw new ConflictException(
          `Workflow run ${run.id} is still ${run.status}; wait for both runs to finish before comparing them`,
        );
      }
    }

    const comparable =
      sourceRun.scopeId === candidateRun.scopeId &&
      isDeepStrictEqual(sourceConfig.inputs, candidateConfig.inputs);
    let benchmarkVersionId: string | null = null;
    let declaredCriteria: WorkflowSuccessCriterion[] = [];
    if (candidateConfig.workflowVersionId) {
      const benchmarkVersion = await this.workflowsService.getWorkflowVersion(
        candidateRun.workflowId,
        candidateConfig.workflowVersionId,
        auth,
      );
      benchmarkVersionId = benchmarkVersion.id;
      declaredCriteria = benchmarkVersion.graph.successCriteria ?? [];
    }
    const [source, candidate] = await Promise.all([
      this.buildRunComparisonEvidence(sourceRun, auth),
      this.buildRunComparisonEvidence(candidateRun, auth),
    ]);
    let successCriteriaComparison: ReturnType<typeof compareWorkflowSuccessCriteria> | null = null;
    if (benchmarkVersionId && declaredCriteria.length > 0) {
      const needsOutputs = declaredCriteria.some(
        (criterion) => criterion.kind === 'output_assertion',
      );
      const [sourceResult, candidateResult] = needsOutputs
        ? await Promise.all([
            this.workflowsService.getRunResult(input.sourceRunId, sourceRun.temporalRunId, auth),
            this.workflowsService.getRunResult(
              input.candidateRunId,
              candidateRun.temporalRunId,
              auth,
            ),
          ])
        : [null, null];
      successCriteriaComparison = compareWorkflowSuccessCriteria({
        criteria: declaredCriteria,
        comparable,
        source: {
          outputs: extractSuccessfulOutputs(sourceResult),
          findings: source.findings,
        },
        candidate: {
          outputs: extractSuccessfulOutputs(candidateResult),
          findings: candidate.findings,
        },
      });
    }
    const failedEventCountDelta = nullableDelta(
      source.trace.failedEventCount,
      candidate.trace.failedEventCount,
    );
    const findingTotalDelta = nullableDelta(source.findings.total, candidate.findings.total);
    const assessment = assessRunComparison(
      source,
      candidate,
      comparable,
      successCriteriaComparison?.assessment,
    );
    const caveats = [
      'Finding and duration changes are observations, not proof of workflow quality.',
      'External targets and model or provider responses can change between repeated runs.',
    ];
    if (!comparable) {
      caveats.unshift(
        'The runs used different stored inputs or scopes, so this is not an apples-to-apples comparison.',
      );
    }
    if (benchmarkVersionId && declaredCriteria.length === 0) {
      caveats.push(
        'The candidate version declares no success criteria, so assessment uses run completion and failure events.',
      );
    }
    if (successCriteriaComparison) {
      caveats.unshift(
        'Success criteria from the immutable candidate workflow version were evaluated against both runs.',
      );
    }
    if (
      source.trace.availability === 'unavailable' ||
      candidate.trace.availability === 'unavailable'
    ) {
      caveats.push('Trace evidence was unavailable for at least one run.');
    }
    if (
      source.findings.availability !== 'available' ||
      candidate.findings.availability !== 'available'
    ) {
      caveats.push('Finding data was degraded or unavailable for at least one run.');
    }

    return {
      result: OperatorRunComparisonResultSchema.parse({
        kind: 'run-comparison',
        assessment,
        comparable,
        source,
        candidate,
        changes: {
          statusChanged: source.status !== candidate.status,
          failedEventCountDelta,
          findingTotalDelta,
          durationDeltaMs: candidate.durationMs - source.durationMs,
        },
        successCriteria:
          benchmarkVersionId && successCriteriaComparison
            ? {
                benchmarkVersionId,
                criteria: successCriteriaComparison.criteria,
              }
            : null,
        caveats,
      }),
    };
  }

  private async buildRunComparisonEvidence(
    run: {
      id: string;
      workflowId: string;
      workflowVersionId: string | null;
      temporalRunId?: string | null;
      status: OperatorRunComparisonEvidence['status'];
      duration: number;
    },
    auth: AuthContext,
  ): Promise<OperatorRunComparisonEvidence> {
    const [trace, findings] = await Promise.all([
      this.getRunTraceEvidence(run.id, auth),
      this.getRunFindingEvidence(run.id, auth),
    ]);
    return {
      runId: run.id,
      workflowId: run.workflowId,
      workflowVersionId: run.workflowVersionId,
      status: run.status,
      durationMs: run.duration,
      trace: {
        availability: trace.availability,
        failedEventCount: trace.availability === 'available' ? trace.failedEventCount : null,
      },
      findings: {
        availability: findings.availability,
        total: findings.total,
      },
    };
  }

  private async runWorkflow(
    input: OperatorCommandInputMap['run_workflow'],
    auth: AuthContext,
    sessionId: string,
    actionId: string,
  ): Promise<{ result: unknown; runId: string }> {
    let inputs = input.inputs;
    let scopeId = input.scopeId;
    if (input.sourceRunId) {
      const [sourceRun, sourceConfig] = await Promise.all([
        this.workflowsService.getRun(input.sourceRunId, auth),
        this.workflowsService.getRunConfig(input.sourceRunId, auth),
      ]);
      if (!(TERMINAL_STATUSES as readonly string[]).includes(sourceRun.status)) {
        throw new ConflictException(
          `Workflow run ${input.sourceRunId} is still ${sourceRun.status}; wait for it to finish before running the improved version`,
        );
      }
      if (
        sourceRun.workflowId !== input.workflowId ||
        sourceConfig.workflowId !== input.workflowId
      ) {
        throw new ConflictException(
          `Workflow run ${input.sourceRunId} does not belong to workflow ${input.workflowId}`,
        );
      }
      if (input.inputChanges) {
        if (sourceConfig.workflowVersionId !== input.versionId) {
          throw new ConflictException(
            `Input-change reruns must use the source run's immutable workflow version ${sourceConfig.workflowVersionId ?? 'unknown'}`,
          );
        }
        const { definition } = await this.workflowsService.getCompiledWorkflowContext(
          input.workflowId,
          { versionId: input.versionId },
          auth,
        );
        inputs = materializeRunInputChanges({
          definitions: extractWorkflowRuntimeInputDefinitions(definition),
          sourceInputs: sourceConfig.inputs,
          inputChanges: input.inputChanges,
        }).inputs;
      } else {
        inputs = sourceConfig.inputs;
      }
      scopeId = sourceRun.scopeId ?? undefined;
    }

    const run = await this.workflowsService.run(
      input.workflowId,
      {
        inputs,
        versionId: input.versionId,
        ...(scopeId ? { scopeId } : {}),
      },
      auth,
      {
        idempotencyKey: `operator:${sessionId}:${actionId}`,
        trigger: {
          type: 'api',
          sourceId: actionId,
          label: 'Sentris Operator',
        },
      },
    );
    return {
      result: toBoundedJson({
        ...run,
        ...(input.sourceRunId ? { sourceRunId: input.sourceRunId } : {}),
        ...(input.inputChanges ? { inputChanges: input.inputChanges } : {}),
      }),
      runId: run.runId,
    };
  }

  private async cancelRun(
    input: OperatorCommandInputMap['cancel_run'],
    auth: AuthContext,
  ): Promise<{ result: unknown }> {
    const run = await this.workflowsService.getRun(input.runId, auth);
    if ((TERMINAL_STATUSES as readonly string[]).includes(run.status)) {
      return {
        result: { runId: input.runId, cancelled: false, status: run.status, alreadyTerminal: true },
      };
    }
    await this.workflowsService.cancelRun(input.runId, run.temporalRunId, auth);
    return { result: { runId: input.runId, cancelled: true } };
  }

  private async retryRun(
    input: OperatorCommandInputMap['retry_run'],
    auth: AuthContext,
    sessionId: string,
    actionId: string,
  ): Promise<{ result: unknown; runId: string }> {
    const [original, config] = await Promise.all([
      this.workflowsService.getRun(input.runId, auth),
      this.workflowsService.getRunConfig(input.runId, auth),
    ]);
    if (!(TERMINAL_STATUSES as readonly string[]).includes(original.status)) {
      throw new ConflictException(
        `Workflow run ${input.runId} is still ${original.status}; cancel it or wait for it to finish before retrying`,
      );
    }
    const run = await this.workflowsService.run(
      config.workflowId,
      {
        inputs: config.inputs,
        ...(config.workflowVersionId ? { versionId: config.workflowVersionId } : {}),
        ...(original.scopeId ? { scopeId: original.scopeId } : {}),
      },
      auth,
      {
        idempotencyKey: `operator-retry:${sessionId}:${actionId}`,
        trigger: {
          type: 'api',
          sourceId: actionId,
          label: 'Sentris Operator retry',
        },
      },
    );
    return {
      result: toBoundedJson({ ...run, retryOfRunId: input.runId }),
      runId: run.runId,
    };
  }

  private async listFindings(
    input: OperatorCommandInputMap['list_findings'],
    auth: AuthContext,
  ): Promise<{ result: unknown }> {
    const page = await this.findingsQueryService.listFindings(
      auth,
      FindingsQuerySchema.parse({
        search: input.search,
        severity: input.severity,
        workflowId: input.workflowId,
        runId: input.runId,
        triageStatus: input.triageStatus,
        page: 1,
        pageSize: input.limit,
        sortOrder: 'desc',
        paginationMode: 'offset',
      }),
    );
    return {
      result: toBoundedJson({
        ...page,
        items: page.items.map(({ raw: _raw, ...finding }) => finding),
      }),
    };
  }

  private async getFinding(
    input: OperatorCommandInputMap['get_finding'],
    auth: AuthContext,
  ): Promise<{ result: unknown }> {
    return {
      result: toBoundedJson(await this.findingsQueryService.getFinding(auth, input.findingId)),
    };
  }

  private async updateFindingTriage(
    input: OperatorCommandInputMap['update_finding_triage'],
    auth: AuthContext,
  ): Promise<{ result: unknown }> {
    const { findingId, ...update } = input;
    const triage = await this.findingTriageService.upsertTriage(
      auth,
      findingId,
      update,
      'operator',
    );
    return { result: toBoundedJson(triage) };
  }

  private async listMcpServers(
    input: OperatorCommandInputMap['list_mcp_servers'],
    auth: AuthContext,
  ): Promise<{ result: unknown }> {
    return {
      result: toBoundedJson({
        servers: await this.operatorMcpAuthorityService.listServers(
          auth,
          input.search,
          input.limit,
        ),
      }),
    };
  }

  private async listMcpCapabilities(
    input: OperatorCommandInputMap['list_mcp_capabilities'],
    auth: AuthContext,
    sessionId: string,
    turnId: string,
    turnCreatedAt: string,
  ): Promise<{ result: unknown }> {
    const { authority, server } = await this.operatorMcpAuthorityService.materialize({
      auth,
      sessionId,
      turnId,
      turnCreatedAt,
      serverId: input.serverId,
    });
    const snapshot = authority.snapshot;
    const binding =
      snapshot.version === MCP_CAPABILITY_CONTRACT_VERSION
        ? snapshot.runtimeBindings[server.id]
        : undefined;
    if (snapshot.scope.kind !== 'operator') {
      throw new Error('Operator MCP materialization returned non-Operator authority');
    }
    return {
      result: toBoundedJson({
        capabilitySnapshotId: snapshot.id,
        sourceId: server.id,
        expiresAt: snapshot.scope.expiresAt,
        server,
        protocol: binding
          ? { era: binding.protocolEra, version: binding.protocolVersion }
          : undefined,
        tools: snapshot.tools.map((descriptor) => ({
          name: descriptor.canonicalName,
          displayName: descriptor.displayName,
          description: descriptor.description,
          inputSchema: descriptor.inputSchema,
          effects: descriptor.effects,
          sourceId: descriptor.source.sourceId,
        })),
        resources: snapshot.resources.map((descriptor) => ({
          uri: descriptor.uri,
          name: descriptor.name,
          description: descriptor.description,
          mimeType: descriptor.mimeType,
          sourceId: descriptor.sourceId,
        })),
        resourceTemplates: snapshot.resourceTemplates.map((descriptor) => ({
          uriTemplate: descriptor.uriTemplate,
          name: descriptor.name,
          description: descriptor.description,
          mimeType: descriptor.mimeType,
          sourceId: descriptor.sourceId,
        })),
        prompts: snapshot.prompts.map((descriptor) => ({
          name: descriptor.name,
          description: descriptor.description,
          arguments: descriptor.arguments,
          sourceId: descriptor.sourceId,
        })),
      }),
    };
  }

  private createMcpToolOperation(
    input: OperatorCommandInputMap['invoke_mcp_tool'],
    context: McpOperatorCommandContext,
  ) {
    return this.deferMcpOperation(
      input,
      context,
      input.name,
      McpOperationSchema.parse({
        kind: 'tool-call',
        name: input.name,
        arguments: input.arguments,
      }),
    );
  }

  private createMcpResourceOperation(
    input: OperatorCommandInputMap['read_mcp_resource'],
    context: McpOperatorCommandContext,
  ) {
    return this.deferMcpOperation(input, context, input.templateUri ?? input.uri, {
      kind: 'resource-read',
      uri: input.uri,
    });
  }

  private createMcpPromptOperation(
    input: OperatorCommandInputMap['get_mcp_prompt'],
    context: McpOperatorCommandContext,
  ) {
    return this.deferMcpOperation(
      input,
      context,
      input.name,
      McpOperationSchema.parse({
        kind: 'prompt-get',
        name: input.name,
        arguments: input.arguments,
      }),
    );
  }

  private async deferMcpOperation(
    input: { capabilitySnapshotId: string; sourceId: string },
    context: McpOperatorCommandContext,
    authorizationTarget: string,
    operation: McpOperation,
  ): Promise<{ result: unknown; mcpOperationRequest: McpOperationInvocationRequest }> {
    const request = await this.operatorMcpAuthorityService.createOperationRequest({
      organizationId: context.auth.organizationId!,
      sessionId: context.sessionId,
      turnId: context.turnId,
      actionId: context.actionId,
      actionRequestedAt: context.actionRequestedAt,
      capabilitySnapshotId: input.capabilitySnapshotId,
      sourceId: input.sourceId,
      authorizationTarget,
      operation,
    });
    return {
      result: {
        kind: 'mcp-operation',
        operationId: request.invocationId,
        operation: request.operation.kind,
        state: 'ready_for_dispatch',
      },
      mcpOperationRequest: request,
    };
  }
}

interface McpOperatorCommandContext {
  auth: AuthContext;
  sessionId: string;
  turnId: string;
  actionId: string;
  actionRequestedAt: string;
}

export { toBoundedJson as boundOperatorCommandResult };
