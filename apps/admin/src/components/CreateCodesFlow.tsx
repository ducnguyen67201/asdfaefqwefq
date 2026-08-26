import { useRef, useState, type FormEvent } from 'react';

import {
  adminApi,
  errorMessage,
  isUnauthorized,
} from '../api/adminApi';
import type { CreatedCode, CreateCodesInput } from '../api/contracts';

import { Modal } from './Modal';

interface CreateCodesFlowProps {
  notify: (message: string) => void;
  onClose: () => void;
  onCodesChanged: () => void;
  onSessionExpired: () => void;
  open: boolean;
}

export function CreateCodesFlow({
  notify,
  onClose,
  onCodesChanged,
  onSessionExpired,
  open,
}: CreateCodesFlowProps) {
  const [createdCodes, setCreatedCodes] = useState<CreatedCode[]>([]);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  function closeCreateDialog() {
    setError('');
    formRef.current?.reset();
    onClose();
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setSubmitting(true);
    const form = new FormData(event.currentTarget);
    const input: CreateCodesInput = {
      count: Number(form.get('count')),
      distributionMode:
        form.get('distributionMode') === 'shared' ? 'shared' : 'organization',
      label: String(form.get('label') || '').trim() || null,
      maxUsers: Number(form.get('maxUsers')),
      plan: String(form.get('plan')),
    };
    try {
      const result = await adminApi.createCodes(input);
      setCreatedCodes(result.items);
      closeCreateDialog();
      onCodesChanged();
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

  async function copyCodes() {
    try {
      await navigator.clipboard.writeText(
        createdCodes.map((item) => item.code).join('\n'),
      );
      notify('Codes copied to the clipboard.');
    } catch {
      notify('Clipboard access was denied. Select and copy each code manually.');
    }
  }

  return (
    <>
      <Modal
        className="code-dialog"
        labelledBy="code-dialog-title"
        onClose={closeCreateDialog}
        open={open}
      >
        <form
          className="dialog-card"
          onSubmit={(event) => void submit(event)}
          ref={formRef}
        >
          <div className="dialog-heading">
            <div>
              <p className="eyebrow">Instant access</p>
              <h2 id="code-dialog-title">Create new codes</h2>
            </div>
            <button
              aria-label="Close"
              className="icon-button"
              onClick={closeCreateDialog}
              type="button"
            >
              ×
            </button>
          </div>
          <p className="dialog-copy">
            Generate up to 100 codes at once. Each code inherits the selected
            distribution, plan, and user limit.
          </p>
          <div className="form-grid">
            <label>
              Number of codes
              <input defaultValue="1" max="100" min="1" name="count" required type="number" />
            </label>
            <label>
              Users per code
              <input defaultValue="1" max="10000" min="1" name="maxUsers" required type="number" />
            </label>
            <label>
              Plan
              <select defaultValue="pro" name="plan" required>
                <option value="free">Free</option>
                <option value="basic">Basic</option>
                <option value="pro">Pro</option>
                <option value="max">Max</option>
              </select>
            </label>
            <label>
              Distribution
              <select defaultValue="organization" name="distributionMode" required>
                <option value="organization">Organization</option>
                <option value="shared">Shared code</option>
              </select>
            </label>
            <label>
              Label prefix <span className="optional">Optional</span>
              <input maxLength={80} name="label" placeholder="September cohort" />
            </label>
          </div>
          <p className="security-note">
            <span aria-hidden="true">◇</span>
            New codes are encrypted at rest and remain viewable in Access codes.
            Legacy digest-only codes cannot be recovered.
          </p>
          <p className="form-error" role="alert">{error}</p>
          <div className="dialog-actions">
            <button className="button button--secondary" onClick={closeCreateDialog} type="button">
              Cancel
            </button>
            <button className="button button--primary" disabled={submitting} type="submit">
              {submitting ? 'Generating…' : 'Generate codes'}
            </button>
          </div>
        </form>
      </Modal>

      <Modal
        className="result-dialog"
        labelledBy="result-title"
        onClose={() => setCreatedCodes([])}
        open={createdCodes.length > 0}
      >
        <div className="dialog-card">
          <div className="dialog-heading">
            <div>
              <p className="eyebrow">Created successfully</p>
              <h2 id="result-title">Copy your codes</h2>
            </div>
            <button
              aria-label="Close"
              className="icon-button"
              onClick={() => setCreatedCodes([])}
              type="button"
            >
              ×
            </button>
          </div>
          <p className="dialog-copy">
            {createdCodes.length} code{createdCodes.length === 1 ? '' : 's'} created
            and encrypted at rest. You can view them again from Access codes.
          </p>
          <div className="code-results">
            {createdCodes.map((item) => (
              <div className="code-result" key={item.id}>
                <code>{item.code}</code>
                <span>
                  {item.plan} · {item.maxUsers} user{item.maxUsers === 1 ? '' : 's'}
                </span>
              </div>
            ))}
          </div>
          <div className="dialog-actions">
            <button className="button button--secondary" onClick={() => setCreatedCodes([])} type="button">
              Done
            </button>
            <button className="button button--primary" onClick={() => void copyCodes()} type="button">
              Copy all
            </button>
          </div>
        </div>
      </Modal>
    </>
  );
}
