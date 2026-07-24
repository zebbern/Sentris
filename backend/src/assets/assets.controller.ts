import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentAuth } from '../auth/auth-context.decorator';
import type { AuthContext } from '../auth/types';
import { assetTypeEnum } from '../database/schema';
import type { AssetType } from './asset-extractor';
import { AssetInventoryService } from './assets.service';
import { AssetResponse } from './dto/assets.dto';

const VALID_ASSET_TYPES = new Set<string>(assetTypeEnum.enumValues);
const MAX_LIMIT = 1000;

@ApiTags('assets')
@Controller('scopes')
export class AssetsController {
  constructor(private readonly assetsService: AssetInventoryService) {}

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
