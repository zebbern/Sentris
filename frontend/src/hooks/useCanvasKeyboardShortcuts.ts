import { useEffect, type Dispatch, type SetStateAction } from 'react';
import type { Node, Edge } from '@xyflow/react';

import type { NodeData } from '@/schemas/node';
import { isEntryPointNode } from '@/utils/entryPointUtils';
import type { ToastContextValue } from '@/components/ui/toast-context';

interface UseCanvasKeyboardShortcutsOptions {
  nodes: Node<NodeData>[];
  edges: Edge[];
  setNodes: Dispatch<SetStateAction<Node<NodeData>[]>>;
  setEdges: Dispatch<SetStateAction<Edge[]>>;
  setSelectedNode: (node: Node<NodeData> | null) => void;
  markDirty: () => void;
  mode: string;
  onSnapshot?: (nodes?: Node<NodeData>[], edges?: Edge[]) => void;
  toast: ToastContextValue['toast'];
}

/**
 * Handles keyboard shortcuts on the canvas in design mode:
 * - Escape: deselect the current node
 * - Delete/Backspace: delete selected nodes and edges
 */
export function useCanvasKeyboardShortcuts({
  nodes,
  edges,
  setNodes,
  setEdges,
  setSelectedNode,
  markDirty,
  mode,
  onSnapshot,
  toast,
}: UseCanvasKeyboardShortcutsOptions): void {
  useEffect(() => {
    const handleKeyPress = (event: KeyboardEvent) => {
      if (mode !== 'design') {
        return;
      }

      const target = event.target as HTMLElement | null;
      if (target) {
        const closestFormElement = target.closest(
          'input, textarea, select, [contenteditable="true"], [role="textbox"]',
        );
        const isFormElement =
          target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.getAttribute('contenteditable') === 'true' ||
          Boolean(closestFormElement);

        if (isFormElement) {
          return;
        }
      }

      // Close config panel on Escape
      if (event.key === 'Escape') {
        setSelectedNode(null);
        return;
      }

      if (event.key === 'Delete' || event.key === 'Backspace') {
        const target = event.target;
        if (target instanceof HTMLElement) {
          const isEditable =
            target.isContentEditable ||
            ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) ||
            target.getAttribute('role') === 'textbox' ||
            target.closest('[contenteditable]:not([contenteditable="false"])');

          if (isEditable) {
            return;
          }
        }

        event.preventDefault();
        const selectedNodes = nodes.filter((node) => node.selected);
        const selectedEdges = edges.filter((edge) => edge.selected);
        const totalEntryNodes = nodes.filter(isEntryPointNode).length;
        const deletingEntryNodes = selectedNodes.filter(isEntryPointNode).length;
        if (deletingEntryNodes > 0 && deletingEntryNodes >= totalEntryNodes) {
          toast({
            title: 'Entry Point required',
            description: 'Each workflow must keep one Entry Point node.',
            variant: 'destructive',
          });
          return;
        }
        const nodeIds = new Set(selectedNodes.map((node) => node.id));
        const edgesFromNodes = edges.filter(
          (edge) => nodeIds.has(edge.source) || nodeIds.has(edge.target),
        );
        const selectedEdgeIds = new Set(selectedEdges.map((edge) => edge.id));
        const dedupedEdges = new Map<string, Edge>();

        edgesFromNodes.forEach((edge) => {
          dedupedEdges.set(edge.id, { ...edge, selected: false });
        });
        selectedEdges.forEach((edge) => {
          dedupedEdges.set(edge.id, { ...edge, selected: false });
        });

        // Calculate next state for snapshot before applying changes
        let nextNodes = nodes;
        let nextEdges = edges;

        if (selectedNodes.length > 0) {
          nextNodes = nodes.filter((node) => !nodeIds.has(node.id));
          nextEdges = edges.filter(
            (edge) => !nodeIds.has(edge.source) && !nodeIds.has(edge.target),
          );
        }

        if (selectedEdges.length > 0) {
          nextEdges = nextEdges.filter((edge) => !selectedEdgeIds.has(edge.id));
        }

        // Apply the changes
        if (selectedNodes.length > 0) {
          setNodes(nextNodes);
          setEdges(nextEdges);
          setSelectedNode(null);
        } else if (selectedEdges.length > 0) {
          setEdges(nextEdges);
        }

        // Capture snapshot for undo/redo
        if (selectedNodes.length > 0 || selectedEdges.length > 0) {
          onSnapshot?.(nextNodes, nextEdges);
          markDirty();
        }
      }
    };

    document.addEventListener('keydown', handleKeyPress);
    return () => document.removeEventListener('keydown', handleKeyPress);
  }, [nodes, edges, setNodes, setEdges, markDirty, mode, onSnapshot, toast]);
}
