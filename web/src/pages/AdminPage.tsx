import { useCallback, useEffect, useState } from 'react';
import { ShieldCheck, ShieldOff, Shield, Search, ChevronLeft, ChevronRight } from 'lucide-react';
import { adminApi } from '../lib/api';

interface AdminUser {
  id: string;
  email: string;
  name: string;
  isAdmin: boolean;
  status: string;
  createdAt: string;
  workspace: { id: string; name: string; plan: string } | null;
  projectCount: number;
}

interface AdminWorkspace {
  id: string;
  name: string;
  plan: string;
  memberCount: number;
  projectCount: number;
  generatedCount: number;
  members: { id: string; name: string; email: string; role: string }[];
}

interface Overview {
  users: { total: number; active: number; disabled: number; admins: number };
  workspaces: { total: number; plans: Record<string, number> };
  content: { totalProjects: number; projectsThisMonth: number; totalGenerated: number };
  scheduling: { scheduledUpcoming: number; published: number };
}

export default function AdminPage() {
  const [tab, setTab] = useState<'overview' | 'users' | 'workspaces'>('overview');
  const [overview, setOverview] = useState<Overview | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [workspaces, setWorkspaces] = useState<AdminWorkspace[]>([]);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      if (tab === 'overview') {
        const res = await adminApi.overview();
        setOverview(res.data);
      } else if (tab === 'users') {
        const res = await adminApi.users({ page, limit: 20, search });
        setUsers(res.data);
        setPages(res.pages || 1);
      } else {
        const res = await adminApi.workspaces({ page, limit: 20 });
        setWorkspaces(res.data);
        setPages(res.pages || 1);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [tab, page, search]);

  useEffect(() => {
    load();
  }, [load]);

  const setDisabled = async (u: AdminUser, status: 'active' | 'disabled') => {
    setBusyId(u.id);
    try {
      await adminApi.setStatus(u.id, status);
      await load();
    } catch (err: any) {
      alert(err.message);
    } finally {
      setBusyId(null);
    }
  };

  const toggleAdmin = async (u: AdminUser) => {
    setBusyId(u.id);
    try {
      await adminApi.setAdmin(u.id, !u.isAdmin);
      await load();
    } catch (err: any) {
      alert(err.message);
    } finally {
      setBusyId(null);
    }
  };

  const stat = (label: string, value: number | string) => (
    <div
      key={label}
      className="rounded-lg p-4"
      style={{ background: 'var(--color-paper-2)', border: 'var(--rule-width) solid var(--color-rule)' }}
    >
      <div className="text-2xl font-bold" style={{ fontFamily: 'var(--font-display)', color: 'var(--color-ink)' }}>
        {value}
      </div>
      <div className="mt-1 text-xs uppercase tracking-wider" style={{ color: 'var(--color-muted)' }}>
        {label}
      </div>
    </div>
  );

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold" style={{ fontFamily: 'var(--font-display)', color: 'var(--color-ink)' }}>
            Platform Admin
          </h1>
          <p className="mt-1 text-sm" style={{ color: 'var(--color-ink-2)' }}>
            Manage users, workspaces, and monitor platform health.
          </p>
        </div>
        <div className="flex gap-1 rounded-lg p-1" style={{ background: 'var(--color-paper-2)', border: 'var(--rule-width) solid var(--color-rule)' }}>
          {(['overview', 'users', 'workspaces'] as const).map((t) => (
            <button
              key={t}
              onClick={() => { setTab(t); setPage(1); }}
              className="rounded px-3 py-1.5 text-sm font-medium capitalize transition-colors"
              style={
                tab === t
                  ? { background: 'var(--color-accent)', color: 'white' }
                  : { color: 'var(--color-ink-2)' }
              }
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="mt-6 rounded-lg p-3 text-sm" style={{ background: 'oklch(95% 0.03 25)', color: 'oklch(40% 0.15 25)' }}>
          {error}
        </div>
      )}

      {loading ? (
        <div className="py-20 text-center text-sm" style={{ color: 'var(--color-muted)' }}>Loading…</div>
      ) : (
        <>
          {tab === 'overview' && overview && (
            <div className="mt-8 space-y-8">
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {stat('Total users', overview.users.total)}
                {stat('Active users', overview.users.active)}
                {stat('Disabled users', overview.users.disabled)}
                {stat('Admins', overview.users.admins)}
                {stat('Workspaces', overview.workspaces.total)}
                {stat('Total projects', overview.content.totalProjects)}
                {stat('Projects this month', overview.content.projectsThisMonth)}
                {stat('Pieces generated', overview.content.totalGenerated)}
                {stat('Scheduled (upcoming)', overview.scheduling.scheduledUpcoming)}
                {stat('Posts published', overview.scheduling.published)}
              </div>
              <div>
                <h2 className="text-sm font-semibold uppercase tracking-wider" style={{ color: 'var(--color-muted)' }}>
                  Plan distribution
                </h2>
                <div className="mt-3 flex flex-wrap gap-3">
                  {Object.entries(overview.workspaces.plans).map(([plan, count]) => (
                    <div
                      key={plan}
                      className="rounded-full px-4 py-1.5 text-sm font-medium capitalize"
                      style={{ background: 'var(--color-paper-2)', border: 'var(--rule-width) solid var(--color-rule)', color: 'var(--color-ink)' }}
                    >
                      {plan}: {count}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {tab === 'users' && (
            <div className="mt-8">
              <div className="flex items-center gap-2">
                <Search className="h-4 w-4" style={{ color: 'var(--color-muted)' }} />
                <input
                  value={search}
                  onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                  placeholder="Search by name or email…"
                  className="input flex-1"
                  style={{ padding: '0.5rem 0.75rem' }}
                />
              </div>

              <div className="mt-4 overflow-x-auto rounded-lg" style={{ border: 'var(--rule-width) solid var(--color-rule)' }}>
                <table className="w-full text-sm">
                  <thead>
                    <tr style={{ background: 'var(--color-paper-2)', borderBottom: 'var(--rule-width) solid var(--color-rule)' }}>
                      <th className="px-4 py-2.5 text-left font-semibold">User</th>
                      <th className="px-4 py-2.5 text-left font-semibold">Workspace</th>
                      <th className="px-4 py-2.5 text-left font-semibold">Projects</th>
                      <th className="px-4 py-2.5 text-left font-semibold">Status</th>
                      <th className="px-4 py-2.5 text-right font-semibold">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {users.map((u) => (
                      <tr key={u.id} style={{ borderBottom: 'var(--rule-width) solid var(--color-rule)' }}>
                        <td className="px-4 py-3">
                          <div className="font-medium" style={{ color: 'var(--color-ink)' }}>{u.name}</div>
                          <div className="text-xs" style={{ color: 'var(--color-muted)' }}>{u.email}</div>
                        </td>
                        <td className="px-4 py-3">
                          {u.workspace ? (
                            <span className="capitalize" style={{ color: 'var(--color-ink-2)' }}>
                              {u.workspace.name} · {u.workspace.plan}
                            </span>
                          ) : (
                            <span style={{ color: 'var(--color-muted)' }}>—</span>
                          )}
                        </td>
                        <td className="px-4 py-3" style={{ color: 'var(--color-ink-2)' }}>{u.projectCount}</td>
                        <td className="px-4 py-3">
                          {u.status === 'disabled' ? (
                            <span className="rounded-full px-2 py-0.5 text-xs font-medium" style={{ background: 'oklch(95% 0.03 25)', color: 'oklch(40% 0.15 25)' }}>Disabled</span>
                          ) : (
                            <span className="rounded-full px-2 py-0.5 text-xs font-medium" style={{ background: 'oklch(95% 0.03 145)', color: 'oklch(35% 0.12 145)' }}>Active</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex justify-end gap-2">
                            <button
                              onClick={() => toggleAdmin(u)}
                              disabled={busyId === u.id}
                              title={u.isAdmin ? 'Revoke admin' : 'Grant admin'}
                              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium disabled:opacity-50"
                              style={{ border: 'var(--rule-width) solid var(--color-rule)', color: u.isAdmin ? 'var(--color-accent)' : 'var(--color-ink-2)' }}
                            >
                              {u.isAdmin ? <ShieldCheck className="h-3.5 w-3.5" /> : <Shield className="h-3.5 w-3.5" />}
                              {u.isAdmin ? 'Admin' : 'Make admin'}
                            </button>
                            {u.status === 'disabled' ? (
                              <button
                                onClick={() => setDisabled(u, 'active')}
                                disabled={busyId === u.id}
                                className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium disabled:opacity-50"
                                style={{ border: 'var(--rule-width) solid var(--color-rule)', color: 'oklch(35% 0.12 145)' }}
                              >
                                <ShieldOff className="h-3.5 w-3.5" /> Re-enable
                              </button>
                            ) : (
                              <button
                                onClick={() => setDisabled(u, 'disabled')}
                                disabled={busyId === u.id}
                                className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium disabled:opacity-50"
                                style={{ border: 'var(--rule-width) solid var(--color-rule)', color: 'oklch(40% 0.15 25)' }}
                              >
                                <ShieldOff className="h-3.5 w-3.5" /> Disable
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                    {users.length === 0 && (
                      <tr><td colSpan={5} className="px-4 py-8 text-center" style={{ color: 'var(--color-muted)' }}>No users found.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>

              <div className="mt-4 flex items-center justify-between text-sm" style={{ color: 'var(--color-ink-2)' }}>
                <span>Page {page} of {pages}</span>
                <div className="flex gap-2">
                  <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1} className="btn-secondary disabled:opacity-40" style={{ padding: '0.35rem 0.6rem' }}>
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                  <button onClick={() => setPage((p) => Math.min(pages, p + 1))} disabled={page >= pages} className="btn-secondary disabled:opacity-40" style={{ padding: '0.35rem 0.6rem' }}>
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </div>
          )}

          {tab === 'workspaces' && (
            <div className="mt-8 space-y-4">
              {workspaces.map((ws) => (
                <div
                  key={ws.id}
                  className="rounded-lg p-4"
                  style={{ background: 'var(--color-paper-2)', border: 'var(--rule-width) solid var(--color-rule)' }}
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="font-semibold" style={{ color: 'var(--color-ink)' }}>{ws.name}</div>
                      <div className="text-xs capitalize" style={{ color: 'var(--color-muted)' }}>{ws.plan} plan</div>
                    </div>
                    <div className="flex gap-6 text-sm" style={{ color: 'var(--color-ink-2)' }}>
                      <span>{ws.memberCount} member{ws.memberCount !== 1 ? 's' : ''}</span>
                      <span>{ws.projectCount} project{ws.projectCount !== 1 ? 's' : ''}</span>
                      <span>{ws.generatedCount} piece{ws.generatedCount !== 1 ? 's' : ''}</span>
                    </div>
                  </div>
                  {ws.members.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {ws.members.map((m) => (
                        <span key={m.id} className="rounded-full px-3 py-1 text-xs" style={{ background: 'var(--color-paper)', border: 'var(--rule-width) solid var(--color-rule)', color: 'var(--color-ink-2)' }}>
                          {m.name} · {m.role}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
              {workspaces.length === 0 && (
                <div className="py-12 text-center text-sm" style={{ color: 'var(--color-muted)' }}>No workspaces.</div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
