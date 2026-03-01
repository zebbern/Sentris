import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { renderHook, act, cleanup } from '@testing-library/react';
import { useSortableList } from '../useSortableList';

interface TestItem {
  id: string;
  name: string;
}

// Stable reference — inline arrow functions create a new identity every render,
// which triggers the hook's useEffect infinitely.
const getId = (item: TestItem): string => item.id;

const STORAGE_KEY = 'sentris:sort:test-page:org-1';

const makeItems = (...ids: string[]): TestItem[] => ids.map((id) => ({ id, name: `Item ${id}` }));

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe('useSortableList', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('returns items in original order when no saved order exists', () => {
    const items = makeItems('a', 'b', 'c');
    const { result } = renderHook(() =>
      useSortableList({
        items,
        getId,
        storageKey: STORAGE_KEY,
      }),
    );

    expect(result.current.orderedItems.map((i) => i.id)).toEqual(['a', 'b', 'c']);
  });

  it('returns items sorted by persisted order', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(['c', 'a', 'b']));

    const items = makeItems('a', 'b', 'c');
    const { result } = renderHook(() =>
      useSortableList({
        items,
        getId,
        storageKey: STORAGE_KEY,
      }),
    );

    expect(result.current.orderedItems.map((i) => i.id)).toEqual(['c', 'a', 'b']);
  });

  it('appends new items not in saved order at the end', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(['b', 'a']));

    const items = makeItems('a', 'b', 'c');
    const { result } = renderHook(() =>
      useSortableList({
        items,
        getId,
        storageKey: STORAGE_KEY,
      }),
    );

    const ids = result.current.orderedItems.map((i) => i.id);
    // 'b' and 'a' should come first in saved order, 'c' appended
    expect(ids[0]).toBe('b');
    expect(ids[1]).toBe('a');
    expect(ids[2]).toBe('c');
  });

  it('prunes removed items from order (items no longer in source)', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(['c', 'b', 'a']));

    // 'c' was removed from server data
    const items = makeItems('a', 'b');
    const { result } = renderHook(() =>
      useSortableList({
        items,
        getId,
        storageKey: STORAGE_KEY,
      }),
    );

    const ids = result.current.orderedItems.map((i) => i.id);
    expect(ids).toHaveLength(2);
    expect(ids).toEqual(['b', 'a']);
  });

  it('persists order to localStorage on drag end', () => {
    const items = makeItems('a', 'b', 'c');
    const { result } = renderHook(() =>
      useSortableList({
        items,
        getId,
        storageKey: STORAGE_KEY,
      }),
    );

    // Simulate drag: move 'c' to first position (before 'a')
    act(() => {
      result.current.handleDragEnd({
        active: { id: 'c' },
        over: { id: 'a' },
      } as any);
    });

    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
    expect(stored).toEqual(['c', 'a', 'b']);
  });

  it('does not reorder when disabled', () => {
    const items = makeItems('a', 'b', 'c');
    const { result } = renderHook(() =>
      useSortableList({
        items,
        getId,
        storageKey: STORAGE_KEY,
        disabled: true,
      }),
    );

    act(() => {
      result.current.handleDragEnd({
        active: { id: 'c' },
        over: { id: 'a' },
      } as any);
    });

    // Order should remain unchanged
    expect(result.current.orderedItems.map((i) => i.id)).toEqual(['a', 'b', 'c']);
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('returns isDragDisabled matching the disabled prop', () => {
    const items = makeItems('a');
    const { result, rerender } = renderHook(
      ({ disabled }) =>
        useSortableList({
          items,
          getId,
          storageKey: STORAGE_KEY,
          disabled,
        }),
      { initialProps: { disabled: false } },
    );

    expect(result.current.isDragDisabled).toBe(false);

    rerender({ disabled: true });
    expect(result.current.isDragDisabled).toBe(true);
  });

  it('returns empty array when items is empty', () => {
    const { result } = renderHook(() =>
      useSortableList({
        items: [] as TestItem[],
        getId,
        storageKey: STORAGE_KEY,
      }),
    );

    expect(result.current.orderedItems).toEqual([]);
  });

  it('ignores drag when active === over', () => {
    const items = makeItems('a', 'b');
    const { result } = renderHook(() =>
      useSortableList({
        items,
        getId,
        storageKey: STORAGE_KEY,
      }),
    );

    act(() => {
      result.current.handleDragEnd({
        active: { id: 'a' },
        over: { id: 'a' },
      } as any);
    });

    // Should remain unchanged, no localStorage write
    expect(result.current.orderedItems.map((i) => i.id)).toEqual(['a', 'b']);
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('ignores drag when over is null', () => {
    const items = makeItems('a', 'b');
    const { result } = renderHook(() =>
      useSortableList({
        items,
        getId,
        storageKey: STORAGE_KEY,
      }),
    );

    act(() => {
      result.current.handleDragEnd({
        active: { id: 'a' },
        over: null,
      } as any);
    });

    expect(result.current.orderedItems.map((i) => i.id)).toEqual(['a', 'b']);
  });
});
