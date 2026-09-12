import { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { content as contentApi } from '../lib/api';
import { Search, Plus, FileText, Clock, AlertCircle, CheckCircle2 } from 'lucide-react';
import toast from 'react-hot-toast';
import type { ContentProject } from '../types';

const statusConfig: Record<string, { color: string; icon: any; label: string }> = {
  processing: { color: 'bg-blue-100 text-blue-700', icon: Clock, label: 'Processing' },
  transcribing: { color: 'bg-blue-100 text-blue-700', icon: Clock, label: 'Transcribing' },
  analysing: { color: 'bg-blue-100 text-blue-700', icon: Clock, label: 'Analysing' },
  generating: { color: 'bg-blue-100 text-blue-700', icon: Clock, label: 'Generating' },
  quality_check: { color: 'bg-blue-100 text-blue-700', icon: Clock, label: 'Checking' },
  ready: { color: 'bg-green-100 text-green-700', icon: CheckCircle2, label: 'Ready' },
  failed: { color: 'bg-red-100 text-red-700', icon: AlertCircle, label: 'Failed' },
  draft: { color: 'bg-gray-100 text-ink-2', icon: FileText, label: 'Draft' },
};

const platformIcons: Record<string, string> = {
  linkedin: '💼', x: '𝕏', instagram: '📸', tiktok: '🎵',
  youtube: '▶️', threads: '🧵', newsletter: '📧', blog: '✍️',
};

const filters = [
  { id: 'all', label: 'All' },
  { id: 'ready', label: 'Ready' },
  { id: 'processing', label: 'Processing' },
  { id: 'failed', label: 'Failed' },
];

export default function ContentLibraryPage() {
  const [items, setItems] = useState<ContentProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const timerRef = useRef<ReturnType<typeof setTimeout>>();

  // Debounce search input
  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setDebouncedSearch(search), 300);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [search]);

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const res = await contentApi.list({
          status: statusFilter === 'all' ? undefined : statusFilter,
          search: debouncedSearch || undefined,
        });
        setItems(res.data);
      } catch (err: any) {
        toast.error('Failed to load content');
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [statusFilter, debouncedSearch]);

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-ink">Content Library</h1>
        <Link to="/create" className="btn-primary text-sm">
          <Plus className="h-4 w-4" />
          Create Content
        </Link>
      </div>

      {/* Filters */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="input pl-10"
            placeholder="Search content..."
          />
        </div>
        <div className="flex gap-1.5">
          {filters.map((f) => (
            <button
              key={f.id}
              onClick={() => setStatusFilter(f.id)}
              className={`rounded-lg px-3 py-2 text-xs font-medium transition-colors ${
                statusFilter === f.id
                  ? 'bg-accent text-white'
                  : 'bg-gray-100 text-ink-2 hover:bg-gray-200'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* List */}
      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="card p-5 animate-pulse">
              <div className="h-4 w-1/3 rounded bg-gray-200" />
              <div className="mt-2 h-3 w-1/5 rounded bg-gray-100" />
            </div>
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="card p-16 text-center">
          <FileText className="mx-auto h-12 w-12 text-gray-300" />
          <h3 className="mt-4 font-medium text-ink">
            {search ? 'No results found' : 'No content yet'}
          </h3>
          <p className="mt-1 text-sm text-muted">
            {search
              ? `No content matching "${search}". Try a different search term.`
              : 'Create your first content pack to get started.'}
          </p>
          {!search && (
            <Link to="/create" className="btn-primary mt-4 inline-flex text-sm">
              <Plus className="h-4 w-4" />
              Create Content
            </Link>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((item) => {
            const status = statusConfig[item.status] || statusConfig.draft;
            return (
              <Link
                key={item._id}
                to={`/content/${item._id}`}
                className="card flex items-center gap-4 p-4 transition-all hover:shadow-md"
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gray-100 shrink-0">
                  <FileText className="h-5 w-5 text-muted" />
                </div>
                <div className="min-w-0 flex-1">
                  <h3 className="font-medium text-ink truncate">{item.title}</h3>
                  <p className="mt-0.5 text-xs text-muted">
                    {new Date(item.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                    {item.generatedCount ? ` · ${item.generatedCount} pieces` : ''}
                  </p>
                </div>
                <div className="hidden sm:flex items-center gap-1.5">
                  {(item.platforms || item.selectedPlatforms || []).slice(0, 4).map((p: string) => (
                    <span key={p} className="text-sm" title={p}>{platformIcons[p] || '📝'}</span>
                  ))}
                </div>
                <span className={`badge ${status.color}`}>
                  <status.icon className="mr-1 h-3 w-3" />
                  {status.label}
                </span>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
