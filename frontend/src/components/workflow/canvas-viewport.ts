import { useEffect, useRef, useState, type MutableRefObject } from 'react';
import type { Node, ReactFlowInstance } from '@xyflow/react';

import type { NodeData } from '@/schemas/node';
import { useExecutionTimelineStore } from '@/store/executionTimelineStore';
import { isEntryPointNode } from '@/utils/entryPointUtils';
import { logger } from '@/lib/logger';

export interface UseCanvasViewportDeps {
  reactFlowInstance: ReactFlowInstance<Node<NodeData>> | null;
  nodes: Node<NodeData>[];
  edges: { length: number };
  mode: string;
  selectedNodeId: string | null;
  schedulePanelExpanded?: boolean;
  webhooksPanelExpanded?: boolean;
}

export interface CanvasViewportState {
  canvasOpacity: number;
  hasUserInteractedRef: MutableRefObject<boolean>;
}

/**
 * Manages canvas viewport state: fitView on load / mode-switch / node-count change,
 * fade transitions on mode change, and auto-center when side panels open / close.
 */
export function useCanvasViewport({
  reactFlowInstance,
  nodes,
  edges,
  mode,
  selectedNodeId,
  schedulePanelExpanded,
  webhooksPanelExpanded,
}: UseCanvasViewportDeps): CanvasViewportState {
  const prevModeRef = useRef<string>(mode);
  const prevNodesLengthRef = useRef(nodes.length);
  const prevEdgesLengthRef = useRef(edges.length);
  const lastSelectedNodeIdRef = useRef<string | null>(null);
  const lastSchedulePanelRef = useRef(false);
  const lastWebhooksPanelRef = useRef(false);
  const hasUserInteractedRef = useRef(false);

  const [canvasOpacity, setCanvasOpacity] = useState(1);

  // Clear timeline selection when switching to design mode
  useEffect(() => {
    if (mode === 'design') {
      useExecutionTimelineStore.setState({ selectedNodeId: null, selectedEventId: null });
    }
  }, [mode]);

  // Fade transition when mode changes
  useEffect(() => {
    if (prevModeRef.current !== mode) {
      setCanvasOpacity(0);
      const timeoutId = setTimeout(() => setCanvasOpacity(1), 50);
      return () => clearTimeout(timeoutId);
    }
  }, [mode]);

  // Fit view on initial load, when nodes/edges change, or when switching modes
  useEffect(() => {
    if (!reactFlowInstance || nodes.length === 0) return;

    const modeChanged = prevModeRef.current !== mode;

    const workflowNodes = nodes.filter((n) => n.type !== 'terminal');
    const workflowNodesCount = workflowNodes.length;

    const nodesCountChanged = prevNodesLengthRef.current !== workflowNodesCount;
    const edgesCountChanged = prevEdgesLengthRef.current !== edges.length;

    if (modeChanged || nodesCountChanged || edgesCountChanged) {
      prevModeRef.current = mode;
      prevNodesLengthRef.current = workflowNodesCount;
      prevEdgesLengthRef.current = edges.length;

      const delay = modeChanged ? 100 : 0;

      setTimeout(() => {
        if (!reactFlowInstance) return;
        if (workflowNodes.length === 0) return;

        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            if (!reactFlowInstance) return;

            const currentNodes = reactFlowInstance.getNodes() as Node<NodeData>[];
            const currentWorkflowNodes = currentNodes.filter(
              (n: Node<NodeData>) => n.type !== 'terminal',
            );
            if (currentWorkflowNodes.length === 0) return;

            try {
              reactFlowInstance.fitView({
                padding: 0.2,
                duration: modeChanged ? 0 : 300,
                maxZoom: 0.85,
                includeHiddenNodes: false,
                nodes: currentWorkflowNodes,
              });
            } catch (error: unknown) {
              logger.warn('Failed to fit view:', error);
            }
          });
        });
      }, delay);
    }
  }, [reactFlowInstance, edges.length, mode, nodes.length]);

  // Auto-center on panel open/close
  useEffect(() => {
    if (mode !== 'design' || !reactFlowInstance) return;

    const isAnyPanelOpen = selectedNodeId || schedulePanelExpanded || webhooksPanelExpanded;
    const wasAnyPanelOpen =
      lastSelectedNodeIdRef.current || lastSchedulePanelRef.current || lastWebhooksPanelRef.current;

    // Panel opened → zoom to entry point
    if (isAnyPanelOpen && !wasAnyPanelOpen) {
      const entryPointNode = nodes.find((n) => isEntryPointNode(n));
      if (entryPointNode) {
        setTimeout(() => {
          if (!reactFlowInstance) return;
          reactFlowInstance.fitView({
            nodes: [{ id: entryPointNode.id }],
            padding: 0.8,
            minZoom: 0.5,
            maxZoom: 1.0,
            duration: 160,
          });
        }, 0);
      }
    }
    // All panels closed → zoom out to fit all
    else if (!isAnyPanelOpen && wasAnyPanelOpen) {
      setTimeout(() => {
        if (!reactFlowInstance) return;
        const currentNodes = reactFlowInstance.getNodes() as Node<NodeData>[];
        const workflowNodes = currentNodes.filter((n) => n.type !== 'terminal');
        if (workflowNodes.length > 0) {
          reactFlowInstance.fitView({
            padding: 0.2,
            maxZoom: 0.85,
            duration: 160,
            nodes: workflowNodes,
          });
        }
      }, 0);
    }

    lastSelectedNodeIdRef.current = selectedNodeId;
    lastSchedulePanelRef.current = schedulePanelExpanded || false;
    lastWebhooksPanelRef.current = webhooksPanelExpanded || false;
  }, [
    selectedNodeId,
    schedulePanelExpanded,
    webhooksPanelExpanded,
    mode,
    reactFlowInstance,
    nodes,
  ]);

  return { canvasOpacity, hasUserInteractedRef };
}
