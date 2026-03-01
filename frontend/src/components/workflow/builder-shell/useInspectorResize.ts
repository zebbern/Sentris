import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';

interface UseInspectorResizeOptions {
  mode: 'design' | 'execution';
  isMobile: boolean;
  setInspectorWidth: (width: number) => void;
  layoutRef: RefObject<HTMLDivElement | null>;
}

export function useInspectorResize({
  mode,
  isMobile,
  setInspectorWidth,
  layoutRef,
}: UseInspectorResizeOptions) {
  const inspectorResizingRef = useRef(false);
  const [isInspectorResizing, setIsInspectorResizing] = useState(false);

  const handleInspectorResizeStart = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      // Disable resizing on mobile - use full width instead
      if (mode !== 'execution' || isMobile) {
        return;
      }
      inspectorResizingRef.current = true;
      setIsInspectorResizing(true);
      document.body.classList.add('select-none');
      event.preventDefault();
    },
    [mode, isMobile],
  );

  useEffect(() => {
    const handleMouseMove = (event: MouseEvent) => {
      if (!inspectorResizingRef.current || mode !== 'execution') {
        return;
      }
      const container = layoutRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const newWidth = rect.right - event.clientX;
      setInspectorWidth(newWidth);
    };

    const stopResizing = () => {
      if (inspectorResizingRef.current) {
        inspectorResizingRef.current = false;
        setIsInspectorResizing(false);
        document.body.classList.remove('select-none');
      }
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', stopResizing);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', stopResizing);
    };
  }, [mode, setInspectorWidth, layoutRef]);

  return { isInspectorResizing, handleInspectorResizeStart };
}
