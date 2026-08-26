import { useCallback, useEffect, useState } from 'react';

const TOAST_DURATION_MS = 3_600;

export function useToast() {
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!message) return;
    const timeout = window.setTimeout(() => setMessage(''), TOAST_DURATION_MS);
    return () => window.clearTimeout(timeout);
  }, [message]);

  const showToast = useCallback((nextMessage: string) => {
    setMessage(nextMessage);
  }, []);

  return { message, showToast };
}
