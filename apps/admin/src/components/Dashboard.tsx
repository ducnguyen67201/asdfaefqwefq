import { useState } from 'react';

import { adminApi } from '../api/adminApi';
import { useToast } from '../hooks/useToast';
import { AccessCodesPage } from '../pages/AccessCodesPage';
import { UsagePage } from '../pages/UsagePage';
import { UsersPage } from '../pages/UsersPage';

import { CreateCodesFlow } from './CreateCodesFlow';

type Page = 'codes' | 'usage' | 'users';

interface DashboardProps {
  onSessionExpired: () => void;
}

const navigation: Array<{ icon: string; label: string; page: Page }> = [
  { icon: '◎', label: 'Users', page: 'users' },
  { icon: '◔', label: 'Usage', page: 'usage' },
  { icon: '⌁', label: 'Access codes', page: 'codes' },
];

export function Dashboard({ onSessionExpired }: DashboardProps) {
  const [codesRevision, setCodesRevision] = useState(0);
  const [createCodesOpen, setCreateCodesOpen] = useState(false);
  const [page, setPage] = useState<Page>('users');
  const { message, showToast } = useToast();

  async function signOut() {
    try {
      await adminApi.deleteSession();
    } catch {
      // Local lock state wins if the server-side session already expired.
    } finally {
      onSessionExpired();
    }
  }

  return (
    <>
      <div className="app-shell">
        <aside className="sidebar">
          <div className="brand-lockup brand-lockup--sidebar">
            <span className="brand-mark">T</span>
            <span>Tro</span>
          </div>
          <nav aria-label="Admin navigation">
            {navigation.map((item) => {
              const active = item.page === page;
              return (
                <button
                  aria-current={active ? 'page' : undefined}
                  className={`nav-item${active ? ' nav-item--active' : ''}`}
                  key={item.page}
                  onClick={() => setPage(item.page)}
                  type="button"
                >
                  <span className="nav-icon" aria-hidden="true">
                    {item.icon}
                  </span>
                  {item.label}
                </button>
              );
            })}
          </nav>
          <div className="sidebar-foot">
            <span className="status-light" aria-hidden="true" />
            <span>Admin API connected</span>
            <button className="text-button" onClick={() => void signOut()} type="button">
              Lock
            </button>
          </div>
        </aside>

        <main className="main-content">
          <UsersPage
            active={page === 'users'}
            notify={showToast}
            onCreateCodes={() => setCreateCodesOpen(true)}
            onSessionExpired={onSessionExpired}
          />
          <UsagePage
            active={page === 'usage'}
            notify={showToast}
            onSessionExpired={onSessionExpired}
          />
          <AccessCodesPage
            active={page === 'codes'}
            notify={showToast}
            onCreateCodes={() => setCreateCodesOpen(true)}
            onSessionExpired={onSessionExpired}
            revision={codesRevision}
          />
        </main>
      </div>

      <CreateCodesFlow
        notify={showToast}
        onClose={() => setCreateCodesOpen(false)}
        onCodesChanged={() => setCodesRevision((current) => current + 1)}
        onSessionExpired={onSessionExpired}
        open={createCodesOpen}
      />
      {message && (
        <div className="toast" role="status" aria-live="polite">
          {message}
        </div>
      )}
    </>
  );
}
