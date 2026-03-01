import { Handle, Position, useReactFlow } from 'reactflow';
import { KeyRound } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { FrontendNodeData } from '@/schemas/node';
import type { InputPort, ComponentMetadata } from '@/schemas/component';
import type { SecretSummary } from '@/schemas/secret';
import { inputSupportsManualValue, isCredentialInput } from '@/utils/portUtils';
import { manualValueProvidedForInput } from './hooks/useNodeValidation';
import { useSecrets } from '@/hooks/queries/useSecretQueries';
import { getSecretLabel } from '@/api/secrets';

export interface NodeInputPortsProps {
  id: string;
  componentInputs: InputPort[];
  isToolMode: boolean;
  inputOverrides: Record<string, unknown>;
  getComponent: (ref: string) => ComponentMetadata | null;
}

/**
 * Renders input port handles on the left side of a workflow node.
 * In tool mode, only credential inputs are shown.
 */
export function NodeInputPorts({
  id,
  componentInputs,
  isToolMode,
  inputOverrides,
  getComponent,
}: NodeInputPortsProps) {
  const { getNodes, getEdges } = useReactFlow();
  const { data: secrets = [] } = useSecrets();

  const configInputs = componentInputs.filter(isCredentialInput);
  const visibleInputs = isToolMode ? configInputs : componentInputs;

  if (visibleInputs.length === 0 && !isToolMode) return null;

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        {visibleInputs.map((input) => (
          <InputPortRow
            key={input.id}
            input={input}
            id={id}
            inputOverrides={inputOverrides}
            getComponent={getComponent}
            getNodes={getNodes}
            getEdges={getEdges}
            secrets={secrets}
          />
        ))}
      </div>

      {isToolMode && configInputs.length === 0 && (
        <div className="text-[10px] text-muted-foreground/50 text-center italic py-2">
          No configuration required
        </div>
      )}
    </div>
  );
}

/** Single input port row with handle, label, connection info, or manual value preview. */
function InputPortRow({
  input,
  id,
  inputOverrides,
  getComponent,
  getNodes,
  getEdges,
  secrets,
}: {
  input: InputPort;
  id: string;
  inputOverrides: Record<string, unknown>;
  getComponent: (ref: string) => ComponentMetadata | null;
  getNodes: ReturnType<typeof useReactFlow>['getNodes'];
  getEdges: ReturnType<typeof useReactFlow>['getEdges'];
  secrets: SecretSummary[];
}) {
  const edges = getEdges();
  const isToolsPort = input.id === 'tools';
  const connections = isToolsPort
    ? edges.filter((edge) => edge.target === id && edge.targetHandle === input.id)
    : [];
  const connection = isToolsPort
    ? connections[0]
    : edges.find((edge) => edge.target === id && edge.targetHandle === input.id);
  const hasConnection = isToolsPort ? connections.length > 0 : Boolean(connection);
  const manualCandidate = inputOverrides[input.id];
  const manualValueProvided = manualValueProvidedForInput(input, hasConnection, inputOverrides);

  // Resolve source info
  let sourceInfo: string | null = null;
  if (!manualValueProvided && connection) {
    const sourceNodes = isToolsPort
      ? connections.map((edge) => getNodes().find((n) => n.id === edge.source)).filter(Boolean)
      : [getNodes().find((n) => n.id === connection.source)].filter(Boolean);
    const sourceLabels = sourceNodes
      .map((sourceNode) => {
        if (!sourceNode) return null;
        return (sourceNode.data as FrontendNodeData)?.label || sourceNode.id;
      })
      .filter(Boolean) as string[];
    if (sourceLabels.length > 0) {
      sourceInfo =
        sourceLabels.length <= 2
          ? sourceLabels.join(', ')
          : `${sourceLabels.slice(0, 2).join(', ')} +${sourceLabels.length - 2}`;
    } else if (!isToolsPort) {
      const sourceNode = getNodes().find((n) => n.id === connection.source);
      if (sourceNode) {
        const sourceRef =
          (sourceNode.data as FrontendNodeData).componentId ??
          (sourceNode.data as FrontendNodeData).componentSlug;
        const sourceComponent = sourceRef ? getComponent(sourceRef) : null;
        if (sourceComponent) {
          const sourceOutput = sourceComponent.outputs.find(
            (o) => o.id === connection.sourceHandle,
          );
          sourceInfo = sourceOutput?.label || 'Connected';
        }
      }
    }
  }

  // Manual value display
  const manualDisplayVal =
    manualValueProvided && inputSupportsManualValue(input) && typeof manualCandidate === 'string'
      ? manualCandidate.trim()
      : '';
  let manualDisplay = manualDisplayVal;
  const isSecretInput =
    input.editor === 'secret' ||
    (input.connectionType?.kind === 'primitive' && input.connectionType.name === 'secret');

  if (isSecretInput && manualDisplayVal) {
    const secret = secrets.find((s) => s.id === manualDisplayVal || s.name === manualDisplayVal);
    manualDisplay = secret ? getSecretLabel(secret) : manualDisplayVal;
  }

  const previewText = manualDisplay.length > 24 ? `${manualDisplay.slice(0, 24)}…` : manualDisplay;
  const handleClassName = cn(
    '!w-[10px] !h-[10px] !border-2 !rounded-full',
    input.required ? '!bg-blue-500 !border-blue-500' : '!bg-background !border-blue-500',
    input.id === 'tools' && '!bg-purple-100 !border-purple-500 !rounded-sm !w-[12px] !h-[12px]',
  );

  return (
    <div className="relative flex items-center gap-2 text-xs">
      <Handle
        type="target"
        position={Position.Left}
        id={input.id}
        className={handleClassName}
        style={{ top: '50%', left: '-18px', transform: 'translateY(-50%)' }}
      />
      <div className="flex-1">
        <div className="text-muted-foreground font-medium">{input.label}</div>
        {input.required && !sourceInfo && !manualValueProvided && (
          <span className="text-destructive text-[10px]">*required</span>
        )}
        {manualValueProvided && manualDisplay && (
          <div className="mt-0.5">
            <span
              className={cn(
                'font-mono px-1 py-0.5 rounded text-[10px] truncate max-w-[120px] inline-flex items-center gap-1',
                isSecretInput
                  ? 'text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/50 font-semibold'
                  : 'text-foreground bg-muted',
              )}
              title={manualDisplay}
            >
              {isSecretInput && <KeyRound className="h-2.5 w-2.5" />}
              {previewText}
            </span>
          </div>
        )}
        {manualValueProvided && !manualDisplay && (
          <span className="text-muted-foreground text-[10px] italic">Manual value</span>
        )}
        {!manualValueProvided && sourceInfo && (
          <span
            className="text-muted-foreground text-[10px] italic"
            title={`Connected to: ${sourceInfo}`}
          >
            {sourceInfo}
          </span>
        )}
      </div>
    </div>
  );
}
