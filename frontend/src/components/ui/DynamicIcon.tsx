import { lazy, memo, Suspense, type ComponentType } from 'react';
import type { LucideProps } from 'lucide-react';
import dynamicIconImports from 'lucide-react/dynamicIconImports';

import { cn } from '@/lib/utils';
import { toKebabCase } from './iconUtils';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type IconName = keyof typeof dynamicIconImports;

export interface DynamicIconProps extends Omit<LucideProps, 'ref'> {
  /** PascalCase or kebab-case icon name (e.g. "Shield", "shield-alert"). */
  name: string;
  /** Fallback icon name when `name` is invalid (default: "box"). */
  fallback?: string;
}

// ---------------------------------------------------------------------------
// Lazy-component cache (one entry per icon name, created once)
// ---------------------------------------------------------------------------

const lazyCache = new Map<string, ComponentType<Omit<LucideProps, 'ref'>>>();

function getLazyIcon(kebabName: string): ComponentType<Omit<LucideProps, 'ref'>> {
  const cached = lazyCache.get(kebabName);
  if (cached) return cached;

  const LazyIcon = lazy(dynamicIconImports[kebabName as IconName]);
  lazyCache.set(kebabName, LazyIcon);
  return LazyIcon;
}

// ---------------------------------------------------------------------------
// Loading placeholder — matches icon dimensions to prevent layout shift
// ---------------------------------------------------------------------------

function IconPlaceholder({ className }: { className?: string }) {
  return <span role="presentation" className={cn('inline-block shrink-0', className)} />;
}

// ---------------------------------------------------------------------------
// DynamicIcon component
// ---------------------------------------------------------------------------

/**
 * Lazy-loads a single lucide-react icon by name instead of pulling in the
 * full barrel export. Wraps each icon in `React.lazy` + `Suspense` so the
 * per-icon chunk is fetched on demand and cached for subsequent renders.
 *
 * Accepts PascalCase names (e.g. `"ShieldAlert"`) for backward compatibility
 * with the existing `component.icon` convention, as well as the native
 * kebab-case format (`"shield-alert"`).
 *
 * @example
 * ```tsx
 * <DynamicIcon name="Shield" className="h-4 w-4" />
 * <DynamicIcon name={component.icon || 'Box'} className="h-4 w-4" />
 * ```
 */
export const DynamicIcon = memo(function DynamicIcon({
  name,
  fallback = 'box',
  className,
  ...rest
}: DynamicIconProps) {
  const kebabName = toKebabCase(name);
  const resolvedName =
    kebabName in dynamicIconImports
      ? kebabName
      : toKebabCase(fallback) in dynamicIconImports
        ? toKebabCase(fallback)
        : 'box';

  const IconComponent = getLazyIcon(resolvedName);

  return (
    <Suspense fallback={<IconPlaceholder className={className} />}>
      <IconComponent className={className} {...rest} />
    </Suspense>
  );
});
