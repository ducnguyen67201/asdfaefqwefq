import { Component, type ErrorInfo, type ReactNode } from 'react';

interface ErrorBoundaryState {
  error: Error | null;
}

export class ErrorBoundary extends Component<
  { children: ReactNode },
  ErrorBoundaryState
> {
  override state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  override componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error('Admin dashboard render failed', error, errorInfo);
  }

  override render(): ReactNode {
    if (!this.state.error) return this.props.children;
    return (
      <section className="login-shell">
        <div className="login-card">
          <div className="brand-lockup" aria-label="Tro Admin">
            <span className="brand-mark">T</span>
            <span>Tro Admin</span>
          </div>
          <p className="eyebrow">Dashboard unavailable</p>
          <h2>Something went wrong</h2>
          <p className="login-copy">
            The admin interface could not be rendered. Reload the page to try
            again.
          </p>
          <button
            className="button button--primary button--wide"
            onClick={() => window.location.reload()}
            type="button"
          >
            Reload dashboard
          </button>
        </div>
      </section>
    );
  }
}
