import { Body, Controller, Post } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ZodValidationPipe } from 'nestjs-zod';

import { CurrentAuth } from '../auth/auth-context.decorator';
import type { AuthContext } from '../auth/types';
import { AiService } from './ai.service';
import {
  ListAnthropicModelsDto,
  ListAnthropicModelsResponse,
  ListAnthropicModelsSchema,
} from './dto/ai-models.dto';

@ApiTags('ai')
@Controller('ai')
export class AiController {
  constructor(private readonly aiService: AiService) {}

  @Post('anthropic/models')
  @ApiOperation({
    summary: 'List Anthropic models accessible to a stored API key secret',
  })
  @ApiOkResponse({ type: ListAnthropicModelsResponse })
  async listAnthropicModels(
    @CurrentAuth() auth: AuthContext | null,
    @Body(new ZodValidationPipe(ListAnthropicModelsSchema)) body: ListAnthropicModelsDto,
  ): Promise<ListAnthropicModelsResponse> {
    return this.aiService.listAnthropicModels(auth, body.apiKeySecretId);
  }
}
