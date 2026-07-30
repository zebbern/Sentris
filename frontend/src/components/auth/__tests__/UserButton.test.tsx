import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { act, cleanup, fireEvent, screen } from '@testing-library/react';
import { GlobalAuthContext } from '@/auth/auth-context-def';
import type { FrontendAuthProvider } from '@/auth/types';
import { useNotificationStore } from '@/store/notificationStore';
import { renderWithProviders } from '@/test/render-with-providers';
import { UserButton } from '../UserButton';

const provider: FrontendAuthProvider = {
  name: 'local',
  context: {
    user: {
      id: 'user-1',
      email: 'admin@example.com',
      organizationId: 'org-1',
      organizationRole: 'ADMIN',
    },
    token: null,
    isLoading: false,
    isAuthenticated: true,
    error: null,
  },
  signIn: () => {},
  signUp: () => {},
  signOut: () => {},
  SignInComponent: () => null,
  SignUpComponent: () => null,
  UserButtonComponent: () => null,
  initialize: () => {},
  cleanup: () => {},
};

const originalCustomEvent = globalThis.CustomEvent;

beforeEach(() => {
  Object.defineProperty(globalThis, 'CustomEvent', {
    configurable: true,
    value: window.CustomEvent,
    writable: true,
  });
});

afterEach(() => {
  cleanup();
  useNotificationStore.setState({ notifications: [] });
  Object.defineProperty(globalThis, 'CustomEvent', {
    configurable: true,
    value: originalCustomEvent,
    writable: true,
  });
});

describe('UserButton', () => {
  it('renders the notification action outside the profile menu button and opens notifications', async () => {
    useNotificationStore.setState({
      notifications: [
        {
          id: 'notification-1',
          title: 'Workflow finished',
          variant: 'success',
          timestamp: '2026-07-30T10:00:00.000Z',
          read: false,
        },
      ],
    });

    const { container } = renderWithProviders(
      <GlobalAuthContext.Provider value={{ provider, providerName: provider.name }}>
        <UserButton compact integratedNotifications />
      </GlobalAuthContext.Provider>,
    );

    const profileMenuButton = container.querySelector<HTMLButtonElement>(
      'button[aria-haspopup="menu"]',
    );
    const notificationButton = screen.getByRole('button', {
      name: 'Notifications — 1 unread',
    });

    expect(profileMenuButton).not.toBeNull();
    expect(profileMenuButton?.contains(notificationButton)).toBe(false);

    await act(async () => {
      fireEvent.click(notificationButton);
    });

    expect(profileMenuButton).toHaveAttribute('data-state', 'closed');
    expect(screen.getByRole('heading', { name: 'Notifications' })).toBeInTheDocument();

    await act(async () => {
      fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    });
  });
});
