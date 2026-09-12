import { useState, useEffect } from 'react';
import { integrations as api } from '../lib/api';
import { Link2, Check, X } from 'lucide-react';
import toast from 'react-hot-toast';
import type { Integration } from '../types';

const providers = [
  { id: 'linkedin', name: 'LinkedIn', icon: '💼', desc: 'Publish posts directly to LinkedIn' },
  { id: 'x', name: 'X (Twitter)', icon: '𝕏', desc: 'Post tweets and threads' },
  { id: 'instagram', name: 'Instagram', icon: '📸', desc: 'Share captions to Instagram' },
  { id: 'tiktok', name: 'TikTok', icon: '🎵', desc: 'Publish content to TikTok' },
  { id: 'youtube', name: 'YouTube', icon: '▶️', desc: 'Upload videos to YouTube' },
  { id: 'telegram', name: 'Telegram', icon: '📱', desc: 'Bot for quick content creation' },
];

export default function IntegrationsPage() {
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { load(); }, []);

  async function load() {
    try {
      const res = await api.list();
      setIntegrations(res.data);
    } catch (err: any) {
      toast.error('Failed to load integrations');
    } finally {
      setLoading(false);
    }
  }

  function isConnected(providerId: string) {
    return integrations.some((i) => i.provider === providerId && i.status === 'connected');
  }

  async function handleConnect(providerId: string) {
    try {
      // Persist the connection (OAuth in production; stored as a workspace-level
      // connection here so the status survives reloads).
      await api.connect(providerId, { connectedAt: new Date().toISOString() });
      toast.success(`${providers.find((p) => p.id === providerId)?.name || providerId} connected`);
      load();
    } catch (err: any) {
      toast.error(err.message);
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

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-ink">Integrations</h1>
        <p className="mt-1 text-sm text-ink-2">Connect your platforms for direct publishing.</p>
      </div>

      {loading ? (
        <div className="card p-8 animate-pulse"><div className="h-4 w-1/3 rounded bg-gray-200" /></div>
      ) : (
        <div className="space-y-3">
          {providers.map((provider) => {
            const connected = isConnected(provider.id);
            return (
              <div key={provider.id} className="card flex items-center gap-4 p-5">
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gray-100 text-2xl">
                  {provider.icon}
                </div>
                <div className="min-w-0 flex-1">
                  <h3 className="font-medium text-ink">{provider.name}</h3>
                  <p className="text-sm text-ink-2">{provider.desc}</p>
                </div>
                <button
                  onClick={() => connected ? handleDisconnect(provider.id) : handleConnect(provider.id)}
                  className={connected ? 'btn-secondary text-sm' : 'btn-primary text-sm'}
                >
                  {connected ? (
                    <>
                      <Check className="h-4 w-4" />
                      Connected
                    </>
                  ) : (
                    <>
                      <Link2 className="h-4 w-4" />
                      Connect
                    </>
                  )}
                </button>
              </div>
            );
          })}
        </div>
      )}

      <div className="card p-6 bg-paper-2">
        <p className="text-sm text-ink-2">
          <strong>Note:</strong> Direct publishing is available when the relevant platform APIs are configured.
          Connect your accounts to enable one-click publishing from generated content.
        </p>
      </div>
    </div>
  );
}
