import { useState } from 'react';
import { Link } from 'react-router-dom';
import { auth } from '../lib/api';
import { Zap } from 'lucide-react';
import toast from 'react-hot-toast';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      await auth.forgotPassword(email);
      setSent(true);
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

        {sent ? (
          <div className="text-center">
            <h1 className="text-2xl font-bold text-ink">Check your email</h1>
            <p className="mt-3 text-sm text-ink-2">
              If an account exists with {email}, we've sent a password reset link.
            </p>
            <Link to="/login" className="btn-primary mt-6 inline-flex">
              Back to login
            </Link>
          </div>
        ) : (
          <>
            <h1 className="text-2xl font-bold text-ink">Forgot your password?</h1>
            <p className="mt-2 text-sm text-ink-2">
              Enter your email and we'll send you a reset link.
            </p>
            <form onSubmit={handleSubmit} className="mt-8 space-y-5">
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
              <button type="submit" className="btn-primary w-full" disabled={loading}>
                {loading ? 'Sending...' : 'Send reset link'}
              </button>
            </form>
            <p className="mt-6 text-center text-sm text-ink-2">
              <Link to="/login" className="font-medium text-accent hover:text-brand-700">
                Back to login
              </Link>
            </p>
          </>
        )}
      </div>
    </div>
  );
}
