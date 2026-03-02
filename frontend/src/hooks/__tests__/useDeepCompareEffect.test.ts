import { describe, it, expect, afterEach, mock } from 'bun:test';
import { renderHook, cleanup } from '@testing-library/react';
import { useDeepCompareEffect } from '../useDeepCompareEffect';

afterEach(cleanup);

describe('useDeepCompareEffect', () => {
  it('runs effect on mount', () => {
    const effect = mock();
    renderHook(() => useDeepCompareEffect(effect, [{ a: 1 }]));

    expect(effect).toHaveBeenCalledTimes(1);
  });

  it('does NOT re-run when object reference changes but value is the same', () => {
    const effect = mock();
    const { rerender } = renderHook(({ deps }) => useDeepCompareEffect(effect, deps), {
      initialProps: { deps: [{ a: 1 }] as unknown[] },
    });

    expect(effect).toHaveBeenCalledTimes(1);

    // New object reference, same value
    rerender({ deps: [{ a: 1 }] });

    expect(effect).toHaveBeenCalledTimes(1);
  });

  it('re-runs when nested value changes', () => {
    const effect = mock();
    const { rerender } = renderHook(({ deps }) => useDeepCompareEffect(effect, deps), {
      initialProps: { deps: [{ a: 1 }] as unknown[] },
    });

    expect(effect).toHaveBeenCalledTimes(1);

    rerender({ deps: [{ a: 2 }] });

    expect(effect).toHaveBeenCalledTimes(2);
  });

  it('calls cleanup function when effect re-runs', () => {
    const cleanupFn = mock();
    const effect = mock().mockReturnValue(cleanupFn);

    const { rerender } = renderHook(({ deps }) => useDeepCompareEffect(effect, deps), {
      initialProps: { deps: [{ x: 'hello' }] as unknown[] },
    });

    expect(effect).toHaveBeenCalledTimes(1);
    expect(cleanupFn).not.toHaveBeenCalled();

    rerender({ deps: [{ x: 'world' }] });

    expect(effect).toHaveBeenCalledTimes(2);
    expect(cleanupFn).toHaveBeenCalledTimes(1);
  });

  it('handles arrays in dependencies', () => {
    const effect = mock();
    const { rerender } = renderHook(({ deps }) => useDeepCompareEffect(effect, deps), {
      initialProps: { deps: [[1, 2, 3]] as unknown[] },
    });

    expect(effect).toHaveBeenCalledTimes(1);

    // Same values, new reference
    rerender({ deps: [[1, 2, 3]] });
    expect(effect).toHaveBeenCalledTimes(1);

    // Different values
    rerender({ deps: [[1, 2, 4]] });
    expect(effect).toHaveBeenCalledTimes(2);
  });

  it('handles primitive dependencies', () => {
    const effect = mock();
    const { rerender } = renderHook(({ deps }) => useDeepCompareEffect(effect, deps), {
      initialProps: { deps: [42, 'hello'] as unknown[] },
    });

    expect(effect).toHaveBeenCalledTimes(1);

    // Same primitives
    rerender({ deps: [42, 'hello'] });
    expect(effect).toHaveBeenCalledTimes(1);

    // Changed primitive
    rerender({ deps: [42, 'world'] });
    expect(effect).toHaveBeenCalledTimes(2);
  });
});
