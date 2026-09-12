import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { integrations as api } from '../lib/api';
import { Link2, Check, AlertTriangle, X, ShieldCheck, Info, ExternalLink } from 'lucide-react';
import toast from 'react-hot-toast';
import type { Integration } from '../types';

interface FieldDef {
  key: string;
  label: string;
  placeholder: string;
  required: boolean;
  secret: boolean;
  help: string;
}

interface ProviderConfig {
  mode: 'full' | 'validate';
  oauth?: boolean;
  oauthLabel?: string;
  fields: FieldDef[];
}

const providers = [
  { id: 'linkedin', name: 'LinkedIn', icon: '💼', desc: 'Publish posts directly to LinkedIn' },
  { id: 'x', name: 'X (Twitter)', icon: '𝕏', desc: 'Post tweets and threads' },
  { id: 'instagram', name: 'Instagram', icon: '📸', desc: 'Share captions to Instagram' },
  { id: 'tiktok', name: 'TikTok', icon: '🎵', desc: 'Publish content to TikTok' },
  { id: 'youtube', name: 'YouTube', icon: '▶️', desc: 'Upload videos to YouTube' },
  { id: 'telegram', name: 'Telegram', icon: '📱', desc: 'Auto-publish posts to your channel' },
];

export default function IntegrationsPage() {
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [providerConfigs, setProviderConfigs] = useState<Record<string, ProviderConfig>>({});
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState<string | null>(null); // provider id with modal open
  const [form, setForm] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [fieldError, setFieldError] = useState('');
  const [searchParams, setSearchParams] = useSearchParams();

  useEffect(() => { load(); }, []);

  // Surface OAuth return result (the platform redirects back with ?oauth=ok|error)
  useEffect(() => {
    const oauthResult = searchParams.get('oauth');
    if (!oauthResult) return;
    const detail = searchParams.get('detail');
    if (oauthResult === 'ok') {
      toast.success(detail ? `Connected as ${detail}` : 'Account connected');
    } else {
      toast.error(detail || 'OAuth connection failed — try again');
    }
    searchParams.delete('oauth');
    searchParams.delete('detail');
    setSearchParams(searchParams, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function load() {
    try {
      const res = await api.list();
      setIntegrations(res.data || []);
      setProviderConfigs(res.providers || {});
    } catch (err: any) {
      toast.error(err.message || 'Failed to load integrations');
    } finally {
      setLoading(false);
    }
  }

  function isConnected(providerId: string) {
    return integrations.some((i) => i.provider === providerId && i.status === 'connected');
  }

  function connectedDoc(providerId: string) {
    return integrations.find((i) => i.provider === providerId && i.status === 'connected');
  }

  function openConnect(providerId: string) {
    setConnecting(providerId);
    setForm({});
    setFieldError('');
  }

  function closeModal() {
    setConnecting(null);
    setForm({});
    setFieldError('');
  }

  async function handleSave() {
    if (!connecting) return;
    const cfg = providerConfigs[connecting];
    const missing = (cfg?.fields || []).filter((f) => f.required && !form[f.key]?.trim());
    if (missing.length > 0) {
      setFieldError(`${missing[0].label} is required`);
      return;
    }
    setSaving(true);
    setFieldError('');
    try {
      const res = await api.connect(connecting, { credentials: form });
      toast.success(res.message || `${providerName(connecting)} connected`);
      closeModal();
      load();
    } catch (err: any) {
      // Server-side verification failed — surface it inline
      setFieldError(err.message || 'Verification failed');
    } finally {
      setSaving(false);
    }
  }

  async function handleDisconnect(providerId: string) {
    try {
      await api.disconnect(providerId);
      toast.success('Disconnected');
      load();
    } catch (err: any) {
      toast.error(err.message);
    }
  }

  // OAuth: ask the server for the platform authorize URL, then redirect
  async function handleOAuthConnect(providerId: string) {
    try {
      const res = await fetch(`/api${api.oauthStartUrl(providerId)}`, {
        credentials: 'include',
      });
      const body = await res.json();
      if (!res.ok || !body?.data?.url) {
        throw new Error(body?.error || 'Could not start the OAuth flow');
      }
      window.location.href = body.data.url;
    } catch (err: any) {
      toast.error(err.message || 'OAuth is not available for this platform');
    }
  }

  function providerName(id: string) {
    return providers.find((p) => p.id === id)?.name || id;
  }

  const activeProvider = providers.find((p) => p.id === connecting);
  const activeCfg = connecting ? providerConfigs[connecting] : null;
  const activeDoc = connecting ? connectedDoc(connecting) : null;

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-ink">Integrations</h1>
        <p className="mt-1 text-sm text-ink-2">
          Connect your platforms with real account credentials. Telegram supports fully automatic publishing.
        </p>
      </div>

      {loading ? (
        <div className="card p-8 animate-pulse"><div className="h-4 w-1/3 rounded bg-gray-200" /></div>
      ) : (
        <div className="space-y-3">
          {providers.map((provider) => {
            const connected = isConnected(provider.id);
            const doc = connectedDoc(provider.id);
            const cfg = providerConfigs[provider.id];
            const mode = cfg?.mode;
            return (
              <div key={provider.id} className="card flex items-center gap-4 p-5">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-gray-100 text-2xl">
                  {provider.icon}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-medium text-ink">{provider.name}</h3>
                    {mode === 'full' && (
                      <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium" style={{ background: 'oklch(92% 0.08 160)', color: 'oklch(40% 0.12 160)' }}>
                        <ShieldCheck className="h-3 w-3" /> Auto-publish
                      </span>
                    )}
                    {mode === 'validate' && connected && (
                      <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium" style={{ background: 'oklch(92% 0.06 80)', color: 'oklch(45% 0.10 80)' }}>
                        <Info className="h-3 w-3" /> Account verified · manual copy
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-ink-2">{provider.desc}</p>
                  {connected && doc?.metadata?.accountName && (
                    <p className="mt-0.5 text-xs text-ink-2">Linked as <strong>{String(doc.metadata.accountName)}</strong></p>
                  )}
                  {connected && doc?.metadata?.chatTitle && (
                    <p className="mt-0.5 text-xs text-ink-2">Channel: <strong>{String(doc.metadata.chatTitle)}</strong></p>
                  )}
                </div>
                {connected ? (
                  <button onClick={() => handleDisconnect(provider.id)} className="btn-secondary text-sm">
                    <Check className="h-4 w-4" /> Connected
                  </button>
                ) : cfg?.oauth ? (
                  <button onClick={() => handleOAuthConnect(provider.id)} className="btn-primary text-sm">
                    <ExternalLink className="h-4 w-4" /> Connect with {cfg.oauthLabel || provider.name}
                  </button>
                ) : (
                  <button onClick={() => openConnect(provider.id)} className="btn-primary text-sm">
                    <Link2 className="h-4 w-4" /> Connect
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div className="card p-6 bg-paper-2">
        <p className="text-sm text-ink-2">
          <strong>How publishing works:</strong> Telegram posts go out fully automatically when their schedule
          time arrives. Where "Connect with …" appears, one click links your account through the platform's own
          login and scheduled posts publish automatically. Platforms without OAuth configured yet fall back to
          credential paste-in — tokens are stored encrypted and publishing activates as each platform's app
          approval lands on this deployment.
        </p>
      </div>

      {/* ── Connect modal ─────────────────────────────────────── */}
      {connecting && activeProvider && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'oklch(18% 0.014 270 / 0.4)' }} onClick={closeModal}>
          <div className="card w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gray-100 text-xl">
                  {activeProvider.icon}
                </div>
                <div>
                  <h3 className="font-semibold text-ink">Connect {activeProvider.name}</h3>
                  <p className="text-xs text-ink-2">
                    {activeCfg?.mode === 'full'
                      ? 'Verified credentials enable automatic publishing.'
                      : 'Credentials are verified and stored; publishing via API comes with deployment-level platform keys.'}
                  </p>
                </div>
              </div>
              <button onClick={closeModal} className="text-ink-2 hover:text-ink" aria-label="Close">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="mt-5 space-y-4">
              {(activeCfg?.fields || []).map((f) => (
                <div key={f.key}>
                  <label className="mb-1 block text-sm font-medium text-ink">
                    {f.label}
                    {f.required && <span className="text-accent"> *</span>}
                  </label>
                  <input
                    type={f.secret ? 'password' : 'text'}
                    value={form[f.key] || ''}
                    onChange={(e) => setForm((prev) => ({ ...prev, [f.key]: e.target.value }))}
                    className="input"
                    placeholder={f.placeholder}
                    autoComplete="off"
                  />
                  {f.help && <p className="mt-1 text-xs text-ink-2">{f.help}</p>}
                </div>
              ))}

              {fieldError && (
                <div className="flex items-start gap-2 rounded-lg p-3 text-sm" style={{ background: 'oklch(94% 0.05 25)', color: 'oklch(45% 0.18 25)' }}>
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{fieldError}</span>
                </div>
              )}

              <p className="text-xs text-ink-2">
                Secrets are encrypted at rest (AES-256-GCM) and are never displayed again after saving.
              </p>

              <div className="flex justify-end gap-2 pt-1">
                <button onClick={closeModal} className="btn-secondary text-sm">Cancel</button>
                <button onClick={handleSave} disabled={saving} className="btn-primary text-sm">
                  {saving ? 'Verifying…' : 'Verify & connect'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
