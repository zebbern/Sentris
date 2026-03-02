import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiOkResponse, ApiCreatedResponse, ApiTags, ApiOperation } from '@nestjs/swagger';
import { ZodValidationPipe } from 'nestjs-zod';
import { RegistryCatalogQuerySchema } from '@sentris/shared';

import { Roles } from '../auth/roles.decorator';
import { CurrentAuth } from '../auth/auth-context.decorator';
import type { AuthContext } from '../auth/types';
import { McpRegistryService } from './mcp-registry.service';
import {
  RegistryCatalogListResponseDto,
  RegistryCatalogDetailDto,
  RegistryCatalogQueryDto,
} from './dto/registry-catalog.dto';
import { RegistryImportRequestDto, RegistryImportResponseDto } from './dto/registry-import.dto';
import { RegistryImportRequestSchema } from '@sentris/shared';

@ApiTags('mcp-registry')
@Controller('mcp-registry')
export class McpRegistryController {
  constructor(private readonly mcpRegistryService: McpRegistryService) {}

  @Get('catalog')
  @ApiOperation({ summary: 'Browse/search the Docker MCP Registry catalog' })
  @ApiOkResponse({ type: RegistryCatalogListResponseDto })
  async getCatalog(
    @CurrentAuth() auth: AuthContext | null,
    @Query(new ZodValidationPipe(RegistryCatalogQuerySchema)) query: RegistryCatalogQueryDto,
  ) {
    return this.mcpRegistryService.getCatalog(auth, query);
  }

  @Get('catalog/:name')
  @ApiOperation({ summary: 'Get details for a single registry server' })
  @ApiOkResponse({ type: RegistryCatalogDetailDto })
  async getCatalogEntry(@CurrentAuth() auth: AuthContext | null, @Param('name') name: string) {
    return this.mcpRegistryService.getCatalogEntry(auth, name);
  }

  @Post('import')
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Import a registry server into the MCP Library' })
  @ApiCreatedResponse({ type: RegistryImportResponseDto })
  async importServer(
    @CurrentAuth() auth: AuthContext | null,
    @Body(new ZodValidationPipe(RegistryImportRequestSchema)) body: RegistryImportRequestDto,
  ) {
    return this.mcpRegistryService.importServer(auth, body);
  }

  @Post('sync')
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Trigger a manual registry sync' })
  async triggerSync() {
    return this.mcpRegistryService.triggerSync();
  }

  @Get('sync/status')
  @ApiOperation({ summary: 'Get the current registry sync status' })
  async getSyncStatus() {
    return this.mcpRegistryService.getSyncStatus();
  }
}
