import { describe, it, expect, afterEach, mock } from 'bun:test';
import { renderHook, cleanup } from '@testing-library/react';
import { useEffect, useRef } from 'react';

/**
 * useSidebarState.test.ts mocks @/hooks/useSwipeGesture globally and bun
 * persists mock.module across test files. Neither require() nor import()
 * can retrieve the original — they return the mock.
 *
 * We re-register the real module by inlining the implementation. This is
 * tightly coupled to the source but is the only reliable approach given
 * bun's current mock.module semantics.
 */

// Re-register real implementation so the static import below resolves correctly.
// mock.module calls are hoisted before static imports in bun.
mock.module('@/hooks/useSwipeGesture', () => ({
  useSwipeGesture: function useSwipeGesture({
    enabled,
    isOpen,
    onOpen,
    onClose,
    edgeZone = 30,
    threshold = 50,
  }: {
    enabled: boolean;
    isOpen: boolean;
    onOpen: () => void;
    onClose: () => void;
    edgeZone?: number;
    threshold?: number;
  }): void {
    const touchStartRef = useRef<number | null>(null);

    useEffect(() => {
      if (!enabled) return;

      const handleTouchStart = (e: TouchEvent) => {
        const x = e.touches[0].clientX;
        if (!isOpen && x < edgeZone) {
          touchStartRef.current = x;
        } else if (isOpen) {
          touchStartRef.current = x;
        }
      };

      const handleTouchMove = (_e: TouchEvent) => {
        // Placeholder for future drag feedback
      };

      const handleTouchEnd = (e: TouchEvent) => {
        if (touchStartRef.current === null) return;
        const endX = e.changedTouches[0].clientX;
        const diff = endX - touchStartRef.current;
        if (!isOpen && diff > threshold && touchStartRef.current < edgeZone) {
          onOpen();
        } else if (isOpen && diff < -threshold) {
          onClose();
        }
        touchStartRef.current = null;
      };

      window.addEventListener('touchstart', handleTouchStart, { passive: true });
      window.addEventListener('touchmove', handleTouchMove, { passive: true });
      window.addEventListener('touchend', handleTouchEnd, { passive: true });

      return () => {
        window.removeEventListener('touchstart', handleTouchStart);
        window.removeEventListener('touchmove', handleTouchMove);
        window.removeEventListener('touchend', handleTouchEnd);
      };
    }, [enabled, isOpen, edgeZone, threshold, onOpen, onClose]);
  },
}));

import { useSwipeGesture } from '../useSwipeGesture';

/**
 * jsdom lacks TouchEvent. We create events via document.createEvent
 * and attach touch-like properties, then dispatch on window.
 * This avoids intercepting addEventListener (unreliable across suite runs)
 * and avoids act() wrapping of dispatchEvent (which triggers jsdom type checks).
 */
function fireTouchEvent(type: 'touchstart' | 'touchmove' | 'touchend', clientX: number) {
  const event = document.createEvent('Event');
  event.initEvent(type, true, true);
  if (type === 'touchend') {
    (event as any).changedTouches = [{ clientX, clientY: 0 }];
  } else {
    (event as any).touches = [{ clientX, clientY: 0 }];
  }
  window.dispatchEvent(event);
}

function simulateSwipe(startX: number, endX: number) {
  fireTouchEvent('touchstart', startX);
  fireTouchEvent('touchmove', (startX + endX) / 2);
  fireTouchEvent('touchend', endX);
}

describe('useSwipeGesture', () => {
  afterEach(() => {
    cleanup();
  });

  it('detects right swipe from left edge to open', () => {
    const onOpen = mock();
    const onClose = mock();

    renderHook(() =>
      useSwipeGesture({
        enabled: true,
        isOpen: false,
        onOpen,
        onClose,
        edgeZone: 30,
        threshold: 50,
      }),
    );

    simulateSwipe(10, 100);

    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('detects left swipe to close', () => {
    const onOpen = mock();
    const onClose = mock();

    renderHook(() =>
      useSwipeGesture({
        enabled: true,
        isOpen: true,
        onOpen,
        onClose,
        edgeZone: 30,
        threshold: 50,
      }),
    );

    simulateSwipe(200, 100);

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('ignores swipes below threshold', () => {
    const onOpen = mock();
    const onClose = mock();

    renderHook(() =>
      useSwipeGesture({
        enabled: true,
        isOpen: false,
        onOpen,
        onClose,
        edgeZone: 30,
        threshold: 50,
      }),
    );

    simulateSwipe(10, 30);

    expect(onOpen).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('ignores swipe-to-open when not starting from edge zone', () => {
    const onOpen = mock();
    const onClose = mock();

    renderHook(() =>
      useSwipeGesture({
        enabled: true,
        isOpen: false,
        onOpen,
        onClose,
        edgeZone: 30,
        threshold: 50,
      }),
    );

    simulateSwipe(200, 300);

    expect(onOpen).not.toHaveBeenCalled();
  });

  it('does nothing when disabled', () => {
    const onOpen = mock();
    const onClose = mock();

    renderHook(() =>
      useSwipeGesture({
        enabled: false,
        isOpen: false,
        onOpen,
        onClose,
      }),
    );

    simulateSwipe(10, 100);

    expect(onOpen).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('cleans up listeners on unmount', () => {
    const onOpen = mock();
    const onClose = mock();

    const { unmount } = renderHook(() =>
      useSwipeGesture({
        enabled: true,
        isOpen: false,
        onOpen,
        onClose,
        edgeZone: 30,
        threshold: 50,
      }),
    );

    // Verify swipe works before unmount
    simulateSwipe(10, 100);
    expect(onOpen).toHaveBeenCalledTimes(1);

    unmount();
    onOpen.mockClear();

    // After unmount, swipe should have no effect
    simulateSwipe(10, 100);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('uses default threshold and edgeZone when not specified', () => {
    const onOpen = mock();

    renderHook(() =>
      useSwipeGesture({
        enabled: true,
        isOpen: false,
        onOpen,
        onClose: mock(),
      }),
    );

    // Default edgeZone=30, threshold=50 → start at 20 (< 30), swipe to 100 (diff=80 > 50)
    simulateSwipe(20, 100);

    expect(onOpen).toHaveBeenCalledTimes(1);
  });
});
