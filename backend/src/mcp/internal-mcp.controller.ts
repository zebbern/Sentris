import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { ZodValidationPipe } from 'nestjs-zod';
import { ToolRegistryService } from './tool-registry.service';
import { McpLegacyOutboundCompatibilityService } from './mcp-legacy-outbound-compatibility.service';
import { McpGroupsService } from '../mcp-groups/mcp-groups.service';
import { McpAuthService } from './mcp-auth.service';
import {
  CleanupRunInput,
  ClaimMcpOperationBody,
  ClaimMcpOperationBodySchema,
  AmbiguousMcpInvocationBody,
  AmbiguousMcpInvocationBodySchema,
  ClaimMcpInvocationBody,
  ClaimMcpInvocationBodySchema,
  GenerateTokenInput,
  PrepareMcpInvocationBody,
  PrepareMcpInvocationBodySchema,
  PrepareMcpOperationBody,
  PrepareMcpOperationBodySchema,
  ReconcileMcpOperationBody,
  ReconcileMcpOperationBodySchema,
  ReconcileMcpInvocationBody,
  ReconcileMcpInvocationBodySchema,
  ReconcileRunMcpInvocationsBody,
  ReconcileRunMcpInvocationsBodySchema,
  ResolveMcpRuntimeDefinitionBody,
  ResolveMcpRuntimeDefinitionBodySchema,
  RegisterComponentToolInput,
  RegisterGroupServerInput,
  RegisterMcpServerInput,
  SettleMcpInvocationBody,
  SettleMcpInvocationBodySchema,
  SettleMcpOperationBody,
  SettleMcpOperationBodySchema,
  ToolsReadyInput,
} from './dto/mcp.dto';
import { InternalOnlyGuard } from '../auth/internal-only.guard';
import { McpInvocationService } from '../mcp-runtime/mcp-invocation.service';
import { McpServerRuntimeConfigService } from '../mcp-servers/mcp-server-runtime-config.service';

@ApiExcludeController()
@Controller('internal/mcp')
@UseGuards(InternalOnlyGuard)
export class InternalMcpController {
  constructor(
    private readonly toolRegistry: ToolRegistryService,
    private readonly mcpGroupsService: McpGroupsService,
    private readonly legacyOutbound: McpLegacyOutboundCompatibilityService,
    private readonly mcpAuthService: McpAuthService,
    private readonly invocationService: McpInvocationService,
    private readonly runtimeConfigService: McpServerRuntimeConfigService,
  ) {}

  @Post('runtime-definition')
  resolveRuntimeDefinition(
    @Body(new ZodValidationPipe(ResolveMcpRuntimeDefinitionBodySchema))
    body: ResolveMcpRuntimeDefinitionBody,
  ) {
    return this.runtimeConfigService.resolveDefinition(body.runtimeKey);
  }

  @Post('generate-token')
  async generateToken(@Body() body: GenerateTokenInput) {
    const token = await this.mcpAuthService.generateSessionToken(
      body.runId,
      body.organizationId ?? null,
      body.agentId,
      body.allowedNodeIds,
      body.ttlSeconds,
      body.invokingNodeId,
    );
    return { token };
  }

  @Post('register-component')
  async registerComponent(@Body() body: RegisterComponentToolInput) {
    await this.toolRegistry.registerComponentTool(body);
    return { success: true };
  }

  /**
   * Register an MCP server with pre-discovered tools.
   * This is the only way to register MCP servers.
   */
  @Post('register-mcp-server')
  async registerMcpServer(@Body() body: RegisterMcpServerInput) {
    await this.toolRegistry.registerMcpServer(body);
    return { success: true, toolCount: body.tools?.length ?? 0 };
  }

  @Post('cleanup')
  async cleanupRun(@Body() body: CleanupRunInput) {
    const [registryCleanup, outboundCleanup] = await Promise.allSettled([
      this.toolRegistry.cleanupRun(body.runId),
      this.legacyOutbound.cleanupRun(body.runId),
    ]);

    if (registryCleanup.status === 'rejected') {
      throw registryCleanup.reason;
    }
    if (outboundCleanup.status === 'rejected') {
      throw outboundCleanup.reason;
    }
    return { containerIds: registryCleanup.value };
  }

  @Post('tools-ready')
  async areToolsReady(@Body() body: ToolsReadyInput) {
    const ready = await this.toolRegistry.areAllToolsReady(body.runId, body.requiredNodeIds);
    return { ready };
  }

  @Post('register-group-server')
  async registerGroupServer(@Body() body: RegisterGroupServerInput) {
    const serverConfig = await this.mcpGroupsService.getServerConfig(body.groupSlug, body.serverId);
    return serverConfig;
  }

  @Post('invocations/prepare')
  prepareInvocation(
    @Body(new ZodValidationPipe(PrepareMcpInvocationBodySchema))
    body: PrepareMcpInvocationBody,
  ) {
    return this.invocationService.prepare(body.request);
  }

  @Post('invocations/claim')
  claimInvocation(
    @Body(new ZodValidationPipe(ClaimMcpInvocationBodySchema))
    body: ClaimMcpInvocationBody,
  ) {
    return this.invocationService.claimComponentDispatch(body.ref);
  }

  @Post('invocations/complete')
  completeInvocation(
    @Body(new ZodValidationPipe(SettleMcpInvocationBodySchema))
    body: SettleMcpInvocationBody,
  ) {
    return this.invocationService.complete(body.ref, body.result);
  }

  @Post('invocations/fail')
  failInvocation(
    @Body(new ZodValidationPipe(SettleMcpInvocationBodySchema))
    body: SettleMcpInvocationBody,
  ) {
    return this.invocationService.fail(body.ref, body.result);
  }

  @Post('invocations/ambiguous')
  ambiguousInvocation(
    @Body(new ZodValidationPipe(AmbiguousMcpInvocationBodySchema))
    body: AmbiguousMcpInvocationBody,
  ) {
    return this.invocationService.ambiguous(body.ref, body.message, body.completedAt);
  }

  @Post('invocations/reconcile')
  reconcileInvocation(
    @Body(new ZodValidationPipe(ReconcileMcpInvocationBodySchema))
    body: ReconcileMcpInvocationBody,
  ) {
    return this.invocationService.reconcileDispatchFailure(body);
  }

  @Post('invocations/reconcile-run')
  async reconcileRunInvocations(
    @Body(new ZodValidationPipe(ReconcileRunMcpInvocationsBodySchema))
    body: ReconcileRunMcpInvocationsBody,
  ) {
    await this.invocationService.reconcileRunInvocations(body);
    return { success: true };
  }

  @Post('operations/prepare')
  prepareOperation(
    @Body(new ZodValidationPipe(PrepareMcpOperationBodySchema))
    body: PrepareMcpOperationBody,
  ) {
    return this.invocationService.prepareOperation(body.request);
  }

  @Post('operations/claim')
  claimOperation(
    @Body(new ZodValidationPipe(ClaimMcpOperationBodySchema))
    body: ClaimMcpOperationBody,
  ) {
    return this.invocationService.claimMcpOperationDispatch(body);
  }

  @Post('operations/settle')
  settleOperation(
    @Body(new ZodValidationPipe(SettleMcpOperationBodySchema))
    body: SettleMcpOperationBody,
  ) {
    return this.invocationService.settleMcpOperation(body);
  }

  @Post('operations/reconcile')
  reconcileOperation(
    @Body(new ZodValidationPipe(ReconcileMcpOperationBodySchema))
    body: ReconcileMcpOperationBody,
  ) {
    return this.invocationService.reconcileMcpOperationDispatch(body);
  }
}
