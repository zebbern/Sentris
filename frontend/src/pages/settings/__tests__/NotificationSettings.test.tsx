import { describe, it, beforeEach, afterEach, expect, mock } from 'bun:test';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

// ---------------------------------------------------------------------------
// Mutable mock state
// ---------------------------------------------------------------------------

let mockPermission: NotificationPermission | 'unsupported' = 'default';
let mockIsSupported = true;
const mockRequestPermission = mock(() => Promise.resolve('granted' as const));

const mockSetNotifyOnRunComplete = mock((_v: boolean) => {});
const mockSetNotifyOnRunFailed = mock((_v: boolean) => {});
const mockSetNotifyOnScheduleTriggered = mock((_v: boolean) => {});

let mockNotifyOnRunComplete = true;
let mockNotifyOnRunFailed = true;
let mockNotifyOnScheduleTriggered = true;

const mockToast = mock(() => ({ id: 'test-toast' }));
const mockDismiss = mock();

// ---------------------------------------------------------------------------
// Module mocks (must precede component import)
// ---------------------------------------------------------------------------

mock.module('@/hooks/useNotificationPermission', () => ({
  useNotificationPermission: () => ({
    permission: mockPermission,
    requestPermission: mockRequestPermission,
    isSupported: mockIsSupported,
  }),
}));

mock.module('@/components/ui/use-toast', () => ({
  useToast: () => ({ toast: mockToast, dismiss: mockDismiss }),
}));

mock.module('@/store/userPreferencesStore', () => {
  const useUserPreferencesStore = ((selector?: any) => {
    const state = {
      notifyOnRunComplete: mockNotifyOnRunComplete,
      notifyOnRunFailed: mockNotifyOnRunFailed,
      notifyOnScheduleTriggered: mockNotifyOnScheduleTriggered,
      setNotifyOnRunComplete: mockSetNotifyOnRunComplete,
      setNotifyOnRunFailed: mockSetNotifyOnRunFailed,
      setNotifyOnScheduleTriggered: mockSetNotifyOnScheduleTriggered,
    };
    return selector ? selector(state) : state;
  }) as any;
  useUserPreferencesStore.setState = () => {};
  useUserPreferencesStore.getState = () => ({});
  useUserPreferencesStore.subscribe = () => () => {};
  useUserPreferencesStore.destroy = () => {};
  return { useUserPreferencesStore };
});

// Import component AFTER all mock.module() calls
import { NotificationSettings } from '../NotificationSettings';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resetMocks() {
  mockPermission = 'default';
  mockIsSupported = true;
  mockNotifyOnRunComplete = true;
  mockNotifyOnRunFailed = true;
  mockNotifyOnScheduleTriggered = true;
  mockSetNotifyOnRunComplete.mockClear();
  mockSetNotifyOnRunFailed.mockClear();
  mockSetNotifyOnScheduleTriggered.mockClear();
  mockRequestPermission.mockClear();
  mockToast.mockClear();
  mockDismiss.mockClear();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('NotificationSettings', () => {
  beforeEach(() => {
    cleanup();
    resetMocks();
  });

  afterEach(cleanup);

  // --- Rendering ---

  it('renders all three notification toggles', () => {
    render(<NotificationSettings />);

    expect(screen.getByText('Run completed')).toBeTruthy();
    expect(screen.getByText('Run failed')).toBeTruthy();
    expect(screen.getByText('Schedule triggered')).toBeTruthy();
  });

  it('renders toggle descriptions', () => {
    render(<NotificationSettings />);

    expect(screen.getByText(/workflow run completes successfully/)).toBeTruthy();
    expect(screen.getByText(/workflow run fails or encounters an error/)).toBeTruthy();
    expect(screen.getByText(/scheduled workflow is automatically triggered/)).toBeTruthy();
  });

  // --- Toggle interactions ---

  it('calls setNotifyOnRunComplete when run-complete switch is toggled', () => {
    render(<NotificationSettings />);

    const toggle = screen.getByRole('switch', { name: 'Run completed' });
    fireEvent.click(toggle);

    expect(mockSetNotifyOnRunComplete).toHaveBeenCalledTimes(1);
  });

  it('calls setNotifyOnRunFailed when run-failed switch is toggled', () => {
    render(<NotificationSettings />);

    const toggle = screen.getByRole('switch', { name: 'Run failed' });
    fireEvent.click(toggle);

    expect(mockSetNotifyOnRunFailed).toHaveBeenCalledTimes(1);
  });

  it('calls setNotifyOnScheduleTriggered when schedule-triggered switch is toggled', () => {
    render(<NotificationSettings />);

    const toggle = screen.getByRole('switch', { name: 'Schedule triggered' });
    fireEvent.click(toggle);

    expect(mockSetNotifyOnScheduleTriggered).toHaveBeenCalledTimes(1);
  });

  // --- Permission banner: granted ---

  it('shows "Browser notifications enabled" banner when permission is granted', () => {
    mockPermission = 'granted';
    render(<NotificationSettings />);

    expect(screen.getByText('Browser notifications enabled')).toBeTruthy();
  });

  // --- Permission banner: denied ---

  it('shows "Browser notifications blocked" alert when permission is denied', () => {
    mockPermission = 'denied';
    render(<NotificationSettings />);

    expect(screen.getByText('Browser notifications blocked')).toBeTruthy();
  });

  // --- Permission banner: default (not yet requested) ---

  it('shows "Enable browser notifications" button when permission is default', () => {
    mockPermission = 'default';
    render(<NotificationSettings />);

    expect(screen.getByRole('button', { name: /enable browser notifications/i })).toBeTruthy();
  });

  // --- Permission banner: unsupported ---

  it('shows "Not supported" banner when isSupported is false', () => {
    mockPermission = 'unsupported';
    mockIsSupported = false;
    render(<NotificationSettings />);

    expect(screen.getByText('Not supported')).toBeTruthy();
  });

  // --- Test notification button ---

  it('"Send test notification" button renders and is clickable', () => {
    render(<NotificationSettings />);

    const button = screen.getByRole('button', { name: /send test notification/i });
    expect(button).toBeTruthy();

    fireEvent.click(button);
    // When permission is 'default', a toast is used instead of browser notification
    expect(mockToast).toHaveBeenCalledTimes(1);
  });

  // --- Local storage note ---

  it('shows local storage note', () => {
    render(<NotificationSettings />);

    expect(screen.getByText(/stored locally and apply to this browser only/)).toBeTruthy();
  });
});
