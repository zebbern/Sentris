/**
 * Shared constants and helpers for identifying workflow entry-point nodes.
 *
 * Previously duplicated across Canvas, ConfigPanel, WorkflowBuilder,
 * useWorkflowGraphControllers, and workflowSerializer.
 */

/** The canonical component ID for the workflow entry point. */
export const ENTRY_COMPONENT_ID = 'core.workflow.entrypoint';

/** The legacy slug variant used for backward-compatible entry point identification. */
export const ENTRY_COMPONENT_SLUG = 'entry-point';

/** All known identifiers for entry point components. */
export const ENTRY_POINT_COMPONENT_IDS = [ENTRY_COMPONENT_ID, ENTRY_COMPONENT_SLUG] as const;

/** Check whether a component reference string identifies an entry point component. */
export function isEntryPointComponentRef(ref?: string | null): boolean {
  return ref === ENTRY_COMPONENT_ID || ref === ENTRY_COMPONENT_SLUG;
}

/**
 * Check whether a React Flow node represents a workflow entry point.
 *
 * Accepts any object whose `data` is a record (compatible with Zod `.passthrough()`
 * index signatures), making it work with both `Node<NodeData>` and
 * `ReactFlowNode<FrontendNodeData>`.
 */
export function isEntryPointNode(node?: { data?: Record<string, unknown> } | null): boolean {
  if (!node) return false;
  const componentRef = (node.data?.componentId ?? node.data?.componentSlug) as string | undefined;
  return isEntryPointComponentRef(componentRef);
}
