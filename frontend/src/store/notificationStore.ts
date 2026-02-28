import { create } from 'zustand';
import { persist } from 'zustand/middleware';

const MAX_NOTIFICATIONS = 50;

export interface NotificationItem {
  id: string;
  title: string;
  description?: string;
  variant: 'success' | 'destructive';
  timestamp: string; // ISO string
  read: boolean;
  runId?: string;
}

interface NotificationStoreState {
  notifications: NotificationItem[];
  push: (item: Omit<NotificationItem, 'id' | 'timestamp' | 'read'>) => void;
  markRead: (id: string) => void;
  markAllRead: () => void;
  dismiss: (id: string) => void;
  clearAll: () => void;
}

export const useNotificationStore = create<NotificationStoreState>()(
  persist(
    (set) => ({
      notifications: [],

      push: (item) =>
        set((state) => {
          const newNotification: NotificationItem = {
            ...item,
            id: crypto.randomUUID(),
            timestamp: new Date().toISOString(),
            read: false,
          };
          const updated = [newNotification, ...state.notifications].slice(0, MAX_NOTIFICATIONS);
          return { notifications: updated };
        }),

      markRead: (id) =>
        set((state) => ({
          notifications: state.notifications.map((n) => (n.id === id ? { ...n, read: true } : n)),
        })),

      markAllRead: () =>
        set((state) => ({
          notifications: state.notifications.map((n) => ({ ...n, read: true })),
        })),

      dismiss: (id) =>
        set((state) => ({
          notifications: state.notifications.filter((n) => n.id !== id),
        })),

      clearAll: () => set({ notifications: [] }),
    }),
    {
      name: 'notification-store',
      partialize: (state) => ({
        notifications: state.notifications,
      }),
    },
  ),
);

/** Derived selector — use with `useNotificationStore(selectUnreadCount)` */
export const selectUnreadCount = (state: NotificationStoreState): number =>
  state.notifications.filter((n) => !n.read).length;
