import { create } from 'zustand';
import { notifications as notificationsApi } from '../lib/api';

export interface Notification {
  _id: string;
  userId: string;
  workspaceId: string;
  type: 'content_ready' | 'content_failed' | 'info' | 'warning';
  title: string;
  message: string;
  projectId?: string;
  read: boolean;
  createdAt: string;
}

interface NotificationState {
  items: Notification[];
  unreadCount: number;
  isOpen: boolean;
  loading: boolean;
  pollInterval: ReturnType<typeof setInterval> | null;

  fetch: () => Promise<void>;
  fetchUnreadCount: () => Promise<void>;
  markRead: (id: string) => Promise<void>;
  markAllRead: () => Promise<void>;
  deleteOne: (id: string) => Promise<void>;
  clearAll: () => Promise<void>;
  toggleOpen: () => void;
  setOpen: (open: boolean) => void;
  startPolling: () => void;
  stopPolling: () => void;
}

export const useNotificationStore = create<NotificationState>((set, get) => ({
  items: [],
  unreadCount: 0,
  isOpen: false,
  loading: false,
  pollInterval: null,

  fetch: async () => {
    try {
      const res = await notificationsApi.list({ limit: 30 });
      set({ items: res.data, unreadCount: res.unreadCount });
    } catch {
      // silently fail — notifications are non-critical
    }
  },

  fetchUnreadCount: async () => {
    try {
      const res = await notificationsApi.unreadCount();
      set({ unreadCount: res.data.count });
    } catch {
      // silently fail
    }
  },

  markRead: async (id: string) => {
    try {
      await notificationsApi.markRead(id);
      set((state) => ({
        items: state.items.map((n) => (n._id === id ? { ...n, read: true } : n)),
        unreadCount: Math.max(0, state.unreadCount - 1),
      }));
    } catch {
      // silently fail
    }
  },

  markAllRead: async () => {
    try {
      await notificationsApi.markAllRead();
      set((state) => ({
        items: state.items.map((n) => ({ ...n, read: true })),
        unreadCount: 0,
      }));
    } catch {
      // silently fail
    }
  },

  deleteOne: async (id: string) => {
    try {
      await notificationsApi.delete(id);
      set((state) => {
        const item = state.items.find((n) => n._id === id);
        return {
          items: state.items.filter((n) => n._id !== id),
          unreadCount: item && !item.read ? Math.max(0, state.unreadCount - 1) : state.unreadCount,
        };
      });
    } catch {
      // silently fail
    }
  },

  clearAll: async () => {
    try {
      await notificationsApi.clearAll();
      set({ items: [], unreadCount: 0 });
    } catch {
      // silently fail
    }
  },

  toggleOpen: () => set((state) => ({ isOpen: !state.isOpen })),
  setOpen: (open: boolean) => set({ isOpen: open }),

  startPolling: () => {
    const { pollInterval } = get();
    if (pollInterval) return;
    // Fetch immediately, then every 30 seconds
    get().fetchUnreadCount();
    const interval = setInterval(() => {
      get().fetchUnreadCount();
    }, 30000);
    set({ pollInterval: interval });
  },

  stopPolling: () => {
    const { pollInterval } = get();
    if (pollInterval) {
      clearInterval(pollInterval);
      set({ pollInterval: null });
    }
  },
}));
