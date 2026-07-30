import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentAuth } from '../auth/auth-context.decorator';
import type { AuthContext } from '../auth/types';
import { ScopeFindingsSummaryResponse } from './dto/scope-findings.dto';
import { ScopeFindingsService } from './scope-findings.service';

@ApiTags('scopes')
@Controller('scopes')
export class ScopeFindingsController {
  constructor(private readonly scopeFindingsService: ScopeFindingsService) {}

  @Get(':id/findings-summary')
  @ApiOperation({ summary: 'Get finding counts for a scope' })
  @ApiOkResponse({ type: ScopeFindingsSummaryResponse })
  async getSummary(
    @CurrentAuth() auth: AuthContext | null,
    @Param('id', new ParseUUIDPipe()) scopeId: string,
  ): Promise<ScopeFindingsSummaryResponse> {
    return this.scopeFindingsService.getSummary(auth, scopeId);
  }
}
