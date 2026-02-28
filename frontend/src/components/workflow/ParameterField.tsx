import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { useNavigate } from 'react-router-dom';
import { RuntimeInputsEditor } from './RuntimeInputsEditor';
import { SimpleVariableListEditor } from './SimpleVariableListEditor';
import { ScriptCodeEditor } from './ScriptCodeEditor';
import { logger } from '@/lib/logger';
import { FormFieldsEditor } from './FormFieldsEditor';
import { SelectionOptionsEditor } from './SelectionOptionsEditor';
import { McpLibraryConfig } from './McpLibraryConfig';
import { McpGroupConfig } from './McpGroupConfig';
import { SecretSelect } from '@/components/inputs/SecretSelect';
import { LeanSelect, type SelectOption } from '@/components/inputs/LeanSelect';
import type { Parameter } from '@/schemas/component';
import type { InputMapping } from '@/schemas/node';
import { useSecrets } from '@/hooks/queries/useSecretQueries';
import { useIntegrationConnections } from '@/hooks/queries/useIntegrationQueries';
import { useWorkflowsList } from '@/hooks/queries/useWorkflowQueries';
import { getCurrentUserId } from '@/lib/currentUser';
import { env } from '@/config/env';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { api } from '@/services/api';
import { useWorkflowStore } from '@/store/workflowStore';
import { ArtifactSelector } from './parameter-field/ArtifactSelector';
import { shouldShowParameter, isHeaderToggleParameter } from './parameter-field/parameterUtils';

interface ParameterFieldProps {
  parameter: Parameter;
  value: any;
  onChange: (value: any) => void;
  connectedInput?: InputMapping;
  componentId?: string;
  parameters?: Record<string, unknown> | undefined;
  onUpdateParameter?: (paramId: string, value: any) => void;
}

/**
 * ParameterField - Renders appropriate input field based on parameter type
 */
export function ParameterField({
  parameter,
  value,
  onChange,
  connectedInput,
  componentId,
  parameters,
  onUpdateParameter,
}: ParameterFieldProps) {
  const currentValue = value !== undefined ? value : parameter.default;
  const [jsonError, setJsonError] = useState<string | null>(null);
  const navigate = useNavigate();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const queryClient = useQueryClient();

  const { data: secrets = [], error: secretsQueryError } = useSecrets();
  const secretsError = secretsQueryError?.message ?? null;

  const currentUserId = useMemo(() => getCurrentUserId(), []);
  const {
    data: integrationConnections = [],
    isLoading: integrationLoading,
    error: integrationQueryError,
  } = useIntegrationConnections(currentUserId);
  const integrationError = integrationQueryError?.message ?? null;

  const autoSelectedConnectionRef = useRef(false);

  const authModeFromParameters: 'manual' | 'connection' = useMemo(() => {
    const map = parameters as Record<string, unknown> | undefined;
    if (map && typeof map.authMode === 'string') {
      return map.authMode as 'manual' | 'connection';
    }
    const connectionCandidate = map?.connectionId;
    if (typeof connectionCandidate === 'string' && connectionCandidate.trim().length > 0) {
      return 'connection';
    }
    return 'manual';
  }, [parameters]);

  const isRemoveGithubComponent = componentId === 'github.org.membership.remove';
  const isProviderGithubComponent = componentId === 'github.connection.provider';
  const isGitHubConnectionComponent = isRemoveGithubComponent || isProviderGithubComponent;
  const isConnectionSelector = isGitHubConnectionComponent && parameter.id === 'connectionId';
  const isGithubConnectionMode = isRemoveGithubComponent && authModeFromParameters === 'connection';

  const currentBuilderWorkflowId = useWorkflowStore((state) => state.metadata.id);
  const isWorkflowCallComponent = componentId === 'core.workflow.call';
  const isWorkflowSelector = isWorkflowCallComponent && parameter.id === 'workflowId';

  const githubConnections = useMemo(
    () => integrationConnections.filter((connection) => connection.provider === 'github'),
    [integrationConnections],
  );

  const {
    data: rawWorkflowList = [],
    isLoading: workflowListLoading,
    error: workflowListError,
  } = useWorkflowsList();
  const workflowOptions = useMemo(
    () =>
      rawWorkflowList
        .filter((w) => w.id !== currentBuilderWorkflowId)
        .map((w) => ({ id: w.id, name: w.name }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [rawWorkflowList, currentBuilderWorkflowId],
  );
  const workflowOptionsLoading = workflowListLoading;
  const workflowOptionsError = workflowListError?.message ?? null;
  const [workflowPortSyncError, setWorkflowPortSyncError] = useState<string | null>(null);

  const selectedWorkflowId =
    typeof currentValue === 'string' && currentValue.trim().length > 0 ? currentValue.trim() : '';

  const syncCallWorkflowPorts = useCallback(
    async (workflowId: string) => {
      setWorkflowPortSyncError(null);
      try {
        const workflow = await api.workflows.get(workflowId);
        const graph = workflow.graph;
        const entrypoint = graph.nodes.find((node) => node.type === 'core.workflow.entrypoint');

        const runtimeInputsCandidate = (
          entrypoint?.data?.config as Record<string, unknown> | undefined
        )?.runtimeInputs;

        const runtimeInputs = Array.isArray(runtimeInputsCandidate) ? runtimeInputsCandidate : [];

        onUpdateParameter?.('childWorkflowName', workflow.name);
        onUpdateParameter?.('childRuntimeInputs', runtimeInputs);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        setWorkflowPortSyncError(message);
        onUpdateParameter?.('childRuntimeInputs', []);
      }
    },
    [onUpdateParameter],
  );

  useEffect(() => {
    if (!isWorkflowSelector) return;
    if (!selectedWorkflowId) return;

    const existingRuntimeInputs = parameters?.childRuntimeInputs;
    const shouldSync = !Array.isArray(existingRuntimeInputs) || existingRuntimeInputs.length === 0;

    if (!shouldSync) return;
    void syncCallWorkflowPorts(selectedWorkflowId);
  }, [isWorkflowSelector, selectedWorkflowId, parameters, syncCallWorkflowPorts]);

  useEffect(() => {
    if (!isConnectionSelector || integrationLoading) {
      return;
    }

    const selectedValue =
      typeof currentValue === 'string' && currentValue.trim().length > 0 ? currentValue.trim() : '';

    if (selectedValue) {
      autoSelectedConnectionRef.current = true;
      return;
    }

    if (githubConnections.length === 1 && !autoSelectedConnectionRef.current) {
      const [firstConnection] = githubConnections;
      if (firstConnection) {
        autoSelectedConnectionRef.current = true;
        onChange(firstConnection.id);
        if (isRemoveGithubComponent) {
          onUpdateParameter?.('authMode', 'connection');
          onUpdateParameter?.('clientId', undefined);
          onUpdateParameter?.('clientSecret', undefined);
        }
      }
    }
  }, [
    isConnectionSelector,
    githubConnections,
    integrationLoading,
    currentValue,
    onChange,
    onUpdateParameter,
    isRemoveGithubComponent,
  ]);

  const handleRefreshConnections = async () => {
    try {
      await queryClient.invalidateQueries({ queryKey: ['integrationConnections'] });
    } catch (error: unknown) {
      logger.error('Failed to refresh integration connections', error);
    }
  };

  const isReceivingInput = Boolean(connectedInput);

  // Secret IDs are resolved to actual values at runtime by the worker
  // and selecting from store is mandatory to ensure security and portability.

  useEffect(() => {
    if (parameter.type !== 'secret' || isReceivingInput) {
      return;
    }

    // Only auto-migrate if current value is a non-empty string that doesn't match any secret ID
    // Do NOT auto-select if value is undefined/null/empty (user intentionally cleared it)
    if (
      typeof currentValue === 'string' &&
      currentValue.trim().length > 0 &&
      secrets.length > 0 &&
      !secrets.some((secret) => secret.id === currentValue)
    ) {
      // The value looks like a legacy name-based reference, try to find matching secret
      const matchingSecret = secrets.find((secret) => secret.name === currentValue);
      if (matchingSecret) {
        // Migrate to ID-based reference
        onChange(matchingSecret.id);
      }
    }
  }, [parameter.type, secrets, currentValue, onChange, isReceivingInput]);

  const updateSecretValue = (nextValue: any) => {
    if (isReceivingInput) {
      return;
    }
    onChange(nextValue);
  };

  if (isWorkflowSelector) {
    const disabled = isReceivingInput || workflowOptionsLoading;

    return (
      <div className="space-y-2">
        <select
          id={parameter.id}
          value={selectedWorkflowId}
          onChange={(event) => {
            const nextValue = event.target.value;
            onChange(nextValue || undefined);

            if (!nextValue) {
              onUpdateParameter?.('childRuntimeInputs', []);
              onUpdateParameter?.('childWorkflowName', undefined);
              return;
            }

            void syncCallWorkflowPorts(nextValue);
          }}
          className="w-full px-3 py-2 text-sm border rounded-md bg-background"
          disabled={disabled}
        >
          <option value="">Select a workflow…</option>
          {workflowOptions.map((workflow) => (
            <option key={workflow.id} value={workflow.id}>
              {workflow.name}
            </option>
          ))}
        </select>

        {workflowOptionsError && (
          <p className="text-sm text-destructive">
            Failed to load workflows: {workflowOptionsError}
          </p>
        )}
        {workflowPortSyncError && (
          <p className="text-sm text-destructive">
            Failed to load entrypoint inputs: {workflowPortSyncError}
          </p>
        )}

        {selectedWorkflowId && (
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground">
              Selecting a workflow syncs its entrypoint inputs into dynamic ports.
            </p>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => void syncCallWorkflowPorts(selectedWorkflowId)}
              disabled={disabled}
            >
              Refresh ports
            </Button>
          </div>
        )}
      </div>
    );
  }

  if (isConnectionSelector) {
    const selectedValue = typeof currentValue === 'string' ? currentValue : '';
    const disabled = isReceivingInput || integrationLoading;

    return (
      <div className="space-y-2">
        <select
          value={selectedValue}
          onChange={(event) => {
            autoSelectedConnectionRef.current = true;
            const nextValue = event.target.value;
            if (nextValue === '') {
              onChange(undefined);
              if (isRemoveGithubComponent) {
                onUpdateParameter?.('authMode', 'manual');
              }
            } else {
              onChange(nextValue);
              if (isRemoveGithubComponent) {
                onUpdateParameter?.('authMode', 'connection');
                onUpdateParameter?.('clientId', undefined);
                onUpdateParameter?.('clientSecret', undefined);
              }
            }
          }}
          className="w-full px-3 py-2 text-sm border rounded-md bg-background"
          disabled={disabled}
        >
          <option value="">Select a GitHub connection…</option>
          {githubConnections.map((connection) => (
            <option key={connection.id} value={connection.id}>
              {connection.providerName} · {connection.userId}
            </option>
          ))}
        </select>

        {integrationLoading && (
          <p className="text-xs text-muted-foreground">Loading connections…</p>
        )}

        {integrationError && <p className="text-sm text-destructive">{integrationError}</p>}

        {!integrationLoading && githubConnections.length === 0 && (
          <p className="text-xs text-muted-foreground">
            No active GitHub connections yet. Connect GitHub from the Connections manager.
          </p>
        )}

        <div className="flex flex-wrap items-center gap-2">
          {env.VITE_ENABLE_CONNECTIONS && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => navigate('/integrations')}
              disabled={isReceivingInput}
            >
              Manage connections
            </Button>
          )}
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => {
              void handleRefreshConnections();
            }}
            disabled={integrationLoading || isReceivingInput}
          >
            {integrationLoading ? 'Refreshing…' : 'Refresh'}
          </Button>
          {selectedValue && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => {
                onChange(undefined);
                if (isRemoveGithubComponent) {
                  onUpdateParameter?.('authMode', 'manual');
                }
              }}
              disabled={isReceivingInput}
            >
              Clear selection
            </Button>
          )}
        </div>
      </div>
    );
  }

  // Custom MCPs - enabledServers parameter uses custom multi-select from MCP servers API
  if (componentId === 'mcp.custom' && parameter.id === 'enabledServers') {
    const selectedServers = Array.isArray(currentValue) ? currentValue : [];
    return (
      <McpLibraryConfig value={selectedServers} onChange={onChange} disabled={isReceivingInput} />
    );
  }

  // MCP Groups - enabledServers parameter uses dynamic group servers
  if (componentId?.startsWith('mcp.group.') && parameter.id === 'enabledServers') {
    const groupSlug = componentId.replace('mcp.group.', '');
    const selectedServers = Array.isArray(currentValue) ? currentValue : [];
    return (
      <McpGroupConfig
        groupSlug={groupSlug}
        value={selectedServers}
        onChange={onChange}
        disabled={isReceivingInput}
      />
    );
  }

  switch (parameter.type) {
    case 'text': {
      const disableForGitHubConnection =
        isRemoveGithubComponent && parameter.id === 'clientId' && isGithubConnectionMode;

      const inputElement = (
        <Input
          id={parameter.id}
          type="text"
          placeholder={parameter.placeholder}
          value={currentValue || ''}
          onChange={(e) => onChange(e.target.value)}
          className="text-sm"
          disabled={isReceivingInput || disableForGitHubConnection}
        />
      );

      if (disableForGitHubConnection) {
        return (
          <div className="space-y-2">
            {inputElement}
            <p className="text-xs text-muted-foreground">
              Using a stored GitHub connection, so the client ID is managed automatically.
            </p>
          </div>
        );
      }

      return inputElement;
    }

    case 'textarea': {
      const isExternalUpdateRef = useRef(false);

      // Sync external changes to textarea (e.g., workflow undo)
      useEffect(() => {
        if (textareaRef.current && textareaRef.current.value !== (currentValue || '')) {
          isExternalUpdateRef.current = true;
          textareaRef.current.value = currentValue || '';
          isExternalUpdateRef.current = false;
        }
      }, [currentValue]);

      // Sync to parent only on blur for native undo behavior
      const handleBlur = useCallback(() => {
        if (textareaRef.current) {
          onChange(textareaRef.current.value);
        }
      }, [onChange]);

      return (
        <textarea
          ref={textareaRef}
          id={parameter.id}
          placeholder={parameter.placeholder}
          defaultValue={currentValue || ''}
          onBlur={handleBlur}
          rows={Math.min(parameter.rows || 3, 4)}
          className="w-full px-3 py-2 text-sm border rounded-md bg-background resize-y font-mono max-h-[160px] overflow-y-auto"
        />
      );
    }

    case 'number':
      return (
        <Input
          id={parameter.id}
          type="number"
          placeholder={parameter.placeholder}
          value={currentValue ?? ''}
          onChange={(e) => {
            const inputValue = e.target.value;
            if (inputValue === '') {
              onChange(undefined);
              return;
            }
            onChange(Number(inputValue));
          }}
          min={parameter.min}
          max={parameter.max}
          className="text-sm"
        />
      );

    case 'boolean':
      return (
        <div className="flex items-center justify-between">
          <label htmlFor={parameter.id} className="text-sm font-medium cursor-pointer select-none">
            {parameter.label}
          </label>
          <Switch
            id={parameter.id}
            checked={currentValue || false}
            onCheckedChange={(checked) => onChange(checked)}
          />
        </div>
      );

    case 'select': {
      const isAuthModeField = isRemoveGithubComponent && parameter.id === 'authMode';

      const options: SelectOption[] =
        parameter.options?.map((o) => ({
          label: o.label,
          value: o.value,
        })) || [];

      return (
        <LeanSelect
          value={currentValue}
          options={options}
          onChange={(nextValue) => {
            onChange(nextValue);

            if (isAuthModeField && nextValue === 'manual') {
              onUpdateParameter?.('connectionId', undefined);
            }
          }}
          disabled={isReceivingInput && !isAuthModeField}
          placeholder={parameter.required ? 'Select an option...' : 'Select an option (optional)'}
          clearable={!parameter.required}
        />
      );
    }

    case 'multi-select': {
      const selectedValues = Array.isArray(currentValue) ? currentValue : [];
      return (
        <div className="space-y-2">
          {parameter.options?.map((option) => {
            const isSelected = selectedValues.includes(option.value);
            return (
              <div
                key={option.value}
                className="flex items-center gap-2 hover:bg-muted/50 p-2 rounded transition-colors"
              >
                <Checkbox
                  id={`${parameter.id}-${option.value}`}
                  checked={isSelected}
                  onCheckedChange={(checked) => {
                    const newValues = checked
                      ? [...selectedValues, option.value]
                      : selectedValues.filter((v) => v !== option.value);
                    onChange(newValues);
                  }}
                />
                <label
                  htmlFor={`${parameter.id}-${option.value}`}
                  className="text-sm select-none cursor-pointer flex-1"
                >
                  {option.label}
                </label>
              </div>
            );
          })}
          {selectedValues.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-2">
              {selectedValues.map((val) => {
                const option = parameter.options?.find((o) => o.value === val);
                return (
                  <Badge key={val} variant="secondary" className="text-xs">
                    {option?.label || val}
                  </Badge>
                );
              })}
            </div>
          )}
        </div>
      );
    }

    case 'file':
      return (
        <div className="space-y-2">
          <Input
            id={parameter.id}
            type="file"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) {
                onChange(file.name);
              }
            }}
            className="text-sm"
          />
          {currentValue && (
            <div className="text-xs text-muted-foreground">
              Selected: <span className="font-mono">{currentValue}</span>
            </div>
          )}
        </div>
      );

    case 'artifact':
      return (
        <ArtifactSelector
          parameterId={parameter.id}
          value={typeof currentValue === 'string' ? currentValue : ''}
          onChange={(nextValue) => onChange(nextValue)}
        />
      );

    case 'secret': {
      const disableForGithubConnection =
        isRemoveGithubComponent && parameter.id === 'clientSecret' && isGithubConnectionMode;

      const connectionLabel =
        connectedInput?.source && connectedInput?.output
          ? `${connectedInput.source}.${connectedInput.output}`
          : connectedInput?.source;

      return (
        <div className="space-y-3">
          {isReceivingInput && (
            <div className="rounded-md border border-dashed border-muted-foreground/40 bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
              Receiving input from upstream node
              {connectionLabel ? ` (${connectionLabel})` : ''}. Disconnect the mapping to edit
              manually.
            </div>
          )}
          {disableForGithubConnection && (
            <p className="text-xs text-muted-foreground">
              Using a stored GitHub connection, so the OAuth client secret is managed automatically.
            </p>
          )}

          {secretsError && <p className="text-sm text-destructive">{secretsError}</p>}

          <SecretSelect
            value={typeof currentValue === 'string' ? currentValue : ''}
            onChange={(nextValue) => {
              // Handle both undefined (from clear button) and empty string
              const valueToSet =
                nextValue === undefined || nextValue === '' || nextValue === null
                  ? undefined
                  : nextValue;
              updateSecretValue(valueToSet);
            }}
            disabled={isReceivingInput || disableForGithubConnection}
            onRefresh={() => {
              void queryClient.invalidateQueries({ queryKey: ['secrets'] });
            }}
          />

          <p className="text-xs text-muted-foreground opacity-70">
            Secrets are resolved at runtime. Only the secret reference is stored in the workflow.
          </p>
        </div>
      );
    }

    case 'json': {
      const jsonTextareaRef = useRef<HTMLTextAreaElement>(null);
      const isExternalJsonUpdateRef = useRef(false);

      // Sync external changes to JSON textarea
      useEffect(() => {
        if (!jsonTextareaRef.current) return;

        let textValue = '';
        let needsNormalization = false;

        if (value === undefined || value === null || value === '') {
          textValue = '';
        } else if (typeof value === 'string') {
          textValue = value;
        } else {
          // If Value is an object - normalize to string
          try {
            textValue = JSON.stringify(value, null, 2);
            needsNormalization = true;
          } catch (error: unknown) {
            logger.error('Failed to serialize JSON parameter value', error);
            return;
          }
        }

        if (jsonTextareaRef.current.value !== textValue) {
          isExternalJsonUpdateRef.current = true;
          jsonTextareaRef.current.value = textValue;
          setJsonError(null);
          isExternalJsonUpdateRef.current = false;
        }

        // Normalize object values to string
        if (needsNormalization) {
          onChange(textValue);
        }
      }, [value, onChange]);

      // Sync to parent only on blur for native undo behavior
      const handleJsonBlur = useCallback(() => {
        if (!jsonTextareaRef.current) return;
        const nextValue = jsonTextareaRef.current.value;

        if (nextValue.trim() === '') {
          setJsonError(null);
          onChange(undefined);
          return;
        }

        try {
          JSON.parse(nextValue); // Validate JSON syntax
          setJsonError(null);
          onChange(nextValue); // Pass string, not parsed object
        } catch (_error: unknown) {
          setJsonError('Invalid JSON');
          // Keep showing error, don't update parent
        }
      }, [onChange]);

      return (
        <div className="space-y-2">
          <textarea
            ref={jsonTextareaRef}
            id={parameter.id}
            defaultValue={
              value === undefined || value === null || value === ''
                ? ''
                : typeof value === 'string'
                  ? value
                  : JSON.stringify(value, null, 2)
            }
            onBlur={handleJsonBlur}
            className="w-full px-3 py-2 text-sm border rounded-md bg-background resize-y font-mono max-h-[160px] overflow-y-auto"
            rows={Math.min(parameter.rows || 4, 4)}
            placeholder={parameter.placeholder || '{\n  "key": "value"\n}'}
          />
          {jsonError && <p className="text-sm text-red-500">{jsonError}</p>}
        </div>
      );
    }

    default:
      return (
        <div className="text-xs text-muted-foreground italic">
          Unsupported parameter type: {parameter.type}
        </div>
      );
  }
}

interface ParameterFieldWrapperProps {
  parameter: Parameter;
  value: any;
  onChange: (value: any) => void;
  connectedInput?: InputMapping;
  componentId?: string;
  parameters?: Record<string, unknown> | undefined;
  onUpdateParameter?: (paramId: string, value: any) => void;
  allComponentParameters?: Parameter[];
}

/**
 * ParameterFieldWrapper - Wraps parameter field with label and description
 */
export function ParameterFieldWrapper({
  parameter,
  value,
  onChange,
  connectedInput,
  componentId,
  parameters,
  onUpdateParameter,
  allComponentParameters,
}: ParameterFieldWrapperProps) {
  // Check visibility conditions
  if (!shouldShowParameter(parameter, parameters)) {
    return null;
  }

  // Special case: Runtime Inputs Editor for Entry Point
  if (parameter.id === 'runtimeInputs') {
    return (
      <div className="space-y-2">
        {parameter.description && (
          <p className="text-xs text-muted-foreground mb-2">{parameter.description}</p>
        )}

        <RuntimeInputsEditor value={value || []} onChange={onChange} />

        {parameter.helpText && (
          <p className="text-xs text-muted-foreground italic mt-2">💡 {parameter.helpText}</p>
        )}
      </div>
    );
  }

  // Special case: Variable list editor (Logic Script, Slack, Manual Actions, etc.)
  if (parameter.type === 'variable-list') {
    const isInput = parameter.id === 'variables';
    const title = parameter.label || (isInput ? 'Input Variables' : 'Return Variables');

    return (
      <div className="space-y-2">
        {parameter.description && (
          <p className="text-xs text-muted-foreground mb-2">{parameter.description}</p>
        )}

        <SimpleVariableListEditor
          value={value || []}
          onChange={onChange}
          title={title}
          type={isInput ? 'input' : 'output'}
        />

        {parameter.helpText && (
          <p className="text-xs text-muted-foreground italic mt-2">💡 {parameter.helpText}</p>
        )}
      </div>
    );
  }

  // Special case: Form Fields Designer
  if (parameter.type === 'form-fields') {
    return (
      <div className="space-y-2">
        {parameter.description && (
          <p className="text-xs text-muted-foreground mb-2">{parameter.description}</p>
        )}

        <FormFieldsEditor value={value || []} onChange={onChange} />

        {parameter.helpText && (
          <p className="text-xs text-muted-foreground italic mt-2">💡 {parameter.helpText}</p>
        )}
      </div>
    );
  }

  // Special case: Selection Options Editor
  if (parameter.type === 'selection-options') {
    return (
      <div className="space-y-2">
        {parameter.description && (
          <p className="text-xs text-muted-foreground mb-2">{parameter.description}</p>
        )}

        <SelectionOptionsEditor value={value || []} onChange={onChange} />

        {parameter.helpText && (
          <p className="text-xs text-muted-foreground italic mt-2">💡 {parameter.helpText}</p>
        )}
      </div>
    );
  }

  // Special case: Logic Script Code Editor
  if (componentId === 'core.logic.script' && parameter.id === 'code') {
    const inputVariables = Array.isArray(parameters?.variables)
      ? (parameters.variables as { name: string; type: string }[])
      : [];
    const outputVariables = Array.isArray(parameters?.returns)
      ? (parameters.returns as { name: string; type: string }[])
      : [];

    return (
      <ScriptCodeEditor
        code={value || ''}
        onCodeChange={onChange}
        inputVariables={inputVariables}
        outputVariables={outputVariables}
      />
    );
  }

  // Check if this is a nested/conditional parameter (has visibleWhen)
  const isNestedParameter = Boolean(parameter.visibleWhen);

  // Check if this is a header toggle (boolean that controls other params' visibility)
  const isHeaderToggle = isHeaderToggleParameter(parameter, allComponentParameters);

  // Header toggle rendering
  if (isHeaderToggle) {
    return (
      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <label className="text-sm font-medium" htmlFor={parameter.id}>
            {parameter.label}
          </label>
          <Switch
            id={parameter.id}
            checked={value || false}
            onCheckedChange={(checked) => onChange(checked)}
          />
        </div>
        {parameter.description && (
          <p className="text-xs text-muted-foreground">{parameter.description}</p>
        )}
      </div>
    );
  }

  // Standard parameter field rendering
  const isBooleanParameter = parameter.type === 'boolean';

  return (
    <div
      className={cn(
        'space-y-2',
        isNestedParameter && 'ml-2 px-3 py-2.5 mt-1 bg-muted/80 rounded-lg',
      )}
    >
      {/* Label and required indicator - skip for boolean (label is inside) */}
      {!isBooleanParameter && (
        <div className="flex items-center justify-between mb-1">
          <label
            className={cn(isNestedParameter ? 'text-xs' : 'text-sm', 'font-medium')}
            htmlFor={parameter.id}
          >
            {parameter.label}
          </label>
          {parameter.required && <span className="text-xs text-red-500">*required</span>}
        </div>
      )}

      {/* Description before the input field - for non-boolean parameters */}
      {!isBooleanParameter && parameter.description && (
        <p className="text-xs text-muted-foreground mb-2">{parameter.description}</p>
      )}

      <ParameterField
        parameter={parameter}
        value={value}
        onChange={onChange}
        connectedInput={connectedInput}
        componentId={componentId}
        parameters={parameters}
        onUpdateParameter={onUpdateParameter}
      />

      {/* Description after field (toggle control) - for boolean parameters */}
      {isBooleanParameter && parameter.description && (
        <p className="text-xs text-muted-foreground">{parameter.description}</p>
      )}

      {parameter.helpText && (
        <p className="text-xs text-muted-foreground italic mt-2">💡 {parameter.helpText}</p>
      )}
    </div>
  );
}
