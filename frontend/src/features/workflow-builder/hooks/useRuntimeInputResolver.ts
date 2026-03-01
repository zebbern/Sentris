import { useCallback } from 'react';
import type { Node as ReactFlowNode } from 'reactflow';
import type { FrontendNodeData } from '@/schemas/node';
import type { ComponentMetadata } from '@/schemas/component';
import { logger } from '@/lib/logger';

interface UseRuntimeInputResolverParams {
  nodes: ReactFlowNode<FrontendNodeData>[];
  getComponent: (ref: string) => ComponentMetadata | null;
}

/**
 * Extracted from WorkflowBuilderContent: resolves runtime input definitions
 * and default values from the Entry Point node.
 */
export function useRuntimeInputResolver({ nodes, getComponent }: UseRuntimeInputResolverParams) {
  const resolveRuntimeInputDefinitions = useCallback(() => {
    const triggerNode = nodes.find((node) => {
      const componentRef = node.data.componentId ?? node.data.componentSlug;
      const component = componentRef ? getComponent(componentRef) : null;
      return component?.id === 'core.workflow.entrypoint';
    });

    if (!triggerNode) {
      return [];
    }

    const runtimeInputsParam = triggerNode.data.config?.params?.runtimeInputs;

    if (!runtimeInputsParam) {
      return [];
    }

    try {
      const parsedInputs =
        typeof runtimeInputsParam === 'string'
          ? JSON.parse(runtimeInputsParam)
          : runtimeInputsParam;

      if (Array.isArray(parsedInputs) && parsedInputs.length > 0) {
        return parsedInputs.map((input: { type: string; [key: string]: unknown }) => ({
          ...input,
          type: input.type === 'string' ? 'text' : input.type,
        }));
      }
    } catch (error: unknown) {
      logger.error('Failed to parse runtime inputs:', error);
    }

    return [];
  }, [getComponent, nodes]);

  // Resolve default values from Entry Point's runtimeInputs parameter (defaultValue field)
  const resolveRuntimeInputDefaults = useCallback((): Record<string, unknown> => {
    const triggerNode = nodes.find((node) => {
      const componentRef = node.data.componentId ?? node.data.componentSlug;
      const component = componentRef ? getComponent(componentRef) : null;
      return component?.id === 'core.workflow.entrypoint';
    });

    if (!triggerNode) {
      return {};
    }

    const runtimeInputsParam = triggerNode.data.config?.params?.runtimeInputs;

    // Extract default values from each runtime input definition
    if (Array.isArray(runtimeInputsParam)) {
      const defaults: Record<string, unknown> = {};
      for (const input of runtimeInputsParam) {
        if (input?.id && input.defaultValue !== undefined && input.defaultValue !== null) {
          defaults[input.id] = input.defaultValue;
        }
      }
      return defaults;
    }

    return {};
  }, [getComponent, nodes]);

  return { resolveRuntimeInputDefinitions, resolveRuntimeInputDefaults };
}
