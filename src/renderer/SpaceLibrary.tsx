import { useState } from 'react';

import type {
  AppLanguage,
  KnowledgeFileSelection,
  KnowledgeSourceList,
} from '../shared/contracts';

import { translate } from './app-language';

type ContentRole = 'reference' | 'instructions' | 'rubric' | 'starter';

const CONTENT_ROLE_DESCRIPTIONS: Record<ContentRole, string> = {
  instructions: 'The task brief students and Tro use during class.',
  reference:
    'Background material Tro may retrieve when a student asks for help.',
  rubric: 'Criteria used by Check and teacher review.',
  starter: 'A safe starting workspace students can copy before they begin.',
};

export function SpaceLibrary({
  appLanguage,
  canManage = true,
  onChanged,
  sources,
  spaceId,
}: {
  appLanguage: AppLanguage;
  canManage?: boolean;
  onChanged: () => void;
  sources: KnowledgeSourceList['items'];
  spaceId: string;
}) {
  const [selection, setSelection] = useState<KnowledgeFileSelection | null>(
    null,
  );
  const [role, setRole] = useState<ContentRole>('reference');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const t = (
    message: string,
    values?: Readonly<Record<string, string | number>>,
  ) => translate(appLanguage, message, values);

  const choose = async (selectionKind: 'files' | 'folder') => {
    try {
      setSelection(
        await window.tro.selectKnowledgeFiles({ role, selectionKind }),
      );
      setError(null);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : t('Could not review those files.'),
      );
    }
  };

  const upload = async () => {
    if (!selection) return;
    setBusy(true);
    try {
      await window.tro.uploadKnowledgeSelection({
        spaceId,
        selectionId: selection.selectionId,
      });
      setSelection(null);
      setError(null);
      onChanged();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : t('Upload could not be completed.'),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      className="space-panel library-studio"
      aria-labelledby="library-heading"
    >
      <div className="section-heading-row">
        <div>
          <p className="eyebrow">{t('Class sourcebook')}</p>
          <h2 id="library-heading">{t('Materials')}</h2>
          <p className="section-deck">
            {canManage
              ? t('Build the bounded source set Tro can use for this class.')
              : t(
                  'Only material published with your Activities is shared with you.',
                )}
          </p>
        </div>
        <span
          className="library-count"
          aria-label={t('{count} sources', { count: sources.length })}
        >
          <strong>{sources.length}</strong>
          <small>{t('sources')}</small>
        </span>
      </div>

      {canManage && (
        <div className="library-upload-station">
          <div className="library-upload-copy">
            <span className="step-index" aria-hidden="true">
              01
            </span>
            <div>
              <strong>{t('Add class material')}</strong>
              <p>{t(CONTENT_ROLE_DESCRIPTIONS[role])}</p>
            </div>
          </div>
          <div className="knowledge-actions library-upload-actions">
            <label>
              {t('Material type')}
              <select
                onChange={(event) => setRole(event.target.value as ContentRole)}
                value={role}
              >
                <option value="reference">{t('Reference')}</option>
                <option value="instructions">{t('Instructions')}</option>
                <option value="rubric">{t('Rubric')}</option>
                <option value="starter">{t('Starter files')}</option>
              </select>
            </label>
            <button onClick={() => void choose('files')} type="button">
              {t('Choose files')}
            </button>
            <button onClick={() => void choose('folder')} type="button">
              {t('Snapshot folder')}
            </button>
          </div>
        </div>
      )}

      {selection && canManage && (
        <div className="upload-preview" aria-label={t('Review upload')}>
          <div className="upload-preview__heading">
            <div>
              <span
                className="step-index step-index--complete"
                aria-hidden="true"
              >
                ✓
              </span>
              <strong>{t('Review before upload')}</strong>
            </div>
            <small>
              {selection.files.length} {t('files')} ·{' '}
              {Math.ceil(selection.totalBytes / 1024)} KB
            </small>
          </div>
          <ul>
            {selection.files.map((file) => (
              <li key={file.relativePath}>
                <span>{file.relativePath}</span>
                <small>{Math.ceil(file.byteSize / 1024)} KB</small>
              </li>
            ))}
          </ul>
          <div className="upload-preview__actions">
            <button onClick={() => setSelection(null)} type="button">
              {t('Cancel')}
            </button>
            <button
              className="primary-button"
              disabled={busy}
              onClick={() => void upload()}
              type="button"
            >
              {busy ? t('Uploading…') : t('Upload reviewed files')}
            </button>
          </div>
        </div>
      )}

      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}

      {sources.length === 0 ? (
        <div className="knowledge-empty knowledge-empty--material">
          <span className="empty-illustration" aria-hidden="true">
            ＋
          </span>
          <div>
            <strong>
              {t(canManage ? 'Your sourcebook is empty' : 'No shared material')}
            </strong>
            <p>
              {t(
                canManage
                  ? 'Start with the exercise instructions, then add a rubric or reference material.'
                  : 'Your teacher has not published material for this Space yet.',
              )}
            </p>
          </div>
        </div>
      ) : (
        <div className="knowledge-table-shell">
          <table className="knowledge-table">
            <thead>
              <tr>
                <th>{t('Source')}</th>
                <th>{t('Role')}</th>
                <th>{t('Status')}</th>
              </tr>
            </thead>
            <tbody>
              {sources.map((source) => (
                <tr key={source.id}>
                  <td>
                    <strong>{source.displayName}</strong>
                    <small>{source.relativePath}</small>
                  </td>
                  <td>
                    <span className="source-role">{t(source.role)}</span>
                  </td>
                  <td>
                    <span
                      className={`knowledge-status knowledge-status--${source.latestVersion?.state ?? 'pending'}`}
                    >
                      {t(source.latestVersion?.state ?? 'pending')}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
