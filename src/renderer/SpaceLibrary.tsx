import { useState } from 'react';

import type {
  AppLanguage,
  KnowledgeFileSelection,
  KnowledgeSourceList,
} from '../shared/contracts';

import { translate } from './app-language';

export function SpaceLibrary({
  appLanguage,
  sources,
  spaceId,
  onChanged,
  readOnly = false,
  loading = false,
}: {
  appLanguage: AppLanguage;
  sources: KnowledgeSourceList['items'];
  spaceId: string;
  onChanged: () => void;
  readOnly?: boolean;
  loading?: boolean;
}) {
  const [selection, setSelection] = useState<KnowledgeFileSelection | null>(
    null,
  );
  const [role, setRole] = useState<
    'reference' | 'instructions' | 'rubric' | 'starter'
  >('reference');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const t = (
    message: string,
    replacements: Readonly<Record<string, string | number>> = {},
  ) => translate(appLanguage, message, replacements);
  const roleLabel = (
    value: 'reference' | 'instructions' | 'rubric' | 'starter' | 'submission',
  ) =>
    t(
      value === 'reference'
        ? 'Reference'
        : value === 'instructions'
          ? 'Instructions'
          : value === 'rubric'
            ? 'Rubric'
            : value === 'starter'
              ? 'Starter files'
              : 'Submission',
    );
  const statusLabel = (
    value: 'pending_upload' | 'processing' | 'ready' | 'failed' | 'pending',
  ) =>
    t(
      value === 'pending_upload'
        ? 'Pending upload'
        : value === 'processing'
          ? 'Processing'
          : value === 'ready'
            ? 'Ready'
            : value === 'failed'
              ? 'Failed'
              : 'Pending',
    );
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
  const uploadOptions = (
    <details className="material-upload-options">
      <summary>
        <span>{t('Upload options')}</span>
        <small>{t('Reference by default')}</small>
      </summary>
      <div className="material-upload-options__body">
        <label>
          {t('Use these materials as')}
          <select
            onChange={(event) => setRole(event.target.value as typeof role)}
            value={role}
          >
            <option value="reference">{t('Reference')}</option>
            <option value="instructions">{t('Instructions')}</option>
            <option value="rubric">{t('Rubric')}</option>
            <option value="starter">{t('Starter files')}</option>
          </select>
        </label>
        <p>
          {t(
            'Reference is the safest default. Choose another type only when the material has a specific job.',
          )}
        </p>
      </div>
    </details>
  );
  return (
    <section
      aria-busy={loading}
      aria-labelledby="materials-heading"
      className="space-panel library-panel materials-panel"
    >
      <header className="library-panel__heading">
        <div>
          <p className="eyebrow">{t('For every activity')}</p>
          <div className="materials-title-line">
            <h2 id="materials-heading">{t('Materials')}</h2>
            <span
              aria-label={t('Material count')}
              aria-live="polite"
              className="materials-count"
            >
              {loading ? (
                t('Checking…')
              ) : (
                <>
                  {sources.length}{' '}
                  {t(sources.length === 1 ? 'material' : 'materials')}
                </>
              )}
            </span>
          </div>
          <p>
            {t(
              readOnly
                ? 'Materials your Teacher shared to support assigned Activities.'
                : 'Add the class material Tro should use when supporting assigned Activities.',
            )}
          </p>
        </div>
        {!readOnly && sources.length > 0 && !selection && (
          <div className="materials-header-tools">
            <div className="materials-header-actions">
              <button
                className="primary-button materials-add-files"
                onClick={() => void choose('files')}
                type="button"
              >
                <span aria-hidden="true">+</span> {t('Add files')}
              </button>
              <button
                className="materials-add-folder"
                onClick={() => void choose('folder')}
                type="button"
              >
                {t('Add a folder')}
              </button>
            </div>
            {uploadOptions}
          </div>
        )}
      </header>
      {!readOnly && selection && (
        <section className="upload-preview materials-selection">
          <div className="upload-preview__heading">
            <div>
              <p className="eyebrow">
                {t('Adding as {type}', {
                  type: roleLabel(selection.role),
                })}
              </p>
              <h3>{t('Review selection')}</h3>
              <p>{t('Only these files will be added to class materials.')}</p>
            </div>
            <span aria-label={t('Selected file count')}>
              {selection.files.length}
            </span>
          </div>
          <ul>
            {selection.files.map((file) => (
              <li key={file.relativePath}>
                <span>{file.relativePath}</span>
                <small>{Math.ceil(file.byteSize / 1024)} KB</small>
              </li>
            ))}
          </ul>
          <div className="materials-selection__actions">
            <button
              className="primary-button"
              disabled={busy}
              onClick={() => void upload()}
              type="button"
            >
              {busy ? t('Adding…') : t('Add selected files')}
            </button>
            <button
              disabled={busy}
              onClick={() => setSelection(null)}
              type="button"
            >
              {t('Cancel')}
            </button>
          </div>
        </section>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {loading && sources.length === 0 && !selection ? (
        <div className="materials-loading" role="status">
          <span aria-hidden="true" />
          <div>
            <strong>{t('Loading materials…')}</strong>
            <p>{t('Checking what this class already has.')}</p>
          </div>
        </div>
      ) : sources.length === 0 && !selection ? (
        <div className="library-empty materials-empty">
          <div className="materials-empty__visual" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
          <div className="materials-empty__copy">
            <p className="eyebrow">
              {t(readOnly ? 'Nothing shared yet' : 'Start with what you teach')}
            </p>
            <h3>
              {t(
                readOnly
                  ? 'No class materials yet'
                  : 'Bring in your first material',
              )}
            </h3>
            <p>
              {t(
                readOnly
                  ? 'Your Teacher has not shared class materials yet.'
                  : 'Add notes, readings, or starter files so Tro can support students with the right context.',
              )}
            </p>
            {!readOnly && (
              <>
                <div className="materials-empty__actions">
                  <button
                    className="primary-button materials-add-files"
                    onClick={() => void choose('files')}
                    type="button"
                  >
                    <span aria-hidden="true">+</span> {t('Add files')}
                  </button>
                  <button
                    className="materials-add-folder"
                    onClick={() => void choose('folder')}
                    type="button"
                  >
                    {t('Add a folder')}
                  </button>
                </div>
                {uploadOptions}
              </>
            )}
          </div>
        </div>
      ) : (
        sources.length > 0 && (
          <>
            <div
              aria-label={t('Class materials')}
              className="library-table-wrap"
              role="region"
              tabIndex={0}
            >
              <table className="knowledge-table">
                <thead>
                  <tr>
                    <th>{t('Material')}</th>
                    <th>{t('Used as')}</th>
                    <th>{t('Status')}</th>
                  </tr>
                </thead>
                <tbody>
                  {sources.map((source) => {
                    const status = source.latestVersion?.state ?? 'pending';
                    return (
                      <tr key={source.id}>
                        <td>
                          <span className="source-mark" aria-hidden="true">
                            T
                          </span>
                          <span>
                            <strong>{source.displayName}</strong>
                            <small>{source.relativePath}</small>
                          </span>
                        </td>
                        <td>
                          <span className="source-role">
                            {roleLabel(source.role)}
                          </span>
                        </td>
                        <td>
                          <span
                            className={`knowledge-status knowledge-status--${status}`}
                          >
                            <i aria-hidden="true" />
                            {statusLabel(status)}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div
              aria-label={t('Class materials')}
              className="materials-mobile-list"
              role="list"
            >
              {sources.map((source) => {
                const status = source.latestVersion?.state ?? 'pending';
                return (
                  <article
                    className="materials-mobile-row"
                    key={source.id}
                    role="listitem"
                  >
                    <div className="materials-mobile-row__identity">
                      <span className="source-mark" aria-hidden="true">
                        T
                      </span>
                      <span>
                        <strong>{source.displayName}</strong>
                        <small>{source.relativePath}</small>
                      </span>
                    </div>
                    <div
                      aria-label={t('{role}; status {status}', {
                        role: roleLabel(source.role),
                        status: statusLabel(status),
                      })}
                      className="materials-mobile-row__metadata"
                    >
                      <span className="source-role">
                        {roleLabel(source.role)}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span
                        className={`knowledge-status knowledge-status--${status}`}
                      >
                        <i aria-hidden="true" />
                        {statusLabel(status)}
                      </span>
                    </div>
                  </article>
                );
              })}
            </div>
          </>
        )
      )}
    </section>
  );
}
