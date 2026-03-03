import { useEffect, useState } from 'react';
import { DynamicIcon } from '@/components/ui/DynamicIcon';
import type { ComponentMetadata } from '@/schemas/component';
import { cn } from '@/lib/utils';
import { useWorkflowUiStore } from '@/store/workflowUiStore';
import { useWorkflowStore } from '@/store/workflowStore';
import { usePlacementStore } from './sidebar-state';

export type ViewMode = 'list' | 'tiles';

interface ComponentItemProps {
  component: ComponentMetadata;
  disabled?: boolean;
  viewMode: ViewMode;
}

export function ComponentItem({ component, disabled, viewMode }: ComponentItemProps) {
  const description = component.description || 'No description available yet.';
  const [isSelected, setIsSelected] = useState(false);

  // Get placement store and workflow ID for scoped placement
  const setPlacement = usePlacementStore((state) => state.setPlacement);
  const placementComponentId = usePlacementStore((state) => state.componentId);
  const currentWorkflowId = useWorkflowStore((state) => state.metadata.id);

  const onDragStart = (event: React.DragEvent) => {
    if (disabled) {
      event.preventDefault();
      return;
    }
    // Store component ID for canvas to create node
    event.dataTransfer.setData('application/reactflow', component.id);
    event.dataTransfer.effectAllowed = 'move';
  };

  // Handle tap on mobile - select component and close sidebar
  const handleTap = () => {
    if (disabled || component.deprecated) return;

    // Set the component for placement, scoped to current workflow
    setPlacement(component.id, component.name, currentWorkflowId);
    setIsSelected(true);

    // Close sidebar after a short delay to show selection feedback
    setTimeout(() => {
      // Close the library panel directly via store
      useWorkflowUiStore.getState().setLibraryOpen(false);
      setIsSelected(false);
    }, 150);
  };

  // Clear selection if this component is no longer the active one
  useEffect(() => {
    if (placementComponentId !== component.id) {
      setIsSelected(false);
    }
  }, [placementComponentId, component.id]);

  if (viewMode === 'list') {
    return (
      <div
        role="button"
        tabIndex={disabled || component.deprecated ? -1 : 0}
        className={cn(
          'group relative flex items-center gap-3 px-3 py-2 rounded-md cursor-pointer transition-all',
          'hover:bg-muted/50 border border-border/30 hover:border-border/60',
          'focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:outline-none',
          'md:cursor-move', // Desktop: show move cursor
          disabled ? 'cursor-not-allowed opacity-50' : '',
          component.deprecated && 'opacity-50',
          isSelected && 'bg-primary/20 border-primary scale-95',
        )}
        draggable={!component.deprecated && !disabled}
        onDragStart={onDragStart}
        onClick={handleTap}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            handleTap();
          }
        }}
        aria-label={`Add ${component.name} component`}
      >
        {/* Icon */}
        <div className="flex-shrink-0">
          {component.logo ? (
            <img
              src={component.logo}
              alt={component.name}
              width={20}
              height={20}
              className="h-5 w-5 object-contain"
              onError={(e) => {
                // Fallback to icon if image fails to load
                e.currentTarget.style.display = 'none';
                e.currentTarget.nextElementSibling?.classList.remove('hidden');
              }}
            />
          ) : null}
          <DynamicIcon
            name={component.icon || 'Box'}
            className={cn(
              'h-5 w-5 text-muted-foreground flex-shrink-0',
              component.logo && 'hidden',
            )}
          />
        </div>

        {/* Title and description */}
        <div className="flex-1 min-w-0 overflow-hidden">
          <span className="block text-sm font-medium leading-tight truncate">{component.name}</span>
          {description && (
            <p className="text-xs text-muted-foreground truncate mt-0.5 leading-snug">
              {description}
            </p>
          )}
        </div>
      </div>
    );
  }

  // Tile view
  return (
    <div
      role="button"
      tabIndex={disabled || component.deprecated ? -1 : 0}
      className={cn(
        'group relative flex flex-col p-3 border border-border/50 rounded-lg cursor-pointer transition-all',
        'bg-background/50 hover:bg-background hover:border-border',
        'text-foreground aspect-[4/3]',
        'focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:outline-none',
        'md:cursor-move', // Desktop: show move cursor
        disabled ? 'cursor-not-allowed opacity-50' : 'hover:shadow-sm hover:scale-[1.02]',
        component.deprecated && 'opacity-50',
        isSelected && 'bg-primary/20 border-primary scale-95',
      )}
      draggable={!component.deprecated && !disabled}
      onDragStart={onDragStart}
      onClick={handleTap}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          handleTap();
        }
      }}
      aria-label={`Add ${component.name} component`}
    >
      {/* Default: Centered icon and name */}
      <div className="flex flex-col items-center justify-center gap-2 flex-1 group-hover:hidden transition-all">
        {component.logo ? (
          <img
            src={component.logo}
            alt={component.name}
            width={32}
            height={32}
            className="h-8 w-8 flex-shrink-0 object-contain"
            onError={(e) => {
              // Fallback to icon if image fails to load
              e.currentTarget.style.display = 'none';
              e.currentTarget.nextElementSibling?.classList.remove('hidden');
            }}
          />
        ) : null}
        <DynamicIcon
          name={component.icon || 'Box'}
          className={cn('h-8 w-8 flex-shrink-0 text-muted-foreground', component.logo && 'hidden')}
        />
        <span className="text-[13px] font-semibold leading-tight text-center line-clamp-2">
          {component.name}
        </span>
      </div>

      {/* Hover: Icon left, name right, description below */}
      <div className="hidden group-hover:flex flex-col gap-2 flex-1">
        <div className="flex items-start gap-2.5">
          {component.logo ? (
            <img
              src={component.logo}
              alt={component.name}
              width={24}
              height={24}
              className="h-6 w-6 flex-shrink-0 object-contain"
              onError={(e) => {
                // Fallback to icon if image fails to load
                e.currentTarget.style.display = 'none';
                e.currentTarget.nextElementSibling?.classList.remove('hidden');
              }}
            />
          ) : null}
          <DynamicIcon
            name={component.icon || 'Box'}
            className={cn(
              'h-6 w-6 flex-shrink-0 text-muted-foreground',
              component.logo && 'hidden',
            )}
          />
          <span className="text-[13px] font-semibold leading-[1.3] line-clamp-2 flex-1 -mt-0.5">
            {component.name}
          </span>
        </div>
        <p className="text-[10px] text-muted-foreground line-clamp-3 leading-snug">{description}</p>
      </div>
    </div>
  );
}
