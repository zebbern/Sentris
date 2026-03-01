import { useEffect, useRef } from 'react';

interface UseSwipeGestureOptions {
  /** Whether to enable swipe gesture detection */
  enabled: boolean;
  /** Whether the target panel is currently open */
  isOpen: boolean;
  /** Callback when swipe opens the panel */
  onOpen: () => void;
  /** Callback when swipe closes the panel */
  onClose: () => void;
  /** Edge zone width in px (swipe-to-open only activates when touch starts within this zone) */
  edgeZone?: number;
  /** Minimum swipe distance in px to trigger open/close */
  threshold?: number;
}

/**
 * Detects horizontal swipe gestures on the window for opening/closing
 * a side panel (e.g. sidebar on mobile).
 *
 * - Swipe right from left edge → open
 * - Swipe left anywhere → close
 */
export function useSwipeGesture({
  enabled,
  isOpen,
  onOpen,
  onClose,
  edgeZone = 30,
  threshold = 50,
}: UseSwipeGestureOptions): void {
  const touchStartRef = useRef<number | null>(null);

  useEffect(() => {
    if (!enabled) return;

    const handleTouchStart = (e: TouchEvent) => {
      const x = e.touches[0].clientX;
      // Start tracking if touching near the left edge to open
      if (!isOpen && x < edgeZone) {
        touchStartRef.current = x;
      }
      // Or if panel is already open, track anywhere to detect closing swipe
      else if (isOpen) {
        touchStartRef.current = x;
      }
    };

    const handleTouchMove = (_e: TouchEvent) => {
      // Placeholder — could be used for visual drag feedback in the future
    };

    const handleTouchEnd = (e: TouchEvent) => {
      if (touchStartRef.current === null) return;

      const endX = e.changedTouches[0].clientX;
      const diff = endX - touchStartRef.current;

      // Swipe right to open
      if (!isOpen && diff > threshold && touchStartRef.current < edgeZone) {
        onOpen();
      }
      // Swipe left to close
      else if (isOpen && diff < -threshold) {
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
}
