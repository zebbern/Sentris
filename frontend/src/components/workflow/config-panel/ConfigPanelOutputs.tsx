import { Badge } from '@/components/ui/badge';
import { CollapsibleSection } from '@/components/ui/collapsible-section';
import { cn } from '@/lib/utils';
import { describePortType, resolvePortType } from '@/utils/portUtils';
import type { OutputPort } from '@/schemas/component';

export interface ConfigPanelOutputsProps {
  componentOutputs: OutputPort[];
  isToolMode: boolean;
}

export function ConfigPanelOutputs({ componentOutputs, isToolMode }: ConfigPanelOutputsProps) {
  if (isToolMode || componentOutputs.length === 0) {
    return null;
  }

  return (
    <CollapsibleSection title="Outputs" count={componentOutputs.length} defaultOpen={true}>
      <div className="space-y-0 mt-2">
        {componentOutputs.map((output, index) => (
          <div key={output.id} className={cn('py-3', index > 0 && 'border-t border-border')}>
            <div className="flex items-center justify-between mb-1">
              <span className="text-sm font-medium">{output.label}</span>
              <Badge variant="outline" className="text-[10px] font-mono px-1.5">
                {describePortType(resolvePortType(output))}
              </Badge>
            </div>
            {output.description && (
              <p className="text-xs text-muted-foreground leading-relaxed">{output.description}</p>
            )}
          </div>
        ))}
      </div>
    </CollapsibleSection>
  );
}
