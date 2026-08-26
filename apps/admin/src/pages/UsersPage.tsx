import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
} from 'react';

import {
  adminApi,
  errorMessage,
  isUnauthorized,
} from '../api/adminApi';
import type {
  AdminUser,
  ClassroomRole,
  UsersResponse,
} from '../api/contracts';
import { EmptyState } from '../components/EmptyState';
import { GrantCodeDialog } from '../components/GrantCodeDialog';
import { SummaryCard } from '../components/SummaryCard';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { dateLabel, initials } from '../lib/formatters';

const PAGE_SIZE = 50;

interface UsersPageProps {
  active: boolean;
  notify: (message: string) => void;
  onCreateCodes: () => void;
  onSessionExpired: () => void;
}

interface RoleSaveState {
  kind: 'error' | 'idle' | 'saved' | 'saving';
  message: string;
}

const idleRoleState: RoleSaveState = { kind: 'idle', message: '' };

export function UsersPage({
  active,
  notify,
  onCreateCodes,
  onSessionExpired,
}: UsersPageProps) {
  const [busyUserId, setBusyUserId] = useState('');
  const [classroomRole, setClassroomRole] = useState('');
  const [grantUser, setGrantUser] = useState<AdminUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [response, setResponse] = useState<UsersResponse | null>(null);
  const [roleStates, setRoleStates] = useState<Record<string, RoleSaveState>>(
    {},
  );
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const debouncedSearch = useDebouncedValue(search.trim(), 260);
  const itemCountRef = useRef(0);
  const requestSequence = useRef(0);

  useEffect(() => {
    itemCountRef.current = response?.items.length ?? 0;
  }, [response?.items.length]);

  const loadUsers = useCallback(
    async (append = false) => {
      const requestId = ++requestSequence.current;
      setLoading(true);
      try {
        const result = await adminApi.listUsers({
          classroomRole,
          limit: PAGE_SIZE,
          offset: append ? itemCountRef.current : 0,
          search: debouncedSearch,
          status,
        });
        if (requestId !== requestSequence.current) return;
        setResponse((current) => ({
          ...result,
          items: append && current ? [...current.items, ...result.items] : result.items,
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
    },
    [classroomRole, debouncedSearch, notify, onSessionExpired, status],
  );

  useEffect(() => {
    if (!active) return;
    const timeout = window.setTimeout(() => void loadUsers(), 0);
    return () => window.clearTimeout(timeout);
  }, [active, loadUsers]);

  async function changeAccess(user: AdminUser) {
    const blocked = user.status !== 'blocked';
    if (
      blocked &&
      !window.confirm(
        `Block ${user.email}? Their active sessions will be revoked immediately.`,
      )
    ) {
      return;
    }
    setBusyUserId(user.id);
    try {
      await adminApi.blockUser(user.id, blocked);
      await loadUsers();
      notify(`${user.email} is now ${blocked ? 'blocked' : 'active'}.`);
    } catch (caught) {
      if (isUnauthorized(caught)) {
        onSessionExpired();
        return;
      }
      notify(errorMessage(caught));
    } finally {
      setBusyUserId('');
    }
  }

  async function changeClassroomRole(
    user: AdminUser,
    event: ChangeEvent<HTMLSelectElement>,
  ) {
    const role = event.target.value as ClassroomRole;
    const previousRole = user.classroomRole;
    setRoleStates((current) => ({
      ...current,
      [user.id]: { kind: 'saving', message: 'Saving…' },
    }));
    setResponse((current) =>
      current
        ? {
            ...current,
            items: current.items.map((item) =>
              item.id === user.id ? { ...item, classroomRole: role } : item,
            ),
          }
        : current,
    );
    try {
      await adminApi.setClassroomRole(user.id, role);
      setRoleStates((current) => ({
        ...current,
        [user.id]: { kind: 'saved', message: 'Saved' },
      }));
      notify(
        `${user.email} is now ${role === 'unassigned' ? 'unassigned' : `a ${role}`}.`,
      );
    } catch (caught) {
      setResponse((current) =>
        current
          ? {
              ...current,
              items: current.items.map((item) =>
                item.id === user.id
                  ? { ...item, classroomRole: previousRole }
                  : item,
              ),
            }
          : current,
      );
      setRoleStates((current) => ({
        ...current,
        [user.id]: {
          kind: 'error',
          message: 'Not saved',
        },
      }));
      if (isUnauthorized(caught)) {
        onSessionExpired();
        return;
      }
      notify(errorMessage(caught));
    }
  }

  const users = response?.items ?? [];
  const total = response?.page.total ?? 0;
  const summary = response?.summary;

  return (
    <section className="page-view" hidden={!active} id="users-page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Workspace access</p>
          <h1>Users</h1>
          <p className="page-subtitle">
            Assign classroom roles, plans, and product access.
          </p>
        </div>
        <button
          className="button button--primary"
          onClick={onCreateCodes}
          type="button"
        >
          <span aria-hidden="true">＋</span>
          New code
        </button>
      </header>

      <section className="summary-grid" aria-label="User summary">
        <SummaryCard
          foot="All registered accounts"
          label="Total users"
          value={summary?.totalUsers ?? '—'}
        />
        <SummaryCard
          foot="Can access Tro"
          footKind="good"
          label="Active"
          value={summary?.activeUsers ?? '—'}
        />
        <SummaryCard
          foot="Access disabled"
          footKind="warning"
          label="Blocked"
          value={summary?.blockedUsers ?? '—'}
        />
      </section>

      <aside className="classroom-flow-note" aria-label="Classroom setup flow">
        <div className="classroom-flow-note__copy">
          <span className="classroom-flow-note__mark" aria-hidden="true">
            ↗
          </span>
          <div>
            <strong>Classroom setup</strong>
            <span>
              Set a role here before a teacher adds this account to a class.
            </span>
          </div>
        </div>
        <ol>
          <li>
            <span>1</span> Account created
          </li>
          <li>
            <span>2</span> Role assigned
          </li>
          <li>
            <span>3</span> Added to class
          </li>
        </ol>
      </aside>

      <section className="table-card" aria-labelledby="users-table-title">
        <div className="table-toolbar">
          <div>
            <h2 id="users-table-title">All accounts</h2>
            <p>
              {loading
                ? 'Loading accounts…'
                : `${total.toLocaleString()} matching account${total === 1 ? '' : 's'}`}
            </p>
          </div>
          <div className="toolbar-controls">
            <label className="search-field">
              <span className="filter-field__label">Search</span>
              <span aria-hidden="true">⌕</span>
              <span className="sr-only">Search users</span>
              <input
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search name or email"
                type="search"
                value={search}
              />
            </label>
            <label className="filter-field">
              <span className="filter-field__label">Class role</span>
              <select
                onChange={(event) => setClassroomRole(event.target.value)}
                value={classroomRole}
              >
                <option value="">All roles</option>
                <option value="unassigned">Unassigned</option>
                <option value="teacher">Teacher</option>
                <option value="student">Student</option>
              </select>
            </label>
            <label className="filter-field">
              <span className="filter-field__label">Status</span>
              <select
                onChange={(event) => setStatus(event.target.value)}
                value={status}
              >
                <option value="">All statuses</option>
                <option value="active">Active</option>
                <option value="blocked">Blocked</option>
              </select>
            </label>
          </div>
        </div>
        {users.length ? (
          <div className="table-scroll">
            <table className="users-table">
              <thead>
                <tr>
                  <th scope="col">User</th>
                  <th scope="col">Plan</th>
                  <th scope="col">Classroom role</th>
                  <th scope="col">Access code</th>
                  <th scope="col">Last seen</th>
                  <th scope="col">Status</th>
                  <th scope="col">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {users.map((user) => {
                  const blocked = user.status === 'blocked';
                  const roleState = roleStates[user.id] ?? idleRoleState;
                  return (
                    <tr key={user.id}>
                      <td>
                        <div className="user-cell">
                          <span className="avatar">
                            {initials(user.name, user.email)}
                          </span>
                          <span>
                            <span className="user-name">
                              {user.name || 'Unnamed user'}
                            </span>
                            <span className="user-email">{user.email}</span>
                          </span>
                        </div>
                      </td>
                      <td>
                        <span className={`plan-badge plan-badge--${user.plan}`}>
                          {user.plan}
                        </span>
                      </td>
                      <td className="classroom-role-cell" data-label="Classroom role">
                        <div
                          className={`classroom-role-control classroom-role-control--${user.classroomRole}`}
                          data-state={roleState.kind}
                        >
                          <span className="classroom-role-control__mark">●</span>
                          <select
                            aria-label={`Classroom role for ${user.email}`}
                            className="classroom-role-select"
                            disabled={roleState.kind === 'saving'}
                            onChange={(event) =>
                              void changeClassroomRole(user, event)
                            }
                            value={user.classroomRole}
                          >
                            <option value="unassigned">Unassigned</option>
                            <option value="teacher">Teacher</option>
                            <option value="student">Student</option>
                          </select>
                        </div>
                        <span
                          className={`classroom-role-save-state${roleState.kind === 'idle' ? '' : ` classroom-role-save-state--${roleState.kind}`}`}
                          role="status"
                        >
                          {roleState.message}
                        </span>
                      </td>
                      <td>
                        {user.codeLabel ||
                          (user.accessCodeId ? 'Unlabelled code' : '—')}
                      </td>
                      <td>{dateLabel(user.lastSeenAt)}</td>
                      <td>
                        <span
                          className={`status-badge status-badge--${user.status}`}
                        >
                          {user.status}
                        </span>
                      </td>
                      <td>
                        <div className="code-actions">
                          {!user.accessCodeId && (
                            <button
                              className="row-action row-action--users"
                              disabled={blocked}
                              onClick={() => setGrantUser(user)}
                              title={
                                blocked
                                  ? 'Unblock this user before granting a code.'
                                  : undefined
                              }
                              type="button"
                            >
                              Grant code
                            </button>
                          )}
                          <button
                            className={`row-action${blocked ? '' : ' row-action--block'}`}
                            disabled={busyUserId === user.id}
                            onClick={() => void changeAccess(user)}
                            type="button"
                          >
                            {busyUserId === user.id
                              ? blocked
                                ? 'Unblocking…'
                                : 'Blocking…'
                              : blocked
                                ? 'Unblock'
                                : 'Block'}
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
          !loading && (
            <EmptyState
              detail="Try a different search or status filter."
              icon="◎"
              title="No users found"
            />
          )
        )}
        <div className="table-footer">
          <span>
            {users.length
              ? `Showing 1–${users.length} of ${total}`
              : 'No accounts to show'}
          </span>
          {users.length < total && (
            <button
              className="button button--secondary"
              disabled={loading}
              onClick={() => void loadUsers(true)}
              type="button"
            >
              Load more
            </button>
          )}
        </div>
      </section>

      {grantUser && (
        <GrantCodeDialog
          notify={notify}
          onClose={() => setGrantUser(null)}
          onGranted={() => loadUsers()}
          onSessionExpired={onSessionExpired}
          user={grantUser}
        />
      )}
    </section>
  );
}
