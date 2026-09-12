import { useState, useEffect } from 'react';
import { brandVoices as api } from '../lib/api';
import { Plus, Mic2, Trash2, Edit3, Save, X } from 'lucide-react';
import toast from 'react-hot-toast';
import type { BrandVoice } from '../types';

export default function BrandVoicePage() {
  const [voices, setVoices] = useState<BrandVoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: '',
    description: '',
    tone: [] as string[],
    audience: '',
    samples: [''],
    avoidWords: [] as string[],
    preferredWords: [] as string[],
  });

  const tones = [
    'Professional', 'Conversational', 'Educational', 'Bold', 'Funny',
    'Storytelling', 'Inspirational', 'Technical', 'Friendly',
  ];

  useEffect(() => {
    loadVoices();
  }, []);

  async function loadVoices() {
    try {
      const res = await api.list();
      setVoices(res.data);
    } catch (err: any) {
      toast.error('Failed to load brand voices');
    } finally {
      setLoading(false);
    }
  }

  function resetForm() {
    setForm({
      name: '', description: '', tone: [], audience: '',
      samples: [''], avoidWords: [], preferredWords: [],
    });
    setEditing(null);
  }

  function startEdit(voice: BrandVoice) {
    setEditing(voice._id);
    setForm({
      name: voice.name,
      description: voice.description,
      tone: voice.tone,
      audience: voice.audience,
      samples: voice.samples.length > 0 ? voice.samples : [''],
      avoidWords: voice.avoidWords,
      preferredWords: voice.preferredWords,
    });
  }

  async function handleSave() {
    try {
      const data = { ...form, samples: form.samples.filter((s) => s.trim()) };
      if (editing) {
        await api.update(editing, data);
        toast.success('Brand voice updated');
      } else {
        await api.create(data);
        toast.success('Brand voice created');
      }
      resetForm();
      loadVoices();
    } catch (err: any) {
      toast.error(err.message);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this brand voice?')) return;
    try {
      await api.delete(id);
      toast.success('Deleted');
      loadVoices();
    } catch (err: any) {
      toast.error(err.message);
    }
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-ink">Brand Voice</h1>
          <p className="mt-1 text-sm text-ink-2">Define how your content should sound.</p>
        </div>
        <button
          onClick={() => { resetForm(); setEditing('new'); }}
          className="btn-primary text-sm"
        >
          <Plus className="h-4 w-4" />
          New Voice
        </button>
      </div>

      {/* Editor */}
      {editing && (
        <div className="card p-6 animate-fade-in">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-ink">
              {editing === 'new' ? 'New Brand Voice' : 'Edit Brand Voice'}
            </h2>
            <button onClick={resetForm} className="btn-ghost text-sm">
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="space-y-4">
            <div>
              <label className="label">Voice name</label>
              <input
                type="text"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                className="input"
                placeholder="e.g., Founder Voice"
              />
            </div>

            <div>
              <label className="label">Description</label>
              <textarea
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                className="input min-h-[80px]"
                placeholder="Direct, conversational, technical but easy to understand..."
              />
            </div>

            <div>
              <label className="label">Tone</label>
              <div className="flex flex-wrap gap-2">
                {tones.map((t) => (
                  <button
                    key={t}
                    onClick={() =>
                      setForm((f) => ({
                        ...f,
                        tone: f.tone.includes(t) ? f.tone.filter((x) => x !== t) : [...f.tone, t],
                      }))
                    }
                    className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                      form.tone.includes(t)
                        ? 'bg-accent text-white'
                        : 'bg-gray-100 text-ink-2 hover:bg-gray-200'
                    }`}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="label">Audience</label>
              <input
                type="text"
                value={form.audience}
                onChange={(e) => setForm((f) => ({ ...f, audience: e.target.value }))}
                className="input"
                placeholder="Who you're writing for"
              />
            </div>

            <div>
              <label className="label">Writing samples</label>
              {form.samples.map((s, i) => (
                <textarea
                  key={i}
                  value={s}
                  onChange={(e) => {
                    const samples = [...form.samples];
                    samples[i] = e.target.value;
                    setForm((f) => ({ ...f, samples }));
                  }}
                  className="input min-h-[60px] mb-2"
                  placeholder="Paste a previous post to use as a style reference..."
                />
              ))}
              <button
                onClick={() => setForm((f) => ({ ...f, samples: [...f.samples, ''] }))}
                className="text-xs font-medium text-accent hover:text-brand-700"
              >
                + Add another sample
              </button>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="label">Words to avoid</label>
                <input
                  type="text"
                  value={form.avoidWords.join(', ')}
                  onChange={(e) => setForm((f) => ({ ...f, avoidWords: e.target.value.split(',').map((w) => w.trim()).filter(Boolean) }))}
                  className="input"
                  placeholder="e.g., leverage, synergy, disrupt"
                />
                <p className="mt-1 text-xs text-muted">Comma-separated words the AI should never use</p>
              </div>
              <div>
                <label className="label">Preferred words</label>
                <input
                  type="text"
                  value={form.preferredWords.join(', ')}
                  onChange={(e) => setForm((f) => ({ ...f, preferredWords: e.target.value.split(',').map((w) => w.trim()).filter(Boolean) }))}
                  className="input"
                  placeholder="e.g., ship, build, iterate"
                />
                <p className="mt-1 text-xs text-muted">Comma-separated words the AI should prefer</p>
              </div>
            </div>

            <div className="flex gap-3 pt-2">
              <button onClick={handleSave} className="btn-primary text-sm">
                <Save className="h-4 w-4" />
                {editing === 'new' ? 'Create' : 'Save'}
              </button>
              <button onClick={resetForm} className="btn-secondary text-sm">Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* List */}
      {loading ? (
        <div className="card p-8 animate-pulse">
          <div className="h-4 w-1/3 rounded bg-gray-200" />
        </div>
      ) : voices.length === 0 ? (
        <div className="card p-16 text-center">
          <Mic2 className="mx-auto h-12 w-12 text-gray-300" />
          <h3 className="mt-4 font-medium text-ink">No brand voices yet</h3>
          <p className="mt-1 text-sm text-muted">
            Create a brand voice to keep your content consistent.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {voices.map((voice) => (
            <div key={voice._id} className="card p-5">
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="font-semibold text-ink">{voice.name}</h3>
                  <p className="mt-1 text-sm text-ink-2">{voice.description || 'No description'}</p>
                  {voice.tone.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {voice.tone.map((t) => (
                        <span key={t} className="badge bg-brand-100 text-brand-700">{t}</span>
                      ))}
                    </div>
                  )}
                  {voice.avoidWords.length > 0 && (
                    <p className="mt-2 text-xs text-muted">Avoid: {voice.avoidWords.join(', ')}</p>
                  )}
                  {voice.preferredWords.length > 0 && (
                    <p className="mt-1 text-xs text-muted">Prefer: {voice.preferredWords.join(', ')}</p>
                  )}
                </div>
                <div className="flex gap-1">
                  <button onClick={() => startEdit(voice)} className="btn-ghost p-2">
                    <Edit3 className="h-4 w-4" />
                  </button>
                  <button onClick={() => handleDelete(voice._id)} className="btn-ghost p-2 text-red-500 hover:text-red-700">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
