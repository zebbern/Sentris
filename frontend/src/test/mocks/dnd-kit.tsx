/**
 * Shared DnD-kit mock factories for test files.
 *
 * Usage:
 * ```ts
 * import {
 *   createDndCoreMock,
 *   createDndSortableMock,
 *   createDndUtilitiesMock,
 *   createSortableUiMock,
 *   createSortableCardMock,
 *   createUseSortableListMock,
 * } from '@/test/mocks/dnd-kit';
 *
 * mock.module('@dnd-kit/core', createDndCoreMock);
 * mock.module('@dnd-kit/sortable', createDndSortableMock);
 * mock.module('@dnd-kit/utilities', createDndUtilitiesMock);
 * mock.module('@/components/ui/sortable', createSortableUiMock);
 * mock.module('@/hooks/useSortableList', createUseSortableListMock);
 * ```
 */

// ---------------------------------------------------------------------------
// @dnd-kit/core
// ---------------------------------------------------------------------------

export function createDndCoreMock() {
  return {
    DndContext: ({ children }: any) => <>{children}</>,
    closestCenter: () => null,
    KeyboardSensor: class {},
    PointerSensor: class {},
    useSensor: () => ({}),
    useSensors: () => [],
  };
}

// ---------------------------------------------------------------------------
// @dnd-kit/sortable
// ---------------------------------------------------------------------------

export function createDndSortableMock() {
  return {
    SortableContext: ({ children }: any) => <>{children}</>,
    verticalListSortingStrategy: {},
    rectSortingStrategy: {},
    useSortable: () => ({
      attributes: {},
      listeners: {},
      setNodeRef: () => {},
      transform: null,
      transition: null,
      isDragging: false,
    }),
    sortableKeyboardCoordinates: () => ({}),
    arrayMove: (arr: unknown[]) => arr,
  };
}

// ---------------------------------------------------------------------------
// @dnd-kit/utilities
// ---------------------------------------------------------------------------

export function createDndUtilitiesMock() {
  return {
    CSS: { Transform: { toString: () => '' } },
  };
}

// ---------------------------------------------------------------------------
// @/components/ui/sortable  (SortableTableRow + DragHandle)
// ---------------------------------------------------------------------------

export function createSortableUiMock() {
  const SortableTableRow = ({ children, id, className, onClick, ...rest }: any) => {
    const handleProps = {
      listeners: {},
      attributes: {
        role: 'button',
        tabIndex: 0,
        'aria-roledescription': 'sortable',
        'aria-describedby': 'dndkit-instructions',
        'aria-disabled': false,
      },
    };
    return (
      <tr data-id={id} className={className} onClick={onClick} {...rest}>
        {typeof children === 'function' ? children({ handleProps, isDragging: false }) : children}
      </tr>
    );
  };
  const DragHandle = ({ listeners, attributes, disabled }: any) => {
    const mergedProps = disabled ? {} : { ...listeners, ...attributes };
    const { 'aria-roledescription': ariaRoleDescription, ...handleProps } = mergedProps;
    return (
      <td className="w-10 px-2 align-middle">
        <div
          className={
            disabled
              ? 'touch-none text-muted-foreground opacity-30 cursor-not-allowed'
              : 'touch-none text-muted-foreground cursor-grab'
          }
          {...handleProps}
          aria-roledescription={ariaRoleDescription}
          aria-label="Drag to reorder"
        >
          <svg className="h-4 w-4" />
        </div>
      </td>
    );
  };
  return { SortableTableRow, DragHandle };
}

// ---------------------------------------------------------------------------
// @/components/ui/sortable-card  (SortableCard + CardDragHandle)
// ---------------------------------------------------------------------------

export function createSortableCardMock() {
  return {
    SortableCard: ({ children, id }: any) => {
      const handleProps = { listeners: {}, attributes: {} };
      return (
        <div data-testid={`sortable-card-${id}`}>
          {typeof children === 'function' ? children({ handleProps }) : children}
        </div>
      );
    },
    CardDragHandle: () => <div />,
  };
}

// ---------------------------------------------------------------------------
// @/hooks/useSortableList
// ---------------------------------------------------------------------------

export function createUseSortableListMock() {
  return {
    useSortableList: ({ items }: any) => ({
      orderedItems: items,
      sensors: [],
      collisionDetection: () => null,
      handleDragEnd: () => {},
      isDragDisabled: false,
    }),
  };
}
