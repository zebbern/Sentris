import { Suspense, lazy } from 'react';
import type { EditorProps } from '@monaco-editor/react';
import { Skeleton } from '@/components/ui/skeleton';

/**
 * Lazy-loaded Monaco Editor component.
 *
 * Defers loading of the ~5MB monaco-editor package until the component
 * is actually rendered. The CDN path is configured during module init
 * so Monaco loads its core from jsdelivr instead of bundling it.
 */
const MonacoEditor = lazy(() =>
  import('@monaco-editor/react').then((mod) => {
    mod.loader.config({
      paths: { vs: 'https://cdn.jsdelivr.net/npm/monaco-editor@0.55.1/min/vs' },
    });
    return { default: mod.default };
  }),
);

function EditorSkeleton({ height }: { height?: string | number }) {
  const h = typeof height === 'number' ? `${height}px` : (height ?? '200px');
  return (
    <div style={{ height: h }} className="w-full">
      <Skeleton className="h-full w-full rounded-md" />
    </div>
  );
}

export function LazyMonacoEditor(props: EditorProps) {
  return (
    <Suspense fallback={<EditorSkeleton height={props.height} />}>
      <MonacoEditor {...props} />
    </Suspense>
  );
}
