import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from 'react';

import {
  adminApi,
  errorMessage,
  isUnauthorized,
} from '../api/adminApi';
import type { AccessCode, AdminUser } from '../api/contracts';
import { useDebouncedValue } from '../hooks/useDebouncedValue';

import { Modal } from './Modal';

const PAGE_SIZE = 50;

interface GrantCodeDialogProps {
  notify: (message: string) => void;
  onClose: () => void;
  onGranted: () => Promise<void>;
  onSessionExpired: () => void;
  user: AdminUser;
}

function optionLabel(code: AccessCode): string {
  const identity = code.label || code.code || 'Unlabelled code';
  const seats = `${code.remainingUsers} seat${code.remainingUsers === 1 ? '' : 's'} left`;
  return `${identity} · ${code.plan} · ${seats}`;
}

export function GrantCodeDialog({
  notify,
  onClose,
  onGranted,
  onSessionExpired,
  user,
}: GrantCodeDialogProps) {
  const [codes, setCodes] = useState<AccessCode[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selectedCodeId, setSelectedCodeId] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [total, setTotal] = useState(0);
  const debouncedSearch = useDebouncedValue(search.trim(), 260);
  const itemCountRef = useRef(0);
  const requestSequence = useRef(0);
  const selectRef = useRef<HTMLSelectElement>(null);

  const loadCodes = useCallback(
    async (append = false) => {
      const requestId = ++requestSequence.current;
      setLoading(true);
      if (!append) {
        setCodes([]);
        setSelectedCodeId('');
        setTotal(0);
      }
      try {
        const result = await adminApi.listCodes({
          limit: PAGE_SIZE,
          offset: append ? itemCountRef.current : 0,
          search: debouncedSearch,
          status: 'available',
        });
        if (requestId !== requestSequence.current) return;
        setCodes((current) =>
          append ? [...current, ...result.items] : result.items,
        );
        setTotal(result.page.total);
        setError(
          result.items.length || append
            ? ''
            : debouncedSearch
              ? 'No available access codes match this search.'
              : 'Create or resume an access code with an available seat first.',
        );
        if (!append && result.items.length) {
          window.requestAnimationFrame(() => selectRef.current?.focus());
        }
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
    }, [debouncedSearch, onSessionExpired],
  );

  useEffect(() => {
    itemCountRef.current = codes.length;
  }, [codes.length]);

  useEffect(() => {
    const timeout = window.setTimeout(() => void loadCodes(), 0);
    return () => window.clearTimeout(timeout);
  }, [loadCodes]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedCodeId) return;
    setError('');
    setSubmitting(true);
    try {
      await adminApi.grantCode(user.id, selectedCodeId);
      onClose();
      notify(`Access code granted to ${user.email}.`);
      await onGranted();
    } catch (caught) {
      if (isUnauthorized(caught)) {
        onSessionExpired();
        return;
      }
      setError(errorMessage(caught));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal
      className="grant-code-dialog"
      labelledBy="grant-code-title"
      onClose={onClose}
      open
    >
      <form className="dialog-card" onSubmit={(event) => void submit(event)}>
        <div className="dialog-heading">
          <div>
            <p className="eyebrow">Workspace access</p>
            <h2 id="grant-code-title">Grant access code</h2>
          </div>
          <button
            aria-label="Close"
            className="icon-button"
            onClick={onClose}
            type="button"
          >
            ×
          </button>
        </div>
        <p className="dialog-copy">
          {`Choose an available code for ${user.name || user.email} (${user.email}).`}
        </p>
        <label>
          Search available codes
          <input
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search label or exact code"
            type="search"
            value={search}
          />
        </label>
        <label>
          Available access code
          <select
            disabled={loading || codes.length === 0}
            onChange={(event) => setSelectedCodeId(event.target.value)}
            ref={selectRef}
            required
            value={selectedCodeId}
          >
            <option value="">
              {loading
                ? 'Loading available codes…'
                : codes.length
                  ? 'Choose an access code…'
                  : 'No available access codes'}
            </option>
            {codes.map((code) => (
              <option key={code.id} value={code.id}>
                {optionLabel(code)}
              </option>
            ))}
          </select>
        </label>
        <div className="grant-code-pagination">
          <span>
            {codes.length
              ? `Showing ${codes.length.toLocaleString()} of ${total.toLocaleString()} available codes`
              : ''}
          </span>
          {codes.length < total && (
            <button
              className="button button--secondary"
              disabled={loading}
              onClick={() => void loadCodes(true)}
              type="button"
            >
              Load more
            </button>
          )}
        </div>
        <p className="security-note">
          <span aria-hidden="true">◇</span>
          Granting reserves one seat immediately and applies the code&apos;s plan
          to this account.
        </p>
        <p className="form-error" role="alert">
          {error}
        </p>
        <div className="dialog-actions">
          <button
            className="button button--secondary"
            onClick={onClose}
            type="button"
          >
            Cancel
          </button>
          <button
            className="button button--primary"
            disabled={submitting || !selectedCodeId}
            type="submit"
          >
            {submitting ? 'Granting…' : 'Grant access'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
