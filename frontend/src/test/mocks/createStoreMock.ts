/**
 * Creates a zustand-compatible store mock from a state object or getter function.
 *
 * When bun:test's `mock.module()` bleeds across test files, non-compatible
 * store mocks (plain objects or selector-only functions) break victim tests
 * that call `store.getState()`, `store.setState()`, or `store.subscribe()`.
 *
 * This utility wraps state into a function that:
 * 1. Works as a selector: `useStore(state => state.foo)` → `state.foo`
 * 2. Works as a getter: `useStore()` → full state
 * 3. Has zustand APIs: `.getState()`, `.setState()`, `.subscribe()`, `.destroy()`
 *
 * @param stateOrGetter - Static state object or getter function for dynamic state
 * @param apiOverrides  - Override default zustand API stubs (e.g., custom `.subscribe`)
 */
export function createStoreMock<T extends Record<string, any>>(
  stateOrGetter: T | (() => T),
  apiOverrides?: {
    subscribe?: (...args: any[]) => any;
    setState?: (...args: any[]) => any;
    destroy?: () => void;
  },
) {
  const getState = () =>
    typeof stateOrGetter === 'function' ? (stateOrGetter as () => T)() : stateOrGetter;

  const fn = ((selector?: (state: T) => any) => {
    const state = getState();
    return selector ? selector(state) : state;
  }) as any;

  fn.getState = getState;

  fn.setState =
    apiOverrides?.setState ??
    ((partial: any) => {
      const current = getState();
      const next = typeof partial === 'function' ? partial(current) : partial;
      if (typeof stateOrGetter !== 'function') {
        Object.assign(stateOrGetter, next);
      }
    });

  fn.subscribe = apiOverrides?.subscribe ?? (() => () => {});
  fn.destroy = apiOverrides?.destroy ?? (() => {});

  return fn;
}
