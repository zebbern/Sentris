import { Injectable } from '@nestjs/common';

import {
  OPERATOR_COMMAND_DEFINITIONS,
  MCP_CAPABILITY_CONTRACT_VERSION,
  McpOperationSchema,
  TERMINAL_STATUSES,
  type McpOperation,
  type McpOperationInvocationRequest,
  type OperatorCommandInputMap,
  type OperatorCommandName,
} from '@sentris/shared';

import type { AuthContext } from '../auth/types';
import { FindingsQuerySchema } from '../analytics/dto/findings-query.dto';
import { FindingsQueryService } from '../analytics/findings-query.service';
import { FindingTriageService } from '../findings/finding-triage.service';
import { WorkflowsService } from '../workflows/workflows.service';
import { OperatorMcpAuthorityService } from './operator-mcp-authority.service';

const MAX_COMMAND_RESULT_CHARS = 60_000;

function toBoundedJson(value: unknown): unknown {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) return null;
  if (serialized.length <= MAX_COMMAND_RESULT_CHARS) {
    return JSON.parse(serialized) as unknown;
  }
  return {
    truncated: true,
    originalCharacters: serialized.length,
    preview: serialized.slice(0, MAX_COMMAND_RESULT_CHARS),
  };
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
    const workflow = await this.workflowsService.findById(input.workflowId, auth);
    const graph = workflow.graph;
    return {
      result: toBoundedJson({
        id: workflow.id,
        name: workflow.name,
        description: workflow.description,
        currentVersionId: workflow.currentVersionId,
        currentVersion: workflow.currentVersion,
        nodeCount: graph.nodes.length,
        edgeCount: graph.edges.length,
        nodes: graph.nodes.slice(0, 50).map((node) => ({
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
    const result = terminal
      ? await this.workflowsService.getRunResult(input.runId, run.temporalRunId, auth)
      : undefined;
    return { result: toBoundedJson({ run, status, terminal, ...(terminal && { result }) }) };
  }

  private async runWorkflow(
    input: OperatorCommandInputMap['run_workflow'],
    auth: AuthContext,
    sessionId: string,
    actionId: string,
  ): Promise<{ result: unknown; runId: string }> {
    const run = await this.workflowsService.run(
      input.workflowId,
      {
        inputs: input.inputs,
        scopeId: input.scopeId,
        versionId: input.versionId,
        version: input.version,
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
    return { result: toBoundedJson(run), runId: run.runId };
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
