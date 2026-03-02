import { describe, it, expect, afterEach, beforeEach, mock } from 'bun:test';
import { renderHook, act, cleanup } from '@testing-library/react';

// Mock the toast hook and logger before importing the hook under test
mock.module('@/components/ui/use-toast', () => ({
  useToast: () => ({ toast: mock() }),
}));
mock.module('@/lib/logger', () => ({
  logger: { error: mock(), warn: mock(), info: mock(), debug: mock() },
}));

import { useCopyToClipboard } from '../useCopyToClipboard';

afterEach(cleanup);

describe('useCopyToClipboard', () => {
  let writeTextMock: ReturnType<typeof mock>;

  beforeEach(() => {
    writeTextMock = mock().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: { writeText: writeTextMock },
    });
  });

  it('returns copy, copiedText, and isCopied', () => {
    const { result } = renderHook(() => useCopyToClipboard());

    expect(typeof result.current.copy).toBe('function');
    expect(result.current.copiedText).toBeNull();
    expect(typeof result.current.isCopied).toBe('function');
  });

  it('copies text to clipboard and sets copiedText', async () => {
    const { result } = renderHook(() => useCopyToClipboard());

    let success: boolean | undefined;
    await act(async () => {
      success = await result.current.copy('hello');
    });

    expect(success).toBe(true);
    expect(writeTextMock).toHaveBeenCalledWith('hello');
    expect(result.current.copiedText).toBe('hello');
  });

  it('isCopied returns true for the copied text', async () => {
    const { result } = renderHook(() => useCopyToClipboard());

    await act(async () => {
      await result.current.copy('test');
    });

    expect(result.current.isCopied('test')).toBe(true);
    expect(result.current.isCopied('other')).toBe(false);
  });

  it('returns false when clipboard API fails', async () => {
    writeTextMock = mock().mockRejectedValue(new Error('denied'));
    Object.assign(navigator, {
      clipboard: { writeText: writeTextMock },
    });

    const { result } = renderHook(() => useCopyToClipboard());

    let success: boolean | undefined;
    await act(async () => {
      success = await result.current.copy('fail');
    });

    expect(success).toBe(false);
    expect(result.current.copiedText).toBeNull();
  });

  it('resets copiedText after 2 seconds', async () => {
    const { result } = renderHook(() => useCopyToClipboard());

    await act(async () => {
      await result.current.copy('temp');
    });

    expect(result.current.copiedText).toBe('temp');

    // Wait for the 2-second timeout
    await act(async () => {
      await new Promise((r) => setTimeout(r, 2100));
    });

    expect(result.current.copiedText).toBeNull();
  });
});
