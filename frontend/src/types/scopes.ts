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

export type AssetObservationStatus = 'observed' | 'not-observed' | 'not-scanned';
export type AssetComparisonChange = 'new' | 'unchanged' | 'missing';

export interface AssetRunComparisonItem {
  assetType: AssetType;
  assetValue: string;
  sourceComponentIds: string[];
  baselineObserved: boolean;
  currentObserved: boolean;
  observationStatus: AssetObservationStatus;
  change: AssetComparisonChange;
}

export interface AssetRunComparison {
  scopeId: string;
  workflowId: string;
  baselineRunId: string;
  currentRunId: string;
  baselineCoverage: {
    completedComponents: string[];
    failedComponents: string[];
  };
  currentCoverage: {
    completedComponents: string[];
    failedComponents: string[];
  };
  summary: {
    observed: number;
    notObserved: number;
    notScanned: number;
  };
  items: AssetRunComparisonItem[];
}
