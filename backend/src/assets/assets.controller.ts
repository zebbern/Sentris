import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ZodValidationPipe } from 'nestjs-zod';

import { CurrentAuth } from '../auth/auth-context.decorator';
import type { AuthContext } from '../auth/types';
import { assetTypeEnum } from '../database/schema';
import type { AssetType } from './asset-extractor';
import { AssetRunComparisonService } from './asset-run-comparison.service';
import { AssetsService } from './assets.service';
import {
  AssetRunComparisonQuery,
  AssetRunComparisonQuerySchema,
  AssetRunComparisonResponse,
} from './dto/asset-comparison.dto';
import { AssetResponse } from './dto/assets.dto';

const VALID_ASSET_TYPES = new Set<string>(assetTypeEnum.enumValues);
const MAX_LIMIT = 1000;

@ApiTags('assets')
@Controller('scopes')
export class AssetsController {
  constructor(
    private readonly assetsService: AssetsService,
    private readonly comparisonService: AssetRunComparisonService,
  ) {}

  @Get(':scopeId/assets/compare')
  @ApiOperation({ summary: 'Compare asset observations and scanner coverage between two runs' })
  @ApiOkResponse({ type: AssetRunComparisonResponse })
  async compareRuns(
    @CurrentAuth() auth: AuthContext | null,
    @Param('scopeId', new ParseUUIDPipe()) scopeId: string,
    @Query(new ZodValidationPipe(AssetRunComparisonQuerySchema))
    query: AssetRunComparisonQuery,
  ): Promise<AssetRunComparisonResponse> {
    return this.comparisonService.compare(auth, scopeId, query);
  }

  @Get(':scopeId/assets')
  @ApiOperation({ summary: 'List discovered assets for a scope' })
  @ApiOkResponse({ type: [AssetResponse] })
  async listAssets(
    @CurrentAuth() auth: AuthContext | null,
    @Param('scopeId', new ParseUUIDPipe()) scopeId: string,
    @Query('type') type?: string,
    @Query('limit') limit?: string,
  ): Promise<AssetResponse[]> {
    const assetType = type && VALID_ASSET_TYPES.has(type) ? (type as AssetType) : undefined;

    const parsedLimit = limit ? Number.parseInt(limit, 10) : undefined;
    const safeLimit =
      parsedLimit !== undefined && Number.isFinite(parsedLimit) && parsedLimit > 0
        ? Math.min(parsedLimit, MAX_LIMIT)
        : undefined;

    return this.assetsService.listAssets(auth, scopeId, { assetType, limit: safeLimit });
  }
}
