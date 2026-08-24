import { useEffect, useState } from 'react';

import type {
  AppLanguage,
  KnowledgeGroup,
  KnowledgeSourceList,
  KnowledgeSpaceSummary,
  SaveKnowledgeActivityRequest,
} from '../shared/contracts';
import { randomUUID } from '../shared/renderer-uuid';

import { ActivityEditorPage } from './ActivityEditorPage';
import { translate } from './app-language';
import { FacilitatorRunPage } from './FacilitatorRunPage';
import { SpaceLibrary } from './SpaceLibrary';

type TeacherTab = 'activities' | 'library' | 'people';

export function SpaceDetailPage({
  appLanguage,
  onBack,
  space,
}: {
  appLanguage: AppLanguage;
  onBack: () => void;
  space: KnowledgeSpaceSummary;
}) {
  const canFacilitate = space.role === 'owner' || space.role === 'facilitator';
  const [tab, setTab] = useState<TeacherTab>('library');
  const [sources, setSources] = useState<KnowledgeSourceList['items']>([]);
  const [groups, setGroups] = useState<KnowledgeGroup[]>([]);
  const [groupName, setGroupName] = useState('');
  const [selectedGroupId, setSelectedGroupId] = useState('');
  const [inviteCode, setInviteCode] = useState<string | null>(null);
  const [activityVersionId, setActivityVersionId] = useState<string | null>(
    null,
  );
  const [publishedDefinition, setPublishedDefinition] = useState<
    SaveKnowledgeActivityRequest['definition'] | null
  >(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [participants, setParticipants] = useState('');
  const [delivery, setDelivery] = useState<'assigned' | 'room'>('room');
  const [mode, setMode] = useState<'live' | 'async' | 'hybrid'>('live');
  const [creatingRun, setCreatingRun] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const t = (message: string) => translate(appLanguage, message);

  const loadSources = () =>
    window.tro
      .listKnowledgeSources(space.id)
      .then((value) => setSources(value.items))
      .catch((cause: unknown) =>
        setError(
          cause instanceof Error ? cause.message : t('Library is unavailable.'),
        ),
      );
  const loadGroups = () =>
    window.tro
      .listKnowledgeGroups(space.id)
      .then((value) => setGroups(value.items))
      .catch((cause: unknown) =>
        setError(
          cause instanceof Error ? cause.message : t('Groups are unavailable.'),
        ),
      );

  useEffect(() => {
    if (!canFacilitate) return;
    void window.tro
      .listKnowledgeSources(space.id)
      .then((value) => setSources(value.items))
      .catch((cause: unknown) =>
        setError(
          cause instanceof Error
            ? cause.message
            : translate(appLanguage, 'Library is unavailable.'),
        ),
      );
    void window.tro
      .listKnowledgeGroups(space.id)
      .then((value) => setGroups(value.items))
      .catch((cause: unknown) =>
        setError(
          cause instanceof Error
            ? cause.message
            : translate(appLanguage, 'Groups are unavailable.'),
        ),
      );
  }, [appLanguage, canFacilitate, space.id]);

  const participantIds = participants
    .split(/\r?\n/u)
    .map((value) => value.trim())
    .filter(Boolean);
  const runTarget =
    delivery === 'room'
      ? { kind: 'room' as const }
      : selectedGroupId
        ? { kind: 'group' as const, groupId: selectedGroupId }
        : { kind: 'participants' as const, userIds: participantIds };

  const createRun = async () => {
    if (!activityVersionId) return;
    setCreatingRun(true);
    setError(null);
    try {
      const run = await window.tro.createKnowledgeRun({
        spaceId: space.id,
        clientId: randomUUID(),
        activityVersionId,
        mode: delivery === 'room' ? 'live' : mode,
        opensAt: null,
        closesAt: null,
        target: runTarget,
        insightPolicy: 'explicit_and_operational',
      });
      if (delivery === 'assigned') {
        await window.tro.setKnowledgeRunState({
          spaceId: space.id,
          runId: run.id,
          state: 'open',
        });
      }
      setRunId(run.id);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : t('Could not create this Run.'),
      );
    } finally {
      setCreatingRun(false);
    }
  };

  if (!canFacilitate) {
    return (
      <section className="knowledge-page participant-space-page">
        <button className="back-link" onClick={onBack} type="button">
          ← {t('Knowledge Spaces')}
        </button>
        <header className="knowledge-heading knowledge-heading--editorial">
          <div>
            <p className="eyebrow">{t('Student Space')}</p>
            <h1>{space.name}</h1>
            <p>
              {space.description ||
                t(
                  'Your published class context and private Attempts live here.',
                )}
            </p>
          </div>
          <span className="role-seal role-seal--student">
            <i aria-hidden="true">S</i>
            {t('Student access')}
          </span>
        </header>
        <section className="participant-boundary-card">
          <div className="participant-boundary-card__mark" aria-hidden="true">
            ✓
          </div>
          <div>
            <p className="eyebrow">{t('Role-aware by design')}</p>
            <h2>{t('Your classwork stays private')}</h2>
            <p>
              {t(
                'You receive only the Activity material assigned to you. Teacher uploads, publishing, room controls, and class-wide reporting are not available in the student view.',
              )}
            </p>
          </div>
          <dl>
            <div>
              <dt>{t('You can')}</dt>
              <dd>{t('Join · Work · Help · Check · Submit')}</dd>
            </div>
            <div>
              <dt>{t('Teachers can')}</dt>
              <dd>{t('Prepare · Broadcast · Review')}</dd>
            </div>
          </dl>
        </section>
        <div className="knowledge-empty knowledge-empty--inline">
          <span className="empty-illustration" aria-hidden="true">
            →
          </span>
          <div>
            <strong>{t('Open Assigned Activities')}</strong>
            <p>
              {t(
                'Your current and previous Attempts appear in Classwork in the sidebar.',
              )}
            </p>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="knowledge-page teacher-space-page">
      <button className="back-link" onClick={onBack} type="button">
        ← {t('Knowledge Spaces')}
      </button>
      <header className="knowledge-heading knowledge-heading--editorial knowledge-heading--space">
        <div>
          <p className="eyebrow">
            {t(
              space.role === 'owner'
                ? 'Teacher · Owner'
                : 'Teacher · Facilitator',
            )}
          </p>
          <h1>{space.name}</h1>
          <p>
            {space.description ||
              t(
                'Prepare material, publish a learning path, then invite the room.',
              )}
          </p>
        </div>
        <div
          className="teacher-flow-map"
          aria-label={t('Teacher flow: Materials, Activity, Live room')}
        >
          <span className={tab === 'library' ? 'is-current' : ''}>
            <b>1</b>
            {t('Materials')}
          </span>
          <i />
          <span className={tab === 'activities' ? 'is-current' : ''}>
            <b>2</b>
            {t('Activity')}
          </span>
          <i />
          <span className={runId ? 'is-current' : ''}>
            <b>3</b>
            {t('Live room')}
          </span>
        </div>
      </header>

      <div
        className="space-tabs"
        role="tablist"
        aria-label={t('Space sections')}
      >
        {(
          [
            ['library', 'Materials'],
            ['activities', 'Activities & rooms'],
            ['people', 'People'],
          ] as const
        ).map(([value, label]) => (
          <button
            aria-selected={tab === value}
            key={value}
            onClick={() => setTab(value)}
            role="tab"
            type="button"
          >
            {t(label)}
            {value === 'library' && <span>{sources.length}</span>}
          </button>
        ))}
      </div>

      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}

      {tab === 'library' && (
        <SpaceLibrary
          appLanguage={appLanguage}
          canManage
          onChanged={() => void loadSources()}
          sources={sources}
          spaceId={space.id}
        />
      )}

      {tab === 'activities' && (
        <>
          <ActivityEditorPage
            appLanguage={appLanguage}
            onPublished={(versionId, definition) => {
              setActivityVersionId(versionId);
              setPublishedDefinition(definition);
            }}
            sources={sources}
            spaceId={space.id}
          />
          {activityVersionId && !runId && (
            <section
              className="space-panel run-launchpad"
              aria-labelledby="run-launch-heading"
            >
              <div className="section-heading-row">
                <div>
                  <p className="eyebrow">{t('Published and ready')}</p>
                  <h2 id="run-launch-heading">
                    {t('How will students begin?')}
                  </h2>
                  <p className="section-deck">
                    {t(
                      'Open a live room for class, or assign this version for independent work.',
                    )}
                  </p>
                </div>
                <span className="published-seal">
                  ✓ {t('Immutable version')}
                </span>
              </div>
              <div
                className="delivery-choice"
                role="radiogroup"
                aria-label={t('Delivery method')}
              >
                <label className={delivery === 'room' ? 'is-selected' : ''}>
                  <input
                    checked={delivery === 'room'}
                    name="delivery"
                    onChange={() => setDelivery('room')}
                    type="radio"
                  />
                  <span className="delivery-choice__icon" aria-hidden="true">
                    ◎
                  </span>
                  <strong>{t('Live room')}</strong>
                  <small>
                    {t(
                      'Students join a lobby with one short code. You decide when class starts.',
                    )}
                  </small>
                  <em>{t('Recommended')}</em>
                </label>
                <label className={delivery === 'assigned' ? 'is-selected' : ''}>
                  <input
                    checked={delivery === 'assigned'}
                    name="delivery"
                    onChange={() => setDelivery('assigned')}
                    type="radio"
                  />
                  <span className="delivery-choice__icon" aria-hidden="true">
                    ↗
                  </span>
                  <strong>{t('Direct assignment')}</strong>
                  <small>
                    {t('Send to an existing group or a list of account IDs.')}
                  </small>
                </label>
              </div>

              {delivery === 'assigned' && (
                <div className="run-assignment-options">
                  {groups.length > 0 && (
                    <label>
                      {t('Assign a group')}
                      <select
                        onChange={(event) =>
                          setSelectedGroupId(event.target.value)
                        }
                        value={selectedGroupId}
                      >
                        <option value="">
                          {t('Use individual account IDs')}
                        </option>
                        {groups.map((group) => (
                          <option key={group.id} value={group.id}>
                            {group.name} ({group.participantCount})
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  {!selectedGroupId && (
                    <label>
                      {t('Participant account IDs')}
                      <textarea
                        onChange={(event) =>
                          setParticipants(event.target.value)
                        }
                        placeholder={t('One account ID per line')}
                        rows={4}
                        value={participants}
                      />
                    </label>
                  )}
                  <label>
                    {t('Mode')}
                    <select
                      onChange={(event) =>
                        setMode(event.target.value as typeof mode)
                      }
                      value={mode}
                    >
                      <option value="live">{t('live')}</option>
                      <option value="async">{t('async')}</option>
                      <option value="hybrid">{t('hybrid')}</option>
                    </select>
                  </label>
                </div>
              )}
              <button
                className="primary-button run-launchpad__action"
                disabled={
                  creatingRun ||
                  (delivery === 'assigned' &&
                    !selectedGroupId &&
                    participantIds.length === 0)
                }
                onClick={() => void createRun()}
                type="button"
              >
                {creatingRun
                  ? t('Creating…')
                  : delivery === 'room'
                    ? t('Create room lobby')
                    : t('Open assignment')}{' '}
                →
              </button>
            </section>
          )}
          {runId && (
            <FacilitatorRunPage
              allowedOrigins={
                publishedDefinition?.sessionPolicy.allowedOrigins ?? []
              }
              appLanguage={appLanguage}
              criteria={publishedDefinition?.criteria ?? []}
              runId={runId}
              spaceId={space.id}
            />
          )}
        </>
      )}

      {tab === 'people' && (
        <section className="space-panel people-studio">
          <div className="section-heading-row">
            <div>
              <p className="eyebrow">{t('Reusable cohorts')}</p>
              <h2>{t('People & groups')}</h2>
              <p className="section-deck">
                {t(
                  'Groups are for recurring assignments. Live rooms can admit students without a prebuilt list.',
                )}
              </p>
            </div>
          </div>
          <div className="knowledge-create">
            <label>
              {t('Group name')}
              <input
                onChange={(event) => setGroupName(event.target.value)}
                placeholder={t('Tuesday Python cohort')}
                value={groupName}
              />
            </label>
            <button
              disabled={!groupName.trim()}
              onClick={() =>
                void window.tro
                  .createKnowledgeGroup({
                    spaceId: space.id,
                    clientId: randomUUID(),
                    name: groupName.trim(),
                  })
                  .then(() => {
                    setGroupName('');
                    return loadGroups();
                  })
                  .catch((cause: unknown) =>
                    setError(
                      cause instanceof Error
                        ? cause.message
                        : t('Could not create that group.'),
                    ),
                  )
              }
              type="button"
            >
              {t('Create group')}
            </button>
          </div>
          <ul className="group-list">
            {groups.map((group) => (
              <li key={group.id}>
                <div>
                  <strong>{group.name}</strong>
                  <span>
                    {group.participantCount} {t('participants')}
                  </span>
                </div>
                <button
                  onClick={() =>
                    void window.tro
                      .createKnowledgeInvite({
                        spaceId: space.id,
                        clientId: randomUUID(),
                        groupId: group.id,
                        role: 'participant',
                        maxUses: 500,
                        expiresAt: new Date(
                          Date.now() + 7 * 24 * 60 * 60 * 1000,
                        ).toISOString(),
                      })
                      .then((invite) => setInviteCode(invite.code))
                      .catch((cause: unknown) =>
                        setError(
                          cause instanceof Error
                            ? cause.message
                            : t('Could not create a join code.'),
                        ),
                      )
                  }
                  type="button"
                >
                  {t('Create 7-day invite')}
                </button>
              </li>
            ))}
          </ul>
          {inviteCode && (
            <div className="invite-code">
              <span className="eyebrow">{t('Space invite')}</span>
              <code>{inviteCode}</code>
              <p>
                {t(
                  'Share this longer-lived code only with intended participants.',
                )}
              </p>
            </div>
          )}
        </section>
      )}
    </section>
  );
}
