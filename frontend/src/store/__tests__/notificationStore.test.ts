import { describe, it, expect, beforeEach, mock } from 'bun:test';
import { realModuleExports } from '@/test/restore-mocks';

// Override any bled mock.module with the real store
mock.module('@/store/notificationStore', () => realModuleExports('@/store/notificationStore'));

import { useNotificationStore, selectUnreadCount } from '../notificationStore';

describe('notificationStore', () => {
  beforeEach(() => {
    useNotificationStore.setState({ notifications: [] });
    localStorage.clear();
  });

  // --- Initial state ---

  it('has empty notifications by default', () => {
    const state = useNotificationStore.getState();
    expect(state.notifications).toEqual([]);
  });

  // --- push() ---

  it('push() adds a notification with auto-generated id, timestamp, and read: false', () => {
    useNotificationStore.getState().push({
      title: 'Scan complete',
      variant: 'success',
    });

    const { notifications } = useNotificationStore.getState();
    expect(notifications).toHaveLength(1);
    expect(notifications[0].title).toBe('Scan complete');
    expect(notifications[0].variant).toBe('success');
    expect(notifications[0].read).toBe(false);
    expect(typeof notifications[0].id).toBe('string');
    expect(notifications[0].id.length).toBeGreaterThan(0);
    expect(typeof notifications[0].timestamp).toBe('string');
    // Verify timestamp is a valid ISO string
    expect(Number.isNaN(Date.parse(notifications[0].timestamp))).toBe(false);
  });

  it('push() preserves optional fields (description, runId)', () => {
    useNotificationStore.getState().push({
      title: 'Scan complete',
      description: 'Found 3 vulnerabilities',
      variant: 'destructive',
      runId: 'run-123',
    });

    const { notifications } = useNotificationStore.getState();
    expect(notifications[0].description).toBe('Found 3 vulnerabilities');
    expect(notifications[0].runId).toBe('run-123');
  });

  it('push() prepends newest notifications first', () => {
    useNotificationStore.getState().push({ title: 'First', variant: 'success' });
    useNotificationStore.getState().push({ title: 'Second', variant: 'success' });
    useNotificationStore.getState().push({ title: 'Third', variant: 'success' });

    const { notifications } = useNotificationStore.getState();
    expect(notifications[0].title).toBe('Third');
    expect(notifications[1].title).toBe('Second');
    expect(notifications[2].title).toBe('First');
  });

  it('push() trims to MAX_NOTIFICATIONS (50) using FIFO', () => {
    // Push 52 notifications
    for (let i = 0; i < 52; i++) {
      useNotificationStore.getState().push({ title: `Notification ${i}`, variant: 'success' });
    }

    const { notifications } = useNotificationStore.getState();
    expect(notifications).toHaveLength(50);
    // The newest should be #51 (0-indexed), the oldest kept should be #2
    expect(notifications[0].title).toBe('Notification 51');
    expect(notifications[49].title).toBe('Notification 2');
  });

  // --- markRead() ---

  it('markRead() sets read: true on the matching notification only', () => {
    useNotificationStore.getState().push({ title: 'A', variant: 'success' });
    useNotificationStore.getState().push({ title: 'B', variant: 'success' });

    const before = useNotificationStore.getState().notifications;
    const targetId = before[0].id; // B (newest)

    useNotificationStore.getState().markRead(targetId);

    const after = useNotificationStore.getState().notifications;
    expect(after[0].read).toBe(true); // B marked
    expect(after[1].read).toBe(false); // A untouched
  });

  it('markRead() is a no-op for non-existent id', () => {
    useNotificationStore.getState().push({ title: 'A', variant: 'success' });
    useNotificationStore.getState().markRead('non-existent-id');

    const { notifications } = useNotificationStore.getState();
    expect(notifications).toHaveLength(1);
    expect(notifications[0].read).toBe(false);
  });

  // --- markAllRead() ---

  it('markAllRead() sets read: true on all notifications', () => {
    useNotificationStore.getState().push({ title: 'A', variant: 'success' });
    useNotificationStore.getState().push({ title: 'B', variant: 'destructive' });
    useNotificationStore.getState().push({ title: 'C', variant: 'success' });

    useNotificationStore.getState().markAllRead();

    const { notifications } = useNotificationStore.getState();
    expect(notifications.every((n) => n.read)).toBe(true);
  });

  it('markAllRead() works on empty array', () => {
    useNotificationStore.getState().markAllRead();
    expect(useNotificationStore.getState().notifications).toEqual([]);
  });

  // --- dismiss() ---

  it('dismiss() removes the notification from the array', () => {
    useNotificationStore.getState().push({ title: 'A', variant: 'success' });
    useNotificationStore.getState().push({ title: 'B', variant: 'success' });

    const idToRemove = useNotificationStore.getState().notifications[0].id; // B
    useNotificationStore.getState().dismiss(idToRemove);

    const { notifications } = useNotificationStore.getState();
    expect(notifications).toHaveLength(1);
    expect(notifications[0].title).toBe('A');
  });

  it('dismiss() is a no-op for non-existent id', () => {
    useNotificationStore.getState().push({ title: 'A', variant: 'success' });
    useNotificationStore.getState().dismiss('non-existent');

    expect(useNotificationStore.getState().notifications).toHaveLength(1);
  });

  // --- clearAll() ---

  it('clearAll() resets notifications to an empty array', () => {
    useNotificationStore.getState().push({ title: 'A', variant: 'success' });
    useNotificationStore.getState().push({ title: 'B', variant: 'success' });

    useNotificationStore.getState().clearAll();
    expect(useNotificationStore.getState().notifications).toEqual([]);
  });

  // --- selectUnreadCount ---

  it('selectUnreadCount returns correct count of unread notifications', () => {
    useNotificationStore.getState().push({ title: 'A', variant: 'success' });
    useNotificationStore.getState().push({ title: 'B', variant: 'success' });
    useNotificationStore.getState().push({ title: 'C', variant: 'success' });

    expect(selectUnreadCount(useNotificationStore.getState())).toBe(3);

    // Mark one as read
    const idToRead = useNotificationStore.getState().notifications[0].id;
    useNotificationStore.getState().markRead(idToRead);
    expect(selectUnreadCount(useNotificationStore.getState())).toBe(2);

    // Mark all read
    useNotificationStore.getState().markAllRead();
    expect(selectUnreadCount(useNotificationStore.getState())).toBe(0);
  });

  it('selectUnreadCount returns 0 for empty notifications', () => {
    expect(selectUnreadCount(useNotificationStore.getState())).toBe(0);
  });
});
