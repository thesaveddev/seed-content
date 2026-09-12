import { useState, useEffect } from 'react';
import { useAuthStore } from '../stores/authStore';
import { settings as settingsApi, workspaces as wsApi } from '../lib/api';
import { Save, User, Key, Shield, Eye, EyeOff, Check, X, AlertCircle, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';

export default function SettingsPage() {
  const { user, workspace } = useAuthStore();
  const [tab, setTab] = useState<'profile' | 'api-key' | 'password'>('profile');

  return (
    <div className="mx-auto max-w-2xl space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-ink">Settings</h1>
        <p className="mt-1 text-sm text-ink-2">Manage your account, API keys, and workspace.</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 rounded-lg bg-paper-2 p-1">
        {([
          { id: 'profile' as const, label: 'Profile', icon: User },
          { id: 'api-key' as const, label: 'API Key', icon: Key },
          { id: 'password' as const, label: 'Password', icon: Shield },
        ]).map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-colors ${
              tab === t.id ? 'bg-paper text-ink shadow-sm' : 'text-muted hover:text-ink'
            }`}
          >
            <t.icon className="h-4 w-4" />
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'profile' && <ProfileTab />}
      {tab === 'api-key' && <ApiKeyTab />}
      {tab === 'password' && <PasswordTab />}
    </div>
  );
}

function ProfileTab() {
  const { user, workspace, checkAuth } = useAuthStore();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [workspaceName, setWorkspaceName] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (user) { setName(user.name || ''); setEmail(user.email || ''); }
  }, [user]);
  useEffect(() => {
    if (workspace) setWorkspaceName(workspace.name || '');
  }, [workspace]);

  const handleSave = async () => {
    setSaving(true);
    try {
      if (name !== user?.name || email !== user?.email) {
        await settingsApi.updateProfile({ name, email });
      }
      if (workspaceName !== workspace?.name) {
        await wsApi.update({ name: workspaceName });
      }
      await checkAuth();
      toast.success('Settings saved');
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="card p-6">
        <h2 className="flex items-center gap-2 font-semibold text-ink">
          <User className="h-5 w-5" /> Profile
        </h2>
        <div className="mt-4 space-y-4">
          <div>
            <label className="label">Name</label>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} className="input" />
          </div>
          <div>
            <label className="label">Email</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="input" />
          </div>
        </div>
      </div>

      <div className="card p-6">
        <h2 className="font-semibold text-ink">Workspace</h2>
        <div className="mt-4 space-y-4">
          <div>
            <label className="label">Workspace name</label>
            <input type="text" value={workspaceName} onChange={(e) => setWorkspaceName(e.target.value)} className="input" />
          </div>
          <div>
            <label className="label">Current plan</label>
            <p className="text-sm text-ink capitalize">{workspace?.plan || 'Free'}</p>
          </div>
        </div>
      </div>

      <button onClick={handleSave} disabled={saving} className="btn-primary text-sm">
        <Save className="h-4 w-4" />
        {saving ? 'Saving...' : 'Save changes'}
      </button>
    </div>
  );
}

function ApiKeyTab() {
  const [status, setStatus] = useState<{ configured: boolean; maskedKey: string | null } | null>(null);
  const [key, setKey] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [showKey, setShowKey] = useState(false);

  useEffect(() => { loadStatus(); }, []);

  async function loadStatus() {
    try {
      const res = await settingsApi.getApiKey();
      setStatus(res.data);
    } catch (err: any) {
      toast.error('Failed to load API key status');
    } finally {
      setLoading(false);
    }
  }

  async function handleSave() {
    if (!key.trim()) { toast.error('Enter an API key'); return; }
    setSaving(true);
    try {
      const res = await settingsApi.saveApiKey(key.trim());
      setStatus(res.data);
      setKey('');
      toast.success('API key saved and verified');
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleRemove() {
    if (!confirm('Remove your API key? Content generation will fall back to the system default (or stop if none is configured).')) return;
    setRemoving(true);
    try {
      await settingsApi.removeApiKey();
      setStatus({ configured: false, maskedKey: null });
      toast.success('API key removed');
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setRemoving(false);
    }
  }

  if (loading) {
    return <div className="card p-8 animate-pulse"><div className="h-4 w-1/3 rounded bg-gray-200" /></div>;
  }

  return (
    <div className="space-y-6">
      <div className="card p-6">
        <div className="flex items-start gap-3">
          <div className="rounded-lg bg-accent/10 p-2">
            <Key className="h-5 w-5 text-accent" />
          </div>
          <div className="flex-1">
            <h2 className="font-semibold text-ink">OpenAI API Key</h2>
            <p className="mt-1 text-sm text-ink-2">
              Bring your own key to generate real AI content. Without a key, Seed uses mock content for development.
            </p>
          </div>
        </div>

        {status?.configured ? (
          <div className="mt-6 space-y-4">
            <div className="flex items-center gap-2 rounded-lg bg-green-50 p-3">
              <Check className="h-4 w-4 text-green-600" />
              <span className="text-sm font-medium text-green-800">
                Key configured: {status.maskedKey}
              </span>
            </div>

            <div>
              <label className="label">Replace with a new key</label>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <input
                    type={showKey ? 'text' : 'password'}
                    value={key}
                    onChange={(e) => setKey(e.target.value)}
                    className="input pr-10"
                    placeholder="sk-..."
                  />
                  <button
                    type="button"
                    onClick={() => setShowKey(!showKey)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-ink"
                  >
                    {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                <button onClick={handleSave} disabled={saving || !key.trim()} className="btn-primary text-sm shrink-0">
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save'}
                </button>
              </div>
            </div>

            <button onClick={handleRemove} disabled={removing} className="text-sm font-medium text-red-600 hover:text-red-700">
              {removing ? 'Removing...' : 'Remove API key'}
            </button>
          </div>
        ) : (
          <div className="mt-6 space-y-4">
            <div className="flex items-center gap-2 rounded-lg bg-amber-50 p-3">
              <AlertCircle className="h-4 w-4 text-amber-600" />
              <span className="text-sm text-amber-800">
                No API key configured. Add your OpenAI key to generate real content.
              </span>
            </div>

            <div>
              <label className="label">OpenAI API Key</label>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <input
                    type={showKey ? 'text' : 'password'}
                    value={key}
                    onChange={(e) => setKey(e.target.value)}
                    className="input pr-10"
                    placeholder="sk-..."
                  />
                  <button
                    type="button"
                    onClick={() => setShowKey(!showKey)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-ink"
                  >
                    {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                <button onClick={handleSave} disabled={saving || !key.trim()} className="btn-primary text-sm shrink-0">
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save & Verify'}
                </button>
              </div>
              <p className="mt-1 text-xs text-muted">
                Your key is encrypted at rest. We never store it in plain text.
                Get yours at <a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener" className="text-accent hover:underline">platform.openai.com</a>
              </p>
            </div>
          </div>
        )}
      </div>

      <div className="card p-6 bg-paper-2">
        <h3 className="font-medium text-ink">How BYOK works</h3>
        <ul className="mt-2 space-y-1 text-sm text-ink-2">
          <li>• Your key is used only when <em>you</em> create content</li>
          <li>• It's stored encrypted and never shared with other users</li>
          <li>• You can remove it anytime — content generation falls back to the system default</li>
          <li>• Your OpenAI billing applies (not Seed's)</li>
        </ul>
      </div>
    </div>
  );
}

function PasswordTab() {
  const [current, setCurrent] = useState('');
  const [newPass, setNewPass] = useState('');
  const [confirmPass, setConfirmPass] = useState('');
  const [saving, setSaving] = useState(false);
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);

  async function handleChange() {
    if (!current || !newPass) { toast.error('Fill in all fields'); return; }
    if (newPass.length < 8) { toast.error('New password must be at least 8 characters'); return; }
    if (newPass !== confirmPass) { toast.error('Passwords do not match'); return; }

    setSaving(true);
    try {
      await settingsApi.changePassword(current, newPass);
      setCurrent(''); setNewPass(''); setConfirmPass('');
      toast.success('Password updated');
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="card p-6">
      <h2 className="flex items-center gap-2 font-semibold text-ink">
        <Shield className="h-5 w-5" /> Change Password
      </h2>
      <div className="mt-4 space-y-4">
        <div>
          <label className="label">Current password</label>
          <div className="relative">
            <input type={showCurrent ? 'text' : 'password'} value={current} onChange={(e) => setCurrent(e.target.value)} className="input pr-10" />
            <button type="button" onClick={() => setShowCurrent(!showCurrent)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-ink">
              {showCurrent ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </div>
        <div>
          <label className="label">New password</label>
          <div className="relative">
            <input type={showNew ? 'text' : 'password'} value={newPass} onChange={(e) => setNewPass(e.target.value)} className="input pr-10" />
            <button type="button" onClick={() => setShowNew(!showNew)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-ink">
              {showNew ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </div>
        <div>
          <label className="label">Confirm new password</label>
          <input type="password" value={confirmPass} onChange={(e) => setConfirmPass(e.target.value)} className="input" />
        </div>
        <button onClick={handleChange} disabled={saving} className="btn-primary text-sm">
          <Save className="h-4 w-4" />
          {saving ? 'Saving...' : 'Update password'}
        </button>
      </div>
    </div>
  );
}
