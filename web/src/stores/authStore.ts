import { create } from 'zustand';
import { auth } from '../lib/api';
import type { User, Workspace } from '../types';

interface AuthState {
  user: User | null;
  workspace: Workspace | null;
  isLoading: boolean;
  isAuthenticated: boolean;

  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, name: string) => Promise<void>;
  logout: () => Promise<void>;
  checkAuth: () => Promise<void>;
  updateOnboarding: (data: any) => Promise<void>;
  setUser: (user: User) => void;
  setWorkspace: (workspace: Workspace) => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  workspace: null,
  isLoading: true,
  isAuthenticated: false,

  login: async (email, password) => {
    const res = await auth.login({ email, password });
    set({
      user: res.data.user,
      workspace: res.data.workspace,
      isAuthenticated: true,
    });
  },

  register: async (email, password, name) => {
    const res = await auth.register({ email, password, name });
    set({
      user: res.data.user,
      workspace: res.data.workspace,
      isAuthenticated: true,
    });
  },

  logout: async () => {
    await auth.logout();
    set({
      user: null,
      workspace: null,
      isAuthenticated: false,
    });
  },

  checkAuth: async () => {
    try {
      const res = await auth.me();
      set({
        user: res.data.user,
        workspace: res.data.workspace,
        isAuthenticated: true,
        isLoading: false,
      });
    } catch {
      set({
        user: null,
        workspace: null,
        isAuthenticated: false,
        isLoading: false,
      });
    }
  },

  updateOnboarding: async (data: any) => {
    await auth.updateOnboarding(data);
    set((state) => ({
      user: state.user
        ? { ...state.user, onboardingCompleted: true, onboardingData: data }
        : null,
    }));
  },

  setUser: (user) => set({ user }),
  setWorkspace: (workspace) => set({ workspace }),
}));
