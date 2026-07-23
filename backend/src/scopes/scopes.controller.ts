import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  ParseUUIDPipe,
} from '@nestjs/common';

import {
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import { ZodValidationPipe } from 'nestjs-zod';

import { Roles } from '../auth/roles.decorator';

import { CurrentAuth } from '../auth/auth-context.decorator';

import type { AuthContext } from '../auth/types';

import { ScopesService } from './scopes.service';

import {
  CreateScopeDto,
  CreateScopeSchema,
  ScopeResponse,
  UpdateScopeDto,
  UpdateScopeSchema,
} from './dto/scopes.dto';

@ApiTags('scopes')
@Controller('scopes')
export class ScopesController {
  constructor(private readonly scopesService: ScopesService) {}

  @Get()
  @ApiOperation({ summary: 'List scopes for the current organization' })
  @ApiOkResponse({ type: [ScopeResponse] })
  async listScopes(@CurrentAuth() auth: AuthContext | null): Promise<ScopeResponse[]> {
    return this.scopesService.listScopes(auth);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a scope by id' })
  @ApiOkResponse({ type: ScopeResponse })
  async getScope(
    @CurrentAuth() auth: AuthContext | null,

    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<ScopeResponse> {
    return this.scopesService.getScope(auth, id);
  }

  @Post()
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Create a scope' })
  @ApiCreatedResponse({ type: ScopeResponse })
  async createScope(
    @CurrentAuth() auth: AuthContext | null,

    @Body(new ZodValidationPipe(CreateScopeSchema)) body: CreateScopeDto,
  ): Promise<ScopeResponse> {
    return this.scopesService.createScope(auth, body);
  }

  @Patch(':id')
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Update a scope' })
  @ApiOkResponse({ type: ScopeResponse })
  async updateScope(
    @CurrentAuth() auth: AuthContext | null,

    @Param('id', new ParseUUIDPipe()) id: string,

    @Body(new ZodValidationPipe(UpdateScopeSchema)) body: UpdateScopeDto,
  ): Promise<ScopeResponse> {
    return this.scopesService.updateScope(auth, id, body);
  }

  @Delete(':id')
  @Roles('ADMIN')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a scope' })
  @ApiNoContentResponse()
  async deleteScope(
    @CurrentAuth() auth: AuthContext | null,

    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<void> {
    await this.scopesService.deleteScope(auth, id);
  }
}
