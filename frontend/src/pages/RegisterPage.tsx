import { FormEvent, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { Spinner } from '../ui/Spinner';
import { AuthSplit } from './AuthSplit';

export function RegisterPage() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await register(email, name, password);
      navigate('/projects');
    } catch {
      setError('Could not register. Email may already be in use.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthSplit>
      <div className="mb-6">
        <p className="text-xs font-medium uppercase tracking-[0.18em] text-ink-subtle">
          Get started
        </p>
        <h1 className="mt-2 font-display text-3xl font-semibold leading-tight text-ink">
          Create an <span className="text-mark-leaf">account</span>
        </h1>
        <p className="mt-2 text-sm text-ink-muted">
          A workspace for your tasks, comments and history. Yours, quickly.
        </p>
      </div>

      <form onSubmit={onSubmit} className="space-y-3">
        <Field label="Display name">
          <input
            className="input"
            placeholder="Anna Petrova"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            minLength={2}
          />
        </Field>
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
            placeholder="At least 8 characters"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
          />
        </Field>
        {error && (
          <p className="rounded-md border border-chip-red bg-chip-red/40 px-3 py-2 text-sm text-[#883128]">
            {error}
          </p>
        )}
        <button className="btn-primary w-full" disabled={busy}>
          {busy && <Spinner className="border-paper border-t-paper/40" />}
          Create account
        </button>
        <p className="pt-2 text-center text-sm text-ink-muted">
          Already have an account?{' '}
          <Link to="/login" className="font-medium text-ink underline-offset-2 hover:underline">
            Sign in
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
