import { useMemo, useState } from 'react';

import type {
  AppLanguage,
  KnowledgeSourceList,
  SaveKnowledgeActivityRequest,
} from '../shared/contracts';
import { randomUUID } from '../shared/renderer-uuid';

import { translate } from './app-language';

export function ActivityEditorPage({
  appLanguage,
  onPublished,
  sources,
  spaceId,
}: {
  appLanguage: AppLanguage;
  onPublished: (
    versionId: string,
    definition: SaveKnowledgeActivityRequest['definition'],
  ) => void;
  sources: KnowledgeSourceList['items'];
  spaceId: string;
}) {
  const [title, setTitle] = useState('');
  const [objective, setObjective] = useState('');
  const [instructions, setInstructions] = useState('');
  const [launchTarget, setLaunchTarget] = useState<
    'none' | 'workspace' | 'current_surface'
  >('none');
  const [hintMode, setHintMode] = useState<'direct' | 'guided' | 'socratic'>(
    'guided',
  );
  const [answerReveal, setAnswerReveal] = useState<
    'allowed' | 'after_attempt' | 'never'
  >('after_attempt');
  const [criteriaText, setCriteriaText] = useState('');
  const [originsText, setOriginsText] = useState('');
  const [requiresSubmission, setRequiresSubmission] = useState(false);
  const [allowRoomJoin, setAllowRoomJoin] = useState(true);
  const [selectedSources, setSelectedSources] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const clientId = useMemo(() => randomUUID(), []);
  const t = (message: string) => translate(appLanguage, message);

  const criteria = criteriaText
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [id = '', criterionTitle = '', description = '', tags = ''] = line
        .split('|')
        .map((value) => value.trim());
      return {
        id,
        title: criterionTitle,
        description,
        tags: tags
          .split(',')
          .map((tag) => tag.trim())
          .filter(Boolean),
      };
    });

  const allowedOrigins = originsText
    .split(/\r?\n/u)
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => {
      try {
        return new URL(value).origin;
      } catch {
        return value;
      }
    });

  const definition: SaveKnowledgeActivityRequest['definition'] = {
    title,
    objective,
    instructions,
    launchTarget,
    guidancePolicy: { answerReveal, hintMode, maxHintLevel: 3 },
    criteria,
    completionPolicy: {
      requiresSubmission,
      requiresFacilitatorConfirmation: true,
    },
    sessionPolicy: { allowRoomJoin, allowedOrigins },
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const draft = await window.tro.saveKnowledgeActivity({
        spaceId,
        clientId,
        definition,
        sourceVersionIds: selectedSources,
      });
      setMessage(t('Draft saved.'));
      return draft.id;
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : t('Could not save this Activity.'),
      );
      throw cause;
    } finally {
      setBusy(false);
    }
  };

  const readySources = sources.filter(
    (source) => source.latestVersion?.state === 'ready',
  );
  const canSave = Boolean(
    title.trim() && objective.trim() && instructions.trim(),
  );

  return (
    <section
      className="space-panel activity-studio"
      aria-labelledby="activity-editor-heading"
    >
      <div className="section-heading-row">
        <div>
          <p className="eyebrow">{t('Activity blueprint')}</p>
          <h2 id="activity-editor-heading">{t('Prepare the learning path')}</h2>
          <p className="section-deck">
            {t('Publish one immutable version before you open a live room.')}
          </p>
        </div>
        <div
          className="activity-studio__progress"
          aria-label={t('Activity preparation steps')}
        >
          <span className="is-active">1</span>
          <i />
          <span>2</span>
          <i />
          <span>3</span>
        </div>
      </div>

      <div className="activity-studio__section">
        <div className="activity-studio__section-label">
          <span className="step-index">01</span>
          <div>
            <strong>{t('Frame the exercise')}</strong>
            <small>{t('What students see and what success means')}</small>
          </div>
        </div>
        <div className="activity-form-grid">
          <label>
            {t('Title')}
            <input
              maxLength={240}
              onChange={(event) => setTitle(event.target.value)}
              placeholder={t('Debug the temperature converter')}
              value={title}
            />
          </label>
          <label>
            {t('Objective')}
            <input
              maxLength={4000}
              onChange={(event) => setObjective(event.target.value)}
              placeholder={t('Explain and correct the unit conversion logic')}
              value={objective}
            />
          </label>
          <label className="activity-form-wide">
            {t('Student instructions')}
            <textarea
              maxLength={24000}
              onChange={(event) => setInstructions(event.target.value)}
              placeholder={t(
                'Describe the exercise in the order students should approach it…',
              )}
              rows={7}
              value={instructions}
            />
          </label>
        </div>
      </div>

      <div className="activity-studio__section">
        <div className="activity-studio__section-label">
          <span className="step-index">02</span>
          <div>
            <strong>{t('Bound Tro’s guidance')}</strong>
            <small>
              {t('Help stays inside the published material and policy')}
            </small>
          </div>
        </div>
        <div className="activity-form-grid activity-form-grid--three">
          <label>
            {t('Work context')}
            <select
              onChange={(event) =>
                setLaunchTarget(event.target.value as typeof launchTarget)
              }
              value={launchTarget}
            >
              <option value="none">{t('Conversation only')}</option>
              <option value="workspace">{t('Workspace folder')}</option>
              <option value="current_surface">{t('Current screen')}</option>
            </select>
          </label>
          <label>
            {t('Guidance style')}
            <select
              onChange={(event) =>
                setHintMode(event.target.value as typeof hintMode)
              }
              value={hintMode}
            >
              <option value="direct">{t('Direct')}</option>
              <option value="guided">{t('Guided debugging')}</option>
              <option value="socratic">{t('Socratic questions')}</option>
            </select>
          </label>
          <label>
            {t('Answer reveal')}
            <select
              onChange={(event) =>
                setAnswerReveal(event.target.value as typeof answerReveal)
              }
              value={answerReveal}
            >
              <option value="allowed">{t('Allowed')}</option>
              <option value="after_attempt">{t('After an attempt')}</option>
              <option value="never">{t('Never')}</option>
            </select>
          </label>
          <label className="activity-form-wide">
            {t('Check criteria')}
            <textarea
              onChange={(event) => setCriteriaText(event.target.value)}
              placeholder={t(
                'criterion-id | Title | Description | concept-tag',
              )}
              rows={5}
              value={criteriaText}
            />
            <small>
              {t(
                'One criterion per line. Check uses these; it never assigns a numeric grade.',
              )}
            </small>
          </label>
        </div>
      </div>

      <div className="activity-studio__section">
        <div className="activity-studio__section-label">
          <span className="step-index">03</span>
          <div>
            <strong>{t('Set live-class permissions')}</strong>
            <small>
              {t('Every automatic action stays explicit and revocable')}
            </small>
          </div>
        </div>
        <div className="activity-policy-grid">
          <label className="activity-toggle-card">
            <input
              checked={allowRoomJoin}
              onChange={(event) => setAllowRoomJoin(event.target.checked)}
              type="checkbox"
            />
            <span>
              <strong>{t('Allow students to join a live room')}</strong>
              <small>
                {t('Joining creates each student’s private Attempt.')}
              </small>
            </span>
          </label>
          <label className="activity-toggle-card">
            <input
              checked={requiresSubmission}
              onChange={(event) => setRequiresSubmission(event.target.checked)}
              type="checkbox"
            />
            <span>
              <strong>{t('Require an explicit file submission')}</strong>
              <small>{t('Tro never uploads local work automatically.')}</small>
            </span>
          </label>
          <label className="activity-form-wide allowed-origins-field">
            {t('Approved sites for automatic opening')}
            <textarea
              onChange={(event) => setOriginsText(event.target.value)}
              placeholder={'https://replit.com\nhttps://scratch.mit.edu'}
              rows={4}
              value={originsText}
            />
            <small>
              {t(
                'One HTTPS origin per line. Other safe links remain manual and always show an Open button.',
              )}
            </small>
          </label>
        </div>
      </div>

      <fieldset className="source-picker">
        <legend>{t('Pinned source versions')}</legend>
        {readySources.length === 0 ? (
          <p>{t('Upload ready material in the Materials tab first.')}</p>
        ) : (
          readySources.map((source) => (
            <label key={source.id}>
              <input
                checked={selectedSources.includes(source.latestVersion!.id)}
                onChange={(event) =>
                  setSelectedSources((current) =>
                    event.target.checked
                      ? [...current, source.latestVersion!.id]
                      : current.filter((id) => id !== source.latestVersion!.id),
                  )
                }
                type="checkbox"
              />
              <span>
                <strong>{source.displayName}</strong>
                <small>{t(source.role)}</small>
              </span>
            </label>
          ))
        )}
      </fieldset>

      <div className="activity-studio__footer">
        <div aria-live="polite">
          {message && <span className="studio-message">✓ {message}</span>}
          {error && (
            <span className="form-error" role="alert">
              {error}
            </span>
          )}
        </div>
        <div className="knowledge-actions">
          <button
            disabled={busy || !canSave}
            onClick={() => void save().catch(() => undefined)}
            type="button"
          >
            {t('Save draft')}
          </button>
          <button
            className="primary-button"
            disabled={busy || !canSave}
            onClick={() =>
              void (async () => {
                try {
                  const id = await save();
                  const version = await window.tro.publishKnowledgeActivity({
                    spaceId,
                    activityId: id,
                    clientId: randomUUID(),
                  });
                  setMessage(t('Activity published. Ready to open a room.'));
                  onPublished(version.id, definition);
                } catch (cause) {
                  setError(
                    cause instanceof Error
                      ? cause.message
                      : t('Could not publish this Activity.'),
                  );
                }
              })()
            }
            type="button"
          >
            {t('Publish Activity')} →
          </button>
        </div>
      </div>
    </section>
  );
}
