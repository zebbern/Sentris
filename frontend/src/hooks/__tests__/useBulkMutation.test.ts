import { describe, it, expect, mock, beforeEach } from 'bun:test';
import { renderHook, act, cleanup } from '@testing-library/react';
import { useBulkMutation } from '../useBulkMutation';

/** Reusable option factory with mock functions. */
function createOptions(overrides: Partial<Parameters<typeof useBulkMutation>[0]> = {}) {
  return {
    mutateAsync: overrides.mutateAsync ?? mock().mockResolvedValue(undefined),
    clearSelection: overrides.clearSelection ?? mock(),
    toast: overrides.toast ?? mock(),
    messages: overrides.messages ?? {
      successTitle: (n: number) => `Deleted ${n}`,
      successDescription: (n: number) => `${n} removed`,
      partialDescription: (s: number, t: number, f: number) => `Deleted ${s} of ${t} (${f} failed)`,
    },
  };
}

describe('useBulkMutation', () => {
  beforeEach(() => {
    cleanup();
  });

  it('returns a stable function reference across re-renders', () => {
    const options = createOptions();
    const { result, rerender } = renderHook(() => useBulkMutation(options));
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
  });

  it('does nothing for an empty ids array', async () => {
    const options = createOptions();
    const { result } = renderHook(() => useBulkMutation(options));

    await act(async () => {
      await result.current([]);
    });

    expect(options.mutateAsync).not.toHaveBeenCalled();
    expect(options.clearSelection).not.toHaveBeenCalled();
    expect(options.toast).not.toHaveBeenCalled();
  });

  it('calls mutateAsync once per id', async () => {
    const options = createOptions();
    const { result } = renderHook(() => useBulkMutation(options));

    await act(async () => {
      await result.current(['a', 'b', 'c']);
    });

    expect(options.mutateAsync).toHaveBeenCalledTimes(3);
    expect(options.mutateAsync).toHaveBeenCalledWith('a');
    expect(options.mutateAsync).toHaveBeenCalledWith('b');
    expect(options.mutateAsync).toHaveBeenCalledWith('c');
  });

  it('clears selection after operations complete', async () => {
    const options = createOptions();
    const { result } = renderHook(() => useBulkMutation(options));

    await act(async () => {
      await result.current(['x']);
    });

    expect(options.clearSelection).toHaveBeenCalledTimes(1);
  });

  it('shows success toast when all operations succeed', async () => {
    const options = createOptions();
    const { result } = renderHook(() => useBulkMutation(options));

    await act(async () => {
      await result.current(['a', 'b']);
    });

    expect(options.toast).toHaveBeenCalledTimes(1);
    expect(options.toast).toHaveBeenCalledWith({
      title: 'Deleted 2',
      description: '2 removed',
    });
  });

  it('shows partial failure toast when some operations fail', async () => {
    const mutateAsync = mock()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('fail'))
      .mockResolvedValueOnce(undefined);

    const options = createOptions({ mutateAsync });
    const { result } = renderHook(() => useBulkMutation(options));

    await act(async () => {
      await result.current(['a', 'b', 'c']);
    });

    expect(options.toast).toHaveBeenCalledTimes(1);
    expect(options.toast).toHaveBeenCalledWith({
      title: 'Partial failure',
      description: 'Deleted 2 of 3 (1 failed)',
      variant: 'destructive',
    });
  });

  it('shows destructive toast when all operations fail', async () => {
    const mutateAsync = mock().mockRejectedValue(new Error('boom'));
    const options = createOptions({ mutateAsync });
    const { result } = renderHook(() => useBulkMutation(options));

    await act(async () => {
      await result.current(['a', 'b']);
    });

    expect(options.toast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Partial failure',
        variant: 'destructive',
      }),
    );
  });

  it('uses latest options via ref (no stale closure)', async () => {
    const toast1 = mock();
    const toast2 = mock();

    const { result, rerender } = renderHook(
      ({ toast }) =>
        useBulkMutation(
          createOptions({
            toast,
          }),
        ),
      { initialProps: { toast: toast1 } },
    );

    rerender({ toast: toast2 });

    await act(async () => {
      await result.current(['id-1']);
    });

    expect(toast1).not.toHaveBeenCalled();
    expect(toast2).toHaveBeenCalledTimes(1);
  });
});
