/**
 * Shared Zustand-compatible userPreferencesStore mock factory.
 *
 * Usage:
 * ```ts
 * import { createUserPreferencesStoreMock } from '@/test/mocks/user-preferences-store';
 * mock.module('@/store/userPreferencesStore', () => createUserPreferencesStoreMock());
 * ```
 *
 * Produces a `useUserPreferencesStore` hook with:
 *  - Selector pattern: `useUserPreferencesStore(s => s.defaultLandingPage)`
 *  - Zustand static API: `.setState()`, `.getState()`, `.subscribe()`, `.destroy()`
 *  - Real action implementations that update internal state.
 */

export function createUserPreferencesStoreMock() {
  // eslint-disable-next-line prefer-const
  let _state: Record<string, any>;

  const _setState = (partial: any) => {
    const next = typeof partial === 'function' ? partial(_state) : partial;
    Object.assign(_state, next);
  };

  _state = {
    defaultLandingPage: '/',
    sidebarDensity: 'comfortable' as string,
    notifyOnRunComplete: true,
    notifyOnRunFailed: true,
    notifyOnScheduleTriggered: true,

    setDefaultLandingPage: (page: string) => _setState({ defaultLandingPage: page }),
    setSidebarDensity: (density: string) => _setState({ sidebarDensity: density }),
    setNotifyOnRunComplete: (value: boolean) => _setState({ notifyOnRunComplete: value }),
    setNotifyOnRunFailed: (value: boolean) => _setState({ notifyOnRunFailed: value }),
    setNotifyOnScheduleTriggered: (value: boolean) =>
      _setState({ notifyOnScheduleTriggered: value }),
  };

  const useUserPreferencesStore = ((selector?: any) => {
    return selector ? selector(_state) : _state;
  }) as any;

  useUserPreferencesStore.setState = _setState;
  useUserPreferencesStore.getState = () => _state;
  useUserPreferencesStore.subscribe = () => () => {};
  useUserPreferencesStore.destroy = () => {};

  return { useUserPreferencesStore };
}
