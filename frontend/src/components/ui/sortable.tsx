import type { CSSProperties, HTMLAttributes } from 'react';
import { GripVertical } from 'lucide-react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------------
// SortableTableRow — wraps a <tr> with useSortable behaviour
// ---------------------------------------------------------------------------

interface SortableTableRowProps {
  id: string;
  disabled?: boolean;
  className?: string;
  onClick?: () => void;
  children: (props: {
    /** Spread onto the drag-handle element. */
    handleProps: {
      listeners: ReturnType<typeof useSortable>['listeners'];
      attributes: ReturnType<typeof useSortable>['attributes'];
    };
    isDragging: boolean;
  }) => React.ReactNode;
}

export function SortableTableRow({
  id,
  disabled,
  className,
  onClick,
  children,
}: SortableTableRowProps) {
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
    <tr
      ref={setNodeRef}
      style={style}
      onClick={onClick}
      className={cn(
        'border-b transition-colors hover:bg-muted/50 data-[state=selected]:bg-muted',
        isDragging && 'bg-accent/50 shadow-lg',
        className,
      )}
    >
      {children({ handleProps: { listeners, attributes }, isDragging })}
    </tr>
  );
}

// ---------------------------------------------------------------------------
// DragHandle — grip icon that acts as the drag initiator
// ---------------------------------------------------------------------------

interface DragHandleProps {
  listeners: ReturnType<typeof useSortable>['listeners'];
  attributes: ReturnType<typeof useSortable>['attributes'];
  disabled?: boolean;
}

export function DragHandle({ listeners, attributes, disabled }: DragHandleProps) {
  // Use Object.assign to merge listeners + attributes into one props object.
  // Spread syntax ({ ...listeners, ...attributes }) triggers TS2783 because
  // dnd-kit types listeners as Record<string, Function>, which TypeScript
  // treats as potentially containing aria-roledescription from attributes.
  const mergedProps: HTMLAttributes<HTMLDivElement> = disabled
    ? {}
    : Object.assign({}, listeners, attributes);
  const { 'aria-roledescription': ariaRoleDescription, ...handleProps } = mergedProps;

  return (
    <td className="w-10 px-2 align-middle [&:has([role=checkbox])]:pr-0">
      <div
        className={cn(
          'touch-none text-muted-foreground hover:text-foreground transition-colors',
          disabled ? 'opacity-30 cursor-not-allowed' : 'cursor-grab active:cursor-grabbing',
        )}
        {...handleProps}
        aria-roledescription={ariaRoleDescription}
        aria-label="Drag to reorder"
        onClick={(e) => e.stopPropagation()}
      >
        <GripVertical className="h-4 w-4" />
      </div>
    </td>
  );
}
