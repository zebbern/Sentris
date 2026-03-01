import { useCallback, useEffect, type Dispatch, type SetStateAction } from 'react';
import {
  addEdge,
  MarkerType,
  type Node,
  type Edge,
  type EdgeChange,
  type OnConnect,
} from 'reactflow';

import type { NodeData } from '@/schemas/node';
import type { ComponentMetadata } from '@/schemas/component';
import type { ToastVariant } from '@/components/ui/toast-context';
import { validateConnection } from '@/utils/connectionValidation';
import {
  getEdgeColor,
  getHeatMapColor,
  getHeatMapStrokeWidth,
} from '@/components/workflow/edge-colors';
import { useThemeStore } from '@/store/themeStore';
import { logger } from '@/lib/logger';
import type { DataPacket } from '@/store/executionTimelineStore';
import type { EdgeHeatMetrics } from '@/components/workflow/useEdgeHeatMap';

export interface UseCanvasConnectionsDeps {
  nodes: Node<NodeData>[];
  edges: Edge[];
  setNodes: Dispatch<SetStateAction<Node<NodeData>[]>>;
  setEdges: Dispatch<SetStateAction<Edge[]>>;
  applyEdgesChange: (changes: EdgeChange[]) => void;
  getComponent: (ref: string) => ComponentMetadata | null;
  markDirty: () => void;
  mode: string;
  toast: (opts: { title: string; description: string; variant?: ToastVariant }) => void;
  selectedNodeId: string | null;
  onSnapshot?: (nodes?: Node<NodeData>[], edges?: Edge[]) => void;
  dataFlows: DataPacket[];
  heatMap: Map<string, EdgeHeatMetrics> | null;
}

/**
 * Manages edge connections, edge change handling (with input-mapping cleanup),
 * and data-flow edge highlighting.
 */
export function useCanvasConnections({
  nodes,
  edges,
  setNodes,
  setEdges,
  applyEdgesChange,
  getComponent,
  markDirty,
  mode,
  toast,
  selectedNodeId,
  onSnapshot,
  dataFlows,
  heatMap,
}: UseCanvasConnectionsDeps) {
  const isDark = useThemeStore((s) => s.theme === 'dark');

  // Enhanced edge change handler that also updates input mappings
  const handleEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      if (mode !== 'design') {
        const allowedChanges = changes.filter((change) => change.type !== 'remove');
        if (allowedChanges.length > 0) {
          applyEdgesChange(allowedChanges);
        }
        return;
      }

      const removedEdges = changes
        .filter((change) => change.type === 'remove')
        .map((change) => edges.find((edge) => edge.id === change.id))
        .filter(Boolean);

      if (removedEdges.length > 0) {
        setNodes((nds) =>
          nds.map((node) => {
            const edgeToRemove = removedEdges.find((edge) => edge && edge.target === node.id);
            if (
              edgeToRemove &&
              edgeToRemove.targetHandle &&
              edgeToRemove.targetHandle !== 'tools' &&
              (node.data.inputs as Record<string, unknown>)?.[edgeToRemove.targetHandle]
            ) {
              const targetHandle = edgeToRemove.targetHandle;
              const inputs = node.data.inputs || {};
              const { [targetHandle]: _removed, ...remainingInputs } = inputs as Record<
                string,
                unknown
              >;
              return {
                ...node,
                data: { ...node.data, inputs: remainingInputs },
              };
            }
            return node;
          }),
        );
      }

      applyEdgesChange(changes);
    },
    [edges, setNodes, applyEdgesChange, mode],
  );

  const onConnect: OnConnect = useCallback(
    (params) => {
      if (mode !== 'design') return;

      const validation = validateConnection(params, nodes, edges, getComponent);

      if (!validation.isValid) {
        logger.warn('Invalid connection:', validation.error);
        toast({
          variant: 'destructive',
          title: 'Invalid connection',
          description: validation.error ?? 'Unknown validation error',
        });
        return;
      }

      // Resolve source port color for edge stroke
      let sourcePortColor: string | undefined;
      let isBranching = false;
      let portType: 'regular' | 'branching' | 'tool' = 'regular';

      if (params.source && params.sourceHandle) {
        const sourceNode = nodes.find((n) => n.id === params.source);
        if (sourceNode) {
          if (params.sourceHandle === 'tools') {
            sourcePortColor = 'purple';
            portType = 'tool';
          } else {
            const componentRef = (sourceNode.data.componentId ?? sourceNode.data.componentSlug) as
              | string
              | undefined;
            const comp = componentRef ? getComponent(componentRef) : null;
            if (comp) {
              const outputPort = comp.outputs?.find((o) => o.id === params.sourceHandle);
              if (outputPort?.isBranching) {
                isBranching = true;
                portType = 'branching';
                sourcePortColor = outputPort.branchColor || 'amber';
              } else {
                sourcePortColor = 'green';
              }
            }
          }
        }
      }

      const newEdge = {
        ...params,
        type: 'default',
        animated: false,
        markerEnd: { type: MarkerType.Arrow, width: 30, height: 30 },
        data: {
          packets: [],
          isHighlighted: selectedNodeId === params.source || selectedNodeId === params.target,
          sourcePortColor,
          isBranching,
          portType,
        },
      };

      const newEdges = addEdge(newEdge, edges);
      setEdges(newEdges);

      let nextNodes = nodes;

      // Update target node's input mapping (SKIP for 'tools' port)
      if (
        params.target &&
        params.targetHandle &&
        params.source &&
        params.sourceHandle &&
        params.targetHandle !== 'tools'
      ) {
        const targetHandle = params.targetHandle;
        nextNodes = nodes.map((node) =>
          node.id === params.target
            ? {
                ...node,
                data: {
                  ...node.data,
                  inputs: {
                    ...(node.data.inputs as Record<string, unknown>),
                    [targetHandle]: { source: params.source, output: params.sourceHandle },
                  } as Record<string, unknown>,
                },
              }
            : node,
        );
        setNodes(nextNodes);
      }

      onSnapshot?.(nextNodes, newEdges);
      markDirty();
    },
    [
      setEdges,
      setNodes,
      nodes,
      edges,
      getComponent,
      markDirty,
      mode,
      toast,
      selectedNodeId,
      onSnapshot,
    ],
  );

  // Update edges with data flow highlighting and packet data
  // Preserve sourcePortColor, isBranching, and portType from the original edge data
  // When heatMap is provided, inject heatMapColor and heatMapStrokeWidth into edge data
  useEffect(() => {
    setEdges((eds) =>
      eds.map((edge) => {
        const portColor = edge.data?.sourcePortColor as string | undefined;
        const resolvedColor = getEdgeColor(portColor, isDark);

        // Heat map overlay data (only present when heatMap is non-null)
        const metrics = heatMap?.get(edge.id);

        return {
          ...edge,
          markerEnd: {
            type: MarkerType.Arrow,
            width: 30,
            height: 30,
            color: resolvedColor,
          },
          data: {
            ...edge.data,
            packets: dataFlows.filter(
              (packet) => packet.sourceNode === edge.source && packet.targetNode === edge.target,
            ),
            isHighlighted: selectedNodeId === edge.source || selectedNodeId === edge.target,
            sourcePortColor: portColor,
            isBranching: edge.data?.isBranching,
            portType: edge.data?.portType,
            // Heat map props — undefined when heat map is off so edge renders normally
            heatMapColor: metrics ? getHeatMapColor(metrics.normalizedCount, isDark) : undefined,
            heatMapStrokeWidth: metrics
              ? getHeatMapStrokeWidth(metrics.normalizedCount)
              : undefined,
          },
        };
      }),
    );
  }, [dataFlows, selectedNodeId, setEdges, isDark, heatMap]);

  return { handleEdgesChange, onConnect };
}
