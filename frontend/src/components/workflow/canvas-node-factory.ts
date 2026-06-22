import type { Dispatch, SetStateAction } from 'react';
import type { Node, Edge, ReactFlowInstance } from '@xyflow/react';

import type { ToastVariant } from '@/components/ui/toast-context';
import type { NodeData, FrontendNodeData } from '@/schemas/node';
import type { ComponentMetadata } from '@/schemas/component';
import { isEntryPointComponentRef, isEntryPointNode } from '@/utils/entryPointUtils';
import { useWorkflowStore } from '@/store/workflowStore';
import { track, Events } from '@/features/analytics/events';
import { logger } from '@/lib/logger';
import { api } from '@/services/api';

export interface CreateNodeContext {
  reactFlowInstance: ReactFlowInstance<Node<NodeData>> | null;
  getComponent: (ref: string) => ComponentMetadata | null;
  nodes: Node<NodeData>[];
  edges: Edge[];
  mode: string;
  workflowId?: string | null;
  toast: (opts: { title: string; description: string; variant?: ToastVariant }) => void;
  onSnapshot?: (nodes?: Node<NodeData>[], edges?: Edge[]) => void;
  setNodes: React.Dispatch<React.SetStateAction<Node<NodeData>[]>>;
  markDirty: () => void;
}

/**
 * Creates a new ReactFlow node from a component definition at the given screen position.
 * Pure utility - no hook state access. All dependencies are passed via `ctx`.
 */
export function createNodeFromComponent(
  componentId: string,
  clientX: number,
  clientY: number,
  ctx: CreateNodeContext,
): { id: string; params: Record<string, unknown> } | null {
  if (ctx.mode !== 'design') return null;

  const component = ctx.getComponent(componentId);
  if (!component) {
    logger.error('Component not found:', componentId);
    return null;
  }

  const isEntryComponent =
    isEntryPointComponentRef(component.id) ||
    isEntryPointComponentRef(component.slug ?? component.id);
  if (isEntryComponent) {
    const existingEntry = ctx.nodes.some(isEntryPointNode);
    if (existingEntry) {
      ctx.toast({
        title: 'Entry Point already exists',
        description: 'Each workflow can only have one Entry Point.',
        variant: 'destructive',
      });
      return null;
    }
  }

  const position = ctx.reactFlowInstance?.screenToFlowPosition({
    x: clientX,
    y: clientY,
  });

  if (!position) return null;

  const initialParameters: Record<string, unknown> = {};

  if (Array.isArray(component.parameters)) {
    component.parameters.forEach((parameter) => {
      if (parameter.default !== undefined) {
        const defaultValue = parameter.default;
        if (defaultValue !== null && typeof defaultValue === 'object') {
          try {
            initialParameters[parameter.id] = JSON.parse(JSON.stringify(defaultValue));
          } catch {
            initialParameters[parameter.id] = defaultValue;
          }
        } else {
          initialParameters[parameter.id] = defaultValue;
        }
      }
    });
  }

  if ((component.slug ?? component.id) === 'entry-point') {
    initialParameters.runtimeInputs = [];
  }

  const newNode: Node<FrontendNodeData> = {
    id: `${component.slug ?? component.id}-${Date.now()}`,
    type: 'workflow',
    position,
    data: {
      // Backend fields (required)
      label: component.name,
      config: {
        params: initialParameters,
        inputOverrides: {},
      },
      // Frontend fields
      componentId: component.id,
      componentSlug: component.slug ?? component.id,
      componentVersion: component.version,
      inputs: {},
      status: 'idle',
      // Pass workflowId to node data for entry point webhook URL
      workflowId: ctx.workflowId ?? undefined,
    },
  };

  // Update nodes and capture snapshot
  const nextNodes = ctx.nodes.concat(newNode);
  ctx.setNodes(nextNodes);
  ctx.onSnapshot?.(nextNodes, ctx.edges);

  // Analytics: node added
  try {
    const workflowId = useWorkflowStore.getState().metadata.id;
    track(Events.NodeAdded, {
      workflow_id: workflowId ?? undefined,
      component_slug: String(component.slug ?? component.id),
    });
  } catch {
    // Ignore analytics tracking errors
  }

  // Mark workflow as dirty
  ctx.markDirty();

  return { id: newNode.id, params: initialParameters };
}

/** Resolve dynamic input/output ports after a node is added (Discord, Slack, Script, etc.). */
export async function resolveDynamicPortsForNode(
  nodeId: string,
  componentId: string,
  params: Record<string, unknown>,
  setNodes: Dispatch<SetStateAction<Node<NodeData>[]>>,
): Promise<void> {
  try {
    const result = await api.components.resolvePorts(componentId, params);
    if (!result?.inputs && !result?.outputs) {
      return;
    }

    setNodes((nodes) =>
      nodes.map((node) => {
        if (node.id !== nodeId) {
          return node;
        }
        return {
          ...node,
          data: {
            ...node.data,
            ...(result.inputs ? { dynamicInputs: result.inputs } : {}),
            ...(result.outputs ? { dynamicOutputs: result.outputs } : {}),
          },
        };
      }),
    );
  } catch (error: unknown) {
    logger.error('Failed to resolve dynamic ports for new node', error);
  }
}
