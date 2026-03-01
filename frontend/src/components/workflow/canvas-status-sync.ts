import { useEffect, type Dispatch, type SetStateAction } from 'react';
import type { Node } from 'reactflow';

import type { NodeData } from '@/schemas/node';

export interface UseNodeStatusSyncDeps {
  mode: string;
  nodeStates: Record<string, string>;
  setNodes: Dispatch<SetStateAction<Node<NodeData>[]>>;
}

/**
 * Syncs node execution status between design and execution modes.
 * In design mode, resets all node statuses to 'idle'.
 * In execution mode, applies live status from the execution store.
 */
export function useNodeStatusSync({ mode, nodeStates, setNodes }: UseNodeStatusSyncDeps): void {
  useEffect(() => {
    if (mode !== 'execution') {
      setNodes((nds) =>
        nds.map((node) => {
          if (node.data.status && node.data.status !== 'idle') {
            return { ...node, data: { ...node.data, status: 'idle' } };
          }
          return node;
        }),
      );
      return;
    }

    setNodes((nds) =>
      nds.map((node) => {
        const executionState = nodeStates[node.id];
        if (executionState && executionState !== node.data.status) {
          return { ...node, data: { ...node.data, status: executionState } };
        }
        return node;
      }),
    );
  }, [mode, nodeStates, setNodes]);
}
