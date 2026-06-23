import { useMemo } from 'react';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import type { Parameter } from '@/schemas/component';
import type { InputMapping } from '@/schemas/node';
import { LeanSelect, type SelectOption } from '@/components/inputs/LeanSelect';
import { McpLibraryConfig } from './McpLibraryConfig';
import { AgentSkillsConfig } from './AgentSkillsConfig';
import { McpGroupConfig } from './McpGroupConfig';
import { ArtifactSelector } from './parameter-field/ArtifactSelector';
import { WorkflowSelector } from './parameter-field/WorkflowSelector';
import { ConnectionSelector } from './parameter-field/ConnectionSelector';
import { SecretField } from './parameter-field/SecretField';
import { JsonField } from './parameter-field/JsonField';
import { TextareaField } from './parameter-field/TextareaField';

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
 * ParameterField - Renders appropriate input field based on parameter type.
 * Dispatches to per-type renderer components in `parameter-field/`.
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
  const isReceivingInput = Boolean(connectedInput);

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

  const isWorkflowCallComponent = componentId === 'core.workflow.call';
  const isWorkflowSelector = isWorkflowCallComponent && parameter.id === 'workflowId';

  // Sub-workflow picker with entrypoint port syncing
  if (isWorkflowSelector) {
    return (
      <WorkflowSelector
        parameterId={parameter.id}
        value={typeof currentValue === 'string' ? currentValue : undefined}
        onChange={onChange}
        onUpdateParameter={onUpdateParameter}
        disabled={isReceivingInput}
        parameters={parameters}
      />
    );
  }

  // GitHub connection picker
  if (isConnectionSelector) {
    return (
      <ConnectionSelector
        value={typeof currentValue === 'string' ? currentValue : undefined}
        onChange={onChange}
        onUpdateParameter={onUpdateParameter}
        disabled={isReceivingInput}
        isRemoveGithubComponent={isRemoveGithubComponent}
      />
    );
  }

  // Custom MCP — multi-select from MCP servers API
  if (componentId === 'mcp.custom' && parameter.id === 'enabledServers') {
    const selectedServers = Array.isArray(currentValue) ? currentValue : [];
    return (
      <McpLibraryConfig value={selectedServers} onChange={onChange} disabled={isReceivingInput} />
    );
  }

  // MCP Groups — dynamic group servers
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

  if (
    (componentId === 'core.ai.opencode' || componentId === 'core.ai.claude-code') &&
    parameter.id === 'skillIds'
  ) {
    const selectedSkills = Array.isArray(currentValue) ? currentValue : [];
    return (
      <AgentSkillsConfig value={selectedSkills} onChange={onChange} disabled={isReceivingInput} />
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

    case 'textarea':
      return <TextareaField parameter={parameter} value={currentValue} onChange={onChange} />;

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
              if (file) onChange(file.name);
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

    case 'secret':
      return (
        <SecretField
          value={typeof currentValue === 'string' ? currentValue : undefined}
          onChange={onChange}
          connectedInput={connectedInput}
          isDisabledForConnection={
            isRemoveGithubComponent && parameter.id === 'clientSecret' && isGithubConnectionMode
          }
        />
      );

    case 'json':
      return <JsonField parameter={parameter} value={value} onChange={onChange} />;

    default:
      return (
        <div className="text-xs text-muted-foreground italic">
          Unsupported parameter type: {parameter.type}
        </div>
      );
  }
}
