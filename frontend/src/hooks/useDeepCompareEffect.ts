import { useEffect, useRef } from 'react';

/**
 * Deep-compare two values using structural equality.
 * Handles primitives, arrays, plain objects, null, and undefined.
 */
function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (a === null || b === null) return false;
  if (typeof a !== typeof b) return false;

  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    return a.every((item, index) => deepEqual(item, b[index]));
  }

  if (typeof a === 'object' && typeof b === 'object') {
    const aObj = a as Record<string, unknown>;
    const bObj = b as Record<string, unknown>;
    const aKeys = Object.keys(aObj);
    const bKeys = Object.keys(bObj);
    if (aKeys.length !== bKeys.length) return false;
    return aKeys.every((key) => key in bObj && deepEqual(aObj[key], bObj[key]));
  }

  return false;
}

/**
 * Like `useEffect`, but uses deep structural comparison for the dependency
 * array instead of referential equality. This avoids the `JSON.stringify`
 * anti-pattern that can mask bugs and misses non-serializable values.
 */
export function useDeepCompareEffect(
  effect: React.EffectCallback,
  deps: React.DependencyList,
): void {
  const previousDeps = useRef<React.DependencyList | undefined>(undefined);
  const signalRef = useRef(0);

  if (previousDeps.current === undefined || !deepEqual(previousDeps.current, deps)) {
    previousDeps.current = deps;
    signalRef.current += 1;
  }

  useEffect(effect, [signalRef.current]);
}
