import { useEffect, useRef, useState } from 'react';

export interface CustomScrollbarState {
  scrollContainerRef: React.RefObject<HTMLDivElement | null>;
  scrollbarVisible: boolean;
  scrollbarPosition: number;
  scrollbarHeight: number;
}

/**
 * Manages a custom overlay scrollbar that appears only during active scrolling.
 *
 * @param contentDependency - A stable value (e.g. item count) that triggers
 *   a recalculation of thumb size/position when content changes.
 * @param isLoading - Whether the container content is still loading.
 */
export function useCustomScrollbar(
  contentDependency: number,
  isLoading: boolean,
): CustomScrollbarState {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [scrollbarVisible, setScrollbarVisible] = useState(false);
  const [scrollbarPosition, setScrollbarPosition] = useState(0);
  const [scrollbarHeight, setScrollbarHeight] = useState(0);
  const scrollTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isScrollingRef = useRef(false);

  // Setup event listeners (only once)
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const updateScrollbar = (showImmediately = false) => {
      const { scrollTop, scrollHeight, clientHeight } = container;
      const maxScroll = scrollHeight - clientHeight;

      if (maxScroll <= 0) {
        setScrollbarVisible(false);
        return;
      }

      // Calculate scrollbar thumb position and height
      const thumbHeight = Math.max((clientHeight / scrollHeight) * clientHeight, 30);
      const thumbPosition = (scrollTop / maxScroll) * (clientHeight - thumbHeight);

      setScrollbarHeight(thumbHeight);
      setScrollbarPosition(thumbPosition);

      // Only show scrollbar when actively scrolling or explicitly requested
      if (showImmediately || isScrollingRef.current) {
        setScrollbarVisible(true);
      }

      // Clear existing timeout
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current);
      }

      // Hide scrollbar after scrolling stops
      scrollTimeoutRef.current = setTimeout(() => {
        isScrollingRef.current = false;
        setScrollbarVisible(false);
      }, 800);
    };

    const handleScroll = () => {
      isScrollingRef.current = true;
      updateScrollbar(true);
    };

    const handleResize = () => {
      updateScrollbar(false);
    };

    container.addEventListener('scroll', handleScroll, { passive: true });
    window.addEventListener('resize', handleResize);

    // Initial check - don't show scrollbar on mount
    updateScrollbar(false);

    return () => {
      container.removeEventListener('scroll', handleScroll);
      window.removeEventListener('resize', handleResize);
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current);
      }
    };
    // Only setup event listeners once - don't depend on content changes
  }, []);

  // Update scrollbar when content changes (without re-setting up listeners)
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    // Use requestAnimationFrame to ensure DOM has updated after content changes
    requestAnimationFrame(() => {
      const { scrollTop, scrollHeight, clientHeight } = container;
      const maxScroll = scrollHeight - clientHeight;

      if (maxScroll <= 0) {
        setScrollbarVisible(false);
        setScrollbarHeight(0);
        setScrollbarPosition(0);
        return;
      }

      // Calculate scrollbar thumb position and height
      const thumbHeight = Math.max((clientHeight / scrollHeight) * clientHeight, 30);
      const thumbPosition = (scrollTop / maxScroll) * (clientHeight - thumbHeight);

      setScrollbarHeight(thumbHeight);
      setScrollbarPosition(thumbPosition);
      // Don't show scrollbar automatically when content changes - only on scroll
    });
  }, [contentDependency, isLoading]);

  return {
    scrollContainerRef,
    scrollbarVisible,
    scrollbarPosition,
    scrollbarHeight,
  };
}
