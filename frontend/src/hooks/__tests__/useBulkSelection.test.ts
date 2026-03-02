import { describe, it, expect, afterEach } from 'bun:test';
import { renderHook, act, cleanup } from '@testing-library/react';
import { useBulkSelection } from '../useBulkSelection';

afterEach(cleanup);

const items = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];

describe('useBulkSelection', () => {
  it('starts with an empty selection', () => {
    const { result } = renderHook(() => useBulkSelection(items));

    expect(result.current.selectedIds.size).toBe(0);
    expect(result.current.selectedCount).toBe(0);
    expect(result.current.isAllSelected).toBe(false);
    expect(result.current.isIndeterminate).toBe(false);
  });

  it('toggleId adds an item to the selection', () => {
    const { result } = renderHook(() => useBulkSelection(items));

    act(() => result.current.toggleId('a'));

    expect(result.current.selectedIds.has('a')).toBe(true);
    expect(result.current.selectedCount).toBe(1);
  });

  it('toggleId removes an already-selected item', () => {
    const { result } = renderHook(() => useBulkSelection(items));

    act(() => result.current.toggleId('a'));
    act(() => result.current.toggleId('a'));

    expect(result.current.selectedIds.has('a')).toBe(false);
    expect(result.current.selectedCount).toBe(0);
  });

  it('toggleAll selects all items when none are selected', () => {
    const { result } = renderHook(() => useBulkSelection(items));

    act(() => result.current.toggleAll());

    expect(result.current.selectedCount).toBe(3);
    expect(result.current.isAllSelected).toBe(true);
    expect(result.current.isIndeterminate).toBe(false);
  });

  it('toggleAll deselects all items when all are selected', () => {
    const { result } = renderHook(() => useBulkSelection(items));

    act(() => result.current.toggleAll());
    act(() => result.current.toggleAll());

    expect(result.current.selectedCount).toBe(0);
    expect(result.current.isAllSelected).toBe(false);
  });

  it('toggleAll selects all when only some are selected', () => {
    const { result } = renderHook(() => useBulkSelection(items));

    act(() => result.current.toggleId('b'));
    act(() => result.current.toggleAll());

    expect(result.current.selectedCount).toBe(3);
    expect(result.current.isAllSelected).toBe(true);
  });

  it('clearSelection empties the selection', () => {
    const { result } = renderHook(() => useBulkSelection(items));

    act(() => result.current.toggleAll());
    act(() => result.current.clearSelection());

    expect(result.current.selectedCount).toBe(0);
  });

  it('isIndeterminate is true when some but not all items are selected', () => {
    const { result } = renderHook(() => useBulkSelection(items));

    act(() => result.current.toggleId('a'));

    expect(result.current.isIndeterminate).toBe(true);
    expect(result.current.isAllSelected).toBe(false);
  });

  it('prunes stale selections when items change', () => {
    const { result, rerender } = renderHook(({ data }) => useBulkSelection(data), {
      initialProps: { data: items },
    });

    act(() => result.current.toggleAll());
    expect(result.current.selectedCount).toBe(3);

    // Remove item 'b' from the list
    rerender({ data: [{ id: 'a' }, { id: 'c' }] });

    expect(result.current.selectedIds.has('b')).toBe(false);
    expect(result.current.selectedCount).toBe(2);
  });

  it('handles an empty items list', () => {
    const { result } = renderHook(() => useBulkSelection([]));

    act(() => result.current.toggleAll());

    expect(result.current.selectedCount).toBe(0);
    expect(result.current.isAllSelected).toBe(false);
  });
});
