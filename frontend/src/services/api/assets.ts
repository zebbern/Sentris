import type { Asset, AssetRunComparison } from '@/types/scopes';
import { httpGet } from './client';

export const assetsApi = {
  listByScope: (scopeId: string) => httpGet<Asset[]>(`/scopes/${scopeId}/assets`),
  compareRuns: (scopeId: string, baselineRunId: string, currentRunId: string) => {
    const search = new URLSearchParams({ baselineRunId, currentRunId });
    return httpGet<AssetRunComparison>(
      `/scopes/${encodeURIComponent(scopeId)}/assets/compare?${search.toString()}`,
    );
  },
};
