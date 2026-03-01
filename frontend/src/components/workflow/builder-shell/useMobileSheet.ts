import { useCallback, useEffect, useRef, useState } from 'react';

interface UseMobileSheetOptions {
  isMobile: boolean;
  anyMobilePanelVisible: boolean | undefined;
}

export function useMobileSheet({ isMobile, anyMobilePanelVisible }: UseMobileSheetOptions) {
  const [mobileSheetHeight, setMobileSheetHeight] = useState(80);
  const isDraggingSheetRef = useRef(false);
  const dragStartYRef = useRef(0);
  const dragStartHeightRef = useRef(50);
  const [showMobileHint, setShowMobileHint] = useState(true);

  // Reset hint when any panel becomes visible on mobile
  useEffect(() => {
    if (isMobile && anyMobilePanelVisible) {
      setShowMobileHint(true);
    }
  }, [isMobile, anyMobilePanelVisible]);

  // Auto-hide mobile hint after 2 seconds
  useEffect(() => {
    if (isMobile && anyMobilePanelVisible && showMobileHint) {
      const timer = setTimeout(() => {
        setShowMobileHint(false);
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [isMobile, anyMobilePanelVisible, showMobileHint]);

  // Core drag handlers operating on clientY coordinates
  const handleSheetDragStart = useCallback(
    (clientY: number) => {
      isDraggingSheetRef.current = true;
      dragStartYRef.current = clientY;
      dragStartHeightRef.current = mobileSheetHeight;
      document.body.classList.add('select-none');
    },
    [mobileSheetHeight],
  );

  const handleSheetDragMove = useCallback((clientY: number) => {
    if (!isDraggingSheetRef.current) return;

    const availableHeight = window.innerHeight - 56; // subtract topbar height
    const deltaY = dragStartYRef.current - clientY;
    const deltaPercent = (deltaY / availableHeight) * 100;
    const newHeight = Math.min(85, Math.max(5, dragStartHeightRef.current + deltaPercent));
    setMobileSheetHeight(newHeight);
  }, []);

  const handleSheetDragEnd = useCallback(() => {
    if (!isDraggingSheetRef.current) return;
    isDraggingSheetRef.current = false;
    document.body.classList.remove('select-none');

    // Snap to nearest position (5% collapsed, 50% half, or 80% expanded)
    const snapPoints = [5, 50, 80];
    const closest = snapPoints.reduce((prev, curr) =>
      Math.abs(curr - mobileSheetHeight) < Math.abs(prev - mobileSheetHeight) ? curr : prev,
    );
    setMobileSheetHeight(closest);
  }, [mobileSheetHeight]);

  // Touch event adapters
  const handleSheetTouchStart = useCallback(
    (e: React.TouchEvent) => {
      e.stopPropagation();
      const touch = e.touches[0];
      if (touch) handleSheetDragStart(touch.clientY);
    },
    [handleSheetDragStart],
  );

  const handleSheetTouchMove = useCallback(
    (e: React.TouchEvent) => {
      e.stopPropagation();
      const touch = e.touches[0];
      if (touch) handleSheetDragMove(touch.clientY);
    },
    [handleSheetDragMove],
  );

  const handleSheetTouchEnd = useCallback(
    (e: React.TouchEvent) => {
      e.stopPropagation();
      handleSheetDragEnd();
    },
    [handleSheetDragEnd],
  );

  // Mouse event adapter (for testing on desktop)
  const handleSheetMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      handleSheetDragStart(e.clientY);
    },
    [handleSheetDragStart],
  );

  // Global mouse events for sheet dragging (window-level listeners)
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (isDraggingSheetRef.current) {
        handleSheetDragMove(e.clientY);
      }
    };
    const handleMouseUp = () => {
      if (isDraggingSheetRef.current) {
        handleSheetDragEnd();
      }
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [handleSheetDragMove, handleSheetDragEnd]);

  return {
    mobileSheetHeight,
    isDraggingSheetRef,
    showMobileHint,
    handleSheetTouchStart,
    handleSheetTouchMove,
    handleSheetTouchEnd,
    handleSheetMouseDown,
  };
}
