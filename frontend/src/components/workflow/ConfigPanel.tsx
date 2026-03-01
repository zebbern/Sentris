import { useState, useRef, useCallback, useMemo } from 'react';
import { AlertCircle } from 'lucide-react';
import { useComponents } from '@/hooks/queries/useComponentQueries';
import { useDeepCompareEffect } from '@/hooks/useDeepCompareEffect';
import { CollapsibleSection } from '@/components/ui/collapsible-section';
import { ConfigPanelRetryButton } from './config-panel/ConfigPanelRetryButton';
import { ConfigPanelHeader } from './config-panel/ConfigPanelHeader';
import { ConfigPanelComponentInfo } from './config-panel/ConfigPanelComponentInfo';
import { ConfigPanelDocumentation } from './config-panel/ConfigPanelDocumentation';
import { ConfigPanelToolSection } from './config-panel/ConfigPanelToolSection';
import { ConfigPanelMcpServer } from './config-panel/ConfigPanelMcpServer';
import { ConfigPanelParameters } from './config-panel/ConfigPanelParameters';
import { ConfigPanelInputs } from './config-panel/ConfigPanelInputs';
import { ConfigPanelOutputs } from './config-panel/ConfigPanelOutputs';
import { ConfigPanelSchedules } from './config-panel/ConfigPanelSchedules';
import { ConfigPanelExamples } from './config-panel/ConfigPanelExamples';
import { ConfigPanelFooter } from './config-panel/ConfigPanelFooter';
import { useReactFlow } from 'reactflow';
import { API_V1_URL, api } from '@/services/api';
import { useWorkflowStore } from '@/store/workflowStore';
import { logger } from '@/lib/logger';
import { useApiKeys, useApiKeyUiStore } from '@/hooks/queries/useApiKeyQueries';
import { useOptionalWorkflowSchedulesContext } from '@/features/workflow-builder/contexts/useWorkflowSchedulesContext';
import { useIsMobile } from '@/hooks/useIsMobile';
import { ENTRY_COMPONENT_ID } from '@/utils/entryPointUtils';
import { normalizeRuntimeInputs } from '@/utils/runtimeInputUtils';
import type { InputPort, OutputPort } from '@/schemas/component';
import type { FrontendNodeData } from '@/schemas/node';
import type { ConfigPanelProps, RuntimeInputDefinition } from './config-panel/types';
import { PANEL_WIDTH } from './config-panel/types';
import {
  buildSampleValueForRuntimeInput,
  buildUpdatedInputOverrides,
  buildUpdatedParams,
  parseToolSchema,
} from './config-panel/utils';

/**
 * ConfigPanel - Configuration panel for selected workflow node
 *
 * Shows component information and allows editing node parameters.
 * Sub-sections are extracted into config-panel/ sub-components.
 */
export function ConfigPanel({
  selectedNode,
  onClose,
  onUpdateNode,
  workflowId: workflowIdProp,
  workflowSchedules,
  schedulesLoading,
  scheduleError,
  onScheduleCreate,
  onScheduleEdit,
  onScheduleAction,
  onScheduleDelete,
  onViewSchedules,
}: ConfigPanelProps) {
  const isMobile = useIsMobile();
  const { data: componentIndex, isLoading: loading } = useComponents();
  const getComponent = (ref: string) => {
    if (!componentIndex || !ref) return null;
    if (componentIndex.byId[ref]) return componentIndex.byId[ref];
    const idFromSlug = componentIndex.slugIndex[ref];
    if (idFromSlug && componentIndex.byId[idFromSlug]) return componentIndex.byId[idFromSlug];
    return null;
  };
  const { getEdges, getNodes } = useReactFlow();
  const fallbackWorkflowId = useWorkflowStore((state) => state.metadata.id);
  const workflowId = workflowIdProp ?? fallbackWorkflowId;
  const schedulesContext = useOptionalWorkflowSchedulesContext();

  const lastCreatedKey = useApiKeyUiStore((state) => state.lastCreatedKey);
  useApiKeys();
  const activeApiKey = lastCreatedKey || null;

  const effectiveWidth = isMobile ? '100%' : PANEL_WIDTH;

  const handleParamValueChange = (paramId: string, value: unknown) => {
    if (!selectedNode || !onUpdateNode) return;
    onUpdateNode(selectedNode.id, buildUpdatedParams(selectedNode, paramId, value));
  };

  const handleInputOverrideChange = (inputId: string, value: unknown) => {
    if (!selectedNode || !onUpdateNode) return;
    onUpdateNode(selectedNode.id, buildUpdatedInputOverrides(selectedNode, inputId, value));
  };

  if (!selectedNode) return null;

  const nodeData: FrontendNodeData = selectedNode.data;
  const componentRef: string | undefined = nodeData.componentId ?? nodeData.componentSlug;
  const isToolMode = Boolean(nodeData.config?.isToolMode || nodeData.config?.mode === 'tool');
  const component = componentRef ? getComponent(componentRef) : null;

  if (!component) {
    if (loading) {
      return (
        <div
          className="config-panel border-l bg-background flex flex-col h-full relative"
          style={{ width: effectiveWidth }}
        >
          <ConfigPanelHeader isToolMode={isToolMode} onClose={onClose} />
          <div className="flex-1 flex items-center justify-center p-6">
            <div className="text-sm text-muted-foreground animate-pulse">Loading…</div>
          </div>
        </div>
      );
    }
    return (
      <div
        className="config-panel border-l bg-background flex flex-col h-full relative"
        style={{ width: effectiveWidth }}
      >
        <ConfigPanelHeader isToolMode={isToolMode} onClose={onClose} />
        <div className="flex-1 p-4">
          <div className="flex items-start gap-2 text-sm bg-red-50 dark:bg-red-900/40 p-3 rounded-lg border border-red-200 dark:border-red-800">
            <AlertCircle className="h-4 w-4 text-red-600 dark:text-red-400 mt-0.5 flex-shrink-0" />
            <div className="flex flex-col gap-1.5">
              <span className="text-red-700 dark:text-red-300 font-medium">
                This component&#39;s metadata could not be loaded
              </span>
              <span className="text-xs text-red-600/70 dark:text-red-400/70">
                {componentRef ?? 'unknown'}
              </span>
              <ConfigPanelRetryButton />
            </div>
          </div>
        </div>
      </div>
    );
  }

  const manualParameters = (nodeData.config?.params ?? {}) as Record<string, unknown>;
  const inputOverrides = (nodeData.config?.inputOverrides ?? {}) as Record<string, unknown>;

  // Dynamic Ports Resolution
  const [dynamicInputs, setDynamicInputs] = useState<InputPort[] | null>(null);
  const [dynamicOutputs, setDynamicOutputs] = useState<OutputPort[] | null>(null);

  // Node name editing state
  const [isEditingNodeName, setIsEditingNodeName] = useState(false);
  const [editingNodeName, setEditingNodeName] = useState('');

  const handleSaveNodeName = useCallback(() => {
    const trimmedName = editingNodeName.trim();
    if (trimmedName && trimmedName !== nodeData.label) {
      onUpdateNode?.(selectedNode.id, { label: trimmedName });
    }
    setIsEditingNodeName(false);
  }, [editingNodeName, nodeData.label, onUpdateNode, selectedNode.id]);

  // Debounce ref
  const assertPortResolution = useRef<NodeJS.Timeout | null>(null);

  useDeepCompareEffect(() => {
    if (!component) return;
    if (assertPortResolution.current) clearTimeout(assertPortResolution.current);

    assertPortResolution.current = setTimeout(async () => {
      try {
        const result = await api.components.resolvePorts(component.id, {
          ...manualParameters,
          ...inputOverrides,
        });
        if (result) {
          if (result.inputs) {
            setDynamicInputs(result.inputs);
            if (
              JSON.stringify(selectedNode?.data?.dynamicInputs) !== JSON.stringify(result.inputs)
            ) {
              onUpdateNode?.(selectedNode!.id, { dynamicInputs: result.inputs });
            }
          }
          if (result.outputs) {
            setDynamicOutputs(result.outputs);
            if (
              JSON.stringify(selectedNode?.data?.dynamicOutputs) !== JSON.stringify(result.outputs)
            ) {
              onUpdateNode?.(selectedNode!.id, { dynamicOutputs: result.outputs });
            }
          }
        }
      } catch (e: unknown) {
        logger.error('Failed to resolve dynamic ports', e);
      }
    }, 500);

    return () => {
      if (assertPortResolution.current) clearTimeout(assertPortResolution.current);
    };
  }, [component?.id, manualParameters, inputOverrides]);

  const componentInputs = dynamicInputs ?? component.inputs ?? [];
  const componentOutputs = dynamicOutputs ?? component.outputs ?? [];
  const componentParameters = component.parameters ?? [];

  const { toolSchemaJson, toolSchemaFields } = useMemo(
    () => parseToolSchema(component.toolSchema),
    [component.toolSchema],
  );

  const isEntryPointComponent = component.id === ENTRY_COMPONENT_ID;
  const runtimeInputDefinitions = normalizeRuntimeInputs<RuntimeInputDefinition>(
    manualParameters.runtimeInputs,
  );
  const entryPointPayload = {
    inputs: runtimeInputDefinitions.reduce<Record<string, unknown>>((acc, input) => {
      if (input?.id) acc[input.id] = buildSampleValueForRuntimeInput(input.type, input.id);
      return acc;
    }, {}),
  };
  const workflowInvokeUrl = workflowId
    ? `${API_V1_URL}/workflows/${workflowId}/run`
    : `${API_V1_URL}/workflows/{workflowId}/run`;
  const exampleItems = [component.example, ...(component.examples ?? [])].filter(
    (value): value is string => Boolean(value && value.trim().length > 0),
  );

  return (
    <div
      className="config-panel border-l bg-background flex flex-col h-full overflow-hidden relative"
      style={{ width: effectiveWidth }}
    >
      <ConfigPanelHeader isToolMode={isToolMode} onClose={onClose} />

      <ConfigPanelComponentInfo
        component={component}
        nodeLabel={nodeData.label}
        isEntryPointComponent={isEntryPointComponent}
        isEditingNodeName={isEditingNodeName}
        editingNodeName={editingNodeName}
        onStartEditing={() => {
          setEditingNodeName(nodeData.label || component.name);
          setIsEditingNodeName(true);
        }}
        onSaveNodeName={handleSaveNodeName}
        onEditingNameChange={setEditingNodeName}
        onCancelEditing={() => setIsEditingNodeName(false)}
      />

      {/* Scrollable Content */}
      <div className="flex-1 overflow-y-auto">
        <div className="p-4 space-y-2">
          <ConfigPanelDocumentation
            documentation={component.documentation}
            documentationUrl={component.documentationUrl}
          />

          {isToolMode && (
            <ConfigPanelToolSection
              componentName={component.name}
              componentSlug={component.slug}
              componentDescription={component.description}
              toolProviderName={component.toolProvider?.name}
              toolProviderDescription={component.toolProvider?.description}
              toolSchemaFields={toolSchemaFields}
              toolSchemaJson={toolSchemaJson}
            />
          )}

          <ConfigPanelParameters
            componentParameters={componentParameters}
            manualParameters={manualParameters}
            componentId={component.id}
            nodeInputs={nodeData.inputs}
            isToolMode={isToolMode}
            onParamValueChange={handleParamValueChange}
          />

          <ConfigPanelInputs
            componentInputs={componentInputs}
            inputOverrides={inputOverrides}
            nodeInputs={nodeData.inputs}
            selectedNodeId={selectedNode.id}
            componentId={component.id}
            isToolMode={isToolMode}
            isEntryPointComponent={isEntryPointComponent}
            getEdges={getEdges}
            getNodes={getNodes}
            onInputOverrideChange={handleInputOverrideChange}
          />

          {!isToolMode &&
            !!component.toolProvider &&
            toolSchemaJson &&
            component.category !== 'mcp' && (
              <CollapsibleSection title="Tool Schema" defaultOpen={false}>
                <div className="mt-2">
                  <pre className="text-[11px] font-mono whitespace-pre-wrap bg-muted/20 text-foreground p-3 rounded-md border border-border shadow-sm min-h-[40px] max-h-[300px] overflow-y-auto">
                    {toolSchemaJson}
                  </pre>
                </div>
              </CollapsibleSection>
            )}

          {component.category === 'mcp' && component.toolProvider?.name && (
            <ConfigPanelMcpServer
              toolProviderName={component.toolProvider.name}
              toolProviderDescription={component.toolProvider.description}
            />
          )}

          <ConfigPanelOutputs componentOutputs={componentOutputs} isToolMode={isToolMode} />

          {isEntryPointComponent && (
            <ConfigPanelSchedules
              workflowId={workflowId}
              workflowInvokeUrl={workflowInvokeUrl}
              entryPointPayload={entryPointPayload}
              activeApiKey={activeApiKey}
              workflowSchedules={workflowSchedules}
              schedulesLoading={schedulesLoading}
              scheduleError={scheduleError}
              onScheduleCreate={onScheduleCreate}
              onScheduleEdit={onScheduleEdit}
              onScheduleAction={onScheduleAction}
              onScheduleDelete={onScheduleDelete}
              onViewSchedules={onViewSchedules}
              onOpenWebhooksSidebar={schedulesContext?.onOpenWebhooksSidebar}
            />
          )}

          <ConfigPanelExamples exampleItems={exampleItems} />
        </div>
      </div>

      <ConfigPanelFooter nodeId={selectedNode.id} componentSlug={component.slug} />
    </div>
  );
}
