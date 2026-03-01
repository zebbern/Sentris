import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { arrayMove, sortableKeyboardCoordinates } from '@dnd-kit/sortable';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface UseSortableListOptions<T> {
  /** Source items from the server / query. */
  items: T[];
  /** Extract the unique ID from each item. */
  getId: (item: T) => string;
  /**
   * localStorage key used to persist the manual order.
   * Convention: `sentris:sort:{page}:{orgId}`
   */
  storageKey: string;
  /**
   * When `true`, dragging is disabled (e.g. while a sort/filter is active).
   * The hook still returns items in their original order.
   */
  disabled?: boolean;
}

interface UseSortableListReturn<T> {
  /** Items sorted by the persisted manual order. */
  orderedItems: T[];
  /** Pre-configured sensors (pointer + keyboard). */
  sensors: ReturnType<typeof useSensors>;
  /** Collision detection strategy to pass to `DndContext`. */
  collisionDetection: typeof closestCenter;
  /** Handler for `DndContext.onDragEnd`. */
  handleDragEnd: (event: DragEndEvent) => void;
  /** Whether drag-to-reorder is currently disabled. */
  isDragDisabled: boolean;
}

// ---------------------------------------------------------------------------
// LocalStorage helpers
// ---------------------------------------------------------------------------

function readOrder(key: string): string[] {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

function writeOrder(key: string, ids: string[]) {
  try {
    localStorage.setItem(key, JSON.stringify(ids));
  } catch {
    // localStorage may be full or unavailable — fail silently.
  }
}

// ---------------------------------------------------------------------------
// Ordering logic
// ---------------------------------------------------------------------------

/**
 * Merge server items with a persisted order:
 * - Known items are sorted to match the saved sequence.
 * - New items (not in the saved list) are appended at the end.
 * - Stale ids (no longer present) are silently pruned.
 */
function applyPersistedOrder<T>(items: T[], getId: (item: T) => string, saved: string[]): T[] {
  if (saved.length === 0) return items;

  const orderMap = new Map(saved.map((id, idx) => [id, idx]));
  return [...items].sort((a, b) => {
    const aIdx = orderMap.get(getId(a)) ?? Infinity;
    const bIdx = orderMap.get(getId(b)) ?? Infinity;
    return aIdx - bIdx;
  });
}

// Stable empty array to avoid re-renders when query returns undefined.
const EMPTY_ITEMS: never[] = [];

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useSortableList<T>({
  items: rawItems,
  getId,
  storageKey,
  disabled = false,
}: UseSortableListOptions<T>): UseSortableListReturn<T> {
  const items = rawItems.length > 0 ? rawItems : (EMPTY_ITEMS as T[]);

  // Stabilize getId so inline arrow functions don't cause infinite re-renders.
  const getIdRef = useRef(getId);
  getIdRef.current = getId;

  const [orderedItems, setOrderedItems] = useState<T[]>([]);

  // Sync from server data + localStorage on items / key change.
  useEffect(() => {
    if (items.length === 0) {
      setOrderedItems((prev) => (prev.length === 0 ? prev : []));
      return;
    }
    const saved = readOrder(storageKey);
    setOrderedItems(applyPersistedOrder(items, getIdRef.current, saved));
  }, [items, storageKey]);

  // Sensors — same config as WorkflowList for consistency.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      if (disabled) return;
      const { active, over } = event;
      if (!over || active.id === over.id) return;

      setOrderedItems((prev) => {
        const currentGetId = getIdRef.current;
        const oldIndex = prev.findIndex((item) => currentGetId(item) === active.id);
        const newIndex = prev.findIndex((item) => currentGetId(item) === over.id);
        if (oldIndex === -1 || newIndex === -1) return prev;

        const reordered = arrayMove(prev, oldIndex, newIndex);
        writeOrder(storageKey, reordered.map(currentGetId));
        return reordered;
      });
    },
    [disabled, storageKey],
  );

  const isDragDisabled = disabled;

  return useMemo(
    () => ({
      orderedItems,
      sensors,
      collisionDetection: closestCenter,
      handleDragEnd,
      isDragDisabled,
    }),
    [orderedItems, sensors, handleDragEnd, isDragDisabled],
  );
}
