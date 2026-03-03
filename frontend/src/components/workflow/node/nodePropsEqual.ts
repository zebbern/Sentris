import type { NodeProps, Node } from '@xyflow/react';
import type { FrontendNodeData } from '@/schemas/node';

/**
 * Shallow-compare two FrontendNodeData objects by own enumerable keys.
 * Avoids deep comparison while catching new data references that ReactFlow
 * may create on every render even when the underlying values haven't changed.
 */
export function areWorkflowNodePropsEqual(
  prev: NodeProps<Node<FrontendNodeData>>,
  next: NodeProps<Node<FrontendNodeData>>,
): boolean {
  if (prev.id !== next.id) return false;
  if (prev.selected !== next.selected) return false;
  if (prev.type !== next.type) return false;
  if (prev.dragging !== next.dragging) return false;

  if (prev.data !== next.data) {
    const prevData = prev.data;
    const nextData = next.data;
    const prevKeys = Object.keys(prevData) as (keyof typeof prevData)[];
    const nextKeys = Object.keys(nextData) as (keyof typeof nextData)[];
    if (prevKeys.length !== nextKeys.length) return false;
    for (const key of prevKeys) {
      if (prevData[key] !== nextData[key]) return false;
    }
  }

  return true;
}

/** Compute sample payload for entry-point webhook dialog. */
export function computeEntryPointPayload(
  nodeData: FrontendNodeData,
  isEntryPoint: boolean,
): Record<string, unknown> {
  const params = nodeData.config?.params || {};
  if (!isEntryPoint || !params.runtimeInputs) return {};
  try {
    const inputs =
      typeof params.runtimeInputs === 'string'
        ? JSON.parse(params.runtimeInputs)
        : params.runtimeInputs;
    if (!Array.isArray(inputs)) return {};
    return inputs.reduce((acc: Record<string, unknown>, input: { id: string; type?: string }) => {
      acc[input.id] = input.type === 'number' ? 0 : input.type === 'boolean' ? false : 'value';
      return acc;
    }, {});
  } catch {
    return {};
  }
}
