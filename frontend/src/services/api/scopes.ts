import type { Scope, CreateScopeInput, UpdateScopeInput } from '@/types/scopes';
import { httpGet, httpPost, httpPatch, httpDel } from './client';

export const scopesApi = {
  list: () => httpGet<Scope[]>('/scopes'),

  get: (id: string) => httpGet<Scope>(`/scopes/${id}`),

  create: (payload: CreateScopeInput) => httpPost<Scope>('/scopes', payload),

  update: (id: string, payload: UpdateScopeInput) => httpPatch<Scope>(`/scopes/${id}`, payload),

  remove: (id: string) => httpDel(`/scopes/${id}`),
};
