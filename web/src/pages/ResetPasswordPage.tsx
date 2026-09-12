import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { auth } from '../lib/api';
import { Zap } from 'lucide-react';
import toast from 'react-hot-toast';

export default function ResetPasswordPage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') || '';
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 8) {
      toast.error('Password must be at least 8 characters');
      return;
    }
    setLoading(true);
    try {
      await auth.resetPassword(token, password);
      setDone(true);
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <Link to="/" className="flex items-center justify-center gap-2.5 mb-10">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent">
            <Zap className="h-4 w-4 text-white" />
          </div>
          <span className="text-lg font-bold text-ink">Seed</span>
        </Link>

        {done ? (
          <div className="text-center">
            <h1 className="text-2xl font-bold text-ink">Password reset!</h1>
            <p className="mt-3 text-sm text-ink-2">Your password has been updated.</p>
            <Link to="/login" className="btn-primary mt-6 inline-flex">
              Sign in with new password
            </Link>
          </div>
        ) : (
          <>
            <h1 className="text-2xl font-bold text-ink">Set new password</h1>
            <form onSubmit={handleSubmit} className="mt-8 space-y-5">
              <div>
                <label className="label">New password</label>
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
              <button type="submit" className="btn-primary w-full" disabled={loading || !token}>
                {loading ? 'Resetting...' : 'Reset password'}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
