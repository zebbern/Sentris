import { memo, useCallback, useEffect, useRef } from 'react';
import { Trash2, PlusCircle, Route } from 'lucide-react';
import { cn } from '@/lib/utils';

interface EdgeContextMenuProps {
  position: { x: number; y: number };
  edgeId: string;
  isDesignMode: boolean;
  onClose: () => void;
  onDelete: (edgeId: string) => void;
  onInsertNode: (edgeId: string) => void;
  onHighlightPath: (edgeId: string) => void;
}

/**
 * Context menu displayed on edge right-click.
 * Positioned absolutely at the cursor coordinates.
 */
export const EdgeContextMenu = memo(function EdgeContextMenu({
  position,
  edgeId,
  isDesignMode,
  onClose,
  onDelete,
  onInsertNode,
  onHighlightPath,
}: EdgeContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  // Close on click-away
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        onClose();
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    // Delay adding the listener to avoid the same right-click event closing the menu
    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('keydown', handleKeyDown);
    }, 0);

    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose]);

  // Focus the menu when it opens for keyboard accessibility
  useEffect(() => {
    menuRef.current?.focus();
  }, []);

  const handleAction = useCallback(
    (action: (edgeId: string) => void) => {
      action(edgeId);
      onClose();
    },
    [edgeId, onClose],
  );

  return (
    <div
      ref={menuRef}
      role="menu"
      tabIndex={-1}
      aria-label="Edge context menu"
      className={cn(
        'fixed z-[200] min-w-[10rem] overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-md',
        'animate-in fade-in-0 zoom-in-95',
      )}
      style={{
        left: position.x,
        top: position.y,
      }}
    >
      {isDesignMode && (
        <>
          <button
            role="menuitem"
            className={cn(
              'relative flex w-full cursor-default select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none',
              'transition-colors hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground',
            )}
            onClick={() => handleAction(onDelete)}
          >
            <Trash2 className="h-4 w-4 text-destructive" />
            <span>Delete Edge</span>
          </button>

          <button
            role="menuitem"
            className={cn(
              'relative flex w-full cursor-default select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none',
              'transition-colors hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground',
            )}
            onClick={() => handleAction(onInsertNode)}
          >
            <PlusCircle className="h-4 w-4" />
            <span>Insert Node Here</span>
          </button>

          <div className="-mx-1 my-1 h-px bg-border" role="separator" />
        </>
      )}

      <button
        role="menuitem"
        className={cn(
          'relative flex w-full cursor-default select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none',
          'transition-colors hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground',
        )}
        onClick={() => handleAction(onHighlightPath)}
      >
        <Route className="h-4 w-4" />
        <span>Highlight Path</span>
      </button>
    </div>
  );
});
