import { memo, useEffect, useRef, useState } from 'react';
import { NodeResizer, type NodeProps, useReactFlow } from 'reactflow';
import { ShieldAlert } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { useComponents } from '@/hooks/queries/useComponentQueries';
import { useExecutionTimelineStore, type NodeVisualState } from '@/store/executionTimelineStore';
import { useWorkflowStore } from '@/store/workflowStore';
import { getNodeStyle } from '../nodeStyles';
import type { FrontendNodeData } from '@/schemas/node';
import { useWorkflowUiStore } from '@/store/workflowUiStore';
import { useThemeStore } from '@/store/themeStore';
import {
  getCategorySeparatorColor,
  getCategoryHeaderBackgroundColor,
} from '@/utils/categoryColors';
import { WebhookDetails } from '../WebhookDetails';
import { useApiKeyUiStore } from '@/hooks/queries/useApiKeyQueries';
import { API_V1_URL } from '@/services/api';
import { useNavigate, useParams } from 'react-router-dom';
import { useIsMobile } from '@/hooks/useIsMobile';

// Extracted hooks
import { useNodeResize } from './hooks/useNodeResize';
import { useNodeLabel } from './hooks/useNodeLabel';
import { useNodeDynamicPorts } from './hooks/useNodeDynamicPorts';
import { useNodeValidation } from './hooks/useNodeValidation';
import { useTerminalPrefetch } from './hooks/useTerminalPrefetch';

// Extracted components
import { ParametersDisplay } from './ParametersDisplay';
import { McpServersDisplay } from './McpServersDisplay';
import { McpGroupServersDisplay } from './McpGroupServersDisplay';
import { NodeHeader } from './NodeHeader';
import { NodeStatusSection } from './NodeStatusSection';
import { EntryPointBody } from './EntryPointBody';
import { NodeInputPorts } from './NodeInputPorts';
import { NodeOutputPorts } from './NodeOutputPorts';
import { NodeStatusMessages } from './NodeStatusMessages';
import { TextBlockContent } from './TextBlockContent';
import { ComponentNotFoundCard } from './ComponentNotFoundCard';
import { areWorkflowNodePropsEqual, computeEntryPointPayload } from './nodePropsEqual';
import { STATUS_ICONS, TEXT_BLOCK_SIZES, DEFAULT_VISUAL_STATE } from './constants';

const { MIN_WIDTH, MAX_WIDTH, MIN_HEIGHT, MAX_HEIGHT } = TEXT_BLOCK_SIZES;

const TOOL_MODE_ONLY_COMPONENTS = new Set([
  'core.mcp.server',
  'security.aws-cloudtrail-mcp',
  'security.aws-cloudwatch-mcp',
]);

/**
 * Enhanced WorkflowNode - Visual representation with timeline states.
 * Delegates to extracted hooks for state logic and sub-components for rendering.
 */
const WorkflowNodeInner = ({ data, selected, id }: NodeProps<FrontendNodeData>) => {
  const nodeRef = useRef<HTMLDivElement | null>(null);

  // ── Store hooks ──────────────────────────────────────────────────────
  const { data: componentIndex, isLoading: loading } = useComponents();
  const getComponent = (ref: string) => {
    if (!componentIndex || !ref) return null;
    if (componentIndex.byId[ref]) return componentIndex.byId[ref];
    const idFromSlug = componentIndex.slugIndex[ref];
    if (idFromSlug && componentIndex.byId[idFromSlug]) return componentIndex.byId[idFromSlug];
    return null;
  };
  const { setNodes, deleteElements } = useReactFlow();
  const nodeStates = useExecutionTimelineStore((s) => s.nodeStates);
  const selectedRunId = useExecutionTimelineStore((s) => s.selectedRunId);
  const selectNode = useExecutionTimelineStore((s) => s.selectNode);
  const isPlaying = useExecutionTimelineStore((s) => s.isPlaying);
  const playbackMode = useExecutionTimelineStore((s) => s.playbackMode);
  const markDirty = useWorkflowStore((s) => s.markDirty);
  const mode = useWorkflowUiStore((s) => s.mode);
  const openHumanInputDialog = useWorkflowUiStore((s) => s.openHumanInputDialog);
  const theme = useThemeStore((state) => state.theme);
  const lastCreatedKey = useApiKeyUiStore((state) => state.lastCreatedKey);
  const workflowIdFromStore = useWorkflowStore((state) => state.metadata.id);

  const navigate = useNavigate();
  const isMobile = useIsMobile();

  // ── Local state ──────────────────────────────────────────────────────
  const [showWebhookDialog, setShowWebhookDialog] = useState(false);
  const [showErrorDetails, setShowErrorDetails] = useState(false);

  // ── Derived values ───────────────────────────────────────────────────
  const nodeData = data;
  const componentRef: string | undefined = nodeData.componentId ?? nodeData.componentSlug;
  const component = componentRef ? getComponent(componentRef) : null;
  const isTextBlock = component?.id === 'core.ui.text';
  const isEntryPoint = component?.id === 'core.workflow.entrypoint';
  const isDarkMode = theme === 'dark';
  const componentCategory = component?.category ?? 'input';
  const isToolModeOnly = component?.id ? TOOL_MODE_ONLY_COMPONENTS.has(component.id) : false;
  const showMcpBadge = componentCategory === 'mcp' || isToolModeOnly;
  const isToolMode = Boolean(nodeData.config?.isToolMode || nodeData.config?.mode === 'tool');

  // Workflow ID resolution
  const params = useParams<{ id?: string }>();
  const workflowIdFromRoute = params?.id && params.id !== 'new' ? params.id : undefined;
  const workflowId = workflowIdFromStore || nodeData.workflowId || workflowIdFromRoute;
  const workflowInvokeUrl = workflowId
    ? `${API_V1_URL}/workflows/${workflowId}/run`
    : `${API_V1_URL}/workflows/{workflowId}/run`;

  // ── Extracted hooks ──────────────────────────────────────────────────
  const resize = useNodeResize({ id, nodeData, isTextBlock, nodeRef });
  const label = useNodeLabel({
    id,
    data,
    componentName: component?.name ?? '',
    isEntryPoint,
    mode,
  });
  const { isTerminalLoading, terminalSession } = useTerminalPrefetch({ id, selectedRunId });
  const { effectiveOutputs, componentInputs, supportsLiveLogs } = useNodeDynamicPorts({
    id,
    nodeData,
    component,
  });
  const componentParameters = component?.parameters ?? [];
  const { hasUnfilledRequired, requiredParams, inputOverrides } = useNodeValidation({
    componentParameters,
    componentInputs,
    nodeData,
  });

  // ── Effects ──────────────────────────────────────────────────────────
  // Tool mode enforcement for tool-mode-only components
  useEffect(() => {
    if (!isToolModeOnly || isToolMode) return;
    setNodes((nds) =>
      nds.map((n) => {
        if (n.id !== id) return n;
        const currentConfig = (n.data as FrontendNodeData).config || {};
        return {
          ...n,
          data: { ...n.data, config: { ...currentConfig, isToolMode: true } },
        };
      }),
    );
    markDirty();
  }, [id, isToolMode, isToolModeOnly, markDirty, setNodes]);

  // Visual state
  const visualState: NodeVisualState = nodeStates[id] || DEFAULT_VISUAL_STATE;

  // Auto-collapse error details when status changes
  useEffect(() => {
    if (visualState.status !== 'error') setShowErrorDetails(false);
  }, [visualState.status]);

  // ── Status & styling ─────────────────────────────────────────────────
  const effectiveStatus =
    mode === 'execution' && selectedRunId ? visualState.status : nodeData.status || 'idle';
  const nodeStyle = getNodeStyle(effectiveStatus);
  const StatusIcon = STATUS_ICONS[effectiveStatus as keyof typeof STATUS_ICONS];
  const isTimelineActive = mode === 'execution' && selectedRunId && visualState.status !== 'idle';

  const separatorColor =
    (!isTimelineActive || visualState.status === 'idle') &&
    (!nodeData.status || nodeData.status === 'idle')
      ? getCategorySeparatorColor(componentCategory, isDarkMode)
      : undefined;
  const headerBackgroundColor = getCategoryHeaderBackgroundColor(componentCategory, isDarkMode);

  const entryPointPayload = computeEntryPointPayload(nodeData, isEntryPoint);
  const activeApiKey = lastCreatedKey;

  // ── Handlers ─────────────────────────────────────────────────────────
  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    deleteElements({ nodes: [{ id }] });
    markDirty();
  };

  const toggleToolMode = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isToolModeOnly) return;
    setNodes((nds) =>
      nds.map((n) => {
        if (n.id !== id) return n;
        const currentConfig = (n.data as FrontendNodeData).config || {};
        return {
          ...n,
          data: { ...n.data, config: { ...currentConfig, isToolMode: !isToolMode } },
        };
      }),
    );
    markDirty();
  };

  // ── Early return for loading / missing component ─────────────────────
  if (!component) {
    if (loading) {
      return (
        <div className="px-4 py-3 shadow-md rounded-lg border-2 border-dashed border-muted bg-background min-w-[200px]">
          <div className="text-sm text-muted-foreground">Loading component metadata…</div>
        </div>
      );
    }
    return <ComponentNotFoundCard componentRef={componentRef} />;
  }

  // ── Text block content ───────────────────────────────────────────────
  const textBlockContent =
    typeof nodeData.config?.params?.content === 'string' ? nodeData.config.params.content : '';
  const trimmedTextBlockContent = textBlockContent.trim();

  // ── Render ───────────────────────────────────────────────────────────
  return (
    <div
      className={cn(
        'shadow-lg border-2 transition-[box-shadow,background-color,border-color,transform] relative group',
        'bg-background',
        isEntryPoint ? 'rounded-[1.5rem]' : 'rounded-lg',
        isTextBlock ? 'min-w-[240px] max-w-none flex flex-col' : 'min-w-[240px] max-w-[280px]',
        isEntryPoint &&
          isTimelineActive &&
          effectiveStatus === 'running' &&
          !isPlaying &&
          'border-dashed',
        !isEntryPoint && isTimelineActive && effectiveStatus === 'running' && 'border-blue-400',
        !isEntryPoint &&
          isTimelineActive &&
          effectiveStatus === 'running' &&
          !isPlaying &&
          'border-dashed',
        !isEntryPoint && isTimelineActive && effectiveStatus === 'error' && 'border-red-400',
        !isEntryPoint &&
          (effectiveStatus !== 'idle' || isTimelineActive) && [nodeStyle.bg, nodeStyle.border],
        (!nodeData.status || nodeData.status === 'idle') && !isTimelineActive && ['border-border'],
        selected && 'shadow-[0_0_15px_hsl(var(--primary)/0.4),0_0_30px_hsl(var(--primary)/0.3)]',
        selected &&
          'hover:shadow-[0_0_25px_hsl(var(--primary)/0.6),0_0_45px_hsl(var(--primary)/0.4)]',
        !selected && 'hover:shadow-xl',
        'hover:scale-[1.02]',
        selectedRunId && 'cursor-pointer',
      )}
      ref={nodeRef}
      onClick={() => selectedRunId && selectNode(id)}
      style={{
        ...(isTextBlock
          ? {
              width: Math.max(MIN_WIDTH, resize.textSize.width),
              minHeight: Math.max(MIN_HEIGHT, resize.textSize.height),
            }
          : isEntryPoint
            ? { width: 160, minHeight: 160 }
            : {}),
      }}
    >
      {isTextBlock && mode === 'design' && (
        <NodeResizer
          minWidth={MIN_WIDTH}
          maxWidth={MAX_WIDTH}
          minHeight={MIN_HEIGHT}
          maxHeight={MAX_HEIGHT}
          isVisible
          handleClassName="text-node-resize-handle"
          lineClassName="text-node-resize-line"
          onResizeStart={resize.handleResizeStart}
          onResize={resize.handleResize}
          onResizeEnd={resize.handleResizeEnd}
        />
      )}

      {/* Header */}
      <NodeHeader
        id={id}
        component={component}
        displayLabel={label.displayLabel}
        hasCustomLabel={label.hasCustomLabel}
        isEditingLabel={label.isEditingLabel}
        editingLabelValue={label.editingLabelValue}
        labelInputRef={label.labelInputRef}
        setEditingLabelValue={label.setEditingLabelValue}
        handleStartEditing={label.handleStartEditing}
        handleSaveLabel={label.handleSaveLabel}
        handleLabelKeyDown={label.handleLabelKeyDown}
        isEntryPoint={isEntryPoint}
        isToolMode={isToolMode}
        isToolModeOnly={isToolModeOnly}
        showMcpBadge={showMcpBadge}
        mode={mode}
        effectiveStatus={effectiveStatus}
        nodeStatus={nodeData.status}
        nodeStyle={nodeStyle}
        StatusIcon={StatusIcon}
        isTimelineActive={!!isTimelineActive}
        isPlaying={isPlaying}
        hasUnfilledRequired={hasUnfilledRequired}
        supportsLiveLogs={supportsLiveLogs}
        selectedRunId={selectedRunId}
        isTerminalLoading={isTerminalLoading}
        terminalSession={terminalSession}
        toggleToolMode={toggleToolMode}
        handleDelete={handleDelete}
        isMobile={isMobile}
        separatorColor={separatorColor}
        headerBackgroundColor={headerBackgroundColor}
        entryPointHeaderSlot={
          isEntryPoint ? (
            <div style={{ display: 'none' }}>
              <WebhookDetails
                url={workflowInvokeUrl}
                payload={entryPointPayload}
                apiKey={activeApiKey}
                open={showWebhookDialog}
                onOpenChange={setShowWebhookDialog}
              />
            </div>
          ) : undefined
        }
      />

      {/* Status Section */}
      {isTimelineActive && (
        <NodeStatusSection
          visualState={visualState}
          playbackMode={playbackMode}
          isPlaying={isPlaying}
          showErrorDetails={showErrorDetails}
          setShowErrorDetails={setShowErrorDetails}
          componentCategory={componentCategory}
          navigate={navigate}
        />
      )}

      {/* Body */}
      <div className={cn('px-3 py-3 pb-4 space-y-2', isTextBlock && 'flex flex-col flex-1')}>
        {/* Human input action required button */}
        {effectiveStatus === 'awaiting_input' && visualState.humanInputRequestId && (
          <div className={cn('mb-2', isEntryPoint && 'hidden')}>
            <Button
              variant="outline"
              className="w-full bg-blue-600/10 hover:bg-blue-600/20 text-blue-700 dark:text-blue-300 border-blue-500/50 shadow-sm animate-pulse h-8 text-xs font-semibold"
              onClick={(e) => {
                e.stopPropagation();
                openHumanInputDialog(visualState.humanInputRequestId!);
              }}
            >
              <ShieldAlert className="w-3.5 h-3.5 mr-2" />
              Action Required
            </Button>
          </div>
        )}

        {/* Text Block Content */}
        {isTextBlock && <TextBlockContent id={id} content={trimmedTextBlockContent} />}

        {/* Entry Point Layout */}
        {isEntryPoint && (
          <EntryPointBody
            effectiveOutputs={effectiveOutputs}
            workflowId={workflowId}
            onOpenWebhookDialog={() => setShowWebhookDialog(true)}
          />
        )}

        {/* Parameters Display */}
        {!isEntryPoint && (
          <ParametersDisplay
            componentParameters={componentParameters}
            requiredParams={requiredParams}
            nodeParameters={nodeData.config?.params}
            position="top"
          />
        )}

        {/* MCP Servers Display */}
        {component.id === 'mcp.custom' && (
          <McpServersDisplay
            enabledServers={(nodeData.config?.params?.enabledServers as string[]) || []}
            position="bottom"
            compact={true}
          />
        )}
        {component.id?.startsWith('mcp.group.') && (
          <McpGroupServersDisplay
            groupSlug={component.id.replace('mcp.group.', '') || ''}
            enabledServers={(nodeData.config?.params?.enabledServers as string[]) || []}
            position="top"
          />
        )}

        {/* Input Ports */}
        {!isEntryPoint && componentInputs.length > 0 && (
          <NodeInputPorts
            id={id}
            componentInputs={componentInputs}
            isToolMode={isToolMode}
            inputOverrides={inputOverrides}
            getComponent={getComponent}
          />
        )}

        {/* Output Ports */}
        {!isEntryPoint && (
          <NodeOutputPorts
            effectiveOutputs={effectiveOutputs}
            isToolMode={isToolMode}
            isTimelineActive={!!isTimelineActive}
            visualState={visualState}
          />
        )}

        {/* Status Messages */}
        <NodeStatusMessages
          isTimelineActive={!!isTimelineActive}
          visualState={visualState}
          nodeStatus={nodeData.status}
          executionTime={nodeData.executionTime}
          error={nodeData.error}
        />
      </div>
    </div>
  );
};

export const WorkflowNode = memo(WorkflowNodeInner, areWorkflowNodePropsEqual);
WorkflowNode.displayName = 'WorkflowNode';
