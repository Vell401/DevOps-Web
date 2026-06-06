import { FormEvent, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { Spinner } from '../ui/Spinner';
import { AuthSplit } from './AuthSplit';

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(email, password);
      navigate('/projects');
    } catch {
      setError('Email or password is incorrect.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthSplit>
      <div className="mb-6">
        <p className="text-xs font-medium uppercase tracking-[0.18em] text-ink-subtle">
          Welcome back
        </p>
        <h1 className="mt-2 font-display text-3xl font-semibold leading-tight text-ink">
          Sign in to <span className="text-mark">tracker</span>
        </h1>
        <p className="mt-2 text-sm text-ink-muted">
          Pick up where you left off. The board misses you.
        </p>
      </div>

      <form onSubmit={onSubmit} className="space-y-3">
        <Field label="Email">
          <input
            className="input"
            type="email"
            placeholder="you@company.com"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </Field>
        <Field label="Password">
          <input
            className="input"
            type="password"
            placeholder="••••••••"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </Field>
        {error && (
          <p className="rounded-md border border-chip-red bg-chip-red/40 px-3 py-2 text-sm text-[#883128]">
            {error}
          </p>
        )}
        <button className="btn-primary w-full" disabled={busy}>
          {busy && <Spinner className="border-paper border-t-paper/40" />}
          Sign in
        </button>
        <p className="pt-2 text-center text-sm text-ink-muted">
          No account?{' '}
          <Link to="/register" className="font-medium text-ink underline-offset-2 hover:underline">
            Create one
          </Link>
        </p>
      </form>
    </AuthSplit>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-ink-subtle">
        {label}
      </span>
      {children}
    </label>
  );
}
