import type { FindingItem } from '@/services/api/findings';
import type {
  FindingTriageStatus,
  FindingTriageResponse,
  FindingTriageEventResponse,
  BulkTriageResult,
} from '@sentris/shared';

// Re-export shared types for convenience
export type {
  FindingTriageStatus,
  FindingTriageResponse,
  FindingTriageEventResponse,
  BulkTriageResult,
};
export { FINDING_TRIAGE_STATUSES, VALID_TRANSITIONS } from '@sentris/shared';

// ---------------------------------------------------------------------------
// Triage-enriched finding
// ---------------------------------------------------------------------------

export interface FindingTriage {
  status: FindingTriageStatus;
  assigneeUserId: string | null;
  severityOverride: string | null;
  notes: string | null;
  updatedAt: string;
}

export interface FindingWithTriage extends FindingItem {
  triage: FindingTriage | null;
}

// ---------------------------------------------------------------------------
// Org member (for assignee picker)
// ---------------------------------------------------------------------------

export interface OrgMember {
  userId: string;
  displayName: string;
  email: string;
  role: string;
  avatarUrl: string | null;
}

// ---------------------------------------------------------------------------
// Status display metadata
// ---------------------------------------------------------------------------

export const TRIAGE_STATUS_META: Record<
  FindingTriageStatus,
  { label: string; color: string; bgClass: string; textClass: string; borderClass: string }
> = {
  new: {
    label: 'New',
    color: 'slate',
    bgClass: 'bg-slate-100 dark:bg-slate-800',
    textClass: 'text-slate-700 dark:text-slate-300',
    borderClass: 'border-slate-300 dark:border-slate-600',
  },
  triaged: {
    label: 'Triaged',
    color: 'blue',
    bgClass: 'bg-blue-100 dark:bg-blue-900',
    textClass: 'text-blue-700 dark:text-blue-300',
    borderClass: 'border-blue-300 dark:border-blue-600',
  },
  in_progress: {
    label: 'In Progress',
    color: 'amber',
    bgClass: 'bg-amber-100 dark:bg-amber-900',
    textClass: 'text-amber-700 dark:text-amber-300',
    borderClass: 'border-amber-300 dark:border-amber-600',
  },
  fixed: {
    label: 'Fixed',
    color: 'green',
    bgClass: 'bg-green-100 dark:bg-green-900',
    textClass: 'text-green-700 dark:text-green-300',
    borderClass: 'border-green-300 dark:border-green-600',
  },
  verified: {
    label: 'Verified',
    color: 'emerald',
    bgClass: 'bg-emerald-100 dark:bg-emerald-900',
    textClass: 'text-emerald-700 dark:text-emerald-300',
    borderClass: 'border-emerald-300 dark:border-emerald-600',
  },
  wont_fix: {
    label: "Won't Fix",
    color: 'gray',
    bgClass: 'bg-gray-100 dark:bg-gray-800',
    textClass: 'text-gray-700 dark:text-gray-300',
    borderClass: 'border-gray-300 dark:border-gray-600',
  },
  accepted_risk: {
    label: 'Accepted Risk',
    color: 'orange',
    bgClass: 'bg-orange-100 dark:bg-orange-900',
    textClass: 'text-orange-700 dark:text-orange-300',
    borderClass: 'border-orange-300 dark:border-orange-600',
  },
};
