import { useState, useEffect } from 'react';
import { Outlet, NavLink, useNavigate, useLocation } from 'react-router-dom';
import { useAuthStore } from '../../stores/authStore';
import {
  LayoutDashboard, Plus, FolderOpen, Mic2, Lightbulb,
  Megaphone, Link2, Settings, CreditCard, LogOut, Menu, X, CalendarDays, Users, ShieldCheck
} from 'lucide-react';
import NotificationBell from '../ui/NotificationBell';
import ThemeToggle from '../ui/ThemeToggle';

interface NavItem {
  to: string;
  icon: typeof LayoutDashboard;
  label: string;
  matchPaths?: string[];
}

const baseNavItems: NavItem[] = [
  { to: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/create', icon: Plus, label: 'Create' },
  { to: '/library', icon: FolderOpen, label: 'Content Library', matchPaths: ['/library', '/content'] },
  { to: '/brand-voice', icon: Mic2, label: 'Brand Voice' },
  { to: '/ideas', icon: Lightbulb, label: 'Content Ideas' },
  { to: '/calendar', icon: CalendarDays, label: 'Calendar' },
  { to: '/team', icon: Users, label: 'Team' },
  { to: '/campaigns', icon: Megaphone, label: 'Campaigns' },
  { to: '/integrations', icon: Link2, label: 'Integrations' },
];

const tailNavItems: NavItem[] = [
  { to: '/settings', icon: Settings, label: 'Settings' },
  { to: '/billing', icon: CreditCard, label: 'Billing' },
];

export default function AppLayout() {
  const { user, workspace, logout } = useAuthStore();
  const navItems: NavItem[] = user?.isAdmin
    ? [...baseNavItems, { to: '/admin', icon: ShieldCheck, label: 'Admin' }, ...tailNavItems]
    : [...baseNavItems, ...tailNavItems];
  const navigate = useNavigate();
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  // Close sidebar on navigation (mobile)
  useEffect(() => {
    setSidebarOpen(false);
  }, [location.pathname]);

  return (
    <div className="flex h-screen" style={{ background: 'var(--color-paper)' }}>
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-30"
          style={{ background: 'oklch(18% 0.014 270 / 0.4)' }}
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-64 flex-col transition-transform duration-200 lg:static lg:translate-x-0 ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
        style={{
          background: 'var(--color-paper)',
          borderRight: 'var(--rule-width) solid var(--color-rule)',
        }}
      >
        {/* Wordmark — Newsreader serif */}
        <div
          className="flex h-16 items-center gap-3 px-5"
          style={{ borderBottom: 'var(--rule-width) solid var(--color-rule)' }}
        >
          <span
            className="text-xl font-bold tracking-tight"
            style={{ fontFamily: 'var(--font-display)', color: 'var(--color-ink)' }}
          >
            Seed
          </span>
          <button
            onClick={() => setSidebarOpen(false)}
            className="ml-auto lg:hidden"
            style={{ color: 'var(--color-muted)' }}
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-0.5">
          {navItems.map((item) => {
            const isActive = item.matchPaths
              ? item.matchPaths.some((p) => location.pathname.startsWith(p))
              : location.pathname === item.to;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                className="sidebar-link"
                style={isActive ? {
                  background: 'var(--color-paper-2)',
                  color: 'var(--color-accent)',
                  fontWeight: 600,
                } : undefined}
              >
                <item.icon className="h-4 w-4" style={{ opacity: 0.7 }} />
                {item.label}
              </NavLink>
            );
          })}
        </nav>

        {/* Theme toggle */}
        <div
          className="px-3 pb-3"
        >
          <ThemeToggle />
        </div>

        {/* User section */}
        <div
          className="p-4"
          style={{ borderTop: 'var(--rule-width) solid var(--color-rule)' }}
        >
          <div className="flex items-center gap-3">
            <div
              className="flex h-8 w-8 items-center justify-center rounded-full text-sm font-semibold"
              style={{
                background: 'var(--color-paper-2)',
                color: 'var(--color-accent)',
                fontFamily: 'var(--font-display)',
              }}
            >
              {user?.name?.charAt(0).toUpperCase() || 'U'}
            </div>
            <div className="flex-1 min-w-0">
              <p
                className="text-sm font-medium truncate"
                style={{ color: 'var(--color-ink)', fontFamily: 'var(--font-display)' }}
              >
                {user?.name}
              </p>
              <p className="text-xs truncate" style={{ color: 'var(--color-muted)' }}>
                {workspace?.plan} plan
              </p>
            </div>
            <NotificationBell placement="sidebar" />
            <button
              onClick={handleLogout}
              className="rounded p-1.5 transition-colors"
              style={{ color: 'var(--color-muted)' }}
              title="Logout"
              onMouseEnter={(e) => { (e.target as HTMLElement).style.color = 'var(--color-ink)'; (e.target as HTMLElement).style.background = 'var(--color-paper-2)'; }}
              onMouseLeave={(e) => { (e.target as HTMLElement).style.color = 'var(--color-muted)'; (e.target as HTMLElement).style.background = 'transparent'; }}
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Mobile header */}
        <header
          className="flex h-14 items-center gap-4 px-4 lg:hidden"
          style={{
            background: 'var(--color-paper)',
            borderBottom: 'var(--rule-width) solid var(--color-rule)',
          }}
        >
          <button onClick={() => setSidebarOpen(true)} style={{ color: 'var(--color-ink-2)' }}>
            <Menu className="h-5 w-5" />
          </button>
          <span
            className="font-bold tracking-tight"
            style={{ fontFamily: 'var(--font-display)', color: 'var(--color-ink)' }}
          >
            Seed
          </span>
          <div className="ml-auto" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <ThemeToggle />
            <NotificationBell />
          </div>
        </header>

        <main className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
