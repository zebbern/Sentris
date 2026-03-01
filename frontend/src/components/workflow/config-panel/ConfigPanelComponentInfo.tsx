import { Pencil, Check } from 'lucide-react';
import { DynamicIcon } from '@/components/ui/DynamicIcon';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import type { ComponentMetadata } from '@/schemas/component';

export interface ConfigPanelComponentInfoProps {
  component: ComponentMetadata;
  nodeLabel?: string;
  isEntryPointComponent: boolean;
  isEditingNodeName: boolean;
  editingNodeName: string;
  onStartEditing: () => void;
  onSaveNodeName: () => void;
  onEditingNameChange: (value: string) => void;
  onCancelEditing: () => void;
}

export function ConfigPanelComponentInfo({
  component,
  nodeLabel,
  isEntryPointComponent,
  isEditingNodeName,
  editingNodeName,
  onStartEditing,
  onSaveNodeName,
  onEditingNameChange,
  onCancelEditing,
}: ConfigPanelComponentInfoProps) {
  return (
    <div className="px-4 py-3 border-b bg-muted/20">
      <div className="flex items-start gap-3">
        <div className="p-2 rounded-lg border bg-background flex-shrink-0">
          {component.logo ? (
            <img
              src={component.logo}
              alt={component.name}
              width={24}
              height={24}
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
                onChange={(e) => onEditingNameChange(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    onSaveNodeName();
                  } else if (e.key === 'Escape') {
                    onCancelEditing();
                  }
                }}
                onBlur={onSaveNodeName}
                placeholder={component.name}
                className="h-6 text-sm font-medium py-0 px-1"
                autoFocus
              />
              <Button
                variant="ghost"
                size="icon"
                className="h-5 w-5 flex-shrink-0"
                onClick={onSaveNodeName}
                aria-label="Save node name"
              >
                <Check className="h-3 w-3" />
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-1 group">
              <h4 className="font-medium text-sm truncate">{nodeLabel || component.name}</h4>
              {!isEntryPointComponent && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-5 w-5 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
                  onClick={onStartEditing}
                  title="Rename node"
                  aria-label="Rename node"
                >
                  <Pencil className="h-3 w-3" />
                </Button>
              )}
            </div>
          )}
          {/* Show component name as subscript if custom name is set */}
          {nodeLabel && nodeLabel !== component.name && (
            <span className="text-[10px] text-muted-foreground opacity-70">{component.name}</span>
          )}
          <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
            {component.description}
          </p>
        </div>
      </div>
    </div>
  );
}
