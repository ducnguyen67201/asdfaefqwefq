import { useCallback, useEffect, useState } from 'react';

import {
  adminApi,
  errorMessage,
  isUnauthorized,
} from './api/adminApi';
import { Dashboard } from './components/Dashboard';
import { LoginPage } from './components/LoginPage';

type SessionState = 'checking' | 'signed-in' | 'signed-out';

export function App() {
  const [loginError, setLoginError] = useState('');
  const [session, setSession] = useState<SessionState>('checking');

  const expireSession = useCallback(() => {
    setLoginError('');
    setSession('signed-out');
  }, []);

  useEffect(() => {
    let cancelled = false;
    adminApi
      .listUsers({ limit: 1, offset: 0 })
      .then(() => {
        if (!cancelled) setSession('signed-in');
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setSession('signed-out');
        if (!isUnauthorized(error)) setLoginError(errorMessage(error));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function login(token: string) {
    setLoginError('');
    try {
      await adminApi.createSession(token);
      setSession('signed-in');
    } catch (error) {
      setLoginError(errorMessage(error));
    }
  }

  if (session === 'checking') return <LoginPage checking />;
  if (session === 'signed-out') {
    return <LoginPage error={loginError} onLogin={login} />;
  }
  return <Dashboard onSessionExpired={expireSession} />;
}
