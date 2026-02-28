/**
 * Shared table utilities used across SchedulesPage, WebhooksPage,
 * and similar list/table views that display workflow-linked entities.
 */

/** Lightweight workflow descriptor used by schedule/webhook selectors. */
export interface WorkflowOption {
  id: string;
  name: string;
}

/**
 * Look up a workflow name by ID. Returns `'Unknown workflow'` when no match is found.
 */
export function getWorkflowName(workflowId: string, workflows: WorkflowOption[]): string {
  const match = workflows.find((workflow) => workflow.id === workflowId);
  return match?.name ?? 'Unknown workflow';
}

/** Allowed badge variant values. */
export type BadgeVariant = 'default' | 'secondary' | 'destructive' | 'outline';

/** Data-only badge descriptor — the caller renders `<Badge>` with these values. */
export interface StatusBadgeProps {
  variant: BadgeVariant;
  label: string;
}

/**
 * Derive badge variant + human-readable label for a given status string.
 *
 * @param status   - Raw status value (e.g. `'active'`, `'paused'`).
 * @param variants - Map of status → badge variant. Falls back to `'outline'`.
 */
export function getStatusBadgeProps(
  status: string,
  variants: Record<string, BadgeVariant>,
): StatusBadgeProps {
  const variant: BadgeVariant = variants[status] || 'outline';
  const label = status.charAt(0).toUpperCase() + status.slice(1);
  return { variant, label };
}
