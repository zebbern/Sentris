import { useCallback } from 'react';
import {
  applyNodeChanges,
  applyEdgeChanges,
  type Node as ReactFlowNode,
  type Edge as ReactFlowEdge,
  type NodeChange,
  type EdgeChange,
} from 'reactflow';
import { isEntryPointNode } from '@/utils/entryPointUtils';
import type { FrontendNodeData } from '@/schemas/node';
import type { ToastContextValue } from '@/components/ui/toast-context';

interface UseWorkflowChangeHandlersParams {
  mode: 'design' | 'execution';
  designNodesRef: React.MutableRefObject<ReactFlowNode<FrontendNodeData>[]>;
  executionNodesRef: React.MutableRefObject<ReactFlowNode<FrontendNodeData>[]>;
  designEdgesRef: React.MutableRefObject<ReactFlowEdge[]>;
  onNodesChangeBase: (changes: NodeChange[]) => void;
  onEdgesChangeBase: (changes: EdgeChange[]) => void;
  captureSnapshot: (nodes: ReactFlowNode<FrontendNodeData>[], edges: ReactFlowEdge[]) => void;
  markDirty: () => void;
  toast: ToastContextValue['toast'];
  navigate: (path: string) => void;
  workflowId: string | null;
}

/**
 * Extracted from WorkflowBuilderContent: wraps onNodesChange/onEdgesChange
 * with entry-point validation, snapshot capture, and dirty-state tracking.
 */
export function useWorkflowChangeHandlers({
  mode,
  designNodesRef,
  executionNodesRef,
  designEdgesRef,
  onNodesChangeBase,
  onEdgesChangeBase,
  captureSnapshot,
  markDirty,
  toast,
  navigate,
  workflowId,
}: UseWorkflowChangeHandlersParams) {
  const onNodesChange = useCallback(
    (changes: any[]) => {
      if (changes.length === 0) {
        return;
      }

      const currentNodes = mode === 'design' ? designNodesRef.current : executionNodesRef.current;
      const totalEntryNodes = currentNodes.filter(isEntryPointNode).length;
      const removingLastEntry = changes.some((change) => {
        if (change.type !== 'remove') return false;
        const node = currentNodes.find((n) => n.id === change.id);
        return isEntryPointNode(node) && totalEntryNodes <= 1;
      });

      if (removingLastEntry) {
        toast({
          variant: 'destructive',
          title: 'Entry Point required',
          description: 'Each workflow must keep one Entry Point node.',
        });
        return;
      }

      const filteredChanges = changes.filter((change) => {
        if (change.type === 'add' && 'item' in change) {
          const node = (change as any).item as ReactFlowNode<FrontendNodeData>;
          const currentNodes =
            mode === 'design' ? designNodesRef.current : executionNodesRef.current;
          if (isEntryPointNode(node) && currentNodes.some(isEntryPointNode)) {
            toast({
              variant: 'destructive',
              title: 'Entry Point already exists',
              description: 'Each workflow can only have one Entry Point.',
            });
            return false;
          }
        }
        return true;
      });

      if (filteredChanges.length === 0) {
        return;
      }

      // Capture snapshot for structural changes or drag end
      if (mode === 'design') {
        const hasStructuralChange = filteredChanges.some(
          (c: any) => c.type === 'add' || c.type === 'remove',
        );
        const positionDragEnded = filteredChanges.some(
          (c: any) => c.type === 'position' && c.dragging === false,
        );

        if (hasStructuralChange || positionDragEnded) {
          // We must calculate the NEXT state to save it to history
          // otherwise we are saving the 'before' state as the 'current' state in store, ignoring the change
          const currentEdges = designEdgesRef.current;
          const nextNodes = applyNodeChanges(filteredChanges, currentNodes);

          // Filter edges connected to removed nodes to avoid stale edges in snapshot
          // This prevents the "deleted node but restored edges" artifact
          let nextEdges = currentEdges;
          const removedNodeIds = filteredChanges
            .filter((c: any) => c.type === 'remove')
            .map((c: any) => c.id);

          if (removedNodeIds.length > 0) {
            nextEdges = currentEdges.filter(
              (e) => !removedNodeIds.includes(e.source) && !removedNodeIds.includes(e.target),
            );
          }

          captureSnapshot(nextNodes, nextEdges);
        }
      }

      onNodesChangeBase(filteredChanges);

      // Mark design as dirty when nodes change in design mode
      // Execution dirty is tracked separately via useEffect comparing positions
      if (mode === 'design') {
        markDirty();
      }
    },
    [onNodesChangeBase, markDirty, mode, toast, captureSnapshot],
  );

  const onEdgesChange = useCallback(
    (changes: any[]) => {
      // Capture snapshot for edge changes (add/remove)
      // Note: Edge removals due to node deletion are handled by onNodesChange,
      // so we only need to capture explicit edge changes here
      if (mode === 'design' && changes.length > 0) {
        const hasStructuralChange = changes.some(
          (c: any) => c.type === 'add' || c.type === 'remove',
        );
        if (hasStructuralChange) {
          const currentNodes = designNodesRef.current;
          const currentEdges = designEdgesRef.current;
          const nextEdges = applyEdgeChanges(changes, currentEdges);
          // Pass both nodes and edges to ensure consistent snapshot
          captureSnapshot(currentNodes, nextEdges);
        }
      }

      onEdgesChangeBase(changes);
      // Mark as dirty when edges change (only in design mode)
      if (mode === 'design' && changes.length > 0) {
        markDirty();
      }
    },
    [onEdgesChangeBase, markDirty, mode, captureSnapshot],
  );

  const navigateToSchedules = useCallback(() => {
    if (workflowId) {
      navigate(`/schedules?workflowId=${workflowId}`);
    } else {
      navigate('/schedules');
    }
  }, [navigate, workflowId]);

  return { onNodesChange, onEdgesChange, navigateToSchedules };
}
