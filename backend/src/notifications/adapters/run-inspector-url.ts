import type { RunLifecycleEvent } from '@sentris/shared';

export function buildRunInspectorUrl(payload: RunLifecycleEvent): string | null {
  const base = process.env.SENTRIS_FRONTEND_BASE_URL?.trim().replace(/\/+$/, '');
  if (!base) {
    return null;
  }

  return `${base}/workflows/${payload.workflowId}/runs/${payload.runId}`;
}
