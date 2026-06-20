import { describe, it, expect, beforeEach, afterEach, afterAll, mock } from 'bun:test';
import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { createAuthStoreMock } from '@/test/mocks/auth-store';
import { createThemeStoreMock } from '@/test/mocks/theme-store';
import { createUserPreferencesStoreMock } from '@/test/mocks/user-preferences-store';
import { restoreMockedModules } from '@/test/restore-mocks';

// ---------------------------------------------------------------------------
// Mutable auth state
// ---------------------------------------------------------------------------
let mockRoles: string[] = ['ADMIN'];

mock.module('@/store/authStore', () => createAuthStoreMock({ roles: () => mockRoles }));

// ---------------------------------------------------------------------------
// Mock stores & hooks used by child settings components so the real components
// render without errors. Shared factories ensure Zustand-compatible mocks
// with .setState()/.getState() so other test files aren't contaminated.
// ---------------------------------------------------------------------------

mock.module('@/store/themeStore', () => createThemeStoreMock());

mock.module('@/store/userPreferencesStore', () => createUserPreferencesStoreMock());

mock.module('@/hooks/useNotificationPermission', () => ({
  useNotificationPermission: () => ({
    permission: 'default' as const,
    requestPermission: mock(() => Promise.resolve('default' as const)),
    isSupported: true,
  }),
}));

mock.module('@/hooks/queries/useAuditLogQueries', () => ({
  useAuditLogs: () => ({
    data: undefined,
    isLoading: false,
    isFetching: false,
    isFetchingNextPage: false,
    hasNextPage: false,
    fetchNextPage: mock(),
    refetch: mock(),
    error: null,
  }),
}));

import { SettingsPage } from '../SettingsPage';

const renderSettings = (initialRoute = '/settings/general') =>
  render(
    <MemoryRouter initialEntries={[initialRoute]}>
      <Routes>
        <Route path="/settings/*" element={<SettingsPage />} />
      </Routes>
    </MemoryRouter>,
  );

describe('SettingsPage', () => {
  beforeEach(() => {
    cleanup();
    mockRoles = ['ADMIN'];
  });

  afterEach(cleanup);

  afterAll(() =>
    restoreMockedModules([
      '@/hooks/queries/useAuditLogQueries',
      '@/hooks/useNotificationPermission',
      '@/store/authStore',
      '@/store/themeStore',
      '@/store/userPreferencesStore',
    ]),
  );

  it('renders navigation tabs', () => {
    renderSettings();
    expect(screen.getByText('General')).toBeTruthy();
  });

  it('shows General, Appearance, and Audit tabs for admin users', () => {
    mockRoles = ['ADMIN'];
    renderSettings();

    expect(screen.getByText('General')).toBeTruthy();
    expect(screen.getByText('Appearance')).toBeTruthy();
    expect(screen.getByText('Audit')).toBeTruthy();
  });

  it('shows only General and Appearance tabs for non-admin users', () => {
    mockRoles = ['VIEWER'];
    renderSettings();

    expect(screen.getByText('General')).toBeTruthy();
    expect(screen.getByText('Appearance')).toBeTruthy();
    expect(screen.queryByText('Audit')).toBeNull();
  });

  it('never shows "Coming Soon" placeholder for admin users', () => {
    mockRoles = ['ADMIN'];
    renderSettings();

    expect(screen.queryByText('Coming Soon')).toBeNull();
    expect(screen.queryByText(/coming soon/i)).toBeNull();
  });

  it('never shows "Coming Soon" placeholder for non-admin users', () => {
    mockRoles = ['VIEWER'];
    renderSettings();

    expect(screen.queryByText('Coming Soon')).toBeNull();
    expect(screen.queryByText(/coming soon/i)).toBeNull();
  });

  it('renders GeneralSettings content on /settings/general', () => {
    renderSettings('/settings/general');
    expect(screen.getByText('Default Landing Page')).toBeTruthy();
  });

  it('renders AppearanceSettings content on /settings/appearance', () => {
    renderSettings('/settings/appearance');
    expect(screen.getByText('Select your preferred color scheme.')).toBeTruthy();
  });

  it('renders AuditLogSettings content on /settings/audit for admin', () => {
    mockRoles = ['ADMIN'];
    renderSettings('/settings/audit');
    expect(screen.getByText('Audit Log')).toBeTruthy();
  });

  it('redirects /settings to /settings/general', () => {
    renderSettings('/settings');
    // After navigate, GeneralSettings should render
    expect(screen.getByText('Default Landing Page')).toBeTruthy();
  });
});
