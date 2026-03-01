/**
 * Shared Zustand-compatible themeStore mock factory.
 *
 * Usage:
 * ```ts
 * import { createThemeStoreMock } from '@/test/mocks/theme-store';
 * mock.module('@/store/themeStore', () => createThemeStoreMock());
 * ```
 *
 * Produces a `useThemeStore` hook with:
 *  - Selector pattern: `useThemeStore(s => s.theme)` returns the current value
 *  - Zustand static API: `.setState()`, `.getState()`, `.subscribe()`, `.destroy()`
 *  - Real action implementations (setTheme, toggleTheme, etc.) that update internal state
 *    and apply DOM class changes, matching the real store's behavior.
 */

export function createThemeStoreMock() {
  // eslint-disable-next-line prefer-const
  let _state: Record<string, any>;

  const applyTheme = (theme: string) => {
    if (typeof document !== 'undefined') {
      document.documentElement.classList.add('theme-switching');
      if (theme === 'dark') {
        document.documentElement.classList.add('dark');
      } else {
        document.documentElement.classList.remove('dark');
      }
      document.documentElement.classList.remove('theme-switching');
    }
  };

  const resolveTheme = (preference: string): string => {
    if (preference === 'system') {
      if (typeof window !== 'undefined') {
        return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
      }
      return 'light';
    }
    return preference;
  };

  const _setState = (partial: any) => {
    const next = typeof partial === 'function' ? partial(_state) : partial;
    Object.assign(_state, next);
  };

  _state = {
    theme: 'light' as string,
    themePreference: 'light' as string,
    isTransitioning: false,

    setTheme: (theme: string) => {
      _setState({ theme, themePreference: theme });
      applyTheme(theme);
    },

    setThemePreference: (preference: string) => {
      const resolved = resolveTheme(preference);
      _setState({ themePreference: preference, theme: resolved });
      applyTheme(resolved);
    },

    toggleTheme: () => {
      const current = _state.theme;
      const next = current === 'light' ? 'dark' : 'light';
      _setState({ theme: next, themePreference: next });
      applyTheme(next);
    },

    startTransition: () => _setState({ isTransitioning: true }),
    endTransition: () => _setState({ isTransitioning: false }),
  };

  const useThemeStore = ((selector?: any) => {
    return selector ? selector(_state) : _state;
  }) as any;

  useThemeStore.setState = _setState;
  useThemeStore.getState = () => _state;
  useThemeStore.subscribe = () => () => {};
  useThemeStore.destroy = () => {};

  return { useThemeStore };
}
