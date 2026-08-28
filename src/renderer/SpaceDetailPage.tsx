import { useCallback, useEffect, useState } from 'react';

import type {
  AddKnowledgeSpaceMembersResult,
  AppLanguage,
  KnowledgeGroup,
  KnowledgeSourceList,
  KnowledgeSpaceMember,
  KnowledgeSpaceSummary,
} from '../shared/contracts';
import { randomUUID } from '../shared/renderer-uuid';

import { ActivityEditorPage } from './ActivityEditorPage';
import { translate } from './app-language';
import {
  canManageClassPeople,
  parseClassMemberEmails,
  rolesAvailableToMemberManager,
} from './class-workspace';
import { ClassSessionsPanel } from './ClassSessionsPanel';
import { SpaceLibrary } from './SpaceLibrary';

export type SpaceDetailTab = 'library' | 'activities' | 'sessions' | 'people';

export function SpaceDetailPage({
  appLanguage,
  initialTab = 'library',
  onJoined,
  onBack,
  space,
}: {
  appLanguage: AppLanguage;
  initialTab?: SpaceDetailTab;
  onJoined?: (attemptId: string) => void;
  onBack: () => void;
  space: KnowledgeSpaceSummary;
}) {
  const canFacilitate = canManageClassPeople(space.role);
  const [tab, setTab] = useState<SpaceDetailTab>(
    !canFacilitate && (initialTab === 'people' || initialTab === 'activities')
      ? 'sessions'
      : initialTab,
  );
  const [sources, setSources] = useState<KnowledgeSourceList['items']>([]);
  const [sourcesLoading, setSourcesLoading] = useState(
    () => typeof window !== 'undefined',
  );
  const [groups, setGroups] = useState<KnowledgeGroup[]>([]);
  const [members, setMembers] = useState<KnowledgeSpaceMember[]>([]);
  const [memberEmails, setMemberEmails] = useState('');
  const [memberRole, setMemberRole] = useState<'facilitator' | 'participant'>(
    'participant',
  );
  const [memberResult, setMemberResult] =
    useState<AddKnowledgeSpaceMembersResult | null>(null);
  const [addingMembers, setAddingMembers] = useState(false);
  const [rosterQuery, setRosterQuery] = useState('');
  const [rosterRole, setRosterRole] = useState<'all' | 'teacher' | 'student'>(
    'all',
  );
  const [groupName, setGroupName] = useState('');
  const [sessionRefreshToken, setSessionRefreshToken] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const t = useCallback(
    (
      message: string,
      replacements: Readonly<Record<string, string | number>> = {},
    ) => translate(appLanguage, message, replacements),
    [appLanguage],
  );
  const availableMemberRoles = rolesAvailableToMemberManager(space.role);
  const studentCount = members.filter(
    (member) => member.role === 'participant',
  ).length;
  const teacherCount = members.length - studentCount;
  const normalizedRosterQuery = rosterQuery.trim().toLocaleLowerCase();
  const visibleMembers = members.filter((member) => {
    const roleMatches =
      rosterRole === 'all' ||
      (rosterRole === 'student' && member.role === 'participant') ||
      (rosterRole === 'teacher' && member.role !== 'participant');
    const queryMatches =
      !normalizedRosterQuery ||
      member.name.toLocaleLowerCase().includes(normalizedRosterQuery) ||
      member.email.toLocaleLowerCase().includes(normalizedRosterQuery) ||
      member.userId.toLocaleLowerCase().includes(normalizedRosterQuery);
    return roleMatches && queryMatches;
  });

  const loadSources = useCallback(
    () =>
      window.tro
        .listKnowledgeSources(space.id)
        .then((value) => setSources(value.items))
        .catch((cause: unknown) =>
          setError(
            cause instanceof Error
              ? cause.message
              : t('Materials are unavailable.'),
          ),
        )
        .finally(() => setSourcesLoading(false)),
    [space.id, t],
  );
  const loadGroups = useCallback(
    () =>
      window.tro
        .listKnowledgeGroups(space.id)
        .then((value) => setGroups(value.items))
        .catch((cause: unknown) =>
          setError(
            cause instanceof Error
              ? cause.message
              : t('Groups are unavailable.'),
          ),
        ),
    [space.id, t],
  );
  const loadMembers = useCallback(
    () =>
      window.tro
        .listKnowledgeMembers(space.id)
        .then((value) => setMembers(value.items))
        .catch((cause: unknown) =>
          setError(
            cause instanceof Error
              ? cause.message
              : t('People are unavailable.'),
          ),
        ),
    [space.id, t],
  );

  useEffect(() => {
    void loadSources();
    if (canFacilitate) {
      void loadGroups();
      void loadMembers();
    }
  }, [canFacilitate, loadGroups, loadMembers, loadSources]);

  const parsedMemberEmails = parseClassMemberEmails(memberEmails);

  const addMembers = async () => {
    if (
      parsedMemberEmails.invalid.length ||
      parsedMemberEmails.emails.length === 0 ||
      parsedMemberEmails.emails.length > 500
    ) {
      return;
    }
    setAddingMembers(true);
    setError(null);
    try {
      const result = await window.tro.addKnowledgeSpaceMembers({
        clientId: randomUUID(),
        emails: parsedMemberEmails.emails,
        role: memberRole,
        spaceId: space.id,
      });
      setMemberResult(result);
      if (result.addedEmails.length) setMemberEmails('');
      await loadMembers();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : t('Could not add those people.'),
      );
    } finally {
      setAddingMembers(false);
    }
  };

  const tabs: SpaceDetailTab[] = canFacilitate
    ? ['library', 'activities', 'sessions', 'people']
    : ['library', 'sessions'];

  return (
    <section className="knowledge-page knowledge-page--class-detail">
      <div className="space-detail-toolbar">
        <button className="back-link" onClick={onBack} type="button">
          <span aria-hidden="true">←</span> {t('Classes')}
        </button>
      </div>
      <header className="class-workspace-identity">
        <span className="class-workspace-identity__mark" aria-hidden="true">
          {space.name.slice(0, 1).toUpperCase()}
        </span>
        <div className="class-workspace-identity__copy">
          <p className="eyebrow">{t('Class workspace')}</p>
          <h1>{space.name}</h1>
          <p>
            {canFacilitate
              ? space.description ||
                t('Materials, activities, and people for this class.')
              : t('Materials and activities shared with this class.')}
          </p>
        </div>
        <span className="class-workspace-identity__role">
          <i aria-hidden="true" />
          {t(canFacilitate ? 'Teaching' : 'Learning')}
        </span>
      </header>
      <div
        aria-label={t('Class workspace sections')}
        className="space-tabs"
        role="tablist"
      >
        {tabs.map((value, index) => (
          <button
            aria-controls={`space-panel-${space.id}-${value}`}
            aria-selected={tab === value}
            id={`space-tab-${space.id}-${value}`}
            key={value}
            onClick={() => setTab(value)}
            onKeyDown={(event) => {
              let nextIndex = index;
              if (event.key === 'ArrowRight')
                nextIndex = (index + 1) % tabs.length;
              else if (event.key === 'ArrowLeft') {
                nextIndex = (index - 1 + tabs.length) % tabs.length;
              } else if (event.key === 'Home') nextIndex = 0;
              else if (event.key === 'End') nextIndex = tabs.length - 1;
              else return;
              event.preventDefault();
              const nextTab = tabs[nextIndex];
              if (!nextTab) return;
              setTab(nextTab);
              const buttons =
                event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>(
                  '[role="tab"]',
                );
              buttons?.[nextIndex]?.focus();
            }}
            role="tab"
            tabIndex={tab === value ? 0 : -1}
            type="button"
          >
            {t(
              value === 'library'
                ? 'Materials'
                : value === 'activities'
                  ? 'Activities'
                  : value === 'sessions'
                    ? 'Sessions'
                    : 'People',
            )}
          </button>
        ))}
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}

      {tab === 'library' && (
        <div
          aria-labelledby={`space-tab-${space.id}-library`}
          id={`space-panel-${space.id}-library`}
          role="tabpanel"
          tabIndex={0}
        >
          <SpaceLibrary
            appLanguage={appLanguage}
            loading={sourcesLoading}
            onChanged={() => {
              setSourcesLoading(true);
              void loadSources();
            }}
            readOnly={!canFacilitate}
            sources={sources}
            spaceId={space.id}
          />
        </div>
      )}

      {tab === 'activities' &&
        (canFacilitate ? (
          <div
            aria-labelledby={`space-tab-${space.id}-activities`}
            id={`space-panel-${space.id}-activities`}
            role="tabpanel"
            tabIndex={0}
          >
            <ActivityEditorPage
              appLanguage={appLanguage}
              onPublished={() => {
                setSessionRefreshToken((current) => current + 1);
                setTab('sessions');
              }}
              sources={sources}
              spaceId={space.id}
            />
          </div>
        ) : null)}

      {tab === 'sessions' && (
        <div
          aria-labelledby={`space-tab-${space.id}-sessions`}
          id={`space-panel-${space.id}-sessions`}
          role="tabpanel"
          tabIndex={0}
        >
          <ClassSessionsPanel
            appLanguage={appLanguage}
            canFacilitate={canFacilitate}
            onJoined={onJoined}
            refreshToken={sessionRefreshToken}
            spaceId={space.id}
          />
        </div>
      )}

      {tab === 'people' && canFacilitate && (
        <section
          aria-labelledby={`space-tab-${space.id}-people`}
          className="space-panel people-panel"
          id={`space-panel-${space.id}-people`}
          role="tabpanel"
          tabIndex={0}
        >
          <div className="section-heading-row people-panel__heading">
            <div>
              <p className="eyebrow">{t('Class community')}</p>
              <h2>{t('People')}</h2>
              <p>
                {t(
                  'Add people after their account exists and an administrator assigns their Teacher or Student role.',
                )}
              </p>
            </div>
            <span className="people-panel__total">
              <strong>{members.length}</strong>
              {t('on the roster')}
            </span>
          </div>

          <div className="people-console">
            <aside
              className="people-composition"
              aria-label={t('Roster composition')}
            >
              <p className="eyebrow">{t('At a glance')}</p>
              <div className="people-composition__total">
                <strong>{members.length}</strong>
                <span>{t('people')}</span>
              </div>
              <dl>
                <div>
                  <dt>
                    <i
                      className="role-dot role-dot--teacher"
                      aria-hidden="true"
                    />
                    {t('Teachers')}
                  </dt>
                  <dd>{teacherCount}</dd>
                </div>
                <div>
                  <dt>
                    <i
                      className="role-dot role-dot--student"
                      aria-hidden="true"
                    />
                    {t('Students')}
                  </dt>
                  <dd>{studentCount}</dd>
                </div>
              </dl>
              <p>{t('Roles are verified before anyone is added.')}</p>
            </aside>

            <div className="member-composer">
              <div className="member-composer__heading">
                <div>
                  <p className="eyebrow">{t('Add registered accounts')}</p>
                  <h3>{t('Build the roster')}</h3>
                </div>
                <span>
                  {parsedMemberEmails.emails.length}
                  <small>/ 500</small>
                </span>
              </div>
              <div className="class-member-add">
                <label>
                  {t('Registered account emails')}
                  <textarea
                    onChange={(event) => setMemberEmails(event.target.value)}
                    placeholder={t('One email per line, comma, or space')}
                    rows={6}
                    value={memberEmails}
                  />
                  <small>
                    {t(
                      'Add up to 500 people per batch. You can repeat as needed.',
                    )}
                  </small>
                </label>
                <div className="member-composer__actions">
                  <label>
                    {t('Add as')}
                    <select
                      onChange={(event) =>
                        setMemberRole(
                          event.target.value as 'facilitator' | 'participant',
                        )
                      }
                      value={memberRole}
                    >
                      {availableMemberRoles.map((role) => (
                        <option key={role} value={role}>
                          {t(role === 'facilitator' ? 'Teacher' : 'Student')}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    className="primary-button"
                    disabled={
                      addingMembers ||
                      parsedMemberEmails.emails.length === 0 ||
                      parsedMemberEmails.emails.length > 500 ||
                      parsedMemberEmails.invalid.length > 0
                    }
                    onClick={() => void addMembers()}
                    type="button"
                  >
                    {t(addingMembers ? 'Adding…' : 'Add to class')}
                    {!addingMembers && <span aria-hidden="true">→</span>}
                  </button>
                </div>
              </div>
            </div>
          </div>
          {parsedMemberEmails.invalid.length > 0 && (
            <p className="form-error" role="alert">
              {t('Check these email entries')}:{' '}
              {parsedMemberEmails.invalid.join(', ')}
            </p>
          )}
          {parsedMemberEmails.emails.length > 500 && (
            <p className="form-error" role="alert">
              {t('Use 500 or fewer emails in each batch.')}
            </p>
          )}
          {memberResult && (
            <div className="member-add-result" role="status">
              <div className="member-add-result__heading">
                <span aria-hidden="true">✓</span>
                <div>
                  <strong>{t('Roster update complete')}</strong>
                  <p>
                    {t('Every account was checked against its classroom role.')}
                  </p>
                </div>
              </div>
              <dl className="member-add-result__stats">
                <div className="member-add-result__stat member-add-result__stat--added">
                  <dt>{t('Added')}</dt>
                  <dd>{memberResult.addedEmails.length}</dd>
                </div>
                <div>
                  <dt>{t('Already here')}</dt>
                  <dd>{memberResult.alreadyMemberEmails.length}</dd>
                </div>
                <div>
                  <dt>{t('Role mismatch')}</dt>
                  <dd>{memberResult.roleMismatchEmails.length}</dd>
                </div>
                <div>
                  <dt>{t('Unavailable')}</dt>
                  <dd>{memberResult.unavailableEmails.length}</dd>
                </div>
              </dl>
              {(memberResult.roleMismatchEmails.length > 0 ||
                memberResult.unavailableEmails.length > 0) && (
                <details>
                  <summary>{t('Review accounts that need attention')}</summary>
                  {memberResult.roleMismatchEmails.length > 0 && (
                    <p>
                      <strong>{t('Wrong Admin-assigned role')}</strong>
                      {memberResult.roleMismatchEmails.join(', ')}
                    </p>
                  )}
                  {memberResult.unavailableEmails.length > 0 && (
                    <p>
                      <strong>{t('Account not found or unavailable')}</strong>
                      {memberResult.unavailableEmails.join(', ')}
                    </p>
                  )}
                </details>
              )}
            </div>
          )}

          <div className="roster-heading">
            <div>
              <p className="eyebrow">{t('Everyone in this class')}</p>
              <h3>{t('Class roster')}</h3>
            </div>
            <span>{members.length}</span>
          </div>
          <div className="roster-toolbar">
            <label className="roster-search">
              <span>{t('Find a person')}</span>
              <input
                onChange={(event) => setRosterQuery(event.target.value)}
                placeholder={t('Search name, email, or account ID')}
                type="search"
                value={rosterQuery}
              />
            </label>
            <label>
              <span>{t('Show role')}</span>
              <select
                onChange={(event) =>
                  setRosterRole(event.target.value as typeof rosterRole)
                }
                value={rosterRole}
              >
                <option value="all">{t('Everyone')}</option>
                <option value="teacher">{t('Teachers')}</option>
                <option value="student">{t('Students')}</option>
              </select>
            </label>
            <span className="roster-toolbar__result" aria-live="polite">
              <strong>{visibleMembers.length}</strong>
              {t('shown')}
            </span>
          </div>
          <div
            className="class-roster-wrap"
            role="region"
            aria-label={t('Class roster')}
            tabIndex={0}
          >
            <table className="knowledge-table">
              <thead>
                <tr>
                  <th>{t('Person')}</th>
                  <th>{t('Role')}</th>
                  <th>{t('Account ID')}</th>
                </tr>
              </thead>
              <tbody>
                {visibleMembers.map((member) => (
                  <tr key={member.userId}>
                    <td>
                      <strong>{member.name}</strong>
                      <small>{member.email}</small>
                    </td>
                    <td>
                      <span
                        className={`roster-role roster-role--${member.role}`}
                      >
                        <i aria-hidden="true" />
                        {t(
                          member.role === 'participant'
                            ? 'Student'
                            : member.role === 'owner'
                              ? 'Class owner'
                              : 'Teacher',
                        )}
                      </span>
                    </td>
                    <td>
                      <code>{member.userId}</code>
                    </td>
                  </tr>
                ))}
                {visibleMembers.length === 0 && (
                  <tr>
                    <td className="roster-empty-row" colSpan={3}>
                      <strong>{t('No people match this view')}</strong>
                      <span>{t('Try another name or role.')}</span>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="groups-studio">
            <div className="groups-studio__heading">
              <div>
                <p className="eyebrow">{t('Smaller circles')}</p>
                <h3>{t('Groups')}</h3>
                <p>{t('Organize rostered students for focused activities.')}</p>
              </div>
              <span>{groups.length}</span>
            </div>
            <div className="knowledge-create group-create">
              <label htmlFor="new-group-name">
                {t('Group name')}
                <input
                  id="new-group-name"
                  onChange={(event) => setGroupName(event.target.value)}
                  placeholder={t('e.g. Studio A')}
                  value={groupName}
                />
              </label>
              <button
                disabled={!groupName.trim()}
                onClick={() =>
                  void window.tro
                    .createKnowledgeGroup({
                      clientId: randomUUID(),
                      name: groupName.trim(),
                      spaceId: space.id,
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
                  <span className="group-list__mark" aria-hidden="true">
                    {group.name.slice(0, 1).toUpperCase()}
                  </span>
                  <div>
                    <strong>{group.name}</strong>
                    <span>
                      {group.participantCount} {t('participants')}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}
    </section>
  );
}
