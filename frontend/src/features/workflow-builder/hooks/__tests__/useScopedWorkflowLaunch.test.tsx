import { describe, expect, it, mock } from 'bun:test';
import { act, renderHook } from '@testing-library/react';
import { useScopedWorkflowLaunch } from '../useScopedWorkflowLaunch';

describe('useScopedWorkflowLaunch', () => {
  it('launches a generic request once when no scope key is provided', async () => {
    const onConsume = mock(() => {});
    const onLaunch = mock(() => Promise.resolve());
    const { rerender } = renderHook(
      ({ ready }) =>
        useScopedWorkflowLaunch({
          requested: true,
          ready,
          requestKey: null,
          onConsume,
          onLaunch,
        }),
      { initialProps: { ready: false } },
    );

    rerender({ ready: true });

    await act(async () => {
      await Promise.resolve();
    });

    expect(onConsume).toHaveBeenCalledTimes(1);
    expect(onLaunch).toHaveBeenCalledTimes(1);

    rerender({ ready: true });
    expect(onConsume).toHaveBeenCalledTimes(1);
    expect(onLaunch).toHaveBeenCalledTimes(1);
  });

  it('waits for the workflow, consumes the request, and launches exactly once', async () => {
    const onConsume = mock(() => {});
    const onLaunch = mock(() => Promise.resolve());
    const { rerender } = renderHook(
      ({ ready }) =>
        useScopedWorkflowLaunch({
          requested: true,
          ready,
          requestKey: 'workflow-1:scope-1',
          onConsume,
          onLaunch,
        }),
      { initialProps: { ready: false } },
    );

    expect(onConsume).not.toHaveBeenCalled();
    expect(onLaunch).not.toHaveBeenCalled();

    await act(async () => {
      rerender({ ready: true });
      await Promise.resolve();
    });

    expect(onConsume).toHaveBeenCalledTimes(1);
    expect(onLaunch).toHaveBeenCalledTimes(1);

    rerender({ ready: true });
    expect(onConsume).toHaveBeenCalledTimes(1);
    expect(onLaunch).toHaveBeenCalledTimes(1);
  });

  it('handles a new target launch after the request key changes', async () => {
    const onConsume = mock(() => {});
    const onLaunch = mock(() => Promise.resolve());
    const { rerender } = renderHook(
      ({ requestKey }) =>
        useScopedWorkflowLaunch({
          requested: true,
          ready: true,
          requestKey,
          onConsume,
          onLaunch,
        }),
      { initialProps: { requestKey: 'workflow-1:scope-1' } },
    );

    await act(async () => {
      await Promise.resolve();
    });

    rerender({ requestKey: 'workflow-1:scope-2' });

    await act(async () => {
      await Promise.resolve();
    });

    expect(onConsume).toHaveBeenCalledTimes(2);
    expect(onLaunch).toHaveBeenCalledTimes(2);
  });
});
