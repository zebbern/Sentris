import { describe, it, expect, afterEach, beforeEach, mock } from 'bun:test';
import { renderHook, act, cleanup } from '@testing-library/react';
import { useNotificationPermission } from '../useNotificationPermission';

afterEach(cleanup);

describe('useNotificationPermission', () => {
  let originalNotification: typeof globalThis.Notification;

  beforeEach(() => {
    originalNotification = globalThis.Notification;
  });

  afterEach(() => {
    if (originalNotification) {
      globalThis.Notification = originalNotification;
    } else {
      delete (globalThis as any).Notification;
    }
  });

  it('returns "granted" when Notification.permission is "granted"', () => {
    (globalThis as any).Notification = {
      permission: 'granted',
      requestPermission: mock().mockResolvedValue('granted'),
    };

    const { result } = renderHook(() => useNotificationPermission());

    expect(result.current.permission).toBe('granted');
    expect(result.current.isSupported).toBe(true);
  });

  it('returns "denied" when Notification.permission is "denied"', () => {
    (globalThis as any).Notification = {
      permission: 'denied',
      requestPermission: mock().mockResolvedValue('denied'),
    };

    const { result } = renderHook(() => useNotificationPermission());

    expect(result.current.permission).toBe('denied');
    expect(result.current.isSupported).toBe(true);
  });

  it('returns "default" when Notification.permission is "default"', () => {
    (globalThis as any).Notification = {
      permission: 'default',
      requestPermission: mock().mockResolvedValue('default'),
    };

    const { result } = renderHook(() => useNotificationPermission());

    expect(result.current.permission).toBe('default');
    expect(result.current.isSupported).toBe(true);
  });

  it('returns "unsupported" when Notification API is unavailable', () => {
    delete (globalThis as any).Notification;

    const { result } = renderHook(() => useNotificationPermission());

    expect(result.current.permission).toBe('unsupported');
    expect(result.current.isSupported).toBe(false);
  });

  it('requestPermission calls Notification.requestPermission and updates state', async () => {
    const requestPermissionMock = mock().mockResolvedValue('granted');
    (globalThis as any).Notification = {
      permission: 'default',
      requestPermission: requestPermissionMock,
    };

    const { result } = renderHook(() => useNotificationPermission());

    expect(result.current.permission).toBe('default');

    let resultPermission: string | undefined;
    await act(async () => {
      resultPermission = await result.current.requestPermission();
    });

    expect(requestPermissionMock).toHaveBeenCalledTimes(1);
    expect(resultPermission).toBe('granted');
    expect(result.current.permission).toBe('granted');
  });

  it('requestPermission returns "unsupported" when Notification is unavailable', async () => {
    delete (globalThis as any).Notification;

    const { result } = renderHook(() => useNotificationPermission());

    let resultPermission: string | undefined;
    await act(async () => {
      resultPermission = await result.current.requestPermission();
    });

    expect(resultPermission).toBe('unsupported');
  });

  it('handles requestPermission throwing an error', async () => {
    (globalThis as any).Notification = {
      permission: 'default',
      requestPermission: mock().mockRejectedValue(new Error('old browser')),
    };

    const { result } = renderHook(() => useNotificationPermission());

    let resultPermission: string | undefined;
    await act(async () => {
      resultPermission = await result.current.requestPermission();
    });

    // Should fallback to current permission
    expect(resultPermission).toBe('default');
  });

  it('re-syncs permission on visibilitychange', () => {
    (globalThis as any).Notification = {
      permission: 'default',
      requestPermission: mock().mockResolvedValue('granted'),
    };

    const { result } = renderHook(() => useNotificationPermission());

    expect(result.current.permission).toBe('default');

    // Simulate user granting permission in browser settings and returning to tab
    (globalThis as any).Notification.permission = 'granted';

    act(() => {
      const event = document.createEvent('Event');
      event.initEvent('visibilitychange', true, true);
      document.dispatchEvent(event);
    });

    expect(result.current.permission).toBe('granted');
  });
});
