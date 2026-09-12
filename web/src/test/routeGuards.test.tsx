import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import App from '../App';
import { useAuthStore } from '../stores/authStore';
import { auth } from '../lib/api';

// ── Mock the API layer ───────────────────────────────────────────
// Every page module is imported by App; the api mock must satisfy all
// named exports so those imports resolve without touching the network.
vi.mock('../lib/api', () => {
  const resolved = (data: any = {}) => vi.fn().mockResolvedValue({ success: true, data });
  const emptyList = () => vi.fn().mockResolvedValue({ success: true, data: [] });
  return {
    auth: {
      login: vi.fn(), register: vi.fn(), logout: vi.fn(), me: vi.fn(),
      forgotPassword: vi.fn(), resetPassword: vi.fn(), updateOnboarding: vi.fn(),
    },
    notifications: {
      list: emptyList(), unreadCount: resolved({ count: 0 }),
      markRead: vi.fn(), markAllRead: vi.fn(), delete: vi.fn(), clearAll: vi.fn(),
    },
    stats: { get: resolved({}) },
    content: {
      list: emptyList(), get: vi.fn(), getStatus: vi.fn(), create: vi.fn(),
      createFromText: vi.fn(), createFromUrl: vi.fn(), export: vi.fn(),
      generate: vi.fn(), regenerate: vi.fn(), updateTranscript: vi.fn(),
      updateGenerated: vi.fn(), rewrite: vi.fn(), delete: vi.fn(),
    },
    workspaces: { list: emptyList(), current: resolved({}), update: vi.fn() },
    brandVoices: { list: emptyList(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
    campaigns: { list: emptyList(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
    ideas: { list: emptyList(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
    billing: {
      plans: emptyList(), usage: resolved({}), subscription: resolved({}),
      checkout: vi.fn(), portal: vi.fn(), cancel: vi.fn(), uncancel: vi.fn(),
    },
    integrations: {
      list: vi.fn().mockResolvedValue({ success: true, data: [], providers: {} }),
      connect: vi.fn(), disconnect: vi.fn(),
      oauthStartUrl: (p: string) => `/integrations/${p}/oauth/start`,
    },
    scheduler: {
      list: emptyList(), get: vi.fn(), create: vi.fn(), reschedule: vi.fn(),
      updateNotes: vi.fn(), cancel: vi.fn(), retry: vi.fn(), markPublished: vi.fn(), delete: vi.fn(),
    },
    team: {
      members: emptyList(), invites: emptyList(), invite: vi.fn(), acceptInvite: vi.fn(),
      updateRole: vi.fn(), removeMember: vi.fn(), revokeInvite: vi.fn(), leave: vi.fn(),
    },
    settings: {
      getApiKey: resolved({}), saveApiKey: vi.fn(), removeApiKey: vi.fn(),
      updateProfile: vi.fn(), changePassword: vi.fn(),
    },
    adminApi: {
      overview: resolved({}), users: resolved({ data: [] }), userDetail: resolved({}),
      setStatus: vi.fn(), setAdmin: vi.fn(), workspaces: resolved({ data: [] }),
    },
  };
});

// ── Replace layouts + pages with labelled probes ─────────────────
// The guard tests assert *which route rendered*; the real page bodies
// add network/lifecycle noise that has nothing to do with routing.
vi.mock('../components/layout/AppLayout', async () => {
  const { Outlet } = await import('react-router-dom');
  return { default: () => <Outlet /> };
});
vi.mock('../components/layout/PublicLayout', async () => {
  const { Outlet } = await import('react-router-dom');
  return { default: () => <Outlet /> };
});
vi.mock('../pages/DashboardPage', () => ({ default: () => <div>page:dashboard</div> }));
vi.mock('../pages/LoginPage', () => ({ default: () => <div>page:login</div> }));
vi.mock('../pages/RegisterPage', () => ({ default: () => <div>page:register</div> }));
vi.mock('../pages/ForgotPasswordPage', () => ({ default: () => <div>page:forgot</div> }));
vi.mock('../pages/OnboardingPage', () => ({ default: () => <div>page:onboarding</div> }));
vi.mock('../pages/LandingPage', () => ({ default: () => <div>page:landing</div> }));

const mockedAuth = vi.mocked(auth, true);

const workspace = { id: 'w1', name: 'W', plan: 'free' as const, ownerId: 'u1' };
const onboardedUser = {
  id: 'u1', email: 'a@b.co', name: 'A', isAdmin: false, onboardingCompleted: true,
};
const freshUser = { ...onboardedUser, onboardingCompleted: false };

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>
  );
}

function authenticateAs(user: typeof onboardedUser) {
  mockedAuth.me.mockResolvedValue({ data: { user, workspace } } as any);
  useAuthStore.setState({ user, workspace, isAuthenticated: true, isLoading: true });
}

describe('Route guards', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthStore.setState({ user: null, workspace: null, isLoading: true, isAuthenticated: false });
  });

  it('shows a loading state while the session is being resolved', async () => {
    mockedAuth.me.mockImplementation(() => new Promise(() => {})); // never resolves
    renderAt('/dashboard');

    expect(await screen.findByText(/loading/i)).toBeInTheDocument();
  });

  it('redirects an unauthenticated visitor away from a protected route to /login', async () => {
    mockedAuth.me.mockRejectedValue(new Error('401'));
    renderAt('/dashboard');

    expect(await screen.findByText('page:login')).toBeInTheDocument();
  });

  it('redirects an unauthenticated visitor from the calendar to /login', async () => {
    mockedAuth.me.mockRejectedValue(new Error('401'));
    renderAt('/calendar');

    expect(await screen.findByText('page:login')).toBeInTheDocument();
  });

  it('sends an unauthenticated visitor hitting an unknown route to the landing page', async () => {
    mockedAuth.me.mockRejectedValue(new Error('401'));
    renderAt('/this-route-does-not-exist');

    expect(await screen.findByText('page:landing')).toBeInTheDocument();
  });

  it('forces a not-yet-onboarded user onto /onboarding from any app page', async () => {
    authenticateAs(freshUser);
    renderAt('/dashboard');

    expect(await screen.findByText('page:onboarding')).toBeInTheDocument();
  });

  it('allows an onboarded user into the dashboard', async () => {
    authenticateAs(onboardedUser);
    renderAt('/dashboard');

    expect(await screen.findByText('page:dashboard')).toBeInTheDocument();
  });

  it('keeps an onboarded user on /onboarding when they visit it directly', async () => {
    authenticateAs(onboardedUser);
    renderAt('/onboarding');

    expect(await screen.findByText('page:onboarding')).toBeInTheDocument();
  });

  it('bounces an authenticated user off /login to the dashboard', async () => {
    authenticateAs(onboardedUser);
    renderAt('/login');

    expect(await screen.findByText('page:dashboard')).toBeInTheDocument();
  });

  it('bounces an authenticated but not-onboarded user off /register to onboarding', async () => {
    authenticateAs(freshUser);
    renderAt('/register');

    expect(await screen.findByText('page:onboarding')).toBeInTheDocument();
  });

  it('renders the public login page for an unauthenticated visitor', async () => {
    mockedAuth.me.mockRejectedValue(new Error('401'));
    renderAt('/login');

    expect(await screen.findByText('page:login')).toBeInTheDocument();
  });
});
