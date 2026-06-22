export type TemplateValidationStatus =
  | 'live-verified'
  | 'requires-secrets'
  | 'needs-fix'
  | 'needs-review'
  | 'unknown';

export type TemplateValidationFilter = 'all' | TemplateValidationStatus | 'stale';

export interface TemplateValidation {
  status: TemplateValidationStatus;
  recommendation: 'keep' | 'fix' | 'consolidate' | 'delete' | 'review' | 'unknown';
  terminalStatus?: string | null;
  artifactsCount?: number | null;
  verifiedAt?: string | null;
  rationale: string;
  isCurrent: boolean;
}

export interface Template {
  id: string;
  name: string;
  description?: string;
  category?: string;
  tags: string[];
  author?: string;
  repository: string;
  path: string;
  branch: string;
  version?: string;
  manifest: Record<string, unknown>;
  graph?: Record<string, unknown>;
  requiredSecrets: { name: string; type: string; description?: string }[];
  popularity: number;
  isOfficial: boolean;
  isVerified: boolean;
  isActive: boolean;
  validation?: TemplateValidation;
  createdAt: string;
  updatedAt: string;
}

export interface TemplateSubmission {
  id: string;
  templateName: string;
  description?: string;
  category?: string;
  repository: string;
  branch?: string;
  path: string;
  pullRequestNumber?: number;
  pullRequestUrl?: string;
  status: 'pending' | 'approved' | 'rejected' | 'merged';
  submittedBy: string;
  organizationId?: string;
  manifest?: Record<string, unknown>;
  graph?: Record<string, unknown>;
  feedback?: string;
  reviewedBy?: string;
  reviewedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface TemplateCategory {
  category: string | null;
  count: number;
}
