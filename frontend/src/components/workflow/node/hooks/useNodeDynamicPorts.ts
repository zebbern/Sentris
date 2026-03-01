import { useEffect } from 'react';
import { useUpdateNodeInternals } from 'reactflow';
import { logger } from '@/lib/logger';
import type { FrontendNodeData } from '@/schemas/node';
import type { ComponentMetadata } from '@/schemas/component';
import { runtimeInputTypeToConnectionType } from '@/utils/portUtils';

interface UseNodeDynamicPortsOptions {
  id: string;
  nodeData: FrontendNodeData;
  component: ComponentMetadata | null;
}

/**
 * Computes effective input/output ports, including dynamic runtime inputs for entry points.
 * Updates ReactFlow node internals when port sets change.
 */
export function useNodeDynamicPorts({ id, nodeData, component }: UseNodeDynamicPortsOptions) {
  const updateNodeInternals = useUpdateNodeInternals();

  // Dynamic outputs — use stored dynamic outputs or component defaults
  let effectiveOutputs: any[] =
    nodeData.dynamicOutputs ?? (Array.isArray(component?.outputs) ? component.outputs : []);

  const runtimeInputsVal = nodeData.config?.params?.runtimeInputs;
  if (
    !nodeData.dynamicOutputs &&
    component?.id === 'core.workflow.entrypoint' &&
    runtimeInputsVal
  ) {
    try {
      const runtimeInputs =
        typeof runtimeInputsVal === 'string' ? JSON.parse(runtimeInputsVal) : runtimeInputsVal;
      if (Array.isArray(runtimeInputs) && runtimeInputs.length > 0) {
        effectiveOutputs = runtimeInputs.map((input: any) => ({
          id: input.id,
          label: input.label,
          connectionType: runtimeInputTypeToConnectionType(input.type || 'text'),
          description: input.description || `Runtime input: ${input.label}`,
        }));
      }
    } catch (error: unknown) {
      logger.error('Failed to parse runtimeInputs:', error);
    }
  }

  const componentInputs = nodeData.dynamicInputs ?? component?.inputs ?? [];

  const outputIds = effectiveOutputs.map((o) => o.id).join(',');
  const inputIds = componentInputs.map((i: any) => i.id).join(',');

  // Update node internals when ports change
  useEffect(() => {
    updateNodeInternals(id);
  }, [id, outputIds, inputIds, updateNodeInternals]);

  const supportsLiveLogs = component?.runner?.kind === 'docker';

  return { effectiveOutputs, componentInputs, supportsLiveLogs };
}
