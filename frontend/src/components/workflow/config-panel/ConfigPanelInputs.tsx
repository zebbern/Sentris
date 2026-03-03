import { Circle, CheckCircle2, AlertCircle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { CollapsibleSection } from '@/components/ui/collapsible-section';
import { ManualListChipsInput } from '@/components/inputs/ManualListChipsInput';
import { SecretSelect } from '@/components/inputs/SecretSelect';
import { DynamicArtifactNameInput } from '../DynamicArtifactNameInput';
import { cn } from '@/lib/utils';
import {
  describePortType,
  inputSupportsManualValue,
  isCredentialInput,
  isListOfTextPort,
  resolvePortType,
} from '@/utils/portUtils';
import type { InputPort } from '@/schemas/component';
import type { FrontendNodeData, InputMapping } from '@/schemas/node';
import type { Edge, Node as RFNode } from '@xyflow/react';

export interface ConfigPanelInputsProps {
  componentInputs: InputPort[];
  inputOverrides: Record<string, unknown>;
  nodeInputs?: Record<string, InputMapping>;
  selectedNodeId: string;
  componentId: string;
  isToolMode: boolean;
  isEntryPointComponent: boolean;
  getEdges: () => Edge[];
  getNodes: () => RFNode[];
  onInputOverrideChange: (inputId: string, value: any) => void;
}

export function ConfigPanelInputs({
  componentInputs,
  inputOverrides,
  nodeInputs,
  selectedNodeId,
  componentId,
  isToolMode,
  isEntryPointComponent,
  getEdges,
  getNodes,
  onInputOverrideChange,
}: ConfigPanelInputsProps) {
  // Hide for Entry Point if only __runtimeData exists
  if (
    componentInputs.length === 0 ||
    (isEntryPointComponent && componentInputs.every((i) => i.id === '__runtimeData'))
  ) {
    return null;
  }

  const inputCount = isToolMode
    ? componentInputs.filter(isCredentialInput).length
    : isEntryPointComponent
      ? componentInputs.filter((i) => i.id !== '__runtimeData').length
      : componentInputs.length;

  return (
    <CollapsibleSection title="Inputs" count={inputCount} defaultOpen={true}>
      <div className="space-y-0 mt-2">
        {componentInputs.map((input, index) => {
          // Skip __runtimeData input for Entry Point
          if (isEntryPointComponent && input.id === '__runtimeData') {
            return null;
          }

          // Filter out non-credential inputs in tool mode
          if (isToolMode && !isCredentialInput(input)) {
            return null;
          }

          // Handle tools port with multiple connections
          const isToolsPort = input.id === 'tools';
          const toolEdges = isToolsPort
            ? getEdges().filter(
                (edge) => edge.target === selectedNodeId && edge.targetHandle === 'tools',
              )
            : [];
          const connection = isToolsPort ? undefined : nodeInputs?.[input.id];
          const hasConnection = isToolsPort ? toolEdges.length > 0 : Boolean(connection);
          const manualValue = inputOverrides[input.id];
          const manualOverridesPort = input.valuePriority === 'manual-first';
          const allowsManualInput = inputSupportsManualValue(input) || manualOverridesPort;
          const manualValueProvided =
            allowsManualInput &&
            (!hasConnection || manualOverridesPort) &&
            manualValue !== undefined &&
            manualValue !== null &&
            (typeof manualValue === 'string' ? manualValue.trim().length > 0 : true);
          const manualLocked = hasConnection && !manualOverridesPort;
          const connectedSourceLabels = isToolsPort
            ? toolEdges
                .map((edge) => {
                  const sourceNode = getNodes().find((n) => n.id === edge.source);
                  return (sourceNode?.data as FrontendNodeData)?.label || edge.source;
                })
                .filter(Boolean)
            : connection
              ? [connection.source]
              : [];
          const connectedSummary = (() => {
            if (connectedSourceLabels.length === 0) return '';
            if (connectedSourceLabels.length <= 2) {
              return connectedSourceLabels.join(', ');
            }
            return `${connectedSourceLabels.slice(0, 2).join(', ')} +${
              connectedSourceLabels.length - 2
            }`;
          })();
          const portType = resolvePortType(input);
          const primitiveName = portType?.kind === 'primitive' ? portType.name : null;
          const isNumberInput = primitiveName === 'number';
          const isBooleanInput = primitiveName === 'boolean';
          const isListOfTextInput = isListOfTextPort(portType);
          const manualInputValue =
            manualValue === undefined || manualValue === null
              ? ''
              : typeof manualValue === 'string'
                ? manualValue
                : String(manualValue);
          const isSecretInput = input.editor === 'secret' || primitiveName === 'secret';
          const useSecretSelect = isSecretInput;
          const manualPlaceholder = useSecretSelect
            ? 'Select a secret...'
            : input.id === 'supabaseUrl'
              ? 'https://<project-ref>.supabase.co or <project_ref>'
              : isNumberInput
                ? 'Enter a number to use without a connection'
                : isListOfTextInput
                  ? 'Add entries or press Add to provide a list'
                  : 'Enter text to use without a connection';
          const typeLabel = describePortType(portType);

          return (
            <div key={input.id} className={cn('py-3', index > 0 && 'border-t border-border')}>
              <div className="flex items-center justify-between mb-1.5">
                <div className="flex items-center gap-1.5">
                  <span className="text-sm font-medium">{input.label}</span>
                  {input.required && (
                    <span className="text-[9px] text-destructive font-medium">*</span>
                  )}
                </div>
                <Badge variant="outline" className="text-[10px] font-mono px-1.5">
                  {typeLabel}
                </Badge>
              </div>
              {input.description && (
                <p className="text-xs text-muted-foreground leading-relaxed mb-2">
                  {input.description}
                </p>
              )}

              {allowsManualInput && (
                <div className="mt-2 space-y-1.5">
                  <label
                    htmlFor={`manual-${input.id}`}
                    className="text-[11px] font-medium text-muted-foreground"
                  >
                    Value
                  </label>
                  {useSecretSelect ? (
                    <SecretSelect
                      value={typeof manualValue === 'string' ? manualValue : ''}
                      onChange={(value) => {
                        // Handle both undefined (from clear button) and empty string
                        if (value === undefined || value === '' || value === null) {
                          onInputOverrideChange(input.id, undefined);
                        } else {
                          onInputOverrideChange(input.id, value);
                        }
                      }}
                      placeholder={manualPlaceholder}
                      className="text-sm"
                      disabled={manualLocked}
                    />
                  ) : isBooleanInput ? (
                    <div className="space-y-2">
                      <Select
                        value={
                          typeof manualValue === 'boolean'
                            ? manualValue
                              ? 'true'
                              : 'false'
                            : undefined
                        }
                        onValueChange={(value) => {
                          if (value === 'true') {
                            onInputOverrideChange(input.id, true);
                          } else if (value === 'false') {
                            onInputOverrideChange(input.id, false);
                          }
                        }}
                        disabled={manualLocked}
                      >
                        <SelectTrigger className="text-sm">
                          <SelectValue placeholder="Select true or false" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="true">True</SelectItem>
                          <SelectItem value="false">False</SelectItem>
                        </SelectContent>
                      </Select>
                      {!manualLocked && typeof manualValue === 'boolean' && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-7 w-fit text-xs px-2"
                          onClick={() => onInputOverrideChange(input.id, undefined)}
                        >
                          Clear manual value
                        </Button>
                      )}
                    </div>
                  ) : isListOfTextInput ? (
                    <ManualListChipsInput
                      inputId={input.id}
                      manualValue={manualValue}
                      disabled={manualLocked}
                      placeholder={manualPlaceholder}
                      onChange={(value) => onInputOverrideChange(input.id, value)}
                    />
                  ) : componentId === 'core.artifact.writer' && input.id === 'artifactName' ? (
                    <DynamicArtifactNameInput
                      value={manualInputValue}
                      onChange={(value) => {
                        if (!value || value === '') {
                          onInputOverrideChange(input.id, undefined);
                        } else {
                          onInputOverrideChange(input.id, value);
                        }
                      }}
                      disabled={manualLocked}
                      placeholder="{{run_id}}-{{timestamp}}"
                    />
                  ) : (
                    <Input
                      id={`manual-${input.id}`}
                      type={isNumberInput ? 'number' : 'text'}
                      value={manualInputValue}
                      onChange={(e) => {
                        const nextValue = e.target.value;
                        if (nextValue === '') {
                          onInputOverrideChange(input.id, undefined);
                          return;
                        }
                        if (isNumberInput) {
                          const parsed = Number(nextValue);
                          if (Number.isNaN(parsed)) {
                            return;
                          }
                          onInputOverrideChange(input.id, parsed);
                        } else {
                          onInputOverrideChange(input.id, nextValue);
                        }
                      }}
                      placeholder={manualPlaceholder}
                      className="text-sm"
                      disabled={manualLocked}
                    />
                  )}
                  {/* Skip helper text for DynamicArtifactNameInput as it has its own */}
                  {!(componentId === 'core.artifact.writer' && input.id === 'artifactName') &&
                    (manualLocked ? (
                      <p className="text-xs text-muted-foreground italic">
                        Disconnect the port to edit manual input.
                      </p>
                    ) : (
                      <p className="text-[10px] text-muted-foreground">
                        {isBooleanInput
                          ? 'Select a value or clear manual input to require a port connection.'
                          : isListOfTextInput
                            ? 'Add entries or clear manual input to require a port connection.'
                            : 'Leave blank to require a port connection.'}
                      </p>
                    ))}
                </div>
              )}

              {/* Connection status - compact */}
              <div className="mt-2 text-[11px]">
                {manualValueProvided ? (
                  <div className="flex items-center gap-1.5 text-primary">
                    <Circle className="h-2 w-2 fill-current" />
                    <span>Value set</span>
                  </div>
                ) : hasConnection ? (
                  <div className="flex items-center gap-1.5 text-green-600 dark:text-green-400">
                    <CheckCircle2 className="h-3 w-3" />
                    <span>Connected from {connectedSummary || connection?.source}</span>
                  </div>
                ) : input.required ? (
                  <div className="flex items-center gap-1.5 text-destructive">
                    <AlertCircle className="h-3 w-3" />
                    <span>Required</span>
                  </div>
                ) : (
                  <span className="text-muted-foreground">Optional</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </CollapsibleSection>
  );
}
