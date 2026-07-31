import { Body, Controller, Post } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { ToolRegistryService } from './tool-registry.service';
import { McpLegacyOutboundCompatibilityService } from './mcp-legacy-outbound-compatibility.service';
import { McpGroupsService } from '../mcp-groups/mcp-groups.service';
import { McpAuthService } from './mcp-auth.service';
import {
  CleanupRunInput,
  GenerateTokenInput,
  RegisterComponentToolInput,
  RegisterGroupServerInput,
  RegisterMcpServerInput,
  ToolsReadyInput,
} from './dto/mcp.dto';

@ApiExcludeController()
@Controller('internal/mcp')
export class InternalMcpController {
  constructor(
    private readonly toolRegistry: ToolRegistryService,
    private readonly mcpGroupsService: McpGroupsService,
    private readonly legacyOutbound: McpLegacyOutboundCompatibilityService,
    private readonly mcpAuthService: McpAuthService,
  ) {}

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
}
