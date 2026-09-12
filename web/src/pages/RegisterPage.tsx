import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';
import { Zap } from 'lucide-react';
import toast from 'react-hot-toast';

export default function RegisterPage() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const { register } = useAuthStore();
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 8) {
      toast.error('Password must be at least 8 characters');
      return;
    }
    setLoading(true);
    try {
      await register(email, password, name);
      // New users always go to onboarding
      navigate('/onboarding', { replace: true });
    } catch (err: any) {
      toast.error(err.message || 'Registration failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen">
      <div className="flex flex-1 flex-col justify-center px-4 sm:px-6 lg:px-12">
        <div className="mx-auto w-full max-w-sm">
          <Link to="/" className="flex items-center gap-2.5 mb-10">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent">
              <Zap className="h-4 w-4 text-white" />
            </div>
            <span className="text-lg font-bold text-ink">Seed</span>
          </Link>

          <h1 className="text-2xl font-bold text-ink">Create your account</h1>
          <p className="mt-2 text-sm text-ink-2">Start repurposing content for free</p>

          <form onSubmit={handleSubmit} className="mt-8 space-y-5">
            <div>
              <label className="label">Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="input"
                placeholder="Your name"
                required
              />
            </div>
            <div>
              <label className="label">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="input"
                placeholder="you@example.com"
                required
              />
            </div>
            <div>
              <label className="label">Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="input"
                placeholder="At least 8 characters"
                minLength={8}
                required
              />
            </div>
            <button type="submit" className="btn-primary w-full" disabled={loading}>
              {loading ? 'Creating account...' : 'Create account'}
            </button>
          </form>

          <p className="mt-8 text-center text-sm text-ink-2">
            Already have an account?{' '}
            <Link to="/login" className="font-medium text-accent hover:text-brand-700">
              Sign in
            </Link>
          </p>
        </div>
      </div>

      <div className="hidden lg:flex lg:flex-1 lg:items-center lg:justify-center bg-gradient-to-br from-brand-50 via-white to-purple-50">
        <div className="max-w-md px-8 text-center">
          <div className="text-6xl mb-6">🚀</div>
          <h2 className="text-2xl font-bold text-ink">One piece of content. Everywhere.</h2>
          <p className="mt-3 text-ink-2">Sign up free and create your first content pack in minutes.</p>
        </div>
      </div>
    </div>
  );
}
