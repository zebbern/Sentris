import type { Asset } from '@/types/scopes';
import { httpGet } from './client';

export const assetsApi = {
  listByScope: (scopeId: string) => httpGet<Asset[]>(`/scopes/${scopeId}/assets`),
};
