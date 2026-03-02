import { describe, it, expect, mock, beforeEach, afterEach } from 'bun:test';
import { cleanup } from '@testing-library/react';

// ---------------------------------------------------------------------------
// Mutable mock state
// ---------------------------------------------------------------------------

let mockIsOpen = false;
const mockToggle = mock(() => {});
const mockClose = mock(() => {});

// ---------------------------------------------------------------------------
// Module mocks (BEFORE import)
// ---------------------------------------------------------------------------

mock.module('@/store/commandPaletteStore', () => ({
  useCommandPaletteStore: (selector: (s: any) => any) => {
    const state = {
      isOpen: mockIsOpen,
      toggle: mockToggle,
      close: mockClose,
    };
    return selector(state);
  },
}));

import { useCommandPaletteKeyboard } from '../useCommandPaletteKeyboard';

// We need renderHook to test the effect
import { renderHook } from '@testing-library/react';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fireKeyDown(key: string, opts: Partial<KeyboardEventInit> = {}) {
  const event = new KeyboardEvent('keydown', {
    key,
    bubbles: true,
    cancelable: true,
    ...opts,
  });
  document.dispatchEvent(event);
  return event;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  mockIsOpen = false;
  mockToggle.mockClear();
  mockClose.mockClear();
});

afterEach(() => {
  cleanup();
});

describe('useCommandPaletteKeyboard', () => {
  it('calls toggle on Ctrl+K', () => {
    renderHook(() => useCommandPaletteKeyboard());

    fireKeyDown('k', { ctrlKey: true });

    expect(mockToggle).toHaveBeenCalledTimes(1);
  });

  it('calls toggle on Meta+K (Cmd+K on macOS)', () => {
    renderHook(() => useCommandPaletteKeyboard());

    fireKeyDown('k', { metaKey: true });

    expect(mockToggle).toHaveBeenCalledTimes(1);
  });

  it('does not toggle on plain K key press', () => {
    renderHook(() => useCommandPaletteKeyboard());

    fireKeyDown('k');

    expect(mockToggle).not.toHaveBeenCalled();
  });

  it('calls close on Escape when palette is open', () => {
    mockIsOpen = true;
    renderHook(() => useCommandPaletteKeyboard());

    fireKeyDown('Escape');

    expect(mockClose).toHaveBeenCalledTimes(1);
  });

  it('does not call close on Escape when palette is closed', () => {
    mockIsOpen = false;
    renderHook(() => useCommandPaletteKeyboard());

    fireKeyDown('Escape');

    expect(mockClose).not.toHaveBeenCalled();
  });

  it('cleans up event listener on unmount', () => {
    const { unmount } = renderHook(() => useCommandPaletteKeyboard());

    unmount();

    // After unmount, Ctrl+K should not trigger toggle
    mockToggle.mockClear();
    fireKeyDown('k', { ctrlKey: true });
    expect(mockToggle).not.toHaveBeenCalled();
  });
});
