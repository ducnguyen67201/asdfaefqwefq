import { useCallback, useEffect, useRef, useState } from 'react';

import {
  adminApi,
  errorMessage,
  isUnauthorized,
} from '../api/adminApi';
import type { AccessCode, AccessCodesResponse } from '../api/contracts';
import { CodeUsersDialog } from '../components/CodeUsersDialog';
import { EmptyState } from '../components/EmptyState';
import { SummaryCard } from '../components/SummaryCard';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { dateLabel } from '../lib/formatters';

const PAGE_SIZE = 50;

interface AccessCodesPageProps {
  active: boolean;
  notify: (message: string) => void;
  onCreateCodes: () => void;
  onSessionExpired: () => void;
  revision: number;
}

const emptyResponse: AccessCodesResponse = {
  items: [],
  page: { limit: PAGE_SIZE, offset: 0, total: 0 },
  summary: {
    availableCodes: 0,
    fullCodes: 0,
    pausedCodes: 0,
    retrievableCodes: 0,
    totalCodes: 0,
    totalRedemptions: 0,
  },
};

export function AccessCodesPage({
  active,
  notify,
  onCreateCodes,
  onSessionExpired,
  revision,
}: AccessCodesPageProps) {
  const [busyAction, setBusyAction] = useState('');
  const [loading, setLoading] = useState(true);
  const [response, setResponse] = useState<AccessCodesResponse>(emptyResponse);
  const [search, setSearch] = useState('');
  const [selectedCode, setSelectedCode] = useState<AccessCode | null>(null);
  const [status, setStatus] = useState('');
  const debouncedSearch = useDebouncedValue(search.trim(), 260);
  const itemCountRef = useRef(0);
  const requestSequence = useRef(0);

  useEffect(() => {
    itemCountRef.current = response.items.length;
  }, [response.items.length]);

  const loadCodes = useCallback(
    async (append = false) => {
      const requestId = ++requestSequence.current;
      setLoading(true);
      try {
        const result = await adminApi.listCodes({
          limit: PAGE_SIZE,
          offset: append ? itemCountRef.current : 0,
          search: debouncedSearch,
          status,
        });
        if (requestId !== requestSequence.current) return;
        setResponse((current) => ({
          ...result,
          items: append ? [...current.items, ...result.items] : result.items,
        }));
      } catch (caught) {
        if (requestId !== requestSequence.current) return;
        if (isUnauthorized(caught)) {
          onSessionExpired();
          return;
        }
        notify(errorMessage(caught));
      } finally {
        if (requestId === requestSequence.current) setLoading(false);
      }
    }, [debouncedSearch, notify, onSessionExpired, status],
  );

  useEffect(() => {
    if (!active) return;
    const timeout = window.setTimeout(() => void loadCodes(), 0);
    return () => window.clearTimeout(timeout);
  }, [active, loadCodes, revision]);

  async function copyCode(code: AccessCode) {
    if (!code.code) return;
    try {
      await navigator.clipboard.writeText(code.code);
      notify('Access code copied to the clipboard.');
    } catch {
      notify('Clipboard access was denied. Select and copy the code manually.');
    }
  }

  async function pauseCode(code: AccessCode) {
    const paused = code.status !== 'paused';
    setBusyAction(`pause:${code.id}`);
    try {
      await adminApi.pauseCode(code.id, paused);
      await loadCodes();
      notify(`${code.label || 'Access code'} was ${paused ? 'paused' : 'resumed'}.`);
    } catch (caught) {
      if (isUnauthorized(caught)) {
        onSessionExpired();
        return;
      }
      notify(errorMessage(caught));
    } finally {
      setBusyAction('');
    }
  }

  async function deleteCode(code: AccessCode) {
    if (code.redeemedUsers > 0) {
      notify('Codes with redemptions cannot be deleted. Pause this code instead.');
      return;
    }
    const label = code.label || 'this access code';
    if (!window.confirm(`Delete ${label}? This cannot be undone.`)) return;
    setBusyAction(`delete:${code.id}`);
    try {
      await adminApi.deleteCode(code.id);
      await loadCodes();
      notify(`${label} was deleted.`);
    } catch (caught) {
      if (isUnauthorized(caught)) {
        onSessionExpired();
        return;
      }
      notify(errorMessage(caught));
    } finally {
      setBusyAction('');
    }
  }

  return (
    <section className="page-view" hidden={!active} id="access-codes-page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Workspace access</p>
          <h1>Access codes</h1>
          <p className="page-subtitle">
            Inspect every code, plan, and redemption from the Tro database.
          </p>
        </div>
        <button className="button button--primary" onClick={onCreateCodes} type="button">
          <span aria-hidden="true">＋</span> New code
        </button>
      </header>

      <section className="summary-grid summary-grid--codes" aria-label="Access code summary">
        <SummaryCard foot="All database records" label="Total codes" value={response.summary.totalCodes} />
        <SummaryCard foot="Capacity remaining" footKind="good" label="Available" value={response.summary.availableCodes} />
        <SummaryCard foot="User limit reached" footKind="warning" label="Full" value={response.summary.fullCodes} />
        <SummaryCard foot="Not accepting new users" label="Paused" value={response.summary.pausedCodes} />
      </section>

      <section className="table-card" aria-labelledby="codes-table-title">
        <div className="table-toolbar">
          <div>
            <h2 id="codes-table-title">All access codes</h2>
            <p>
              {loading
                ? 'Loading codes…'
                : `${response.page.total.toLocaleString()} matching code${response.page.total === 1 ? '' : 's'} · ${response.summary.totalRedemptions.toLocaleString()} redemption${response.summary.totalRedemptions === 1 ? '' : 's'}`}
            </p>
          </div>
          <div className="toolbar-controls">
            <label className="search-field">
              <span aria-hidden="true">⌕</span>
              <span className="sr-only">Search access codes</span>
              <input onChange={(event) => setSearch(event.target.value)} placeholder="Search label or exact code" type="search" value={search} />
            </label>
            <label className="filter-field">
              <span className="sr-only">Filter codes by status</span>
              <select onChange={(event) => setStatus(event.target.value)} value={status}>
                <option value="">All statuses</option>
                <option value="available">Available</option>
                <option value="full">Full</option>
                <option value="paused">Paused</option>
              </select>
            </label>
          </div>
        </div>
        {response.items.length ? (
          <div className="table-scroll">
            <table className="access-codes-table">
              <thead>
                <tr>
                  <th scope="col">Access code</th>
                  <th scope="col">Label</th>
                  <th scope="col">Plan</th>
                  <th scope="col">Usage</th>
                  <th scope="col">Who&apos;s using it</th>
                  <th scope="col">Created</th>
                  <th scope="col">Status</th>
                  <th scope="col">Actions</th>
                </tr>
              </thead>
              <tbody>
                {response.items.map((code) => {
                  const isPaused = code.status === 'paused';
                  const memberCount = code.assignedSeats;
                  return (
                    <tr key={code.id}>
                      <td>
                        {code.retrievable && code.code ? (
                          <div className="access-code-cell">
                            <code>{code.code}</code>
                            <button aria-label={`Copy access code ${code.label || ''}`.trim()} className="row-action" onClick={() => void copyCode(code)} type="button">Copy</button>
                          </div>
                        ) : (
                          <span className="code-unavailable" title="This code was stored as a one-way digest before encrypted retrieval was enabled.">
                            Unavailable (legacy)
                          </span>
                        )}
                      </td>
                      <td>
                        {code.label || '—'}
                        <span className="code-meta">
                          {code.distributionMode === 'organization' ? 'Organization' : 'Shared'}
                        </span>
                      </td>
                      <td><span className={`plan-badge plan-badge--${code.plan}`}>{code.plan}</span></td>
                      <td className="usage-cell">{code.assignedSeats.toLocaleString()} / {code.maxUsers.toLocaleString()}</td>
                      <td>
                        {memberCount === 0 ? (
                          <span className="code-users-none">No users</span>
                        ) : (
                          <button className="row-action row-action--users" onClick={() => setSelectedCode(code)} type="button">
                            View {memberCount.toLocaleString()} user{memberCount === 1 ? '' : 's'}
                          </button>
                        )}
                      </td>
                      <td>{dateLabel(code.createdAt)}</td>
                      <td><span className={`status-badge status-badge--${code.status}`}>{code.status}</span></td>
                      <td>
                        <div className="code-actions">
                          <button className="row-action" disabled={busyAction === `pause:${code.id}`} onClick={() => void pauseCode(code)} type="button">
                            {busyAction === `pause:${code.id}` ? (isPaused ? 'Resuming…' : 'Pausing…') : isPaused ? 'Resume' : 'Pause'}
                          </button>
                          <button
                            className="row-action row-action--danger"
                            disabled={code.redeemedUsers > 0 || busyAction === `delete:${code.id}`}
                            onClick={() => void deleteCode(code)}
                            title={code.redeemedUsers > 0 ? 'Codes with redemptions cannot be deleted.' : undefined}
                            type="button"
                          >
                            {busyAction === `delete:${code.id}` ? 'Deleting…' : 'Delete'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          !loading && <EmptyState detail="Create a code or try a different filter." icon="⌁" title="No access codes found" />
        )}
        <div className="table-footer">
          <span>
            {response.items.length
              ? `Showing 1–${response.items.length} of ${response.page.total}`
              : 'No access codes to show'}
          </span>
          {response.items.length < response.page.total && (
            <button className="button button--secondary" disabled={loading} onClick={() => void loadCodes(true)} type="button">Load more</button>
          )}
        </div>
      </section>

      {selectedCode && (
        <CodeUsersDialog
          code={selectedCode}
          onClose={() => setSelectedCode(null)}
          onSessionExpired={onSessionExpired}
        />
      )}
    </section>
  );
}
