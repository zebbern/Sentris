import { describe, it, expect, afterEach } from 'bun:test';
import { renderHook, cleanup } from '@testing-library/react';
import { useCustomScrollbar } from '../useCustomScrollbar';

afterEach(cleanup);

describe('useCustomScrollbar', () => {
  it('returns a ref and initial state', () => {
    const { result } = renderHook(() => useCustomScrollbar(0, false));

    expect(result.current.scrollContainerRef).toBeDefined();
    expect(result.current.scrollbarVisible).toBe(false);
    expect(result.current.scrollbarPosition).toBe(0);
    expect(result.current.scrollbarHeight).toBe(0);
  });

  it('handles null ref gracefully (no container attached)', () => {
    const { result } = renderHook(() => useCustomScrollbar(5, false));

    // Should not throw; scrollbar stays hidden
    expect(result.current.scrollbarVisible).toBe(false);
    expect(result.current.scrollbarPosition).toBe(0);
    expect(result.current.scrollbarHeight).toBe(0);
  });

  it('re-renders without error when contentDependency changes', () => {
    const { result, rerender } = renderHook(
      ({ count, loading }) => useCustomScrollbar(count, loading),
      { initialProps: { count: 0, loading: true } },
    );

    expect(result.current.scrollbarVisible).toBe(false);

    // Simulate content loaded
    rerender({ count: 10, loading: false });

    // Without a real DOM container the scrollbar stays hidden
    expect(result.current.scrollbarVisible).toBe(false);
  });

  it('cleans up on unmount without errors', () => {
    const { unmount } = renderHook(() => useCustomScrollbar(5, false));

    // Should not throw
    unmount();
  });

  it('returns consistent ref across re-renders', () => {
    const { result, rerender } = renderHook(({ count }) => useCustomScrollbar(count, false), {
      initialProps: { count: 0 },
    });

    const firstRef = result.current.scrollContainerRef;

    rerender({ count: 5 });

    expect(result.current.scrollContainerRef).toBe(firstRef);
  });
});
