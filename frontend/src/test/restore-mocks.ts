/**
 * Utilities for capturing real module exports before mocking and restoring them afterwards.
 *
 * Usage:
 * ```ts
 * import { realModuleExports, restoreMockedModules } from '@/test/restore-mocks';
 *
 * // Spread real exports while overriding specific ones:
 * mock.module('@dnd-kit/core', () => ({
 *   ...realModuleExports('@dnd-kit/core'),
 *   DndContext: ({ children }: any) => <>{children}</>,
 * }));
 *
 * // Restore all mocked modules in afterAll:
 * afterAll(() => restoreMockedModules(['@dnd-kit/core']));
 * ```
 */
import { mock } from 'bun:test';

const cache = new Map<string, Record<string, unknown>>();

/**
 * Returns the real (pre-mock) exports of a module, caching the result.
 *
 * Call this **inside** a `mock.module()` factory to spread the original exports
 * while selectively overriding specific members.
 */
export function realModuleExports(modulePath: string): Record<string, unknown> {
  if (!cache.has(modulePath)) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const real = require(modulePath);
      cache.set(modulePath, { ...real });
    } catch {
      cache.set(modulePath, {});
    }
  }
  return cache.get(modulePath)!;
}

/**
 * Restores mocked modules to their original (cached) implementations.
 *
 * Typically called in `afterAll` to prevent mock leakage between test files.
 */
export function restoreMockedModules(modulePaths: string[]): void {
  for (const path of modulePaths) {
    const real = cache.get(path);
    if (real) {
      mock.module(path, () => real);
    }
  }
}
