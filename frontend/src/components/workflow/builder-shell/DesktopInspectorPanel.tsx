import { cn } from '@/lib/utils';
import type { DesktopInspectorPanelProps } from './types';

export function DesktopInspectorPanel({
  isInspectorVisible,
  inspectorWidth,
  isInspectorResizing,
  inspectorContent,
  onResizeStart,
}: DesktopInspectorPanelProps) {
  return (
    <aside
      className={cn(
        'border-l bg-background overflow-hidden relative h-full',
        isInspectorVisible ? 'opacity-100' : 'opacity-0 pointer-events-none',
      )}
      style={{
        width: isInspectorVisible ? inspectorWidth : 0,
        transition: isInspectorResizing
          ? 'opacity 200ms ease-in-out'
          : 'width 200ms ease-in-out, opacity 200ms ease-in-out',
      }}
    >
      <div
        className="absolute inset-0"
        style={{
          width: inspectorWidth,
        }}
      >
        {/* Resize handle */}
        <div
          className="absolute top-0 left-0 h-full w-2 cursor-col-resize border-l border-transparent hover:border-primary/40 z-10"
          onMouseDown={onResizeStart}
        />
        <div className="flex h-full min-h-0 overflow-hidden pl-2">{inspectorContent}</div>
      </div>
    </aside>
  );
}
