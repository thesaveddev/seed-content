import { useState, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useDropzone } from 'react-dropzone';
import { content as contentApi, billing as billingApi } from '../lib/api';
import {
  Upload, FileVideo, FileAudio, Link2, Type, ArrowRight, ArrowLeft,
  Zap, CheckCircle, ChevronRight, Loader2, AlertCircle
} from 'lucide-react';
import toast from 'react-hot-toast';

const goals = [
  { id: 'reach', label: 'Reach', desc: 'Get more people interested', icon: '🌍', optimize: 'curiosity, entertainment, shareability' },
  { id: 'authority', label: 'Authority', desc: 'Build trust and expertise', icon: '💡', optimize: 'education, insight, credibility' },
  { id: 'conversion', label: 'Conversion', desc: 'Turn attention into customers', icon: '🎯', optimize: 'problem/solution, CTA, lead generation' },
  { id: 'auto', label: 'Let AI choose', desc: 'AI picks the best approach', icon: '🤖', optimize: 'automatic' },
];

const platforms = [
  { id: 'linkedin', name: 'LinkedIn', icon: '💼' },
  { id: 'x', name: 'X', icon: '𝕏' },
  { id: 'instagram', name: 'Instagram', icon: '📸' },
  { id: 'tiktok', name: 'TikTok', icon: '🎵' },
  { id: 'youtube', name: 'YouTube', icon: '▶️' },
  { id: 'threads', name: 'Threads', icon: '🧵' },
  { id: 'newsletter', name: 'Newsletter', icon: '📧' },
  { id: 'blog', name: 'Blog', icon: '✍️' },
];

export default function CreateContentPage() {
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [sourceType, setSourceType] = useState<'upload' | 'paste' | 'url'>('upload');
  const [file, setFile] = useState<File | null>(null);
  const [pasteText, setPasteText] = useState('');
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const [goal, setGoal] = useState('auto');
  const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>([
    'linkedin', 'x', 'instagram',
  ]);
  const [uploading, setUploading] = useState(false);
  const [usage, setUsage] = useState<any>(null);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    billingApi.usage().then((res) => setUsage(res.data)).catch(() => {});
  }, []);

  const onDrop = useCallback((acceptedFiles: File[]) => {
    if (acceptedFiles.length > 0) {
      setFile(acceptedFiles[0]);
      if (!title) {
        setTitle(acceptedFiles[0].name.replace(/\.[^/.]+$/, ''));
      }
    }
  }, [title]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'video/mp4': ['.mp4'],
      'video/quicktime': ['.mov'],
      'video/webm': ['.webm'],
      'audio/mpeg': ['.mp3'],
      'audio/wav': ['.wav'],
      'audio/x-m4a': ['.m4a'],
    },
    maxFiles: 1,
    maxSize: 200 * 1024 * 1024,
  });

  const togglePlatform = (id: string) => {
    setSelectedPlatforms((p) =>
      p.includes(id) ? p.filter((x) => x !== id) : [...p, id]
    );
  };

  const handleCreate = async () => {
    if (sourceType === 'paste' && !pasteText.trim()) {
      toast.error('Please enter some content');
      return;
    }
    if (sourceType === 'upload' && !file) {
      toast.error('Please select a file');
      return;
    }
    if (selectedPlatforms.length === 0) {
      toast.error('Select at least one platform');
      return;
    }

    setUploading(true);
    try {
      let result;
      if (sourceType === 'paste') {
        result = await contentApi.createFromText({
          title: title || 'Untitled Content',
          text: pasteText,
          goal,
          selectedPlatforms,
        });
      } else if (sourceType === 'url') {
        result = await contentApi.createFromUrl({
          title: title || undefined,
          url,
          goal,
          selectedPlatforms,
        });
      } else {
        const formData = new FormData();
        if (file) formData.append('file', file);
        if (title) formData.append('title', title);
        formData.append('goal', goal);
        formData.append('selectedPlatforms', JSON.stringify(selectedPlatforms));
        result = await contentApi.create(formData);
      }

      toast.success('Content created! Processing...');
      navigate(`/content/${result.data._id}`);
    } catch (err: any) {
      toast.error(err.message || 'Failed to create content');
    } finally {
      setUploading(false);
    }
  };

  const steps = [
    { label: 'Source', done: sourceType === 'upload' ? !!file : sourceType === 'paste' ? !!pasteText.trim() : !!(url.trim() && /^https?:\/\//.test(url.trim())) },
    { label: 'Goal', done: !!goal },
    { label: 'Platforms', done: selectedPlatforms.length > 0 },
    { label: 'Generate', done: false },
  ];

  const canNext = steps[step]?.done ?? false;

  return (
    <div className="mx-auto max-w-3xl space-y-6 animate-fade-in">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-ink">Create Content</h1>
        <p className="mt-1 text-ink-2">Turn your content into a multi-platform campaign.</p>
      </div>

      {/* Usage limit warning */}
      {usage && usage.limits.projectsPerMonth > 0 && (
        <div className="flex items-center justify-between rounded-lg bg-paper-2 p-3">
          <span className="text-sm text-ink-2">
            {usage.usage.projects} / {usage.limits.projectsPerMonth} projects used this month
          </span>
          {usage.usage.projects / usage.limits.projectsPerMonth > 0.8 && (
            <a href="/billing" className="flex items-center gap-1 text-sm font-medium text-accent hover:underline">
              <AlertCircle className="h-3.5 w-3.5" />
              Upgrade
            </a>
          )}
        </div>
      )}

      {/* Step indicator */}
      <div className="flex items-center gap-2">
        {steps.map((s, i) => (
          <div key={s.label} className="flex items-center">
            <div
              className={`flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium ${
                i === step
                  ? 'bg-accent text-white'
                  : s.done
                  ? 'bg-green-100 text-green-700'
                  : 'bg-gray-100 text-muted'
              }`}
            >
              {i < step || s.done ? (
                <CheckCircle className="h-3.5 w-3.5" />
              ) : (
                <span>{i + 1}</span>
              )}
              {s.label}
            </div>
            {i < steps.length - 1 && <ChevronRight className="mx-1 h-4 w-4 text-gray-300" />}
          </div>
        ))}
      </div>

      {/* Step content */}
      <div className="card p-6">
        {/* Step 0: Source */}
        {step === 0 && (
          <div className="space-y-6 animate-fade-in">
            <h2 className="text-lg font-semibold text-ink">Choose your source</h2>

            {/* Source type tabs */}
            <div className="flex gap-2">
              {[
                { id: 'upload' as const, label: 'Upload', icon: Upload },
                { id: 'paste' as const, label: 'Paste text', icon: Type },
                { id: 'url' as const, label: 'Paste URL', icon: Link2 },
              ].map((t) => (
                <button
                  key={t.id}
                  onClick={() => setSourceType(t.id)}
                  className={`flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium transition-all ${
                    sourceType === t.id
                      ? 'bg-accent text-white'
                      : 'bg-gray-100 text-ink-2 hover:bg-gray-200'
                  }`}
                >
                  <t.icon className="h-4 w-4" />
                  {t.label}
                </button>
              ))}
            </div>

            {/* Upload */}
            {sourceType === 'upload' && (
              <div>
                <div
                  {...getRootProps()}
                  className={`flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed p-10 transition-colors ${
                    isDragActive
                      ? 'border-accent bg-paper-2'
                      : file
                      ? 'border-green-300 bg-green-50'
                      : 'border-rule hover:border-accent hover:bg-paper-2'
                  }`}
                >
                  <input {...getInputProps()} />
                  {file ? (
                    <>
                      <div className="rounded-full bg-green-100 p-3">
                        {file.type.startsWith('video') ? (
                          <FileVideo className="h-6 w-6 text-green-600" />
                        ) : (
                          <FileAudio className="h-6 w-6 text-green-600" />
                        )}
                      </div>
                      <p className="mt-3 font-medium text-ink">{file.name}</p>
                      <p className="mt-1 text-xs text-muted">
                        {(file.size / (1024 * 1024)).toFixed(1)} MB
                      </p>
                      <p className="mt-2 text-xs text-accent">Click to change file</p>
                    </>
                  ) : (
                    <>
                      <div className="rounded-full bg-gray-100 p-3">
                        <Upload className="h-6 w-6 text-gray-400" />
                      </div>
                      <p className="mt-3 font-medium text-ink">
                        Drop a video or audio file here
                      </p>
                      <p className="mt-1 text-xs text-muted">
                        MP4, MOV, WEBM, MP3, WAV, M4A — up to 200MB
                      </p>
                    </>
                  )}
                </div>
              </div>
            )}

            {/* Paste text */}
            {sourceType === 'paste' && (
              <div>
                <label className="label">Paste your content</label>
                <textarea
                  value={pasteText}
                  onChange={(e) => setPasteText(e.target.value)}
                  className="input min-h-[200px]"
                  placeholder="Paste a blog post, transcript, notes, or any text content you want to repurpose..."
                />
                <p className="mt-1 text-xs text-muted">
                  {pasteText.length} characters
                </p>
              </div>
            )}

            {/* URL */}
            {sourceType === 'url' && (
              <div>
                <label className="label">Paste a URL</label>
                <input
                  type="url"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  className="input"
                  placeholder="https://youtube.com/watch?v=... or https://example.com/article"
                />
                <p className="mt-1 text-xs text-muted">
                  YouTube videos, blog posts, articles — the content will be automatically extracted
                </p>
              </div>
            )}

            {/* Title */}
            <div>
              <label className="label">Title (optional)</label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="input"
                placeholder="Give your content a name"
              />
            </div>
          </div>
        )}

        {/* Step 1: Goal */}
        {step === 1 && (
          <div className="space-y-4 animate-fade-in">
            <h2 className="text-lg font-semibold text-ink">What do you want this content to achieve?</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              {goals.map((g) => (
                <button
                  key={g.id}
                  onClick={() => setGoal(g.id)}
                  className={`flex items-start gap-3 rounded-xl border-2 p-4 text-left transition-all ${
                    goal === g.id
                      ? 'border-brand-600 bg-paper-2'
                      : 'border-rule hover:border-rule'
                  }`}
                >
                  <span className="text-2xl">{g.icon}</span>
                  <div>
                    <p className="font-medium text-ink">{g.label}</p>
                    <p className="text-sm text-ink-2">{g.desc}</p>
                    <p className="mt-1 text-xs text-gray-400">Optimised for: {g.optimize}</p>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Step 2: Platforms */}
        {step === 2 && (
          <div className="space-y-4 animate-fade-in">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-ink">Select platforms</h2>
              <button
                onClick={() =>
                  setSelectedPlatforms(
                    selectedPlatforms.length === platforms.length
                      ? []
                      : platforms.map((p) => p.id)
                  )
                }
                className="text-sm font-medium text-accent hover:text-brand-700"
              >
                {selectedPlatforms.length === platforms.length ? 'Deselect all' : 'Select all'}
              </button>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {platforms.map((p) => (
                <button
                  key={p.id}
                  onClick={() => togglePlatform(p.id)}
                  className={`flex flex-col items-center gap-2 rounded-xl border-2 p-4 transition-all ${
                    selectedPlatforms.includes(p.id)
                      ? 'border-brand-600 bg-paper-2'
                      : 'border-rule hover:border-rule'
                  }`}
                >
                  <span className="text-2xl">{p.icon}</span>
                  <span className="text-sm font-medium">{p.name}</span>
                  {selectedPlatforms.includes(p.id) && (
                    <CheckCircle className="h-4 w-4 text-accent" />
                  )}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Step 3: Review & Generate */}
        {step === 3 && (
          <div className="space-y-6 animate-fade-in">
            <h2 className="text-lg font-semibold text-ink">Ready to generate</h2>

            <div className="space-y-3 rounded-xl bg-paper-2 p-4">
              <div>
                <span className="text-xs font-medium text-muted">SOURCE</span>
                <p className="text-sm text-ink">
                  {sourceType === 'upload'
                    ? file?.name || 'File upload'
                    : sourceType === 'paste'
                    ? 'Pasted text'
                    : url || 'URL'}
                </p>
              </div>
              <div>
                <span className="text-xs font-medium text-muted">GOAL</span>
                <p className="text-sm text-ink">
                  {goals.find((g) => g.id === goal)?.label || 'Auto'}
                </p>
              </div>
              <div>
                <span className="text-xs font-medium text-muted">PLATFORMS ({selectedPlatforms.length})</span>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {selectedPlatforms.map((p) => (
                    <span key={p} className="badge bg-paper-3 text-brand-700">
                      {platforms.find((x) => x.id === p)?.icon}{' '}
                      {platforms.find((x) => x.id === p)?.name}
                    </span>
                  ))}
                </div>
              </div>
            </div>

            <button
              onClick={handleCreate}
              disabled={uploading}
              className="btn-primary w-full py-3 text-base"
            >
              {uploading ? (
                <>
                  <Loader2 className="h-5 w-5 animate-spin" />
                  Creating...
                </>
              ) : (
                <>
                  <Zap className="h-5 w-5" />
                  Generate Content Pack
                </>
              )}
            </button>
          </div>
        )}
      </div>

      {/* Navigation */}
      {step < 3 && (
        <div className="flex items-center justify-between">
          <button
            onClick={() => setStep((s) => s - 1)}
            disabled={step === 0}
            className="btn-ghost"
          >
            <ArrowLeft className="h-4 w-4" />
            Back
          </button>
          <button
            onClick={() => setStep((s) => s + 1)}
            disabled={!canNext}
            className="btn-primary"
          >
            Continue
            <ArrowRight className="h-4 w-4" />
          </button>
        </div>
      )}
    </div>
  );
}
