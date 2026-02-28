import { useState, useRef, useCallback, useMemo } from 'react';
import { X, ExternalLink, AlertCircle, Pencil, Check } from 'lucide-react';
import { DynamicIcon } from '@/components/ui/DynamicIcon';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { MarkdownView } from '@/components/ui/markdown';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { useComponents } from '@/hooks/queries/useComponentQueries';
import { useDeepCompareEffect } from '@/hooks/useDeepCompareEffect';
import { CollapsibleSection } from '@/components/ui/collapsible-section';
import { ConfigPanelRetryButton } from './config-panel/ConfigPanelRetryButton';
import { ConfigPanelParameters } from './config-panel/ConfigPanelParameters';
import { ConfigPanelInputs } from './config-panel/ConfigPanelInputs';
import { ConfigPanelOutputs } from './config-panel/ConfigPanelOutputs';
import { ConfigPanelSchedules } from './config-panel/ConfigPanelSchedules';
import type { Node } from 'reactflow';
import type { FrontendNodeData } from '@/schemas/node';
import { useReactFlow } from 'reactflow';
import { API_V1_URL, api } from '@/services/api';
import { useWorkflowStore } from '@/store/workflowStore';
import { logger } from '@/lib/logger';
import { useApiKeys, useApiKeyUiStore } from '@/hooks/queries/useApiKeyQueries';
import type { WorkflowSchedule } from '@shipsec/shared';
import { useOptionalWorkflowSchedulesContext } from '@/features/workflow-builder/contexts/useWorkflowSchedulesContext';
import { useIsMobile } from '@/hooks/useIsMobile';
import { ENTRY_COMPONENT_ID } from '@/utils/entryPointUtils';
import { normalizeRuntimeInputs } from '@/utils/runtimeInputUtils';

interface ConfigPanelProps {
  selectedNode: Node<FrontendNodeData> | null;
  onClose: () => void;
  onUpdateNode?: (id: string, data: Partial<FrontendNodeData>) => void;
  workflowId?: string | null;
  workflowSchedules?: WorkflowSchedule[];
  schedulesLoading?: boolean;
  scheduleError?: string | null;
  onScheduleCreate?: () => void;
  onScheduleEdit?: (schedule: WorkflowSchedule) => void;
  onScheduleAction?: (
    schedule: WorkflowSchedule,
    action: 'pause' | 'resume' | 'run',
  ) => Promise<void> | void;
  onScheduleDelete?: (schedule: WorkflowSchedule) => Promise<void> | void;
  onViewSchedules?: () => void;
}

const PANEL_WIDTH = 432;

const buildSampleValueForRuntimeInput = (type?: string, id?: string) => {
  switch (type) {
    case 'number':
      return 0;
    case 'json':
      return { example: true };
    case 'array':
      return ['value-1'];
    case 'file':
      return 'upload-file-id';
    case 'text':
    default:
      return id ? `${id}-value` : 'value';
  }
};

/**
 * ConfigPanel - Configuration panel for selected workflow node
 *
 * Shows component information and allows editing node parameters
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

  // Get API key for curl command

  const lastCreatedKey = useApiKeyUiStore((state) => state.lastCreatedKey);
  // API keys are auto-fetched by useApiKeys() used elsewhere; just ensure they're loaded
  useApiKeys();

  // Use lastCreatedKey (full key) if available, otherwise null (will show placeholder)
  const activeApiKey = lastCreatedKey || null;

  // Fixed width on desktop, full width on mobile
  const effectiveWidth = isMobile ? '100%' : PANEL_WIDTH;

  const handleParamValueChange = (paramId: string, value: any) => {
    if (!selectedNode || !onUpdateNode) return;

    const nodeData: FrontendNodeData = selectedNode.data;
    const config = nodeData.config || { params: {}, inputOverrides: {} };

    let updatedParams = {
      ...(config.params ?? {}),
    };

    if (value === undefined) {
      const { [paramId]: _removed, ...rest } = updatedParams;
      updatedParams = rest;
    } else {
      updatedParams[paramId] = value;
    }

    onUpdateNode(selectedNode.id, {
      config: {
        ...config,
        params: updatedParams,
      },
    });
  };

  const handleInputOverrideChange = (inputId: string, value: any) => {
    if (!selectedNode || !onUpdateNode) return;

    const nodeData: FrontendNodeData = selectedNode.data;
    const config = nodeData.config || { params: {}, inputOverrides: {} };

    let updatedOverrides = {
      ...(config.inputOverrides ?? {}),
    };

    if (value === undefined) {
      const { [inputId]: _removed, ...rest } = updatedOverrides;
      updatedOverrides = rest;
    } else {
      updatedOverrides[inputId] = value;
    }

    onUpdateNode(selectedNode.id, {
      config: {
        ...config,
        inputOverrides: updatedOverrides,
      },
    });
  };

  if (!selectedNode) {
    return null;
  }

  const nodeData: FrontendNodeData = selectedNode.data;
  const componentRef: string | undefined = nodeData.componentId ?? nodeData.componentSlug;
  const isToolMode = Boolean(
    (nodeData.config as any)?.isToolMode || (nodeData.config as any)?.mode === 'tool',
  );
  const component = componentRef ? getComponent(componentRef) : null;

  if (!component) {
    if (loading) {
      return (
        <div
          className="config-panel border-l bg-background flex flex-col h-full relative"
          style={{ width: effectiveWidth }}
        >
          <div className="flex items-center justify-between px-3 md:px-4 py-3 border-b min-h-[56px] md:min-h-0">
            <h3 className="font-medium text-sm">{isToolMode ? 'Tool' : 'Configuration'}</h3>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 md:h-7 md:w-7 hover:bg-muted"
              onClick={onClose}
              aria-label="Close panel"
            >
              <X className="h-5 w-5 md:h-4 md:w-4" />
            </Button>
          </div>
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
        <div className="flex items-center justify-between px-3 md:px-4 py-3 border-b min-h-[56px] md:min-h-0">
          <h3 className="font-medium text-sm">{isToolMode ? 'Tool' : 'Configuration'}</h3>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 md:h-7 md:w-7 hover:bg-muted"
            onClick={onClose}
            aria-label="Close panel"
          >
            <X className="h-5 w-5 md:h-4 md:w-4" />
          </Button>
        </div>
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
  const [dynamicInputs, setDynamicInputs] = useState<any[] | null>(null);
  const [dynamicOutputs, setDynamicOutputs] = useState<any[] | null>(null);

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
    // reset if component changes
    if (!component) return;

    // Debounce the API call
    if (assertPortResolution.current) {
      clearTimeout(assertPortResolution.current);
    }

    assertPortResolution.current = setTimeout(async () => {
      try {
        // Only call if we have parameters
        // combine params and overrides for resolvePorts as it might need both
        const result = await api.components.resolvePorts(component.id, {
          ...manualParameters,
          ...inputOverrides,
        });
        if (result) {
          if (result.inputs) {
            setDynamicInputs(result.inputs);
            const currentDynamic = selectedNode?.data?.dynamicInputs;
            if (JSON.stringify(currentDynamic) !== JSON.stringify(result.inputs)) {
              onUpdateNode?.(selectedNode!.id, { dynamicInputs: result.inputs });
            }
          }
          if (result.outputs) {
            setDynamicOutputs(result.outputs);
            const currentDynamicOutputs = selectedNode?.data?.dynamicOutputs;
            if (JSON.stringify(currentDynamicOutputs) !== JSON.stringify(result.outputs)) {
              onUpdateNode?.(selectedNode!.id, { dynamicOutputs: result.outputs });
            }
          }
        }
      } catch (e: unknown) {
        logger.error('Failed to resolve dynamic ports', e);
      }
    }, 500); // 500ms debounce

    return () => {
      if (assertPortResolution.current) {
        clearTimeout(assertPortResolution.current);
      }
    };
  }, [component?.id, manualParameters, inputOverrides]);

  const componentInputs = dynamicInputs ?? component.inputs ?? [];
  const componentOutputs = dynamicOutputs ?? component.outputs ?? [];
  const componentParameters = component.parameters ?? [];
  const toolSchemaJson = useMemo(() => {
    if (!component.toolSchema) {
      return null;
    }
    if (typeof component.toolSchema === 'string') {
      return component.toolSchema;
    }
    try {
      return JSON.stringify(component.toolSchema, null, 2);
    } catch (_error: unknown) {
      return String(component.toolSchema);
    }
  }, [component.toolSchema]);
  const toolSchemaObject = useMemo(() => {
    if (!component.toolSchema) {
      return null;
    }
    if (typeof component.toolSchema === 'string') {
      try {
        return JSON.parse(component.toolSchema);
      } catch (_error: unknown) {
        return null;
      }
    }
    if (typeof component.toolSchema === 'object') {
      return component.toolSchema as Record<string, any>;
    }
    return null;
  }, [component.toolSchema]);
  const toolSchemaFields = useMemo(() => {
    const properties = toolSchemaObject?.properties ?? {};
    const required = new Set((toolSchemaObject?.required as string[]) ?? []);
    return Object.entries(properties).map(([id, schema]) => {
      const typed = schema as Record<string, any>;
      const type =
        typeof typed.type === 'string'
          ? typed.type
          : Array.isArray(typed.type)
            ? typed.type.join(' | ')
            : 'object';
      return {
        id,
        type,
        description: typed.description as string | undefined,
        required: required.has(id),
        defaultValue: typed.default,
        enumValues: Array.isArray(typed.enum) ? typed.enum : undefined,
      };
    });
  }, [toolSchemaObject]);
  const isEntryPointComponent = component.id === ENTRY_COMPONENT_ID;
  const runtimeInputDefinitions = normalizeRuntimeInputs(manualParameters.runtimeInputs);
  const entryPointPayload = {
    inputs: runtimeInputDefinitions.reduce<Record<string, unknown>>((acc, input: any) => {
      if (input?.id) {
        acc[input.id] = buildSampleValueForRuntimeInput(input.type, input.id);
      }
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
      {/* Header */}
      <div className="flex items-center justify-between px-3 md:px-4 py-3 border-b min-h-[56px] md:min-h-0">
        <h3 className="font-medium text-sm">{isToolMode ? 'Tool' : 'Configuration'}</h3>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 md:h-7 md:w-7 hover:bg-muted"
          onClick={onClose}
          aria-label="Close panel"
        >
          <X className="h-5 w-5 md:h-4 md:w-4" />
        </Button>
      </div>

      {/* Component Info with inline Node Name editing */}
      <div className="px-4 py-3 border-b bg-muted/20">
        <div className="flex items-start gap-3">
          <div className="p-2 rounded-lg border bg-background flex-shrink-0">
            {component.logo ? (
              <img
                src={component.logo}
                alt={component.name}
                className="h-6 w-6 object-contain"
                onError={(e) => {
                  // Fallback to icon if image fails to load
                  e.currentTarget.style.display = 'none';
                  e.currentTarget.nextElementSibling?.classList.remove('hidden');
                }}
              />
            ) : null}
            <DynamicIcon
              name={component.icon || 'Box'}
              className={cn('h-6 w-6 text-primary', component.logo && 'hidden')}
            />
          </div>
          <div className="flex-1 min-w-0">
            {/* Node Name - editable for non-entry-point nodes */}
            {!isEntryPointComponent && isEditingNodeName ? (
              <div className="flex items-center gap-1">
                <Input
                  type="text"
                  value={editingNodeName}
                  onChange={(e) => setEditingNodeName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleSaveNodeName();
                    } else if (e.key === 'Escape') {
                      setIsEditingNodeName(false);
                    }
                  }}
                  onBlur={handleSaveNodeName}
                  placeholder={component.name}
                  className="h-6 text-sm font-medium py-0 px-1"
                  autoFocus
                />
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-5 w-5 flex-shrink-0"
                  onClick={handleSaveNodeName}
                  aria-label="Save node name"
                >
                  <Check className="h-3 w-3" />
                </Button>
              </div>
            ) : (
              <div className="flex items-center gap-1 group">
                <h4 className="font-medium text-sm truncate">{nodeData.label || component.name}</h4>
                {!isEntryPointComponent && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-5 w-5 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={() => {
                      setEditingNodeName(nodeData.label || component.name);
                      setIsEditingNodeName(true);
                    }}
                    title="Rename node"
                    aria-label="Rename node"
                  >
                    <Pencil className="h-3 w-3" />
                  </Button>
                )}
              </div>
            )}
            {/* Show component name as subscript if custom name is set */}
            {nodeData.label && nodeData.label !== component.name && (
              <span className="text-[10px] text-muted-foreground opacity-70">{component.name}</span>
            )}
            <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
              {component.description}
            </p>
          </div>
        </div>
      </div>

      {/* Scrollable Content */}
      <div className="flex-1 overflow-y-auto">
        <div className="p-4 space-y-2">
          {/* Documentation */}
          {(component.documentation || component.documentationUrl) && (
            <CollapsibleSection title="Documentation" defaultOpen={false}>
              <div className="space-y-0 mt-2">
                {component.documentationUrl && (
                  <div
                    className={cn('py-3', component.documentation && 'border-b border-border pb-3')}
                  >
                    <a
                      href={component.documentationUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-2 text-xs hover:text-primary transition-colors group"
                    >
                      <ExternalLink className="h-3.5 w-3.5 text-muted-foreground group-hover:text-primary shrink-0" />
                      <span className="text-muted-foreground group-hover:text-foreground">
                        View external documentation
                      </span>
                    </a>
                  </div>
                )}
                {component.documentation && (
                  <div className="py-3">
                    <MarkdownView
                      content={component.documentation}
                      dataTestId="component-documentation"
                      className={cn(
                        'prose prose-sm dark:prose-invert max-w-none',
                        'text-foreground prose-headings:text-foreground',
                        'prose-p:text-muted-foreground prose-p:text-xs prose-p:leading-relaxed',
                        'prose-a:text-primary prose-a:no-underline hover:prose-a:underline',
                        'prose-code:text-xs prose-code:bg-muted prose-code:px-1 prose-code:py-0.5 prose-code:rounded',
                        'prose-pre:bg-muted prose-pre:text-xs',
                        'prose-ul:text-xs prose-ol:text-xs',
                        'prose-li:text-muted-foreground',
                      )}
                    />
                  </div>
                )}
              </div>
            </CollapsibleSection>
          )}

          {isToolMode && (
            <CollapsibleSection title="Tool" defaultOpen={true}>
              <div className="space-y-3 mt-2">
                <div className="rounded-md border bg-muted/20 p-3 space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline" className="text-[10px] font-mono">
                      {component.toolProvider?.name ?? component.slug}
                    </Badge>
                    <span className="text-xs font-semibold text-foreground">{component.name}</span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {component.toolProvider?.description ?? component.description}
                  </p>
                </div>

                <div className="space-y-2">
                  <div className="text-[11px] uppercase text-muted-foreground">Arguments</div>
                  {toolSchemaFields.length > 0 ? (
                    <div className="space-y-2">
                      {toolSchemaFields.map((field) => (
                        <div
                          key={field.id}
                          className="rounded-md border bg-background/60 px-3 py-2"
                        >
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-sm font-medium text-foreground">{field.id}</span>
                            <Badge variant="outline" className="text-[10px] font-mono">
                              {field.type}
                            </Badge>
                            {field.required && (
                              <Badge
                                variant="outline"
                                className="text-[10px] font-mono text-destructive border-destructive/40"
                              >
                                required
                              </Badge>
                            )}
                          </div>
                          {field.description && (
                            <p className="text-xs text-muted-foreground mt-1">
                              {field.description}
                            </p>
                          )}
                          {(field.defaultValue !== undefined || field.enumValues) && (
                            <div className="mt-2 text-[11px] text-muted-foreground space-y-1">
                              {field.defaultValue !== undefined && (
                                <div>
                                  Default:{' '}
                                  <span className="font-mono text-foreground">
                                    {JSON.stringify(field.defaultValue)}
                                  </span>
                                </div>
                              )}
                              {field.enumValues && (
                                <div>
                                  Enum:{' '}
                                  <span className="font-mono text-foreground">
                                    {field.enumValues
                                      .map((value) => JSON.stringify(value))
                                      .join(', ')}
                                  </span>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground italic">
                      No tool schema available for this node.
                    </p>
                  )}
                </div>

                {toolSchemaJson && (
                  <div className="space-y-2">
                    <div className="text-[11px] uppercase text-muted-foreground">Raw Schema</div>
                    <pre className="text-[11px] font-mono whitespace-pre-wrap bg-muted/20 text-foreground p-3 rounded-md border border-border shadow-sm min-h-[40px] max-h-[300px] overflow-y-auto">
                      {toolSchemaJson}
                    </pre>
                  </div>
                )}
              </div>
            </CollapsibleSection>
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
            <CollapsibleSection title="MCP Server" defaultOpen={false}>
              <div className="mt-2 space-y-2 text-xs text-muted-foreground">
                <div>
                  <span className="font-medium text-foreground">Tool name: </span>
                  <span className="font-mono">{component.toolProvider.name}</span>
                </div>
                {component.toolProvider.description && (
                  <div className="text-[11px] leading-relaxed">
                    {component.toolProvider.description}
                  </div>
                )}
                <div className="text-[11px] italic">
                  Tool list appears after the MCP server starts at runtime.
                </div>
              </div>
            </CollapsibleSection>
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

          {/* Examples */}
          {exampleItems.length > 0 && (
            <CollapsibleSection title="Examples" count={exampleItems.length} defaultOpen={false}>
              <div className="space-y-0 mt-2">
                {exampleItems.map((exampleText, index) => {
                  const commandMatch = exampleText.match(/`([^`]+)`/);
                  const command = commandMatch?.[1]?.trim();
                  const description = commandMatch
                    ? exampleText
                        .replace(commandMatch[0], '')
                        .replace(/^[\s\u2013\u2014-]+/, '')
                        .trim()
                    : exampleText.trim();

                  return (
                    <div
                      key={`${exampleText}-${index}`}
                      className={cn('py-3', index > 0 && 'border-t border-border')}
                    >
                      <div className="flex items-start gap-2">
                        <span className="text-[10px] font-medium text-muted-foreground mt-0.5">
                          {index + 1}.
                        </span>
                        <div className="flex-1 space-y-1.5">
                          {command && (
                            <code className="block w-full overflow-x-auto rounded bg-muted px-2 py-1 text-[11px] font-mono">
                              {command}
                            </code>
                          )}
                          {description && (
                            <p className="text-xs text-muted-foreground leading-relaxed">
                              {description}
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </CollapsibleSection>
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="px-4 py-2 border-t">
        <div className="flex items-center justify-between text-[10px] text-muted-foreground">
          <span className="font-mono truncate max-w-[140px]" title={selectedNode.id}>
            {selectedNode.id}
          </span>
          <span className="font-mono">{component.slug}</span>
        </div>
      </div>
    </div>
  );
}
