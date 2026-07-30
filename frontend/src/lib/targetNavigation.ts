export function buildTargetWorkflowSelectionPath(scopeId: string): string {
  const search = new URLSearchParams({ scopeId, launch: '1' });
  return `/workflows?${search.toString()}`;
}

export function buildScopedWorkflowPath(workflowId: string, currentSearch: string): string {
  const current = new URLSearchParams(currentSearch);
  const next = new URLSearchParams();
  const scopeId = current.get('scopeId');

  if (scopeId) next.set('scopeId', scopeId);
  if (current.get('launch') === '1') next.set('launch', '1');

  const search = next.toString();
  return `/workflows/${encodeURIComponent(workflowId)}${search ? `?${search}` : ''}`;
}

export function buildTargetWorkflowPath(workflowId: string, scopeId: string): string {
  return buildScopedWorkflowPath(
    workflowId,
    new URLSearchParams({ scopeId, launch: '1' }).toString(),
  );
}

export function buildTargetFindingPath(scopeId: string, findingId: string): string {
  const search = new URLSearchParams({ scopeId, findingId });
  return `/findings?${search.toString()}`;
}

export function consumeScopedLaunchSearch(currentSearch: string): string {
  const next = new URLSearchParams(currentSearch);
  next.delete('launch');
  return next.toString();
}
