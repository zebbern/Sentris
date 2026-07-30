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
  interactive = false,
  className,
  heightClass = 'h-48',
  showCategoryBadge = true,
}: {
  graph?: Record<string, unknown>;
  category?: string | null;
  onPreviewClick?: () => void;
  /** When true (detail modal), allow zoom / pan. Cards stay static. */
  interactive?: boolean;
  className?: string;
  heightClass?: string;
  showCategoryBadge?: boolean;
}) {
  const [zoom, setZoom] = useState(1);
  const [origin, setOrigin] = useState({ x: 50, y: 50 });
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const lastPointerRef = useRef({ x: 0, y: 0 });
  const containerRef = useRef<HTMLDivElement>(null);
  const hasGraph = hasGraphNodes(graph);
  const catStyle = getCategoryStyle(category);
  const CategoryIcon = catStyle.icon;

  const updateOrigin = (e: React.MouseEvent | React.PointerEvent) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    setOrigin({
      x: ((e.clientX - rect.left) / rect.width) * 100,
      y: ((e.clientY - rect.top) / rect.height) * 100,
    });
  };

  const resetView = () => {
    setZoom(1);
    setOrigin({ x: 50, y: 50 });
    setPan({ x: 0, y: 0 });
  };

  const handleWheel = (e: React.WheelEvent) => {
    if (!interactive || !hasGraph) return;
    e.stopPropagation();
    updateOrigin(e);
    const delta = e.deltaY > 0 ? -0.15 : 0.15;
    setZoom((z) => {
      const next = Math.min(Math.max(z + delta, 0.75), 2.5);
      if (next === 1) setPan({ x: 0, y: 0 });
      return next;
    });
  };

  const handleZoomIn = (e: React.MouseEvent) => {
    e.stopPropagation();
    setZoom((z) => Math.min(z + 0.25, 2.5));
  };

  const handleZoomOut = (e: React.MouseEvent) => {
    e.stopPropagation();
    setZoom((z) => {
      const next = Math.max(z - 0.25, 0.75);
      if (next === 1) setPan({ x: 0, y: 0 });
      return next;
    });
  };

  const handleDoubleClick = (e: React.MouseEvent) => {
    if (!interactive || !hasGraph) return;
    e.stopPropagation();
    resetView();
  };

  const handlePreviewClick = (e: React.MouseEvent) => {
    if (interactive) return;
    e.stopPropagation();
    onPreviewClick?.();
  };

  const handlePointerDown = (e: React.PointerEvent) => {
    if (!interactive || !hasGraph || zoom <= 1) return;
    e.stopPropagation();
    setIsDragging(true);
    lastPointerRef.current = { x: e.clientX, y: e.clientY };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isDragging) return;
    const dx = e.clientX - lastPointerRef.current.x;
    const dy = e.clientY - lastPointerRef.current.y;
    lastPointerRef.current = { x: e.clientX, y: e.clientY };
    setPan((p) => ({ x: p.x + dx, y: p.y + dy }));
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (!isDragging) return;
    setIsDragging(false);
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // ignore if capture already released
    }
  };

  return (
    <div
      ref={containerRef}
      className={cn(
        'relative w-full overflow-hidden',
        heightClass,
        !interactive && hasGraph && 'cursor-pointer',
        interactive && hasGraph && zoom > 1 && 'cursor-grab active:cursor-grabbing',
        className,
      )}
      style={{
        background: 'linear-gradient(180deg, hsl(var(--muted) / 0.5) 0%, hsl(var(--muted)) 100%)',
      }}
      onClick={hasGraph && !interactive ? handlePreviewClick : undefined}
      onWheel={interactive && hasGraph ? handleWheel : undefined}
      onDoubleClick={interactive && hasGraph ? handleDoubleClick : undefined}
      onPointerDown={interactive ? handlePointerDown : undefined}
      onPointerMove={interactive ? handlePointerMove : undefined}
      onPointerUp={interactive ? handlePointerUp : undefined}
      onPointerCancel={interactive ? handlePointerUp : undefined}
    >
      <div
        className="absolute inset-0 hidden dark:block"
        style={{
          background: 'linear-gradient(180deg, hsl(var(--muted)) 0%, hsl(var(--background)) 100%)',
        }}
      />
      <div
        className="pointer-events-none absolute inset-0 hidden dark:block"
        style={{
          background:
            'radial-gradient(circle at 50% 0%, hsl(var(--primary) / 0.08), transparent 60%)',
        }}
      />

      <div
        className="pointer-events-none absolute inset-0 opacity-[0.03]"
        style={{
          backgroundImage:
            'radial-gradient(circle, hsl(var(--foreground)) 0.5px, transparent 0.5px)',
          backgroundSize: '12px 12px',
        }}
      />

      {showCategoryBadge && (
        <Badge
          variant="outline"
          className={cn(
            'pointer-events-none absolute left-2 top-2 z-10 gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-medium',
            catStyle.badge,
          )}
        >
          <CategoryIcon className="h-3 w-3" />
          {category || 'Automation'}
        </Badge>
      )}

      {hasGraph ? (
        <>
          <div
            className="absolute inset-0 flex items-center justify-center p-2"
            style={{
              transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
              transformOrigin: `${origin.x}% ${origin.y}%`,
              transition: isDragging ? undefined : 'transform 200ms ease-out',
            }}
          >
            <WorkflowPreview graph={graph} className="h-full w-full" />
          </div>

          {!interactive && (
            <div className="pointer-events-none absolute bottom-2 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-full bg-foreground/5 px-2 py-0.5 text-[10px] font-medium text-muted-foreground/70 opacity-0 backdrop-blur-sm transition-opacity duration-300 group-hover:opacity-100">
              Click to open
            </div>
          )}

          {interactive && (
            <>
              <div className="absolute right-2 top-2 z-10 flex gap-1">
                <button
                  type="button"
                  onClick={handleZoomOut}
                  className="rounded-md border border-border/50 bg-background/80 p-1 text-muted-foreground backdrop-blur-sm transition-colors hover:bg-background hover:text-foreground"
                  title="Zoom out"
                >
                  <ZoomOut className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={handleZoomIn}
                  className="rounded-md border border-border/50 bg-background/80 p-1 text-muted-foreground backdrop-blur-sm transition-colors hover:bg-background hover:text-foreground"
                  title="Zoom in"
                >
                  <ZoomIn className="h-3.5 w-3.5" />
                </button>
              </div>

              {zoom !== 1 && (
                <div className="absolute bottom-1.5 left-1.5 rounded border border-border/30 bg-background/70 px-1.5 py-0.5 text-[9px] font-medium text-muted-foreground backdrop-blur-sm">
                  {Math.round(zoom * 100)}% · drag to pan
                </div>
              )}
            </>
          )}
        </>
      ) : (
        <div
          className={cn(
            'absolute inset-0 flex flex-col items-center justify-center gap-1.5 text-muted-foreground/30',
            !interactive && 'cursor-pointer',
          )}
          onClick={(e) => {
            if (interactive) return;
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
