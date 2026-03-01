import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test';
import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { createAuthStoreMock } from '@/test/mocks/auth-store';

// Mutable auth state
let mockRoles: string[] = ['ADMIN'];

mock.module('@/store/authStore', () => createAuthStoreMock({ roles: () => mockRoles }));

// Stub out child route components to isolate SettingsPage logic
mock.module('@/pages/settings/GeneralSettings', () => ({
  GeneralSettings: () => <div data-testid="general-settings">General Settings Content</div>,
}));

mock.module('@/pages/settings/AppearanceSettings', () => ({
  AppearanceSettings: () => (
    <div data-testid="appearance-settings">Appearance Settings Content</div>
  ),
}));

mock.module('@/pages/settings/AuditLogSettings', () => ({
  AuditLogSettings: () => <div data-testid="audit-settings">Audit Log Settings Content</div>,
}));

mock.module('@/pages/settings/NotificationSettings', () => ({
  NotificationSettings: () => (
    <div data-testid="notification-settings">Notification Settings Content</div>
  ),
}));

mock.module('@/pages/settings/KeyboardShortcutsSettings', () => ({
  KeyboardShortcutsSettings: () => (
    <div data-testid="shortcuts-settings">Keyboard Shortcuts Settings Content</div>
  ),
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
    expect(screen.getByTestId('general-settings')).toBeTruthy();
  });

  it('renders AppearanceSettings content on /settings/appearance', () => {
    renderSettings('/settings/appearance');
    expect(screen.getByTestId('appearance-settings')).toBeTruthy();
  });

  it('renders AuditLogSettings content on /settings/audit for admin', () => {
    mockRoles = ['ADMIN'];
    renderSettings('/settings/audit');
    expect(screen.getByTestId('audit-settings')).toBeTruthy();
  });

  it('redirects /settings to /settings/general', () => {
    renderSettings('/settings');
    // After navigate, GeneralSettings should render
    expect(screen.getByTestId('general-settings')).toBeTruthy();
  });
});
