import { useRef, useState, useEffect, type RefObject } from 'react';
import { useReactFlow, useUpdateNodeInternals } from 'reactflow';
import { useWorkflowStore } from '@/store/workflowStore';
import type { FrontendNodeData } from '@/schemas/node';
import { TEXT_BLOCK_SIZES } from '../constants';

const { MIN_WIDTH, MAX_WIDTH, MIN_HEIGHT, MAX_HEIGHT, DEFAULT_WIDTH, DEFAULT_HEIGHT } =
  TEXT_BLOCK_SIZES;

interface UseNodeResizeOptions {
  id: string;
  nodeData: FrontendNodeData;
  isTextBlock: boolean;
  nodeRef: RefObject<HTMLDivElement | null>;
}

/**
 * Manages text-block node resizing: size state, clamping, drag handlers, and persistence.
 */
export function useNodeResize({ id, nodeData, isTextBlock, nodeRef }: UseNodeResizeOptions) {
  const { setNodes } = useReactFlow();
  const updateNodeInternals = useUpdateNodeInternals();
  const markDirty = useWorkflowStore((s) => s.markDirty);

  const [textSize, setTextSize] = useState<{ width: number; height: number }>(() => {
    const uiSize = nodeData.ui?.size;
    return {
      width: uiSize?.width ?? DEFAULT_WIDTH,
      height: uiSize?.height ?? DEFAULT_HEIGHT,
    };
  });

  const isResizing = useRef(false);

  const clampWidth = (width: number) => Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, width));
  const clampHeight = (height: number) => Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, height));

  const persistSize = (width: number, height: number) => {
    const clampedWidth = clampWidth(width);
    const clampedHeight = clampHeight(height);
    setTextSize({ width: clampedWidth, height: clampedHeight });
    setNodes((nodes) =>
      nodes.map((node) =>
        node.id === id
          ? {
              ...node,
              data: {
                ...(node.data as FrontendNodeData),
                ui: {
                  ...(node.data as FrontendNodeData).ui,
                  size: { width: clampedWidth, height: clampedHeight },
                },
              },
            }
          : node,
      ),
    );
    updateNodeInternals(id);
    markDirty();
  };

  // Sync text size when external data changes
  useEffect(() => {
    if (!isTextBlock) return;
    const uiSize = nodeData.ui?.size;
    if (!uiSize) return;
    setTextSize((current) => {
      const nextWidth = uiSize.width ?? current.width;
      const nextHeight = uiSize.height ?? current.height;
      const clamped = {
        width: Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, nextWidth)),
        height: Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, nextHeight)),
      };
      if (current.width === clamped.width && current.height === clamped.height) return current;
      return clamped;
    });
  }, [isTextBlock, nodeData]);

  // Update node internals when text block mounts
  useEffect(() => {
    if (isTextBlock) updateNodeInternals(id);
  }, [id, isTextBlock, updateNodeInternals]);

  const handleResizeStart = () => {
    isResizing.current = true;
  };

  const handleResize = (_evt: unknown, params: { width: number; height: number }) => {
    if (nodeRef.current) {
      nodeRef.current.style.width = `${clampWidth(params.width)}px`;
      nodeRef.current.style.minHeight = `${clampHeight(params.height)}px`;
    }
  };

  const handleResizeEnd = (_evt: unknown, params: { width: number; height: number }) => {
    isResizing.current = false;
    persistSize(params.width, params.height);
  };

  return {
    textSize,
    handleResizeStart,
    handleResize,
    handleResizeEnd,
  };
}
