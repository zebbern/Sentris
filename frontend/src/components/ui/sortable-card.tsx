import type { CSSProperties, HTMLAttributes } from 'react';
import { GripVertical } from 'lucide-react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------------
// SortableCard — wraps a <div> with useSortable behaviour for card grids
// ---------------------------------------------------------------------------

interface SortableCardProps {
  id: string;
  disabled?: boolean;
  className?: string;
  children: (props: {
    /** Spread onto the drag-handle element. */
    handleProps: {
      listeners: ReturnType<typeof useSortable>['listeners'];
      attributes: ReturnType<typeof useSortable>['attributes'];
    };
    isDragging: boolean;
  }) => React.ReactNode;
}

export function SortableCard({ id, disabled, className, children }: SortableCardProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
    disabled,
  });

  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    position: 'relative',
    zIndex: isDragging ? 50 : undefined,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div ref={setNodeRef} style={style} className={cn(isDragging && 'shadow-lg', className)}>
      {children({ handleProps: { listeners, attributes }, isDragging })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// CardDragHandle — grip icon positioned inside a card (typically top-right)
// ---------------------------------------------------------------------------

interface CardDragHandleProps {
  listeners: ReturnType<typeof useSortable>['listeners'];
  attributes: ReturnType<typeof useSortable>['attributes'];
  disabled?: boolean;
  className?: string;
}

export function CardDragHandle({
  listeners,
  attributes,
  disabled,
  className,
}: CardDragHandleProps) {
  if (disabled) return null;

  // Use Object.assign to merge listeners + attributes into one props object.
  // Spread syntax ({ ...listeners, ...attributes }) triggers TS2783 because
  // dnd-kit types listeners as Record<string, Function>, which TypeScript
  // treats as potentially containing aria-roledescription from attributes.
  const mergedProps: HTMLAttributes<HTMLButtonElement> = Object.assign({}, listeners, attributes);
  const { 'aria-roledescription': ariaRoleDescription, ...handleProps } = mergedProps;

  return (
    <button
      type="button"
      className={cn(
        'absolute top-2 right-2 p-1 rounded-md',
        'opacity-0 group-hover:opacity-100 transition-opacity',
        'touch-none cursor-grab active:cursor-grabbing',
        'text-muted-foreground hover:text-foreground hover:bg-muted/50',
        className,
      )}
      {...handleProps}
      aria-roledescription={ariaRoleDescription}
      aria-label="Drag to reorder"
      onClick={(e) => e.stopPropagation()}
    >
      <GripVertical className="h-4 w-4" />
    </button>
  );
}
