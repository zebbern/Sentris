import { lazy } from 'react';
import type { ComponentType } from 'react';

type LazyFactory<T extends ComponentType<unknown>> = () => Promise<{ default: T }>;

const SESSION_KEY_PREFIX = 'chunk-retry-';

/**
 * Derives a deterministic chunk ID from the factory function's source string.
 * Uses a simple hash to keep the sessionStorage key short.
 */
function deriveChunkId(factory: LazyFactory<ComponentType<unknown>>): string {
  const source = factory.toString();
  let hash = 0;
  for (let i = 0; i < source.length; i++) {
    hash = (hash << 5) - hash + source.charCodeAt(i);
    hash |= 0; // Convert to 32-bit integer
  }
  return Math.abs(hash).toString(36);
}

/**
 * Wraps `React.lazy()` with automatic retry on chunk load failures.
 *
 * On the first `ChunkLoadError`, sets a sessionStorage flag and reloads the
 * page once. If the flag is already set (meaning the reload didn't fix it),
 * clears the flag and re-throws so the nearest ErrorBoundary can handle it.
 *
 * This prevents infinite reload loops while recovering from stale chunk
 * references after deployments.
 */
export function lazyWithRetry<T extends ComponentType<unknown>>(factory: LazyFactory<T>) {
  return lazy(() =>
    factory().catch((error: unknown) => {
      const chunkId = deriveChunkId(factory as LazyFactory<ComponentType<unknown>>);
      const storageKey = `${SESSION_KEY_PREFIX}${chunkId}`;
      const hasReloaded = sessionStorage.getItem(storageKey);

      if (!hasReloaded) {
        sessionStorage.setItem(storageKey, '1');
        window.location.reload();
        // Return a never-resolving promise to prevent React from rendering
        // while the page reloads
        return new Promise<{ default: T }>(() => {});
      }

      // Already reloaded once — clear flag and let ErrorBoundary handle it
      sessionStorage.removeItem(storageKey);
      throw error;
    }),
  );
}
