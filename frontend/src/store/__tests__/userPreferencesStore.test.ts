import { describe, it, expect, beforeEach, mock } from 'bun:test';
import { realModuleExports } from '@/test/restore-mocks';

// Override any bled mock.module with the real store
mock.module('@/store/userPreferencesStore', () =>
  realModuleExports('@/store/userPreferencesStore'),
);

import { useUserPreferencesStore } from '../userPreferencesStore';

describe('userPreferencesStore', () => {
  beforeEach(() => {
    // Reset to defaults
    useUserPreferencesStore.setState({
      defaultLandingPage: '/',
      sidebarDensity: 'comfortable',
    });
    localStorage.clear();
  });

  it('has correct default values', () => {
    const state = useUserPreferencesStore.getState();
    expect(state.defaultLandingPage).toBe('/');
    expect(state.sidebarDensity).toBe('comfortable');
  });

  it('updates defaultLandingPage', () => {
    useUserPreferencesStore.getState().setDefaultLandingPage('/templates');
    expect(useUserPreferencesStore.getState().defaultLandingPage).toBe('/templates');
  });

  it('updates sidebarDensity to compact', () => {
    useUserPreferencesStore.getState().setSidebarDensity('compact');
    expect(useUserPreferencesStore.getState().sidebarDensity).toBe('compact');
  });

  it('updates sidebarDensity back to comfortable', () => {
    useUserPreferencesStore.getState().setSidebarDensity('compact');
    useUserPreferencesStore.getState().setSidebarDensity('comfortable');
    expect(useUserPreferencesStore.getState().sidebarDensity).toBe('comfortable');
  });

  it('accepts different landing page values', () => {
    const pages = ['/schedules', '/webhooks', '/secrets', '/api-keys'];
    for (const page of pages) {
      useUserPreferencesStore.getState().setDefaultLandingPage(page);
      expect(useUserPreferencesStore.getState().defaultLandingPage).toBe(page);
    }
  });
});
