import { CollapsibleSection } from '@/components/ui/collapsible-section';
import { ParameterFieldWrapper } from '../parameter-field/ParameterFieldWrapper';
import { cn } from '@/lib/utils';
import type { Parameter } from '@/schemas/component';
import type { InputMapping } from '@/schemas/node';

export interface ConfigPanelParametersProps {
  componentParameters: Parameter[];
  manualParameters: Record<string, unknown>;
  componentId: string;
  nodeInputs?: Record<string, InputMapping>;
  isToolMode: boolean;
  onParamValueChange: (paramId: string, value: any) => void;
}

export function ConfigPanelParameters({
  componentParameters,
  manualParameters,
  componentId,
  nodeInputs,
  isToolMode,
  onParamValueChange,
}: ConfigPanelParametersProps) {
  // Show parameters if not tool mode, OR if we're in tool mode but have parameters to configure (e.g., MCP components)
  if (isToolMode && componentParameters.length === 0) {
    return null;
  }

  return (
    <CollapsibleSection title="Parameters" count={componentParameters.length} defaultOpen={true}>
      <div className="space-y-0 mt-2">
        {/* Render parameters in component definition order to preserve hierarchy */}
        {componentParameters.map((param, index) => {
          // Only show border between top-level parameters (not nested ones)
          const isTopLevel = !param.visibleWhen;
          const prevParam = index > 0 ? componentParameters[index - 1] : null;
          const prevIsTopLevel = prevParam ? !prevParam.visibleWhen : false;
          const showBorder = index > 0 && isTopLevel && prevIsTopLevel;

          return (
            <div key={param.id} className={cn(showBorder && 'border-t border-border pt-3')}>
              <ParameterFieldWrapper
                parameter={param}
                value={manualParameters[param.id]}
                onChange={(value) => onParamValueChange(param.id, value)}
                connectedInput={nodeInputs?.[param.id]}
                componentId={componentId}
                parameters={manualParameters}
                onUpdateParameter={onParamValueChange}
                allComponentParameters={componentParameters}
              />
            </div>
          );
        })}
      </div>
    </CollapsibleSection>
  );
}
