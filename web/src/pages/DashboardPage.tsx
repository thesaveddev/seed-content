import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';
import { stats as statsApi, content as contentApi, billing as billingApi } from '../lib/api';
import { Plus, FileText, Mic2, Megaphone, TrendingUp, ArrowRight, Clock, AlertCircle, CheckCircle2 } from 'lucide-react';
import type { ContentProject } from '../types';

const statusConfig: Record<string, { color: string; icon: any; label: string }> = {
  processing: { color: 'bg-blue-100 info', icon: Clock, label: 'Processing' },
  transcribing: { color: 'bg-blue-100 info', icon: Clock, label: 'Transcribing' },
  analysing: { color: 'bg-blue-100 info', icon: Clock, label: 'Analysing' },
  generating: { color: 'bg-blue-100 info', icon: Clock, label: 'Generating' },
  quality_check: { color: 'bg-blue-100 info', icon: Clock, label: 'Checking quality' },
  ready: { color: 'bg-green-100 text-green-700', icon: CheckCircle2, label: 'Ready' },
  failed: { color: 'bg-red-100 error', icon: AlertCircle, label: 'Failed' },
  draft: { color: 'bg-gray-100 text-ink-2', icon: FileText, label: 'Draft' },
};

const platformIcons: Record<string, string> = {
  linkedin: '💼',
  x: '𝕏',
  instagram: '📸',
  tiktok: '🎵',
  youtube: '▶️',
  threads: '🧵',
  newsletter: '📧',
  blog: '✍️',
};

function getGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

export default function DashboardPage() {
  const { user, checkAuth } = useAuthStore();
  const navigate = useNavigate();
  const [stats, setStats] = useState<any>(null);
  const [recentContent, setRecentContent] = useState<ContentProject[]>([]);
  const [usage, setUsage] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        // Refresh user data in background to keep name/email fresh
        checkAuth();
        const [statsRes, contentRes, usageRes] = await Promise.all([
          statsApi.get(),
          contentApi.list({ limit: 6 }),
          billingApi.usage().catch(() => null),
        ]);
        setStats(statsRes.data);
        setRecentContent(contentRes.data);
        if (usageRes) setUsage(usageRes.data);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  const statCards = [
    { label: 'Content created', value: stats?.contentCreated || 0, icon: FileText, color: 'bg-paper-2 text-accent' },
    { label: 'Pieces generated', value: stats?.piecesGenerated || 0, icon: TrendingUp, color: 'bg-success/10 text-success' },
    { label: 'Campaigns', value: stats?.campaignsCreated || 0, icon: Megaphone, color: 'bg-info/10 text-info' },
    { label: 'Ready to publish', value: stats?.contentPublished || 0, icon: Mic2, color: 'bg-warning/10 text-warning' },
  ];

  return (
    <div className="space-y-8 animate-fade-in">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-ink">
          {getGreeting()}, {user?.name?.split(' ')[0] || 'there'}
        </h1>
        <p className="mt-1 text-ink-2">What are you turning into content today?</p>
        <Link to="/create" className="btn-primary mt-4 inline-flex">
          <Plus className="h-4 w-4" />
          Create Content
        </Link>
      </div>

      {/* Stats */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {statCards.map((stat) => (
          <div key={stat.label} className="card p-5">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-ink-2">{stat.label}</span>
              <div className={`rounded-lg p-2 ${stat.color}`}>
                <stat.icon className="h-4 w-4" />
              </div>
            </div>
            <p className="mt-2 text-3xl font-bold text-ink">{stat.value}</p>
          </div>
        ))}
      </div>

      {/* Usage Limits */}
      {usage && (
        <div className="card p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-ink">Monthly Usage</h2>
            <span className="badge bg-paper-3 text-brand-700 capitalize">{usage.plan} plan</span>
          </div>
          <div className="space-y-3">
            <div>
              <div className="flex items-center justify-between text-xs mb-1">
                <span className="text-muted">Projects</span>
                <span className="text-ink-2 font-medium">
                  {usage.usage.projects} / {usage.limits.projectsPerMonth}
                </span>
              </div>
              <div className="h-1.5 rounded-full bg-paper-3 overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${
                    usage.usage.projects / usage.limits.projectsPerMonth > 0.8
                      ? 'bg-red-500'
                      : usage.usage.projects / usage.limits.projectsPerMonth > 0.5
                      ? 'bg-amber-500'
                      : 'bg-accent'
                  }`}
                  style={{ width: `${Math.min(100, (usage.usage.projects / usage.limits.projectsPerMonth) * 100)}%` }}
                />
              </div>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted">Brands voices</span>
              <span className="text-ink-2">
                {usage.limits.brandVoices < 0 ? 'Unlimited' : `${usage.limits.brandVoices} allowed`}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Quick Create */}
      <div className="card p-6">
        <h2 className="text-lg font-semibold text-ink">Quick Create</h2>
        <Link
          to="/create"
          className="mt-4 flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-gray-300 bg-paper-2 p-8 text-center transition-colors hover:border-brand-400 hover:bg-paper-2"
        >
          <div className="rounded-full bg-paper-3 p-3">
            <Plus className="h-6 w-6 text-accent" />
          </div>
          <p className="mt-3 font-medium text-ink">Drop a video, audio file or content here</p>
          <p className="mt-1 text-sm text-muted">or paste a URL</p>
        </Link>
      </div>

      {/* Recent Content */}
      <div>
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-ink">Recent Content</h2>
          <Link to="/library" className="text-sm font-medium text-accent hover:text-brand-700">
            View all →
          </Link>
        </div>

        {loading ? (
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="card p-5 animate-pulse">
                <div className="h-4 w-2/3 rounded bg-gray-200" />
                <div className="mt-3 h-3 w-1/2 rounded bg-gray-100" />
                <div className="mt-4 h-3 w-1/3 rounded bg-gray-100" />
              </div>
            ))}
          </div>
        ) : recentContent.length === 0 ? (
          <div className="mt-4 card p-12 text-center">
            <div className="text-4xl">📝</div>
            <h3 className="mt-4 font-medium text-ink">No content yet</h3>
            <p className="mt-1 text-sm text-muted">Create your first content pack to get started.</p>
            <Link to="/create" className="btn-primary mt-4 inline-flex">
              <Plus className="h-4 w-4" />
              Create Content
            </Link>
          </div>
        ) : (
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {recentContent.map((item) => {
              const status = statusConfig[item.status] || statusConfig.draft;
              return (
                <Link
                  key={item._id}
                  to={`/content/${item._id}`}
                  className="card p-5 transition-all hover:shadow-md"
                >
                  <div className="flex items-start justify-between">
                    <h3 className="font-medium text-ink line-clamp-2">{item.title}</h3>
                    <span className={`badge ${status.color} shrink-0`}>
                      <status.icon className="mr-1 h-3 w-3" />
                      {status.label}
                    </span>
                  </div>
                  <p className="mt-2 text-xs text-muted">
                    {new Date(item.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                  </p>
                  <div className="mt-3 flex items-center gap-1.5">
                    {(item.platforms || item.selectedPlatforms || []).slice(0, 5).map((p: string) => (
                      <span key={p} className="text-sm" title={p}>
                        {platformIcons[p] || '📝'}
                      </span>
                    ))}
                    {item.generatedCount ? (
                      <span className="ml-auto text-xs text-muted">{item.generatedCount} pieces</span>
                    ) : null}
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
