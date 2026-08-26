import { useState, type FormEvent } from 'react';

interface LoginPageProps {
  checking?: boolean;
  error?: string;
  onLogin?: (token: string) => Promise<void>;
}

export function LoginPage({ checking = false, error, onLogin }: LoginPageProps) {
  const [submitting, setSubmitting] = useState(false);
  const [token, setToken] = useState('');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!onLogin || !token) return;
    setSubmitting(true);
    try {
      await onLogin(token);
      setToken('');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="login-shell" aria-labelledby="login-title">
      <div className="login-card">
        <div className="brand-lockup" aria-label="Tro Admin">
          <span className="brand-mark">T</span>
          <span>Tro Admin</span>
        </div>
        <p className="eyebrow">Protected workspace</p>
        <h2 id="login-title">
          {checking ? 'Checking your session' : 'Open the dashboard'}
        </h2>
        <p className="login-copy">
          {checking
            ? 'Confirming this browser’s admin session…'
            : 'Enter the server admin token. It stays in this tab’s memory and is never saved by the page.'}
        </p>
        {!checking && (
          <>
            <p className="login-persistence">
              This browser stays signed in for 30 days. Use Lock to sign out.
            </p>
            <form onSubmit={(event) => void submit(event)}>
              <label htmlFor="admin-token">Admin access token</label>
              <input
                autoComplete="off"
                autoFocus
                id="admin-token"
                name="token"
                onChange={(event) => setToken(event.target.value)}
                required
                type="password"
                value={token}
              />
              <p className="form-error" role="alert">
                {error}
              </p>
              <button
                className="button button--primary button--wide"
                disabled={submitting}
                type="submit"
              >
                {submitting ? 'Opening…' : 'Continue'}
              </button>
            </form>
          </>
        )}
      </div>
    </section>
  );
}
