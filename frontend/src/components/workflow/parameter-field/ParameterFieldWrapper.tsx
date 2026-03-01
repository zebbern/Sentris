import { cn } from '@/lib/utils';
import { Switch } from '@/components/ui/switch';
import type { Parameter } from '@/schemas/component';
import type { InputMapping } from '@/schemas/node';
import { RuntimeInputsEditor } from '../RuntimeInputsEditor';
import { SimpleVariableListEditor } from '../SimpleVariableListEditor';
import { ScriptCodeEditor } from '../ScriptCodeEditor';
import { FormFieldsEditor } from '../FormFieldsEditor';
import { SelectionOptionsEditor } from '../SelectionOptionsEditor';
import { shouldShowParameter, isHeaderToggleParameter } from './parameterUtils';
import { ParameterField } from '../ParameterField';

interface ParameterFieldWrapperProps {
  parameter: Parameter;
  value: unknown;
  onChange: (value: unknown) => void;
  connectedInput?: InputMapping;
  componentId?: string;
  parameters?: Record<string, unknown> | undefined;
  onUpdateParameter?: (paramId: string, value: unknown) => void;
  allComponentParameters?: Parameter[];
}

/**
 * ParameterFieldWrapper - Wraps parameter field with label and description.
 * Handles special-case editors (runtime inputs, variable lists, form fields,
 * selection options, script code) and renders standard parameters with labels.
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
        <RuntimeInputsEditor value={Array.isArray(value) ? value : []} onChange={onChange} />
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
          value={Array.isArray(value) ? value : []}
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
        <FormFieldsEditor value={Array.isArray(value) ? value : []} onChange={onChange} />
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
        <SelectionOptionsEditor value={Array.isArray(value) ? value : []} onChange={onChange} />
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
        code={typeof value === 'string' ? value : ''}
        onCodeChange={onChange}
        inputVariables={inputVariables}
        outputVariables={outputVariables}
      />
    );
  }

  const isNestedParameter = Boolean(parameter.visibleWhen);
  const isHeaderToggle = isHeaderToggleParameter(parameter, allComponentParameters);

  // Header toggle rendering (boolean that controls other params' visibility)
  if (isHeaderToggle) {
    return (
      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <label className="text-sm font-medium" htmlFor={parameter.id}>
            {parameter.label}
          </label>
          <Switch
            id={parameter.id}
            checked={Boolean(value)}
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

      {isBooleanParameter && parameter.description && (
        <p className="text-xs text-muted-foreground">{parameter.description}</p>
      )}

      {parameter.helpText && (
        <p className="text-xs text-muted-foreground italic mt-2">💡 {parameter.helpText}</p>
      )}
    </div>
  );
}
