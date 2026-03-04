import { httpGet, httpPut } from './client';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PostureTrendBucket {
  date: string;
  critical: number;
  high: number;
  medium: number;
  low: number;
  info: number;
}

export interface PostureTrendResponse {
  buckets: PostureTrendBucket[];
}

export interface TriageVelocityBucket {
  date: string;
  new: number;
  triaged: number;
  in_progress: number;
  fixed: number;
  verified: number;
  wont_fix: number;
  accepted_risk: number;
}

export interface TriageVelocityResponse {
  buckets: TriageVelocityBucket[];
}

export interface MttrSeverity {
  severity: string;
  mttrSeconds: number | null;
  resolvedCount: number;
}

export interface MttrResponse {
  severities: MttrSeverity[];
}

export interface SlaComplianceSeverity {
  severity: string;
  totalWithSla: number;
  metSla: number;
  missedSla: number;
  complianceRate: number | null;
}

export interface SlaComplianceResponse {
  severities: SlaComplianceSeverity[];
}

export interface StatusDistributionEntry {
  status: string;
  count: number;
}

export interface StatusDistributionResponse {
  statuses: StatusDistributionEntry[];
  total: number;
}

export interface TopAssignee {
  userId: string | null;
  totalCount: number;
  resolvedCount: number;
  resolutionRate: number | null;
}

export interface TopAssigneesResponse {
  assignees: TopAssignee[];
}

export interface SlaPolicy {
  id: string;
  severity: string;
  deadlineHours: number;
  createdAt: string;
  updatedAt: string;
}

export interface SlaPoliciesResponse {
  policies: SlaPolicy[];
}

export interface UpsertSlaPolicyInput {
  severity: string;
  deadlineHours: number;
}

export interface UpsertSlaPoliciesBody {
  policies: UpsertSlaPolicyInput[];
}

// ---------------------------------------------------------------------------
// API functions
// ---------------------------------------------------------------------------

export const triageAnalyticsApi = {
  getPostureTrend: (period: string): Promise<PostureTrendResponse> =>
    httpGet<PostureTrendResponse>(`/findings/analytics/posture-trend?period=${period}`),

  getTriageVelocity: (period: string): Promise<TriageVelocityResponse> =>
    httpGet<TriageVelocityResponse>(`/findings/analytics/triage-velocity?period=${period}`),

  getMttr: (period: string): Promise<MttrResponse> =>
    httpGet<MttrResponse>(`/findings/analytics/mttr?period=${period}`),

  getSlaCompliance: (period: string): Promise<SlaComplianceResponse> =>
    httpGet<SlaComplianceResponse>(`/findings/analytics/sla-compliance?period=${period}`),

  getStatusDistribution: (): Promise<StatusDistributionResponse> =>
    httpGet<StatusDistributionResponse>('/findings/analytics/status-distribution'),

  getTopAssignees: (limit = 10): Promise<TopAssigneesResponse> =>
    httpGet<TopAssigneesResponse>(`/findings/analytics/top-assignees?limit=${limit}`),

  getSlaPolicies: (): Promise<SlaPoliciesResponse> =>
    httpGet<SlaPoliciesResponse>('/findings/sla-policies'),

  upsertSlaPolicies: (body: UpsertSlaPoliciesBody): Promise<SlaPoliciesResponse> =>
    httpPut<SlaPoliciesResponse>('/findings/sla-policies', body),
};
