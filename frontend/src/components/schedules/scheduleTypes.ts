import type { ScheduleOverlapPolicy } from '@sentris/shared';

export type RuntimeInputType = 'file' | 'text' | 'number' | 'json' | 'array' | 'string';
export type NormalizedRuntimeInputType = Exclude<RuntimeInputType, 'string'>;

export interface RuntimeInputDefinition {
  id: string;
  label: string;
  type: RuntimeInputType;
  required: boolean;
  description?: string;
  defaultValue?: unknown;
}

export interface WorkflowOption {
  id: string;
  name: string;
}

export type ScheduleEditorMode = 'create' | 'edit';

export interface ScheduleFormState {
  workflowId: string;
  name: string;
  description: string;
  cronExpression: string;
  timezone: string;
  humanLabel: string;
  overlapPolicy: ScheduleOverlapPolicy;
  catchupWindowSeconds: string;
}

export type OverrideDraft = Record<string, string>;

/** Minimal graph‐node shape used by schedule sub‐components. */
export interface ScheduleWorkflowNode {
  id: string;
  type: string;
  data?: { label?: string; [key: string]: unknown };
}

export const normalizeRuntimeInputType = (type: RuntimeInputType): NormalizedRuntimeInputType =>
  type === 'string' ? 'text' : type;

export const OVERLAP_OPTIONS: {
  value: ScheduleOverlapPolicy;
  label: string;
  description: string;
}[] = [
  {
    value: 'skip',
    label: 'Skip overlapping runs',
    description: 'New runs are skipped when the previous run is still executing.',
  },
  {
    value: 'buffer',
    label: 'Buffer until available',
    description: 'Backlog queued runs and execute sequentially when workers free up.',
  },
  {
    value: 'allow',
    label: 'Allow overlap',
    description: 'Always start the run even when previous executions are in-flight.',
  },
];

/**
 * Validate a 5-field cron expression (minute hour day-of-month month day-of-week).
 * Returns null if valid, or an error message string if invalid.
 */
export function validateCronExpression(expression: string): string | null {
  const trimmed = expression.trim();
  if (!trimmed) return null; // empty is handled by required check

  const parts = trimmed.split(/\s+/);
  if (parts.length !== 5) {
    return `Expected 5 fields (minute hour day month weekday), got ${parts.length}.`;
  }

  const fieldRanges: [string, number, number][] = [
    ['minute', 0, 59],
    ['hour', 0, 23],
    ['day of month', 1, 31],
    ['month', 1, 12],
    ['day of week', 0, 7],
  ];

  // Matches: *, */N, N, N-N, N-N/N, names like MON-FRI, JAN-DEC, and comma-separated lists
  const fieldPattern = /^(\*|[0-9a-zA-Z]+(-[0-9a-zA-Z]+)?)(\/(0|[1-9][0-9]*))?$/;

  for (let i = 0; i < 5; i++) {
    const [fieldName] = fieldRanges[i];
    const items = parts[i].split(',');
    for (const item of items) {
      if (!fieldPattern.test(item)) {
        return `Invalid ${fieldName} field: "${item}".`;
      }
    }
  }

  return null;
}
