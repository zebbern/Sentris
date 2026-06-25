import { useRef, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Workflow, ZoomIn, ZoomOut } from 'lucide-react';
import { WorkflowPreview } from '@/features/templates/WorkflowPreview';
import { cn } from '@/lib/utils';
import { getCategoryStyle, hasGraphNodes } from './types';

export function PreviewSection({
  graph,
  category,
  onPreviewClick,
}: {
  graph?: Record<string, unknown>;
  category?: string | null;
  onPreviewClick?: () => void;
}) {
  const [zoom, setZoom] = useState(1);
  const [origin, setOrigin] = useState({ x: 50, y: 50 });
  const containerRef = useRef<HTMLDivElement>(null);
  const hasGraph = hasGraphNodes(graph);
  const catStyle = getCategoryStyle(category);
  const CategoryIcon = catStyle.icon;

  const updateOrigin = (e: React.MouseEvent) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    setOrigin({
      x: ((e.clientX - rect.left) / rect.width) * 100,
      y: ((e.clientY - rect.top) / rect.height) * 100,
    });
  };

  const handleWheel = (e: React.WheelEvent) => {
    e.stopPropagation();
    updateOrigin(e);
    const delta = e.deltaY > 0 ? -0.15 : 0.15;
    setZoom((z) => Math.min(Math.max(z + delta, 0.75), 2.5));
  };

  const handleZoomIn = (e: React.MouseEvent) => {
    e.stopPropagation();
    setZoom((z) => Math.min(z + 0.25, 2.5));
  };

  const handleZoomOut = (e: React.MouseEvent) => {
    e.stopPropagation();
    setZoom((z) => Math.max(z - 0.25, 0.75));
  };

  const handleDoubleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setZoom(1);
    setOrigin({ x: 50, y: 50 });
  };

  const handlePreviewClick = (e: React.MouseEvent) => {
    if (zoom !== 1) return;
    e.stopPropagation();
    onPreviewClick?.();
  };

  return (
    <div
      ref={containerRef}
      className={cn(
        'relative h-48 w-full overflow-hidden rounded-xl ring-1 ring-border/50',
        hasGraph && zoom === 1 && 'cursor-pointer',
        hasGraph && zoom > 1 && 'cursor-zoom-out',
      )}
      style={{
        background: 'linear-gradient(180deg, hsl(var(--muted) / 0.5) 0%, hsl(var(--muted)) 100%)',
      }}
      onClick={hasGraph && zoom === 1 ? handlePreviewClick : undefined}
      onWheel={hasGraph ? handleWheel : undefined}
      onMouseMove={hasGraph ? updateOrigin : undefined}
      onDoubleClick={hasGraph ? handleDoubleClick : undefined}
    >
      <div
        className="absolute inset-0 hidden dark:block"
        style={{
          background: 'linear-gradient(180deg, hsl(var(--muted)) 0%, hsl(var(--background)) 100%)',
        }}
      />
      <div
        className="absolute inset-0 hidden dark:block pointer-events-none"
        style={{
          background:
            'radial-gradient(circle at 50% 0%, hsl(var(--primary) / 0.08), transparent 60%)',
        }}
      />

      <div
        className="absolute inset-0 opacity-[0.03] pointer-events-none"
        style={{
          backgroundImage:
            'radial-gradient(circle, hsl(var(--foreground)) 0.5px, transparent 0.5px)',
          backgroundSize: '12px 12px',
        }}
      />

      <Badge
        variant="outline"
        className={cn(
          'absolute top-2 left-2 z-10 gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-medium pointer-events-none',
          catStyle.badge,
        )}
      >
        <CategoryIcon className="h-3 w-3" />
        {category || 'Automation'}
      </Badge>

      {hasGraph ? (
        <>
          <div
            className="absolute inset-0 flex items-center justify-center p-2 transition-transform duration-300 ease-out group-hover:scale-[1.02]"
            style={{
              transform: `scale(${zoom})`,
              transformOrigin: `${origin.x}% ${origin.y}%`,
            }}
          >
            <WorkflowPreview graph={graph} className="w-full h-full" />
          </div>

          {zoom === 1 && (
            <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex items-center gap-1 px-2 py-0.5 rounded-full bg-foreground/5 backdrop-blur-sm text-[10px] font-medium text-muted-foreground/70 opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none">
              Click to preview
            </div>
          )}

          <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
            <button
              type="button"
              onClick={handleZoomOut}
              className="p-1 rounded-md bg-background/80 backdrop-blur-sm border border-border/50 text-muted-foreground hover:text-foreground hover:bg-background transition-colors"
              title="Zoom out"
            >
              <ZoomOut className="h-3 w-3" />
            </button>
            <button
              type="button"
              onClick={handleZoomIn}
              className="p-1 rounded-md bg-background/80 backdrop-blur-sm border border-border/50 text-muted-foreground hover:text-foreground hover:bg-background transition-colors"
              title="Zoom in"
            >
              <ZoomIn className="h-3 w-3" />
            </button>
          </div>

          {zoom !== 1 && (
            <div className="absolute bottom-1.5 left-1.5 px-1.5 py-0.5 rounded bg-background/70 backdrop-blur-sm text-[9px] font-medium text-muted-foreground border border-border/30">
              {Math.round(zoom * 100)}%
            </div>
          )}
        </>
      ) : (
        <div
          className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 text-muted-foreground/30 cursor-pointer"
          onClick={(e) => {
            e.stopPropagation();
            onPreviewClick?.();
          }}
        >
          <Workflow className="h-8 w-8" />
          <span className="text-[10px] font-medium">No preview</span>
        </div>
      )}
    </div>
  );
}
