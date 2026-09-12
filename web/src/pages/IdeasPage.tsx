import { useState, useEffect } from 'react';
import { ideas as api } from '../lib/api';
import { Plus, Lightbulb, Trash2, X } from 'lucide-react';
import toast from 'react-hot-toast';
import type { ContentIdea } from '../types';

const statuses = ['idea', 'planned', 'creating', 'created', 'published'] as const;
const statusColors: Record<string, string> = {
  idea: 'bg-gray-100 text-ink-2',
  planned: 'bg-blue-100 text-blue-700',
  creating: 'bg-yellow-100 text-yellow-700',
  created: 'bg-green-100 text-green-700',
  published: 'bg-purple-100 text-purple-700',
};

const platformOptions = [
  { id: '', label: 'Any platform' },
  { id: 'linkedin', label: '💼 LinkedIn' },
  { id: 'x', label: '𝕏 X' },
  { id: 'instagram', label: '📸 Instagram' },
  { id: 'tiktok', label: '🎵 TikTok' },
  { id: 'youtube', label: '▶️ YouTube' },
  { id: 'threads', label: '🧵 Threads' },
  { id: 'newsletter', label: '📧 Newsletter' },
  { id: 'blog', label: '✍️ Blog' },
];

const goalOptions = [
  { id: '', label: 'Any goal' },
  { id: 'reach', label: '🌍 Reach' },
  { id: 'authority', label: '💡 Authority' },
  { id: 'conversion', label: '🎯 Conversion' },
];

export default function IdeasPage() {
  const [items, setItems] = useState<ContentIdea[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ title: '', description: '', platform: '', goal: '', status: 'idea' as string });

  useEffect(() => { load(); }, []);

  async function load() {
    try {
      const res = await api.list();
      setItems(res.data);
    } catch (err: any) {
      toast.error('Failed to load ideas');
    } finally {
      setLoading(false);
    }
  }

  async function handleCreate() {
    if (!form.title.trim()) { toast.error('Title required'); return; }
    try {
      await api.create(form);
      toast.success('Idea added');
      setShowForm(false);
      setForm({ title: '', description: '', platform: '', goal: '', status: 'idea' });
      load();
    } catch (err: any) {
      toast.error(err.message);
    }
  }

  async function handleStatusChange(id: string, status: string) {
    try {
      await api.update(id, { status });
      load();
    } catch (err: any) {
      toast.error(err.message);
    }
  }

  async function handleDelete(id: string) {
    try {
      await api.delete(id);
      load();
    } catch (err: any) {
      toast.error(err.message);
    }
  }

  const activeCount = items.filter((i) => i.status !== 'published').length;

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-ink">Content Ideas</h1>
          <p className="mt-1 text-sm text-ink-2">
            {activeCount > 0 ? `${activeCount} active idea${activeCount !== 1 ? 's' : ''}` : 'Track and plan your content ideas.'}
          </p>
        </div>
        <button onClick={() => setShowForm(!showForm)} className="btn-primary text-sm">
          <Plus className="h-4 w-4" /> Add Idea
        </button>
      </div>

      {showForm && (
        <div className="card p-5 animate-fade-in">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold text-ink">New Idea</h2>
            <button onClick={() => setShowForm(false)} className="btn-ghost p-1"><X className="h-4 w-4" /></button>
          </div>
          <div className="space-y-3">
            <input
              type="text"
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              className="input"
              placeholder="Idea title"
              autoFocus
            />
            <textarea
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              className="input min-h-[60px]"
              placeholder="Description..."
            />
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="label">Platform</label>
                <select
                  value={form.platform}
                  onChange={(e) => setForm((f) => ({ ...f, platform: e.target.value }))}
                  className="input"
                >
                  {platformOptions.map((p) => (
                    <option key={p.id} value={p.id}>{p.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">Goal</label>
                <select
                  value={form.goal}
                  onChange={(e) => setForm((f) => ({ ...f, goal: e.target.value }))}
                  className="input"
                >
                  {goalOptions.map((g) => (
                    <option key={g.id} value={g.id}>{g.label}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="flex gap-2 pt-1">
              <button onClick={handleCreate} className="btn-primary text-sm">Add Idea</button>
              <button onClick={() => setShowForm(false)} className="btn-secondary text-sm">Cancel</button>
            </div>
          </div>
        </div>
      )}

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="card p-4 animate-pulse">
              <div className="h-4 w-1/3 rounded bg-gray-200" />
              <div className="mt-2 h-3 w-1/4 rounded bg-gray-100" />
            </div>
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="card p-16 text-center">
          <Lightbulb className="mx-auto h-12 w-12 text-gray-300" />
          <h3 className="mt-4 font-medium text-ink">No ideas yet</h3>
          <p className="mt-1 text-sm text-muted">Add content ideas to plan ahead.</p>
          <button onClick={() => setShowForm(true)} className="btn-primary mt-4 text-sm">
            <Plus className="h-4 w-4" /> Add Idea
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((item) => (
            <div key={item._id} className="card p-4">
              <div className="flex items-start justify-between">
                <div className="min-w-0 flex-1">
                  <h3 className="font-medium text-ink">{item.title}</h3>
                  {item.description && <p className="mt-1 text-sm text-ink-2">{item.description}</p>}
                  <div className="mt-2 flex items-center gap-2 flex-wrap">
                    <select
                      value={item.status}
                      onChange={(e) => handleStatusChange(item._id, e.target.value)}
                      className="rounded-md border border-rule bg-paper px-2 py-1 text-xs font-medium"
                    >
                      {statuses.map((s) => <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
                    </select>
                    <span className={`badge text-xs ${statusColors[item.status] || 'bg-gray-100 text-ink-2'}`}>
                      {item.status}
                    </span>
                    {item.platform && (
                      <span className="badge bg-gray-100 text-ink-2">
                        {platformOptions.find((p) => p.id === item.platform)?.label || item.platform}
                      </span>
                    )}
                    {item.goal && (
                      <span className="badge bg-gray-100 text-ink-2">
                        {goalOptions.find((g) => g.id === item.goal)?.label || item.goal}
                      </span>
                    )}
                  </div>
                </div>
                <button onClick={() => handleDelete(item._id)} className="btn-ghost p-2 text-red-500 hover:text-red-700">
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
