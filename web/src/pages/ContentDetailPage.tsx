import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { content as contentApi, scheduler } from '../lib/api';
import {
  ArrowLeft, Copy, RefreshCw, Edit3, Check, Loader2, AlertCircle,
  CheckCircle2, Sparkles, ChevronDown, Trash2, Download, FileText, FileJson, FileType,
  CalendarClock
} from 'lucide-react';
import toast from 'react-hot-toast';
import type { ContentProject, GeneratedContent } from '../types';

const statusMessages: Record<string, { icon: any; title: string; desc: string }> = {
  uploading: { icon: Loader2, title: 'Uploading...', desc: 'Storing your file securely.' },
  processing: { icon: Loader2, title: 'Processing...', desc: 'Preparing your content.' },
  transcribing: { icon: Loader2, title: 'Transcribing...', desc: 'Converting speech to text.' },
  analysing: { icon: Sparkles, title: 'Analysing your content...', desc: 'Understanding the message, tone, and key ideas.' },
  generating: { icon: Sparkles, title: 'Generating content...', desc: 'Creating platform-native content for each platform.' },
  quality_check: { icon: CheckCircle2, title: 'Quality checking...', desc: 'Verifying content quality and accuracy.' },
};

const platformConfig: Record<string, { name: string; icon: string; color: string }> = {
  linkedin: { name: 'LinkedIn', icon: '💼', color: 'bg-blue-50 border-blue-200' },
  x: { name: 'X', icon: '𝕏', color: 'bg-paper-2 border-rule' },
  instagram: { name: 'Instagram', icon: '📸', color: 'bg-pink-50 border-pink-200' },
  tiktok: { name: 'TikTok', icon: '🎵', color: 'bg-slate-50 border-slate-200' },
  youtube: { name: 'YouTube', icon: '▶️', color: 'bg-red-50 border-red-200' },
  threads: { name: 'Threads', icon: '🧵', color: 'bg-purple-50 border-purple-200' },
  newsletter: { name: 'Newsletter', icon: '📧', color: 'bg-amber-50 border-amber-200' },
  blog: { name: 'Blog', icon: '✍️', color: 'bg-green-50 border-green-200' },
};

function getText(content: any): string {
  if (typeof content === 'string') return content;
  if (content.text) return content.text;
  if (content.caption) return content.caption;
  if (content.body) return content.body;
  if (content.tweets) return content.tweets.join('\n\n---\n\n');
  if (content.thread) return content.thread.join('\n\n---\n\n');
  if (content.firstLine && content.caption) return `${content.firstLine}\n\n${content.caption}`;
  if (content.subjectLines) return `Subject: ${content.subjectLines[0]}\n\n${content.body || ''}`;
  if (content.seoTitle) return `# ${content.h1 || content.seoTitle}\n\n${content.body || ''}`;
  return JSON.stringify(content, null, 2);
}

function ContentBlock({
  platform,
  contents,
  projectId,
  onRefresh,
}: {
  platform: string;
  contents: GeneratedContent[];
  projectId: string;
  onRefresh: () => void;
}) {
  const config = platformConfig[platform] || { name: platform, icon: '📝', color: 'bg-paper-2 border-rule' };
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(true);
  const [editing, setEditing] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [rewriting, setRewriting] = useState(false);
  const [rewriteInstruction, setRewriteInstruction] = useState('');
  const [showRewrite, setShowRewrite] = useState<string | null>(null);

  const handleCopy = async (text: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    toast.success('Copied to clipboard');
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSave = async (generatedId: string, text: string) => {
    try {
      await contentApi.updateGenerated(generatedId, { text });
      setEditing(null);
      toast.success('Saved');
      onRefresh();
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const handleRewrite = async (generatedId: string) => {
    if (!rewriteInstruction.trim()) {
      toast.error('Enter an instruction');
      return;
    }
    setRewriting(true);
    try {
      await contentApi.rewrite(projectId, generatedId, rewriteInstruction);
      toast.success('Rewriting...');
      setShowRewrite(null);
      setRewriteInstruction('');
      // Refresh after a short delay to allow processing
      setTimeout(() => onRefresh(), 1500);
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setRewriting(false);
    }
  };

  const copyAll = async () => {
    const allText = contents
      .map((gen) => {
        const typeLabel = gen.type && gen.type !== 'error' ? `[${gen.type}]\n` : '';
        return `${typeLabel}${getText(gen.content)}`;
      })
      .join('\n\n---\n\n');
    await navigator.clipboard.writeText(allText);
    toast.success(`Copied all ${config.name} content`);
  };

  return (
    <div className={`card border ${config.color} overflow-hidden`}>
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center justify-between p-4"
      >
        <div className="flex items-center gap-2.5">
          <span className="text-xl">{config.icon}</span>
          <span className="font-semibold text-ink">{config.name}</span>
          <span className="badge bg-paper/80 text-ink-2">
            {contents.length} piece{contents.length !== 1 ? 's' : ''}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {expanded && contents.length > 0 && (
            <button
              onClick={(e) => { e.stopPropagation(); copyAll(); }}
              className="flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-muted hover:bg-paper/80 transition-colors"
            >
              <Copy className="h-3 w-3" />
              Copy all
            </button>
          )}
          <ChevronDown className={`h-5 w-5 text-muted transition-transform ${expanded ? 'rotate-180' : ''}`} />
        </div>
      </button>

      {expanded && (
        <div className="space-y-3 border-t border-rule/50 p-4">
          {contents.map((gen) => {
            const text = getText(gen.content);
            const isEditing = editing === gen._id;
            const isRewriting = showRewrite === gen._id;

            return (
              <div key={gen._id} className="rounded-lg bg-paper p-4 shadow-sm">
                {gen.type && gen.type !== 'error' && (
                  <span className="badge bg-gray-100 text-ink-2 mb-2">{gen.type}</span>
                )}

                {isEditing ? (
                  <div className="space-y-2">
                    <textarea
                      value={editText}
                      onChange={(e) => setEditText(e.target.value)}
                      className="input min-h-[150px] font-mono text-sm"
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleSave(gen._id, editText)}
                        className="btn-primary text-xs"
                      >
                        Save
                      </button>
                      <button
                        onClick={() => setEditing(null)}
                        className="btn-ghost text-xs"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <pre className="whitespace-pre-wrap text-sm text-ink-2 font-sans">{text}</pre>
                )}

                {/* Rewrite instruction bar */}
                {isRewriting && !isEditing && (
                  <div className="mt-3 flex items-center gap-2 rounded-lg border border-brand-200 bg-paper-2 p-2">
                    <input
                      type="text"
                      value={rewriteInstruction}
                      onChange={(e) => setRewriteInstruction(e.target.value)}
                      className="input flex-1 text-xs"
                      placeholder='e.g., "Make it more conversational" or "Add a stronger hook"'
                      onKeyDown={(e) => { if (e.key === 'Enter') handleRewrite(gen._id); }}
                      autoFocus
                    />
                    <button
                      onClick={() => handleRewrite(gen._id)}
                      disabled={rewriting}
                      className="btn-primary text-xs shrink-0"
                    >
                      {rewriting ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Rewrite'}
                    </button>
                    <button
                      onClick={() => { setShowRewrite(null); setRewriteInstruction(''); }}
                      className="btn-ghost text-xs shrink-0"
                    >
                      Cancel
                    </button>
                  </div>
                )}

                <div className="mt-3 flex items-center gap-2">
                  <button
                    onClick={() => handleCopy(text)}
                    className="flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs font-medium text-ink-2 hover:bg-gray-100 transition-colors"
                  >
                    {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                    Copy
                  </button>
                  {!isEditing && !isRewriting && (
                    <>
                      <button
                        onClick={() => { setEditing(gen._id); setEditText(text); }}
                        className="flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs font-medium text-ink-2 hover:bg-gray-100 transition-colors"
                      >
                        <Edit3 className="h-3 w-3" />
                        Edit
                      </button>
                      <button
                        onClick={() => { setShowRewrite(gen._id); setRewriteInstruction(''); }}
                        className="flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs font-medium text-ink-2 hover:bg-gray-100 transition-colors"
                      >
                        <Sparkles className="h-3 w-3" />
                        AI Edit
                      </button>
                    </>
                  )}
                  {gen.qualityScore && (
                    <span className="ml-auto text-xs text-gray-400">
                      Quality: {gen.qualityScore}/100
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ScheduleModal({
  projectId,
  generatedContent,
  onClose,
  onScheduled,
}: {
  projectId: string;
  generatedContent: GeneratedContent[];
  onClose: () => void;
  onScheduled: () => void;
}) {
  const [selectedGC, setSelectedGC] = useState(generatedContent[0]?._id || '');
  const [selectedPlatform, setSelectedPlatform] = useState(generatedContent[0]?.platform || '');
  const [date, setDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    d.setHours(9, 0, 0, 0);
    return d.toISOString().slice(0, 16);
  });
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const gc = generatedContent.find((g) => g._id === selectedGC);
    if (gc) setSelectedPlatform(gc.platform);
  }, [selectedGC, generatedContent]);

  const handleSubmit = async () => {
    if (!selectedGC || !date) return;
    setSubmitting(true);
    try {
      await scheduler.create({
        projectId,
        generatedContentId: selectedGC,
        platform: selectedPlatform,
        scheduledAt: new Date(date).toISOString(),
        notes,
      });
      toast.success('Post scheduled');
      onScheduled();
      onClose();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'oklch(18% 0.014 270 / 0.4)' }}>
      <div className="w-full max-w-md rounded-lg border border-rule bg-paper p-6 shadow-lg">
        <h3 className="mb-4 text-lg font-semibold text-ink" style={{ fontFamily: 'var(--font-display)' }}>Schedule post</h3>

        <label className="mb-1 block text-xs font-medium text-muted" style={{ textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          Content piece
        </label>
        <select
          value={selectedGC}
          onChange={(e) => setSelectedGC(e.target.value)}
          className="mb-3 w-full rounded-md border border-rule bg-paper px-3 py-2 text-sm text-ink"
        >
          {generatedContent.map((gc) => (
            <option key={gc._id} value={gc._id}>
              {gc.platform.charAt(0).toUpperCase() + gc.platform.slice(1)} — {gc.type}
            </option>
          ))}
        </select>

        <label className="mb-1 block text-xs font-medium text-muted" style={{ textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          Date & time
        </label>
        <input
          type="datetime-local"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="mb-3 w-full rounded-md border border-rule bg-paper px-3 py-2 text-sm text-ink"
        />

        <label className="mb-1 block text-xs font-medium text-muted" style={{ textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          Notes (optional)
        </label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          placeholder="Add a reminder..."
          className="mb-4 w-full rounded-md border border-rule bg-paper px-3 py-2 text-sm text-ink resize-none"
        />

        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-3 py-2 text-sm text-muted hover:text-ink">
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={submitting || !selectedGC || !date}
            className="btn-primary text-sm disabled:opacity-50"
          >
            {submitting ? 'Scheduling...' : 'Schedule'}
          </button>
        </div>
      </div>
    </div>
  );
}

function ExportDropdown({ projectId }: { projectId: string }) {
  const [open, setOpen] = useState(false);
  const [exporting, setExporting] = useState(false);

  async function handleExport(format: string) {
    setExporting(true);
    try {
      const res = await contentApi.export(projectId, format);
      const blob = new Blob([res.data.content], {
        type: format === 'json' ? 'application/json' : 'text/plain',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `content-pack.${format === 'markdown' ? 'md' : format}`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success(`Exported as ${format}`);
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setExporting(false);
      setOpen(false);
    }
  }

  return (
    <div className="relative">
      <button onClick={() => setOpen(!open)} className="btn-secondary text-sm">
        <Download className="h-4 w-4" />
        Export
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-20 mt-1 w-44 rounded-lg border border-rule bg-paper py-1 shadow-lg">
            <button onClick={() => handleExport('markdown')} disabled={exporting} className="flex w-full items-center gap-2 px-3 py-2 text-sm text-ink hover:bg-paper-2">
              <FileText className="h-4 w-4 text-muted" /> Markdown (.md)
            </button>
            <button onClick={() => handleExport('text')} disabled={exporting} className="flex w-full items-center gap-2 px-3 py-2 text-sm text-ink hover:bg-paper-2">
              <FileType className="h-4 w-4 text-muted" /> Plain text (.txt)
            </button>
            <button onClick={() => handleExport('json')} disabled={exporting} className="flex w-full items-center gap-2 px-3 py-2 text-sm text-ink hover:bg-paper-2">
              <FileJson className="h-4 w-4 text-muted" /> JSON (.json)
            </button>
          </div>
        </>
      )}
    </div>
  );
}

export default function ContentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [project, setProject] = useState<ContentProject | null>(null);
  const [generated, setGenerated] = useState<GeneratedContent[]>([]);
  const [loading, setLoading] = useState(true);
  const [showSchedule, setShowSchedule] = useState(false);

  const fetchData = useCallback(async () => {
    if (!id) return;
    try {
      const res = await contentApi.get(id);
      setProject(res.data.project);
      setGenerated(res.data.generatedContent);
    } catch (err: any) {
      toast.error('Failed to load content');
      navigate('/library');
    } finally {
      setLoading(false);
    }
  }, [id, navigate]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // SSE for real-time status updates; fall back to polling
  useEffect(() => {
    if (!project || !id) return;
    if (['ready', 'failed', 'archived'].includes(project.status)) return;

    let eventSource: EventSource | null = null;
    let pollInterval: ReturnType<typeof setInterval> | null = null;

    try {
      eventSource = new EventSource(`/api/content/${id}/events`);
      eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.status) {
            setProject((prev) => prev ? { ...prev, status: data.status } : prev);
            if (['ready', 'failed'].includes(data.status)) {
              eventSource?.close();
              fetchData();
            }
          }
        } catch { /* ignore parse errors */ }
      };
      eventSource.onerror = () => {
        eventSource?.close();
        startPolling();
      };
    } catch {
      startPolling();
    }

    function startPolling() {
      if (pollInterval) return;
      pollInterval = setInterval(async () => {
        try {
          const res = await contentApi.getStatus(id!);
          setProject((prev) => prev ? { ...prev, status: res.data.status } : prev);
          if (['ready', 'failed'].includes(res.data.status)) {
            clearInterval(pollInterval!);
            fetchData();
          }
        } catch { /* ignore */ }
      }, 2000);
    }

    return () => {
      eventSource?.close();
      if (pollInterval) clearInterval(pollInterval);
    };
  }, [project?.status, id, fetchData]);

  const handleRegenerate = async () => {
    if (!id) return;
    try {
      await contentApi.generate(id);
      toast.success('Regenerating...');
      fetchData();
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const handleDelete = async () => {
    if (!id || !confirm('Delete this content? This cannot be undone.')) return;
    try {
      await contentApi.delete(id);
      toast.success('Deleted');
      navigate('/library');
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const handleCopyAll = async () => {
    const sections = Object.entries(
      generated.reduce((acc, g) => {
        if (!acc[g.platform]) acc[g.platform] = [];
        acc[g.platform].push(g);
        return acc;
      }, {} as Record<string, GeneratedContent[]>)
    ).map(([platform, contents]) => {
      const config = platformConfig[platform] || { name: platform };
      const body = contents
        .map((gen) => getText(gen.content))
        .join('\n\n---\n\n');
      return `## ${config.name}\n\n${body}`;
    });

    await navigator.clipboard.writeText(sections.join('\n\n\n'));
    toast.success('Entire content pack copied to clipboard');
  };

  const isProcessing = project && !['ready', 'failed', 'archived'].includes(project.status);
  const statusInfo = project ? statusMessages[project.status] : null;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-accent" />
      </div>
    );
  }

  if (!project) return null;

  return (
    <div className="mx-auto max-w-4xl space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <button onClick={() => navigate(-1)} className="btn-ghost mb-2 text-xs">
            <ArrowLeft className="h-3 w-3" />
            Back
          </button>
          <h1 className="text-2xl font-bold text-ink">{project.title}</h1>
          <p className="mt-1 text-sm text-muted">
            Created {new Date(project.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}
          </p>
        </div>
        <div className="flex gap-2">
          {project.status === 'ready' && (
            <>
              <ExportDropdown projectId={id!} />
              <button onClick={() => setShowSchedule(true)} className="btn-secondary text-sm">
                <CalendarClock className="h-4 w-4" />
                Schedule
              </button>
              <button onClick={handleCopyAll} className="btn-secondary text-sm">
                <Copy className="h-4 w-4" />
                Copy All
              </button>
              <button onClick={handleRegenerate} className="btn-secondary text-sm">
                <RefreshCw className="h-4 w-4" />
                Regenerate
              </button>
            </>
          )}
          <button onClick={handleDelete} className="btn-ghost text-sm text-red-500 hover:text-red-700 hover:bg-red-50">
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Processing state */}
      {isProcessing && statusInfo && (
        <div className="card p-8 text-center">
          <statusInfo.icon className={`mx-auto h-10 w-10 text-accent ${
            statusInfo.icon === Loader2 ? 'animate-spin' : 'animate-pulse-soft'
          }`} />
          <h2 className="mt-4 text-lg font-semibold text-ink">{statusInfo.title}</h2>
          <p className="mt-1 text-sm text-ink-2">{statusInfo.desc}</p>
          <div className="mx-auto mt-6 h-1.5 w-48 overflow-hidden rounded-full bg-gray-200">
            <div className="h-full animate-pulse bg-accent rounded-full" style={{ width: '60%' }} />
          </div>
        </div>
      )}

      {/* Failed state */}
      {project.status === 'failed' && (
        <div className="card border-red-200 bg-red-50 p-6">
          <div className="flex items-center gap-3">
            <AlertCircle className="h-5 w-5 text-red-600" />
            <div>
              <h3 className="font-medium text-red-900">Processing failed</h3>
              <p className="text-sm text-red-700">{project.errorMessage || 'Something went wrong. Please try again.'}</p>
            </div>
          </div>
          <button onClick={handleRegenerate} className="btn-primary mt-4 text-sm">
            <RefreshCw className="h-4 w-4" />
            Try again
          </button>
        </div>
      )}

      {/* Transcript */}
      {project.transcript && (
        <details className="card overflow-hidden">
          <summary className="cursor-pointer p-5 font-medium text-ink hover:bg-paper-2 transition-colors">
            View Transcript
          </summary>
          <div className="border-t border-gray-100 p-5">
            <pre className="whitespace-pre-wrap text-sm text-ink-2 font-sans max-h-64 overflow-y-auto">{project.transcript}</pre>
          </div>
        </details>
      )}

      {/* Analysis */}
      {project.analysis && (
        <div className="card p-5">
          <h3 className="font-semibold text-ink mb-3">Content Analysis</h3>
          <div className="grid gap-3 sm:grid-cols-2 text-sm">
            <div>
              <span className="text-xs font-medium text-muted">TOPIC</span>
              <p className="text-ink">{project.analysis.mainTopic}</p>
            </div>
            <div>
              <span className="text-xs font-medium text-muted">TONE</span>
              <p className="text-ink">{project.analysis.tone}</p>
            </div>
            <div>
              <span className="text-xs font-medium text-muted">AUDIENCE</span>
              <p className="text-ink">{project.analysis.audience}</p>
            </div>
            <div>
              <span className="text-xs font-medium text-muted">KEY HOOK</span>
              <p className="text-ink">{project.analysis.hook}</p>
            </div>
          </div>
          {project.analysis.keyPoints?.length > 0 && (
            <div className="mt-3">
              <span className="text-xs font-medium text-muted">KEY POINTS</span>
              <ul className="mt-1 space-y-1">
                {project.analysis.keyPoints.map((point, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-ink-2">
                    <span className="mt-0.5 text-accent">•</span>
                    {point}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {project.analysis.suggestedAngles?.length > 0 && (
            <div className="mt-3">
              <span className="text-xs font-medium text-muted">SUGGESTED ANGLES</span>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {project.analysis.suggestedAngles.map((angle, i) => (
                  <span key={i} className="badge bg-purple-100 text-purple-700">{angle}</span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Generated Content */}
      {project.status === 'ready' && generated.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-ink">Generated Content</h2>
            <button onClick={handleCopyAll} className="btn-primary text-sm">
              <Download className="h-4 w-4" />
              Copy Entire Pack
            </button>
          </div>
          {Object.entries(
            generated.reduce((acc, g) => {
              if (!acc[g.platform]) acc[g.platform] = [];
              acc[g.platform].push(g);
              return acc;
            }, {} as Record<string, GeneratedContent[]>)
          ).map(([platform, contents]) => (
            <ContentBlock
              key={platform}
              platform={platform}
              contents={contents}
              projectId={id!}
              onRefresh={fetchData}
            />
          ))}
        </div>
      )}

      {/* Empty ready state */}
      {project.status === 'ready' && generated.length === 0 && (
        <div className="card p-12 text-center">
          <p className="text-muted">No content was generated. Try regenerating.</p>
          <button onClick={handleRegenerate} className="btn-primary mt-4 text-sm">
            <RefreshCw className="h-4 w-4" />
            Regenerate
          </button>
        </div>
      )}

      {/* Schedule modal */}
      {showSchedule && project && generated.length > 0 && (
        <ScheduleModal
          projectId={id!}
          generatedContent={generated}
          onClose={() => setShowSchedule(false)}
          onScheduled={fetchData}
        />
      )}
    </div>
  );
}
