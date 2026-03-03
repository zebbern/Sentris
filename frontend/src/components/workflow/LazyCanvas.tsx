import { Suspense, lazy, type ComponentProps } from 'react';
import { Skeleton } from '@/components/ui/skeleton';

/**
 * Lazy-loaded Canvas component.
 *
 * Defers loading of the @xyflow/react package and the Canvas component
 * tree until the workflow canvas is actually rendered. This keeps the
 * ReactFlow dependency out of the initial bundle for non-workflow routes.
 */
const Canvas = lazy(() =>
  import('@/components/workflow/Canvas').then((m) => ({ default: m.Canvas })),
);

function CanvasSkeleton() {
  return (
    <div className="flex-1 h-full flex items-center justify-center bg-muted/20">
      <Skeleton className="h-full w-full rounded" />
    </div>
  );
}

export type LazyCanvasProps = ComponentProps<typeof Canvas>;

export function LazyCanvas(props: LazyCanvasProps) {
  return (
    <Suspense fallback={<CanvasSkeleton />}>
      <Canvas {...props} />
    </Suspense>
  );
}
