import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  CapabilityGrantSchema,
  MCP_CAPABILITY_CONTRACT_VERSION,
  MCP_LEGACY_CAPABILITY_CONTRACT_VERSION,
  McpCapabilityCatalogSnapshotSchema,
  buildInvocationManifest,
  type CapabilityGrant,
  type ExecutionScope,
  type McpCapabilityCatalogSnapshot,
} from '@sentris/shared';

import { sha256 } from './mcp-binding-fingerprint';
import { stableMcpAuthorityUuid } from './mcp-authority-identity';
import { McpRunCatalogService } from './mcp-run-catalog.service';
import { McpRuntimeRepository, type StoredMcpAuthority } from './mcp-runtime.repository';
import { WorkflowGraphSchema } from '../workflows/dto/workflow-graph.dto';
import { WorkflowRunRepository } from '../workflows/repository/workflow-run.repository';
import { WorkflowVersionRepository } from '../workflows/repository/workflow-version.repository';

@Injectable()
export class McpRunAuthorityService {
  constructor(
    private readonly catalog: McpRunCatalogService,
    private readonly repository: McpRuntimeRepository,
    private readonly runRepository: WorkflowRunRepository,
    private readonly versionRepository: WorkflowVersionRepository,
  ) {}

  async materialize(input: {
    runId: string;
    organizationId: string | null;
    invokingNodeId?: string;
    allowedNodeIds?: readonly string[];
    contractVersion:
      | typeof MCP_LEGACY_CAPABILITY_CONTRACT_VERSION
      | typeof MCP_CAPABILITY_CONTRACT_VERSION;
  }): Promise<StoredMcpAuthority> {
    const run = await this.runRepository.findByRunId(input.runId);
    if (!run) {
      throw new NotFoundException(`Workflow run ${input.runId} not found`);
    }
    if (run.organizationId !== input.organizationId) {
      throw new ForbiddenException(
        `Workflow run ${input.runId} does not belong to this organization`,
      );
    }

    const invokingNodeId = input.invokingNodeId;
    const graphScoped = invokingNodeId !== undefined;
    const allowedNodeIds = graphScoped
      ? await this.connectedToolNodeIds(run, invokingNodeId)
      : normalizeAllowedNodeIds(input.allowedNodeIds ?? []);
    const built = await this.catalog.build({
      runId: input.runId,
      organizationId: run.organizationId,
      ...(invokingNodeId !== undefined && { invokingNodeId }),
      allowedNodeIds,
      allowAllSources: !graphScoped && allowedNodeIds.length === 0,
    });
    const authorityKey = sha256([
      input.contractVersion,
      {
        kind: 'run',
        runId: input.runId,
        organizationId: run.organizationId,
        invokingNodeId: invokingNodeId ?? null,
      },
      allowedNodeIds,
      built.configFingerprint,
    ]);
    const grantId = stableMcpAuthorityUuid('mcp-run-grant', authorityKey);
    const snapshotId = stableMcpAuthorityUuid('mcp-run-snapshot', authorityKey);
    const createdAt = new Date().toISOString();
    const scope: ExecutionScope = {
      kind: 'run',
      runId: input.runId,
      organizationId: run.organizationId,
      capabilityGrantId: grantId,
      ...(invokingNodeId !== undefined && { invokingNodeId }),
    };
    const sourceIds = [
      ...new Set([
        ...built.tools.map((tool) => tool.source.sourceId),
        ...built.resources.map((resource) => resource.sourceId),
        ...built.resourceTemplates.map((template) => template.sourceId),
        ...built.prompts.map((prompt) => prompt.sourceId),
      ]),
    ].sort();
    const grant: CapabilityGrant = CapabilityGrantSchema.parse({
      id: grantId,
      organizationId: run.organizationId,
      subject: { kind: 'run', runId: input.runId },
      sources: sourceIds.map((sourceId) => ({
        sourceId,
        toolAccess: { mode: 'all' as const },
      })),
      createdAt,
    });
    const snapshot: McpCapabilityCatalogSnapshot = McpCapabilityCatalogSnapshotSchema.parse({
      id: snapshotId,
      scope,
      version: input.contractVersion,
      configFingerprint: built.configFingerprint,
      ...(input.contractVersion === MCP_CAPABILITY_CONTRACT_VERSION && {
        runtimeBindings: built.runtimeBindings,
      }),
      tools: built.tools,
      resources: built.resources,
      resourceTemplates: built.resourceTemplates,
      prompts: built.prompts,
      createdAt,
    });
    const manifest = buildInvocationManifest(snapshot, grant);

    return this.repository.createOrReadRunAuthority({
      authorityKey,
      grant,
      snapshot,
      manifest,
    });
  }

  private async connectedToolNodeIds(
    run: {
      runId: string;
      workflowId: string;
      workflowVersionId: string | null;
      organizationId: string | null;
    },
    invokingNodeId: string,
  ): Promise<string[]> {
    if (!run.workflowVersionId) {
      throw new ConflictException(`Workflow run ${run.runId} has no immutable workflow version`);
    }
    const version = await this.versionRepository.findById(run.workflowVersionId, {
      organizationId: run.organizationId,
    });
    if (
      !version ||
      version.workflowId !== run.workflowId ||
      version.organizationId !== run.organizationId
    ) {
      throw new ConflictException(`Workflow run ${run.runId} version identity is mismatched`);
    }
    const graph = WorkflowGraphSchema.safeParse(version.graph);
    if (!graph.success) {
      throw new ConflictException(`Workflow run ${run.runId} version graph is invalid`);
    }
    if (!graph.data.nodes.some((node) => node.id === invokingNodeId)) {
      throw new NotFoundException(
        `Workflow node ${invokingNodeId} was not found in run ${run.runId}`,
      );
    }
    return normalizeAllowedNodeIds(
      graph.data.edges
        .filter((edge) => edge.target === invokingNodeId && edge.targetHandle === 'tools')
        .map((edge) => edge.source),
    );
  }
}

function normalizeAllowedNodeIds(nodeIds: readonly string[]): string[] {
  return [...new Set(nodeIds.map((nodeId) => nodeId.trim()).filter(Boolean))].sort();
}
