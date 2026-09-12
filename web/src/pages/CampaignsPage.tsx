import { useState, useEffect } from 'react';
import { campaigns as api } from '../lib/api';
import { Plus, Megaphone, Trash2, Edit3, Save, X } from 'lucide-react';
import toast from 'react-hot-toast';
import type { Campaign } from '../types';

export default function CampaignsPage() {
  const [items, setItems] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', description: '' });

  useEffect(() => { load(); }, []);

  async function load() {
    try {
      const res = await api.list();
      setItems(res.data);
    } catch (err: any) {
      toast.error('Failed to load campaigns');
    } finally {
      setLoading(false);
    }
  }

  async function handleSave() {
    if (!form.name.trim()) { toast.error('Name required'); return; }
    try {
      if (editing && editing !== 'new') {
        await api.update(editing, form);
        toast.success('Campaign updated');
      } else {
        await api.create(form);
        toast.success('Campaign created');
      }
      setEditing(null);
      setForm({ name: '', description: '' });
      load();
    } catch (err: any) {
      toast.error(err.message);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this campaign?')) return;
    try {
      await api.delete(id);
      toast.success('Deleted');
      load();
    } catch (err: any) {
      toast.error(err.message);
    }
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-ink">Campaigns</h1>
          <p className="mt-1 text-sm text-ink-2">Group related content together.</p>
        </div>
        <button
          onClick={() => { setForm({ name: '', description: '' }); setEditing('new'); }}
          className="btn-primary text-sm"
        >
          <Plus className="h-4 w-4" />
          New Campaign
        </button>
      </div>

      {editing && (
        <div className="card p-5 animate-fade-in">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold text-ink">{editing === 'new' ? 'New Campaign' : 'Edit Campaign'}</h2>
            <button onClick={() => setEditing(null)} className="btn-ghost p-1"><X className="h-4 w-4" /></button>
          </div>
          <div className="space-y-3">
            <div>
              <label className="label">Name</label>
              <input type="text" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} className="input" placeholder="e.g., SaaS Launch" />
            </div>
            <div>
              <label className="label">Description</label>
              <textarea value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} className="input min-h-[60px]" placeholder="Optional description..." />
            </div>
            <div className="flex gap-2">
              <button onClick={handleSave} className="btn-primary text-sm"><Save className="h-4 w-4" /> Save</button>
              <button onClick={() => setEditing(null)} className="btn-secondary text-sm">Cancel</button>
            </div>
          </div>
        </div>
      )}

      {loading ? (
        <div className="card p-8 animate-pulse"><div className="h-4 w-1/3 rounded bg-gray-200" /></div>
      ) : items.length === 0 ? (
        <div className="card p-16 text-center">
          <Megaphone className="mx-auto h-12 w-12 text-gray-300" />
          <h3 className="mt-4 font-medium text-ink">No campaigns yet</h3>
          <p className="mt-1 text-sm text-muted">Create a campaign to group related content.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((item) => (
            <div key={item._id} className="card p-5">
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="font-semibold text-ink">{item.name}</h3>
                  {item.description && <p className="mt-1 text-sm text-ink-2">{item.description}</p>}
                  <p className="mt-2 text-xs text-muted">{item.contentCount || 0} pieces of content</p>
                </div>
                <div className="flex gap-1">
                  <button onClick={() => { setForm({ name: item.name, description: item.description }); setEditing(item._id); }} className="btn-ghost p-2"><Edit3 className="h-4 w-4" /></button>
                  <button onClick={() => handleDelete(item._id)} className="btn-ghost p-2 text-red-500 hover:text-red-700"><Trash2 className="h-4 w-4" /></button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
