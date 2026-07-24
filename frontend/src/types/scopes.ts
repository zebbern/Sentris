export interface Scope {
  id: string;
  organizationId: string;
  name: string;
  description?: string | null;
  domains: string[];
  repos: string[];
  ipRanges: string[];
  runtimeValues: Record<string, unknown>;
  createdBy?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateScopeInput {
  name: string;
  description?: string | null;
  domains: string[];
  repos: string[];
  ipRanges: string[];
  runtimeValues: Record<string, unknown>;
}

export type UpdateScopeInput = Partial<CreateScopeInput>;
