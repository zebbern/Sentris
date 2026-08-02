import { ConflictException, Injectable } from '@nestjs/common';

import {
  OPERATOR_COMMAND_DEFINITIONS,
  MCP_CAPABILITY_CONTRACT_VERSION,
  McpOperationSchema,
  TERMINAL_STATUSES,
  describeWorkflowRuntimeInputs,
  extractWorkflowRuntimeInputDefinitions,
  type McpOperation,
  type McpOperationInvocationRequest,
  type OperatorCommandInputMap,
  type OperatorCommandName,
  type TraceEventPayload,
} from '@sentris/shared';

import type { AuthContext } from '../auth/types';
import { FindingsQuerySchema } from '../analytics/dto/findings-query.dto';
import { FindingsQueryService } from '../analytics/findings-query.service';
import { FindingTriageService } from '../findings/finding-triage.service';
import { TraceService } from '../trace/trace.service';
import { WorkflowsService } from '../workflows/workflows.service';
import { OperatorMcpAuthorityService } from './operator-mcp-authority.service';
import {
  OPERATOR_PRESERVE_CREDENTIAL,
  OperatorWorkflowAuthoringService,
} from './operator-workflow-authoring.service';

const MAX_COMMAND_RESULT_CHARS = 60_000;
const MAX_RUN_FAILED_TRACE_EVENTS = 8;
const MAX_RUN_RECENT_TRACE_EVENTS = 8;
const MAX_RUN_FINDINGS = 10;
const MAX_RUN_RESULT_CHARS = 10_000;
const MAX_RUN_FINDING_CHARS = 1_000;
const MAX_EVIDENCE_TEXT_CHARS = 400;
const MAX_EVIDENCE_VALUE_CHARS = 600;

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
  }): Promise<{
    result: unknown;
    runId?: string;
    mcpOperationRequest?: McpOperationInvocationRequest;
  }> {
    switch (input.commandName) {
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
      case 'list_components':
        return this.listComponents(
          OPERATOR_COMMAND_DEFINITIONS.list_components.inputSchema.parse(input.arguments),
        );
      case 'get_component':
        return this.getComponent(
          OPERATOR_COMMAND_DEFINITIONS.get_component.inputSchema.parse(input.arguments),
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
      case 'apply_workflow_draft':
        return this.applyWorkflowDraft(
          OPERATOR_COMMAND_DEFINITIONS.apply_workflow_draft.inputSchema.parse(input.arguments),
          input.auth,
          input.sessionId,
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
    return { result: toBoundedJson(filtered.slice(0, input.limit)) };
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
      result: {
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
        nodes: graph.nodes.slice(0, 50).map((node) => ({
          id: node.id,
          type: node.type,
          label:
            typeof (node.data as { label?: unknown }).label === 'string'
              ? (node.data as { label: string }).label
              : null,
        })),
      },
    };
  }

  private listComponents(input: OperatorCommandInputMap['list_components']): { result: unknown } {
    return {
      result: toBoundedJson({
        components: this.operatorWorkflowAuthoringService.listComponents(input),
      }),
    };
  }

  private getComponent(input: OperatorCommandInputMap['get_component']): { result: unknown } {
    return { result: toBoundedJson(this.operatorWorkflowAuthoringService.getComponent(input)) };
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
    if (!terminal) {
      return { result: toBoundedJson({ run, status, terminal }) };
    }

    const [result, trace, findings] = await Promise.all([
      this.workflowsService.getRunResult(input.runId, run.temporalRunId, auth),
      this.getRunTraceEvidence(input.runId, auth),
      this.getRunFindingEvidence(input.runId, auth),
    ]);
    return {
      result: toBoundedJson({
        run,
        status,
        terminal,
        result: toBoundedJson(result, MAX_RUN_RESULT_CHARS),
        diagnostics: { trace, findings },
      }),
    };
  }

  private async getRunTraceEvidence(runId: string, auth: AuthContext): Promise<unknown> {
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

  private async getRunFindingEvidence(runId: string, auth: AuthContext): Promise<unknown> {
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
      inputs = sourceConfig.inputs;
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
