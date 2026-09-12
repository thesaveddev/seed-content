import { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ChevronLeft, ChevronRight, Calendar as CalendarIcon,
  Clock, Eye, XCircle, ExternalLink, Filter, Plus
} from 'lucide-react';
import toast from 'react-hot-toast';
import { scheduler, content as contentApi } from '../lib/api';

const PLATFORM_ICONS: Record<string, string> = {
  linkedin: '💼',
  x: '𝕏',
  instagram: '📸',
  tiktok: '🎵',
  youtube: '▶️',
  threads: '🧵',
  newsletter: '📧',
  blog: '✍️',
};

const PLATFORM_COLORS: Record<string, string> = {
  linkedin: 'oklch(55% 0.15 250)',
  x: 'oklch(20% 0.01 270)',
  instagram: 'oklch(55% 0.16 320)',
  tiktok: 'oklch(30% 0.01 270)',
  youtube: 'oklch(50% 0.16 15)',
  threads: 'oklch(50% 0.01 270)',
  newsletter: 'oklch(50% 0.14 60)',
  blog: 'oklch(50% 0.12 160)',
};

type ViewMode = 'month' | 'week';

function getDaysInMonth(year: number, month: number) {
  return new Date(year, month + 1, 0).getDate();
}

function getFirstDayOfMonth(year: number, month: number) {
  return new Date(year, month, 1).getDay();
}

function formatDate(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function formatTime(dateStr: string) {
  const d = new Date(dateStr);
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
}

function formatMonthYear(year: number, month: number) {
  return new Date(year, month).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

function getWeekDays(year: number, month: number, day: number) {
  const start = new Date(year, month, day);
  start.setDate(start.getDate() - start.getDay()); // Sunday
  const days = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    days.push(d);
  }
  return days;
}

export default function CalendarPage() {
  const navigate = useNavigate();
  const [view, setView] = useState<ViewMode>('month');
  const [year, setYear] = useState(new Date().getFullYear());
  const [month, setMonth] = useState(new Date().getMonth());
  const [selectedDay, setSelectedDay] = useState(new Date().getDate());
  const [posts, setPosts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterPlatform, setFilterPlatform] = useState<string>('');
  const [filterStatus, setFilterStatus] = useState<string>('');
  const [selectedPost, setSelectedPost] = useState<any>(null);
  const [showDetail, setShowDetail] = useState(false);

  // Add-entry modal state
  const [showAdd, setShowAdd] = useState(false);
  const [addDate, setAddDate] = useState<string>('');
  const [projects, setProjects] = useState<any[]>([]);
  const [projectsLoading, setProjectsLoading] = useState(false);
  const [selProject, setSelProject] = useState<string>('');
  const [pieces, setPieces] = useState<any[]>([]);
  const [selPiece, setSelPiece] = useState<string>('');
  const [addNotes, setAddNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const fetchPosts = useCallback(async () => {
    setLoading(true);
    try {
      const from = new Date(year, month, 1).toISOString();
      const to = new Date(year, month + 1, 0, 23, 59, 59).toISOString();
      const params: any = { from, to };
      if (filterPlatform) params.platform = filterPlatform;
      if (filterStatus) params.status = filterStatus;
      const res = await scheduler.list(params);
      setPosts(res.data || []);
    } catch {
      setPosts([]);
    }
    setLoading(false);
  }, [year, month, filterPlatform, filterStatus]);

  useEffect(() => {
    fetchPosts();
  }, [fetchPosts]);

  const postsByDate = useMemo(() => {
    const map: Record<string, any[]> = {};
    posts.forEach((p) => {
      const key = formatDate(new Date(p.scheduledAt));
      if (!map[key]) map[key] = [];
      map[key].push(p);
    });
    return map;
  }, [posts]);

  const monthDays = getDaysInMonth(year, month);
  const firstDay = getFirstDayOfMonth(year, month);
  const weekDays = getWeekDays(year, month, selectedDay);

  const navigatePrev = () => {
    if (view === 'month') {
      if (month === 0) { setYear(year - 1); setMonth(11); }
      else setMonth(month - 1);
    } else {
      const d = new Date(year, month, selectedDay - 7);
      setYear(d.getFullYear());
      setMonth(d.getMonth());
      setSelectedDay(d.getDate());
    }
  };

  const navigateNext = () => {
    if (view === 'month') {
      if (month === 11) { setYear(year + 1); setMonth(0); }
      else setMonth(month + 1);
    } else {
      const d = new Date(year, month, selectedDay + 7);
      setYear(d.getFullYear());
      setMonth(d.getMonth());
      setSelectedDay(d.getDate());
    }
  };

  const handleCancel = async (id: string) => {
    try {
      await scheduler.cancel(id);
      fetchPosts();
      setShowDetail(false);
    } catch {}
  };

  const handleDelete = async (id: string) => {
    try {
      await scheduler.delete(id);
      fetchPosts();
      setShowDetail(false);
    } catch {}
  };

  const handleMarkPublished = async (id: string) => {
    try {
      await scheduler.markPublished(id);
      fetchPosts();
      setShowDetail(false);
    } catch {}
  };

  // ── Add-entry flow ──
  const openAddModal = useCallback(async (day?: number) => {
    const d = new Date(year, month, day ?? selectedDay, 9, 0, 0, 0);
    setAddDate(d.toISOString().slice(0, 16));
    setSelProject('');
    setSelPiece('');
    setPieces([]);
    setAddNotes('');
    setShowAdd(true);
    setProjectsLoading(true);
    try {
      // Fetch recent ready projects (up to 3 pages, free plan has 3 projects/month)
      const all: any[] = [];
      for (const page of [1, 2, 3]) {
        const res = await contentApi.list({ limit: 20, page });
        all.push(...(res.data || []));
        if (!res.data || res.data.length < 20) break;
      }
      const ready = all.filter((p: any) => p.status === 'ready');
      setProjects(ready);
    } catch {
      toast.error('Could not load your content');
    } finally {
      setProjectsLoading(false);
    }
  }, [year, month, selectedDay]);

  const loadPieces = useCallback(async (projectId: string) => {
    setSelPiece('');
    setPieces([]);
    if (!projectId) return;
    try {
      const res = await contentApi.get(projectId);
      setPieces(res.data?.generatedContent || []);
    } catch {
      toast.error('Could not load content pieces');
    }
  }, []);

  const handleAddSubmit = async () => {
    if (!selProject || !selPiece || !addDate) return;
    const piece = pieces.find((p) => p._id === selPiece);
    setSubmitting(true);
    try {
      await scheduler.create({
        projectId: selProject,
        generatedContentId: selPiece,
        platform: piece?.platform || 'linkedin',
        scheduledAt: new Date(addDate).toISOString(),
        notes: addNotes,
      });
      toast.success('Post scheduled');
      setShowAdd(false);
      fetchPosts();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const today = new Date();
  const isToday = (day: number) =>
    day === today.getDate() && month === today.getMonth() && year === today.getFullYear();

  const statusColor = (s: string) => {
    if (s === 'scheduled') return 'var(--color-accent)';
    if (s === 'published') return 'oklch(55% 0.15 150)';
    if (s === 'cancelled') return 'var(--color-muted)';
    return 'oklch(55% 0.15 25)';
  };

  return (
    <div style={{ color: 'var(--color-ink)' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '2rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <CalendarIcon style={{ width: 24, height: 24, color: 'var(--color-accent)' }} />
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '1.75rem', fontWeight: 700, letterSpacing: '-0.02em' }}>
            Content Calendar
          </h1>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <button
            onClick={() => openAddModal()}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.375rem',
              padding: '0.4375rem 0.875rem',
              borderRadius: '6px',
              border: 'none',
              background: 'var(--color-accent)',
              color: 'var(--color-accent-ink)',
              fontSize: '0.8125rem',
              fontFamily: 'var(--font-body)',
              fontWeight: 600,
              cursor: 'pointer',
              marginRight: '0.5rem',
            }}
          >
            <Plus style={{ width: 14, height: 14 }} />
            Schedule post
          </button>
          <button
            onClick={() => { setView('month'); }}
            style={{
              padding: '0.375rem 0.75rem',
              borderRadius: '6px',
              fontSize: '0.8125rem',
              fontFamily: 'var(--font-body)',
              fontWeight: view === 'month' ? 600 : 400,
              background: view === 'month' ? 'var(--color-accent)' : 'transparent',
              color: view === 'month' ? 'white' : 'var(--color-muted)',
              border: 'none',
              cursor: 'pointer',
              transition: 'all 0.15s ease',
            }}
          >
            Month
          </button>
          <button
            onClick={() => { setView('week'); }}
            style={{
              padding: '0.375rem 0.75rem',
              borderRadius: '6px',
              fontSize: '0.8125rem',
              fontFamily: 'var(--font-body)',
              fontWeight: view === 'week' ? 600 : 400,
              background: view === 'week' ? 'var(--color-accent)' : 'transparent',
              color: view === 'week' ? 'white' : 'var(--color-muted)',
              border: 'none',
              cursor: 'pointer',
              transition: 'all 0.15s ease',
            }}
          >
            Week
          </button>
        </div>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: '1rem', marginBottom: '1.5rem', alignItems: 'center' }}>
        <Filter style={{ width: 16, height: 16, color: 'var(--color-muted)' }} />
        <select
          value={filterPlatform}
          onChange={(e) => setFilterPlatform(e.target.value)}
          style={{
            padding: '0.375rem 0.625rem',
            borderRadius: '6px',
            border: '1px solid var(--color-rule)',
            background: 'var(--color-paper)',
            color: 'var(--color-ink)',
            fontFamily: 'var(--font-body)',
            fontSize: '0.8125rem',
          }}
        >
          <option value="">All platforms</option>
          {Object.entries(PLATFORM_ICONS).map(([k, v]) => (
            <option key={k} value={k}>{v} {k.charAt(0).toUpperCase() + k.slice(1)}</option>
          ))}
        </select>
        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
          style={{
            padding: '0.375rem 0.625rem',
            borderRadius: '6px',
            border: '1px solid var(--color-rule)',
            background: 'var(--color-paper)',
            color: 'var(--color-ink)',
            fontFamily: 'var(--font-body)',
            fontSize: '0.8125rem',
          }}
        >
          <option value="">All statuses</option>
          <option value="scheduled">Scheduled</option>
          <option value="published">Published</option>
          <option value="cancelled">Cancelled</option>
        </select>
        <span style={{ fontSize: '0.8125rem', color: 'var(--color-muted)', marginLeft: 'auto' }}>
          {posts.length} post{posts.length !== 1 ? 's' : ''} this month
        </span>
      </div>

      {/* Navigation */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
        <button
          onClick={navigatePrev}
          style={{ padding: '0.375rem', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-ink)' }}
        >
          <ChevronLeft style={{ width: 20, height: 20 }} />
        </button>
        <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '1.125rem', fontWeight: 600 }}>
          {formatMonthYear(year, month)}
        </h2>
        <button
          onClick={navigateNext}
          style={{ padding: '0.375rem', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-ink)' }}
        >
          <ChevronRight style={{ width: 20, height: 20 }} />
        </button>
      </div>

      {/* Calendar grid */}
      {view === 'month' ? (
        <div style={{ border: '1px solid var(--color-rule)', borderRadius: '8px', overflow: 'hidden' }}>
          {/* Day headers */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)' }}>
            {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => (
              <div
                key={d}
                style={{
                  padding: '0.5rem',
                  textAlign: 'center',
                  fontSize: '0.75rem',
                  fontWeight: 600,
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                  color: 'var(--color-muted)',
                  background: 'var(--color-paper-2)',
                  borderBottom: '1px solid var(--color-rule)',
                }}
              >
                {d}
              </div>
            ))}
          </div>
          {/* Day cells */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)' }}>
            {Array.from({ length: firstDay }).map((_, i) => (
              <div key={`empty-${i}`} style={{ minHeight: 90, background: 'var(--color-paper-2)', opacity: 0.4 }} />
            ))}
            {Array.from({ length: monthDays }).map((_, i) => {
              const day = i + 1;
              const dateKey = formatDate(new Date(year, month, day));
              const dayPosts = postsByDate[dateKey] || [];
              const selected = day === selectedDay && view === 'month';

              return (
                <div
                  key={day}
                  onClick={() => { setSelectedDay(day); if (dayPosts.length === 0) { openAddModal(day); } }}
                  style={{
                    minHeight: 90,
                    padding: '0.375rem',
                    borderBottom: '1px solid var(--color-rule)',
                    borderRight: (i % 7 < 6) ? '1px solid var(--color-rule)' : 'none',
                    cursor: 'pointer',
                    background: isToday(day) ? 'var(--color-accent)' : selected ? 'var(--color-paper-2)' : 'var(--color-paper)',
                    transition: 'background 0.15s ease',
                    position: 'relative',
                  }}
                  onMouseEnter={(e) => { if (!isToday(day)) (e.currentTarget as HTMLElement).style.background = 'var(--color-paper-2)'; }}
                  onMouseLeave={(e) => { if (!isToday(day)) (e.currentTarget as HTMLElement).style.background = 'var(--color-paper)'; }}
                >
                  <span
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      width: 24,
                      height: 24,
                      borderRadius: '50%',
                      fontSize: '0.8125rem',
                      fontWeight: isToday(day) ? 700 : 400,
                      fontFamily: 'var(--font-display)',
                      color: isToday(day) ? 'white' : 'var(--color-ink)',
                    }}
                  >
                    {day}
                  </span>
                  <div style={{ marginTop: '0.25rem', display: 'flex', flexDirection: 'column', gap: '2px' }}>
                    {dayPosts.slice(0, 3).map((p) => (
                      <div
                        key={p._id}
                        onClick={(e) => { e.stopPropagation(); setSelectedPost(p); setShowDetail(true); }}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '4px',
                          padding: '1px 4px',
                          borderRadius: '3px',
                          fontSize: '0.6875rem',
                          lineHeight: '1.3',
                          background: `${PLATFORM_COLORS[p.platform] || 'var(--color-muted)'}18`,
                          borderLeft: `2px solid ${PLATFORM_COLORS[p.platform] || 'var(--color-muted)'}`,
                          color: 'var(--color-ink)',
                          overflow: 'hidden',
                          whiteSpace: 'nowrap',
                          textOverflow: 'ellipsis',
                        }}
                      >
                        <span>{PLATFORM_ICONS[p.platform] || '📝'}</span>
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {formatTime(p.scheduledAt)}
                        </span>
                      </div>
                    ))}
                    {dayPosts.length > 3 && (
                      <span style={{ fontSize: '0.625rem', color: 'var(--color-muted)', paddingLeft: '4px' }}>
                        +{dayPosts.length - 3} more
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        /* Week view */
        <div style={{ border: '1px solid var(--color-rule)', borderRadius: '8px', overflow: 'hidden' }}>
          {weekDays.map((day, i) => {
            const dateKey = formatDate(day);
            const dayPosts = postsByDate[dateKey] || [];
            const dayIsToday = day.getDate() === today.getDate() && day.getMonth() === today.getMonth() && day.getFullYear() === today.getFullYear();

            return (
              <div
                key={i}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '100px 1fr',
                  borderBottom: i < 6 ? '1px solid var(--color-rule)' : 'none',
                  background: dayIsToday ? 'oklch(52% 0.18 270 / 0.04)' : 'var(--color-paper)',
                }}
              >
                {/* Day label */}
                <div style={{
                  padding: '1rem 0.75rem',
                  borderRight: '1px solid var(--color-rule)',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: '0.25rem',
                }}>
                  <span style={{
                    fontSize: '0.6875rem',
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                    color: dayIsToday ? 'var(--color-accent)' : 'var(--color-muted)',
                    fontWeight: 600,
                  }}>
                    {day.toLocaleDateString('en-US', { weekday: 'short' })}
                  </span>
                  <span style={{
                    fontSize: '1.25rem',
                    fontFamily: 'var(--font-display)',
                    fontWeight: dayIsToday ? 700 : 400,
                    color: dayIsToday ? 'var(--color-accent)' : 'var(--color-ink)',
                  }}>
                    {day.getDate()}
                  </span>
                </div>

                {/* Posts */}
                <div style={{ padding: '0.5rem', display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
                  {dayPosts.length === 0 && (
                    <div style={{ padding: '1rem', textAlign: 'center', color: 'var(--color-muted)', fontSize: '0.8125rem' }}>
                      No posts scheduled
                    </div>
                  )}
                  {dayPosts.map((p) => (
                    <div
                      key={p._id}
                      onClick={() => { setSelectedPost(p); setShowDetail(true); }}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.625rem',
                        padding: '0.5rem 0.75rem',
                        borderRadius: '6px',
                        border: '1px solid var(--color-rule)',
                        background: 'var(--color-paper)',
                        cursor: 'pointer',
                        transition: 'all 0.15s ease',
                      }}
                      onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.borderColor = PLATFORM_COLORS[p.platform] || 'var(--color-accent)'; }}
                      onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--color-rule)'; }}
                    >
                      <span style={{ fontSize: '1.125rem' }}>{PLATFORM_ICONS[p.platform] || '📝'}</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{
                          fontSize: '0.8125rem',
                          fontWeight: 600,
                          fontFamily: 'var(--font-display)',
                          color: 'var(--color-ink)',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}>
                          {p.platform.charAt(0).toUpperCase() + p.platform.slice(1)}
                        </div>
                        {p.notes && (
                          <div style={{
                            fontSize: '0.75rem',
                            color: 'var(--color-muted)',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}>
                            {p.notes}
                          </div>
                        )}
                      </div>
                      <div style={{ textAlign: 'right', flexShrink: 0 }}>
                        <div style={{ fontSize: '0.8125rem', fontFamily: 'var(--font-display)', color: 'var(--color-ink)' }}>
                          {formatTime(p.scheduledAt)}
                        </div>
                        <span style={{
                          display: 'inline-block',
                          padding: '1px 6px',
                          borderRadius: '10px',
                          fontSize: '0.625rem',
                          fontWeight: 600,
                          textTransform: 'uppercase',
                          letterSpacing: '0.05em',
                          color: statusColor(p.status),
                          background: `${statusColor(p.status)}15`,
                          marginTop: '2px',
                        }}>
                          {p.status}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Detail slide-over */}
      {showDetail && selectedPost && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            right: 0,
            bottom: 0,
            width: 380,
            maxWidth: '90vw',
            background: 'var(--color-paper)',
            borderLeft: '1px solid var(--color-rule)',
            boxShadow: '-8px 0 24px oklch(18% 0.014 270 / 0.08)',
            zIndex: 50,
            display: 'flex',
            flexDirection: 'column',
            animation: 'slideIn 0.2s ease',
          }}
        >
          <style>{`@keyframes slideIn { from { transform: translateX(100%); } to { transform: translateX(0); } }`}</style>
          {/* Header */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '1rem 1.25rem',
            borderBottom: '1px solid var(--color-rule)',
          }}>
            <h3 style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: '1rem' }}>
              Scheduled Post
            </h3>
            <button
              onClick={() => setShowDetail(false)}
              style={{ padding: '0.25rem', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-muted)' }}
            >
              <XCircle style={{ width: 18, height: 18 }} />
            </button>
          </div>

          {/* Content */}
          <div style={{ flex: 1, overflow: 'auto', padding: '1.25rem' }}>
            <div style={{ marginBottom: '1.5rem' }}>
              <div style={{ fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--color-muted)', marginBottom: '0.25rem' }}>
                Platform
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '1rem', fontFamily: 'var(--font-display)' }}>
                <span>{PLATFORM_ICONS[selectedPost.platform]}</span>
                <span style={{ fontWeight: 600 }}>{selectedPost.platform.charAt(0).toUpperCase() + selectedPost.platform.slice(1)}</span>
              </div>
            </div>

            <div style={{ marginBottom: '1.5rem' }}>
              <div style={{ fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--color-muted)', marginBottom: '0.25rem' }}>
                Scheduled Time
              </div>
              <div style={{ fontSize: '1rem', fontFamily: 'var(--font-display)' }}>
                {new Date(selectedPost.scheduledAt).toLocaleString('en-US', {
                  weekday: 'short', month: 'short', day: 'numeric',
                  hour: 'numeric', minute: '2-digit', hour12: true,
                })}
              </div>
            </div>

            <div style={{ marginBottom: '1.5rem' }}>
              <div style={{ fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--color-muted)', marginBottom: '0.25rem' }}>
                Status
              </div>
              <span style={{
                display: 'inline-block',
                padding: '2px 10px',
                borderRadius: '12px',
                fontSize: '0.8125rem',
                fontWeight: 600,
                color: statusColor(selectedPost.status),
                background: `${statusColor(selectedPost.status)}15`,
                textTransform: 'capitalize',
              }}>
                {selectedPost.status}
              </span>
            </div>

            {selectedPost.notes && (
              <div style={{ marginBottom: '1.5rem' }}>
                <div style={{ fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--color-muted)', marginBottom: '0.25rem' }}>
                  Notes
                </div>
                <p style={{ fontSize: '0.875rem', lineHeight: 1.6, color: 'var(--color-ink-2)' }}>
                  {selectedPost.notes}
                </p>
              </div>
            )}

            <div style={{ marginBottom: '1.5rem' }}>
              <div style={{ fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--color-muted)', marginBottom: '0.25rem' }}>
                Created
              </div>
              <div style={{ fontSize: '0.875rem', color: 'var(--color-muted)' }}>
                {new Date(selectedPost.createdAt).toLocaleDateString('en-US', {
                  month: 'short', day: 'numeric', year: 'numeric',
                })}
              </div>
            </div>
          </div>

          {/* Actions */}
          <div style={{
            padding: '1rem 1.25rem',
            borderTop: '1px solid var(--color-rule)',
            display: 'flex',
            flexDirection: 'column',
            gap: '0.5rem',
          }}>
            {selectedPost.projectId && (
              <button
                onClick={() => {
                  navigate(`/content/${selectedPost.projectId}`);
                  setShowDetail(false);
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '0.5rem',
                  padding: '0.5rem',
                  borderRadius: '6px',
                  border: '1px solid var(--color-rule)',
                  background: 'var(--color-paper)',
                  color: 'var(--color-ink)',
                  cursor: 'pointer',
                  fontFamily: 'var(--font-body)',
                  fontSize: '0.875rem',
                }}
              >
                <ExternalLink style={{ width: 14, height: 14 }} />
                View content
              </button>
            )}
            {selectedPost.status === 'scheduled' && (
              <>
                <button
                  onClick={() => handleMarkPublished(selectedPost._id)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '0.5rem',
                    padding: '0.5rem',
                    borderRadius: '6px',
                    border: 'none',
                    background: 'oklch(55% 0.15 150)',
                    color: 'white',
                    cursor: 'pointer',
                    fontFamily: 'var(--font-body)',
                    fontSize: '0.875rem',
                    fontWeight: 500,
                  }}
                >
                  <Eye style={{ width: 14, height: 14 }} />
                  Mark as published
                </button>
                <button
                  onClick={() => handleCancel(selectedPost._id)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '0.5rem',
                    padding: '0.5rem',
                    borderRadius: '6px',
                    border: '1px solid var(--color-rule)',
                    background: 'transparent',
                    color: 'var(--color-muted)',
                    cursor: 'pointer',
                    fontFamily: 'var(--font-body)',
                    fontSize: '0.875rem',
                  }}
                >
                  Cancel schedule
                </button>
              </>
            )}
            <button
              onClick={() => handleDelete(selectedPost._id)}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '0.5rem',
                padding: '0.5rem',
                borderRadius: '6px',
                border: 'none',
                background: 'transparent',
                color: 'oklch(50% 0.16 25)',
                cursor: 'pointer',
                fontFamily: 'var(--font-body)',
                fontSize: '0.875rem',
              }}
            >
              <XCircle style={{ width: 14, height: 14 }} />
              Delete
            </button>
          </div>
        </div>
      )}

      {/* Add-entry modal */}
      {showAdd && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 60,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'oklch(18% 0.014 270 / 0.4)',
          }}
          onClick={() => setShowAdd(false)}
        >
          <div
            style={{
              width: '100%',
              maxWidth: 420,
              background: 'var(--color-paper)',
              borderRadius: '12px',
              border: '1px solid var(--color-rule)',
              boxShadow: '0 8px 32px oklch(18% 0.014 270 / 0.12)',
              padding: '1.5rem',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '1.125rem', fontWeight: 700, marginBottom: '1rem' }}>
              Schedule a post
            </h3>

            {projectsLoading ? (
              <p style={{ fontSize: '0.875rem', color: 'var(--color-muted)', padding: '1rem 0' }}>
                Loading your content…
              </p>
            ) : projects.length === 0 ? (
              <p style={{ fontSize: '0.875rem', color: 'var(--color-muted)', lineHeight: 1.6 }}>
                You don't have any ready content yet. Create a content pack first —
                once a pack is ready you can schedule its pieces here.
              </p>
            ) : (
              <>
                <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--color-muted)', marginBottom: '0.375rem' }}>
                  Content pack
                </label>
                <select
                  value={selProject}
                  onChange={(e) => { setSelProject(e.target.value); loadPieces(e.target.value); }}
                  style={{ width: '100%', padding: '0.625rem 0.75rem', borderRadius: '8px', border: '1px solid var(--color-rule)', background: 'var(--color-paper)', color: 'var(--color-ink)', fontSize: '0.875rem', marginBottom: '0.75rem' }}
                >
                  <option value="">Choose content…</option>
                  {projects.map((p) => (
                    <option key={p._id} value={p._id}>{p.title}</option>
                  ))}
                </select>

                {pieces.length > 0 && (
                  <>
                    <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--color-muted)', marginBottom: '0.375rem' }}>
                      Piece
                    </label>
                    <select
                      value={selPiece}
                      onChange={(e) => setSelPiece(e.target.value)}
                      style={{ width: '100%', padding: '0.625rem 0.75rem', borderRadius: '8px', border: '1px solid var(--color-rule)', background: 'var(--color-paper)', color: 'var(--color-ink)', fontSize: '0.875rem', marginBottom: '0.75rem' }}
                    >
                      <option value="">Choose piece…</option>
                      {pieces.map((p) => (
                        <option key={p._id} value={p._id}>
                          {PLATFORM_ICONS[p.platform] || '📝'} {p.platform} — {p.type}
                        </option>
                      ))}
                    </select>
                  </>
                )}

                <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--color-muted)', marginBottom: '0.375rem' }}>
                  Date & time
                </label>
                <input
                  type="datetime-local"
                  value={addDate}
                  onChange={(e) => setAddDate(e.target.value)}
                  style={{ width: '100%', padding: '0.625rem 0.75rem', borderRadius: '8px', border: '1px solid var(--color-rule)', background: 'var(--color-paper)', color: 'var(--color-ink)', fontSize: '0.875rem', marginBottom: '0.75rem' }}
                />

                <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--color-muted)', marginBottom: '0.375rem' }}>
                  Notes (optional)
                </label>
                <input
                  type="text"
                  value={addNotes}
                  onChange={(e) => setAddNotes(e.target.value)}
                  placeholder="Add a reminder…"
                  style={{ width: '100%', padding: '0.625rem 0.75rem', borderRadius: '8px', border: '1px solid var(--color-rule)', background: 'var(--color-paper)', color: 'var(--color-ink)', fontSize: '0.875rem', marginBottom: '1.25rem' }}
                />

                <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
                  <button
                    onClick={() => setShowAdd(false)}
                    style={{ padding: '0.5rem 1rem', borderRadius: '6px', border: '1px solid var(--color-rule)', background: 'transparent', color: 'var(--color-ink)', fontSize: '0.875rem', cursor: 'pointer' }}
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleAddSubmit}
                    disabled={submitting || !selProject || !selPiece || !addDate}
                    style={{ padding: '0.5rem 1rem', borderRadius: '6px', border: 'none', background: 'var(--color-accent)', color: 'var(--color-accent-ink)', fontSize: '0.875rem', fontWeight: 600, cursor: 'pointer', opacity: submitting || !selProject || !selPiece || !addDate ? 0.5 : 1 }}
                  >
                    {submitting ? 'Scheduling…' : 'Schedule'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Empty state */}
      {!loading && posts.length === 0 && (
        <div style={{
          textAlign: 'center',
          padding: '4rem 2rem',
          marginTop: '2rem',
          borderTop: '1px solid var(--color-rule)',
        }}>
          <Clock style={{ width: 40, height: 40, color: 'var(--color-muted)', margin: '0 auto 1rem' }} />
          <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '1.125rem', fontWeight: 600, marginBottom: '0.5rem' }}>
            No posts scheduled
          </h3>
          <p style={{ fontSize: '0.875rem', color: 'var(--color-muted)', maxWidth: 400, margin: '0 auto' }}>
            Schedule content from the detail page to plan your publishing calendar.
          </p>
        </div>
      )}
    </div>
  );
}
