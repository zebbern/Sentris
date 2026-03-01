import type { Node } from 'reactflow';
import type { NodeData } from '@/schemas/node';

/** Maps node execution status to MiniMap display colors. */
export const NODE_STATUS_COLORS: Record<string, string> = {
  running: '#f59e0b',
  success: '#10b981',
  error: '#ef4444',
  default: '#6b7280',
} as const;

/** Returns the MiniMap color for a node based on its execution status. */
export function getNodeStatusColor(node: Node<NodeData>): string {
  const status = node.data?.status as string | undefined;
  if (status && status in NODE_STATUS_COLORS) {
    return NODE_STATUS_COLORS[status];
  }
  return NODE_STATUS_COLORS.default;
}
