import { useCallback, useEffect, useMemo, useState } from 'react';

interface Identifiable {
  id: string;
}

interface UseBulkSelectionReturn {
  /** Set of currently selected item IDs. */
  selectedIds: Set<string>;
  /** Toggle a single item's selection state. */
  toggleId: (id: string) => void;
  /** Select or deselect all visible items. */
  toggleAll: () => void;
  /** Clear the entire selection. */
  clearSelection: () => void;
  /** True when every visible item is selected. */
  isAllSelected: boolean;
  /** True when some (but not all) visible items are selected. */
  isIndeterminate: boolean;
  /** Number of selected items. */
  selectedCount: number;
}

/**
 * Manages multi-select state for a list of items.
 *
 * Selection automatically clears when the underlying item list changes
 * (e.g. after a delete or refetch).
 */
export function useBulkSelection<T extends Identifiable>(items: T[]): UseBulkSelectionReturn {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Build a set of valid IDs for quick lookups
  const validIds = useMemo(() => new Set(items.map((item) => item.id)), [items]);

  // Prune stale selections when items change
  useEffect(() => {
    setSelectedIds((prev) => {
      if (prev.size === 0) return prev;
      const pruned = new Set<string>();
      for (const id of prev) {
        if (validIds.has(id)) pruned.add(id);
      }
      return pruned.size === prev.size ? prev : pruned;
    });
  }, [validIds]);

  const toggleId = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const toggleAll = useCallback(() => {
    setSelectedIds((prev) => {
      // If all are selected, deselect all. Otherwise select all.
      if (prev.size === validIds.size && validIds.size > 0) {
        return new Set();
      }
      return new Set(validIds);
    });
  }, [validIds]);

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  const selectedCount = selectedIds.size;
  const isAllSelected = selectedCount > 0 && selectedCount === validIds.size;
  const isIndeterminate = selectedCount > 0 && selectedCount < validIds.size;

  return {
    selectedIds,
    toggleId,
    toggleAll,
    clearSelection,
    isAllSelected,
    isIndeterminate,
    selectedCount,
  };
}
