import { useCallback, useEffect, useRef, useState } from 'react';

import {
  adminApi,
  errorMessage,
  isUnauthorized,
} from '../api/adminApi';
import type {
  AccessCode,
  CodeUser,
  CodeUsersResponse,
} from '../api/contracts';
import { dateLabel, initials } from '../lib/formatters';

import { EmptyState } from './EmptyState';
import { Modal } from './Modal';

const PAGE_SIZE = 50;

interface CodeUsersDialogProps {
  code: AccessCode;
  onClose: () => void;
  onSessionExpired: () => void;
}

export function CodeUsersDialog({
  code,
  onClose,
  onSessionExpired,
}: CodeUsersDialogProps) {
  const [error, setError] = useState('');
  const [items, setItems] = useState<CodeUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [metadata, setMetadata] = useState<CodeUsersResponse['code'] | null>(null);
  const [total, setTotal] = useState(0);
  const itemCountRef = useRef(0);
  const requestSequence = useRef(0);

  useEffect(() => {
    itemCountRef.current = items.length;
  }, [items.length]);

  const loadUsers = useCallback(
    async (append = false) => {
      const requestId = ++requestSequence.current;
      setLoading(true);
      setError('');
      try {
        const result = await adminApi.listCodeUsers(
          code.id,
          PAGE_SIZE,
          append ? itemCountRef.current : 0,
        );
        if (requestId !== requestSequence.current) return;
        setItems((current) => append ? [...current, ...result.items] : result.items);
        setMetadata(result.code);
        setTotal(result.page.total);
      } catch (caught) {
        if (requestId !== requestSequence.current) return;
        if (isUnauthorized(caught)) {
          onSessionExpired();
          return;
        }
        setError(errorMessage(caught));
      } finally {
        if (requestId === requestSequence.current) setLoading(false);
      }
    }, [code, onSessionExpired],
  );

  useEffect(() => {
    const timeout = window.setTimeout(() => void loadUsers(), 0);
    return () => window.clearTimeout(timeout);
  }, [loadUsers]);

  const summary = metadata
    ? `${metadata.label || 'Unlabelled code'} · ${metadata.plan} plan · ${metadata.assignedSeats.toLocaleString()} of ${metadata.maxUsers.toLocaleString()} seats used`
    : loading
      ? 'Loading users…'
      : error;

  return (
    <Modal
      className="code-users-dialog"
      labelledBy="code-users-title"
      onClose={onClose}
      open
    >
      <div className="dialog-card">
        <div className="dialog-heading">
          <div>
            <p className="eyebrow">Access activity</p>
            <h2 id="code-users-title">Who&apos;s using it</h2>
          </div>
          <button aria-label="Close" className="icon-button" onClick={onClose} type="button">×</button>
        </div>
        <p className="dialog-copy">{summary}</p>
        <div className="code-users-list" aria-live="polite">
          {items.map((user) => (
            <article className="code-user-row" key={user.id}>
              <div className="user-cell">
                <span className="avatar">{initials(user.name, user.email)}</span>
                <span>
                  <span className="user-name">{user.name || 'Pending member'}</span>
                  <span className="user-email">{user.email}</span>
                </span>
              </div>
              <div className="code-user-details">
                <span className="code-user-redeemed">
                  {user.state === 'pending'
                    ? `Invitation pending${user.role ? ` · ${user.role}` : ''}`
                    : `Joined ${dateLabel(user.redeemedAt)}`}
                </span>
                <span className={`status-badge status-badge--${user.state === 'pending' ? 'pending' : user.status}`}>
                  {user.state === 'pending' ? 'pending' : user.status}
                </span>
              </div>
            </article>
          ))}
        </div>
        {!items.length && !loading && (
          <EmptyState
            detail={error || 'This code has not been redeemed.'}
            icon="◎"
            title={error ? 'Could not load users' : 'No users yet'}
          />
        )}
        <div className="dialog-actions">
          <button className="button button--secondary" onClick={onClose} type="button">Close</button>
          {items.length < total && (
            <button className="button button--primary" disabled={loading} onClick={() => void loadUsers(true)} type="button">
              Load more
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}
