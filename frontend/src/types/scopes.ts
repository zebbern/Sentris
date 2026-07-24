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

export type AssetType =
  | 'subdomain'
  | 'host'
  | 'ip-address'
  | 'open-port'
  | 'http-probe'
  | 'dns-record'
  | 'crawled-url'
  | 'url';
export interface Asset {
  id: string;
  organizationId: string;
  scopeId: string;
  assetType: AssetType;
  assetValue: string;
  firstSeenAt: string;
  lastSeenAt: string;
  firstSeenRunId?: string | null;
  lastSeenRunId?: string | null;
  sourceComponentId?: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}
