import { useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, Check, CheckCheck, Trash2, X, Zap, AlertCircle } from 'lucide-react';
import { useNotificationStore } from '../../stores/notificationStore';
import toast from 'react-hot-toast';
import type { Notification } from '../../stores/notificationStore';

const typeConfig: Record<string, { icon: any; color: string }> = {
  content_ready: { icon: Zap, color: 'text-green-600 bg-green-50' },
  content_failed: { icon: AlertCircle, color: 'text-red-600 bg-red-50' },
  info: { icon: Bell, color: 'text-blue-600 bg-blue-50' },
  warning: { icon: AlertCircle, color: 'text-amber-600 bg-amber-50' },
};

function timeAgo(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diff = Math.floor((now - then) / 1000);
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export default function NotificationBell({
  placement = 'header',
}: {
  /**
   * 'header'  — bell sits at the top of the screen; panel opens downward, right-aligned.
   * 'sidebar' — bell sits at the bottom-left (sidebar user section); panel opens upward,
   *             left-aligned so it stays on-screen instead of rendering off the viewport.
   */
  placement?: 'header' | 'sidebar';
}) {
  const navigate = useNavigate();
  const {
    items, unreadCount, isOpen, loading,
    fetch, fetchUnreadCount, markRead, markAllRead,
    deleteOne, toggleOpen, setOpen, startPolling, stopPolling,
  } = useNotificationStore();
  const panelRef = useRef<HTMLDivElement>(null);
  const prevUnreadRef = useRef(0);

  // Start polling on mount
  useEffect(() => {
    startPolling();
    return () => stopPolling();
  }, [startPolling, stopPolling]);

  // Show toast when new notifications arrive
  useEffect(() => {
    if (unreadCount > prevUnreadRef.current && prevUnreadRef.current > 0) {
      // New notification arrived — fetch the full list and toast the latest
      fetch().then(() => {
        const latest = useNotificationStore.getState().items[0];
        if (latest && !latest.read) {
          const config = typeConfig[latest.type] || typeConfig.info;
          if (latest.type === 'content_ready') {
            toast.success(`${latest.title}: ${latest.message}`, { duration: 6000 });
          } else if (latest.type === 'content_failed') {
            toast.error(`${latest.title}: ${latest.message}`, { duration: 8000 });
          } else {
            toast(`${latest.title}: ${latest.message}`, { duration: 5000 });
          }
        }
      });
    }
    prevUnreadRef.current = unreadCount;
  }, [unreadCount, fetch]);

  // Close on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isOpen, setOpen]);

  // Close on Escape
  useEffect(() => {
    function handleEscape(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    if (isOpen) {
      document.addEventListener('keydown', handleEscape);
      return () => document.removeEventListener('keydown', handleEscape);
    }
  }, [isOpen, setOpen]);

  const handleToggle = useCallback(() => {
    if (!isOpen) {
      fetch();
    }
    toggleOpen();
  }, [isOpen, fetch, toggleOpen]);

  const handleNotificationClick = useCallback((n: Notification) => {
    markRead(n._id);
    setOpen(false);
    if (n.projectId) {
      navigate(`/content/${n.projectId}`);
    }
  }, [markRead, setOpen, navigate]);

  return (
    <div className="relative" ref={panelRef}>
      {/* Bell button */}
      <button
        onClick={handleToggle}
        className="relative rounded-lg p-2 transition-colors"
        style={{ color: 'var(--color-muted)' }}
        onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--color-paper-2)'; (e.currentTarget as HTMLElement).style.color = 'var(--color-ink)'; }}
        onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; (e.currentTarget as HTMLElement).style.color = 'var(--color-muted)'; }}
        title="Notifications"
      >
        <Bell className="h-5 w-5" />
        {unreadCount > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {/* Dropdown panel */}
      {isOpen && (
        <div
          className={`absolute z-50 w-72 sm:w-96 rounded-xl shadow-xl animate-fade-in ${
            placement === 'sidebar' ? 'bottom-full left-0 mb-2' : 'right-0 top-full mt-2'
          }`}
          style={{ background: 'var(--color-paper)', border: 'var(--rule-width) solid var(--color-rule)' }}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: 'var(--rule-width) solid var(--color-rule)' }}>
            <h3 className="text-sm font-semibold" style={{ fontFamily: 'var(--font-display)', color: 'var(--color-ink)' }}>Notifications</h3>
            <div className="flex items-center gap-1">
              {unreadCount > 0 && (                  <button
                    onClick={markAllRead}
                    className="rounded-md px-2 py-1 text-xs font-medium transition-colors"
                    style={{ color: 'var(--color-accent)' }}
                >
                  <CheckCheck className="h-3.5 w-3.5 inline mr-1" />
                  Mark all read
                </button>
              )}                <button
                  onClick={() => setOpen(false)}
                  className="rounded-md p-1 transition-colors"
                  style={{ color: 'var(--color-muted)' }}
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* List */}
          <div className="max-h-[min(20rem,50vh)] overflow-y-auto">
            {loading && items.length === 0 ? (
              <div className="flex items-center justify-center py-8">
                <div className="h-5 w-5 animate-spin rounded-full border-2 border-brand-200 border-t-brand-600" />
              </div>
            ) : items.length === 0 ? (
              <div className="py-8 text-center">
                <Bell className="mx-auto h-8 w-8" style={{ color: 'var(--color-rule)' }} />
                <p className="mt-2 text-sm" style={{ color: 'var(--color-muted)' }}>No notifications yet</p>
              </div>
            ) : (
              items.map((n) => {
                const config = typeConfig[n.type] || typeConfig.info;
                const Icon = config.icon;
                return (
                  <div
                    key={n._id}
                    className={`flex items-start gap-3 px-4 py-3 cursor-pointer transition-colors ${
                      !n.read ? '' : ''
                    }`}
                    style={{
                      borderBottom: 'var(--rule-width) solid var(--color-rule-2)',
                      background: !n.read ? 'oklch(52% 0.18 270 / 0.04)' : 'transparent',
                    }}
                    onClick={() => handleNotificationClick(n)}
                  >
                    <div className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${config.color}`}>
                      <Icon className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className={`text-sm ${!n.read ? 'font-semibold' : 'font-medium'}`} style={{ color: 'var(--color-ink)', fontFamily: 'var(--font-display)' }}>
                          {n.title}
                        </p>
                        {!n.read && <span className="h-2 w-2 shrink-0 rounded-full bg-brand-500" />}
                      </div>
                      <p className="mt-0.5 text-xs line-clamp-2" style={{ color: 'var(--color-ink-2)' }}>{n.message}</p>
                      <p className="mt-1 text-[11px]" style={{ color: 'var(--color-muted)' }}>{timeAgo(n.createdAt)}</p>
                    </div>
                    <div className="flex shrink-0 flex-col items-center gap-1">
                      {!n.read && (
                        <button
                          onClick={(e) => { e.stopPropagation(); markRead(n._id); }}
                          className="rounded p-1 transition-colors"
                        style={{ color: 'var(--color-muted)' }}
                          title="Mark as read"
                        >
                          <Check className="h-3 w-3" />
                        </button>
                      )}
                      <button
                        onClick={(e) => { e.stopPropagation(); deleteOne(n._id); }}
                        className="rounded p-1 transition-colors"
                        style={{ color: 'var(--color-muted)' }}
                        title="Delete"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Footer */}
          {items.length > 0 && (
            <div className="px-4 py-2.5" style={{ borderTop: 'var(--rule-width) solid var(--color-rule)' }}>
              <button
                onClick={() => { setOpen(false); navigate('/library'); }}
                className="w-full text-center text-xs font-medium text-brand-600 hover:text-brand-700"
              >
                View all content
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
