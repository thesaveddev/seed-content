import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the API layer — the store must be tested in isolation from the network
vi.mock('../lib/api', () => ({
  auth: {
    login: vi.fn(),
    register: vi.fn(),
    logout: vi.fn(),
    me: vi.fn(),
    updateOnboarding: vi.fn(),
  },
}));

import { useAuthStore } from '../stores/authStore';
import { auth } from '../lib/api';

const mockedAuth = vi.mocked(auth, true);

const sampleUser = {
  id: 'u1',
  email: 'jane@example.com',
  name: 'Jane Doe',
  isAdmin: false,
  onboardingCompleted: false,
};
const sampleWorkspace = { id: 'w1', name: "Jane's Workspace", plan: 'free' as const, ownerId: 'u1' };

function resetStore() {
  useAuthStore.setState({
    user: null,
    workspace: null,
    isLoading: true,
    isAuthenticated: false,
  });
}

describe('authStore', () => {
  beforeEach(() => {
    resetStore();
    vi.clearAllMocks();
  });

  it('starts unauthenticated with loading=true', () => {
    const s = useAuthStore.getState();
    expect(s.isAuthenticated).toBe(false);
    expect(s.user).toBeNull();
    expect(s.isLoading).toBe(true);
  });

  it('login sets user, workspace, and authenticated state', async () => {
    mockedAuth.login.mockResolvedValueOnce({
      data: { user: sampleUser, workspace: sampleWorkspace, token: 'tok' },
    });

    await useAuthStore.getState().login('jane@example.com', 'Password123!');

    const s = useAuthStore.getState();
    expect(mockedAuth.login).toHaveBeenCalledWith({
      email: 'jane@example.com',
      password: 'Password123!',
    });
    expect(s.isAuthenticated).toBe(true);
    expect(s.user?.id).toBe('u1');
    expect(s.workspace?.plan).toBe('free');
  });

  it('failed login does not authenticate', async () => {
    mockedAuth.login.mockRejectedValueOnce(new Error('Invalid email or password'));

    await expect(
      useAuthStore.getState().login('jane@example.com', 'wrong')
    ).rejects.toThrow('Invalid email or password');

    const s = useAuthStore.getState();
    expect(s.isAuthenticated).toBe(false);
    expect(s.user).toBeNull();
  });

  it('register sets authenticated state', async () => {
    mockedAuth.register.mockResolvedValueOnce({
      data: { user: sampleUser, workspace: sampleWorkspace, token: 'tok' },
    });

    await useAuthStore.getState().register('jane@example.com', 'Password123!', 'Jane Doe');

    const s = useAuthStore.getState();
    expect(mockedAuth.register).toHaveBeenCalledWith({
      email: 'jane@example.com',
      password: 'Password123!',
      name: 'Jane Doe',
    });
    expect(s.isAuthenticated).toBe(true);
    expect(s.user?.name).toBe('Jane Doe');
  });

  it('logout clears all auth state', async () => {
    mockedAuth.logout.mockResolvedValueOnce({ success: true } as any);
    useAuthStore.setState({ user: sampleUser, workspace: sampleWorkspace, isAuthenticated: true });

    await useAuthStore.getState().logout();

    const s = useAuthStore.getState();
    expect(s.isAuthenticated).toBe(false);
    expect(s.user).toBeNull();
    expect(s.workspace).toBeNull();
  });

  it('checkAuth hydrates the session when a valid cookie exists', async () => {
    mockedAuth.me.mockResolvedValueOnce({
      data: { user: sampleUser, workspace: sampleWorkspace },
    });

    await useAuthStore.getState().checkAuth();

    const s = useAuthStore.getState();
    expect(s.isAuthenticated).toBe(true);
    expect(s.user?.id).toBe('u1');
    expect(s.isLoading).toBe(false);
  });

  it('checkAuth clears state and stops loading when the session is invalid', async () => {
    mockedAuth.me.mockRejectedValueOnce(new Error('401'));

    await useAuthStore.getState().checkAuth();

    const s = useAuthStore.getState();
    expect(s.isAuthenticated).toBe(false);
    expect(s.user).toBeNull();
    expect(s.workspace).toBeNull();
    expect(s.isLoading).toBe(false);
  });

  it('updateOnboarding calls the API and marks onboarding complete', async () => {
    mockedAuth.updateOnboarding.mockResolvedValueOnce({ success: true } as any);
    useAuthStore.setState({ user: sampleUser, isAuthenticated: true });

    const data = { role: 'founder', audience: 'creators' };
    await useAuthStore.getState().updateOnboarding(data);

    expect(mockedAuth.updateOnboarding).toHaveBeenCalledWith(data);
    expect(useAuthStore.getState().user?.onboardingCompleted).toBe(true);
  });

  it('setUser and setWorkspace patch their slices', () => {
    useAuthStore.getState().setUser(sampleUser);
    expect(useAuthStore.getState().user?.id).toBe('u1');

    useAuthStore.getState().setWorkspace(sampleWorkspace);
    expect(useAuthStore.getState().workspace?.id).toBe('w1');
  });
});
