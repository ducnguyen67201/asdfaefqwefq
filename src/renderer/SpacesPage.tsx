import { useCallback, useEffect, useState } from 'react';

import type {
  AppLanguage,
  ClassroomAccountRole,
  KnowledgeSpaceSummary,
} from '../shared/contracts';
import { randomUUID } from '../shared/renderer-uuid';

import { translate } from './app-language';
import {
  canCreateClassWorkspace,
  groupClassWorkspaces,
} from './class-workspace';

function classInitials(name: string) {
  return name
    .split(/\s+/u)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');
}

export function SpacesPage({
  appLanguage,
  onOpen,
}: {
  appLanguage: AppLanguage;
  onOpen: (space: KnowledgeSpaceSummary) => void;
}) {
  const [classroomRole, setClassroomRole] =
    useState<ClassroomAccountRole>('unassigned');
  const [spaces, setSpaces] = useState<KnowledgeSpaceSummary[]>([]);
  const [name, setName] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [creating, setCreating] = useState(false);
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const t = (message: string) => translate(appLanguage, message);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await window.tro.listKnowledgeSpaces();
      setClassroomRole(result.classroomRole);
      setSpaces(result.items);
      setError(null);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : translate(appLanguage, 'Class workspaces are unavailable.'),
      );
    } finally {
      setLoading(false);
    }
  }, [appLanguage]);

  useEffect(() => {
    let active = true;
    void window.tro
      .listKnowledgeSpaces()
      .then((result) => {
        if (!active) return;
        setClassroomRole(result.classroomRole);
        setSpaces(result.items);
        setError(null);
      })
      .catch((cause: unknown) => {
        if (!active) return;
        setError(
          cause instanceof Error
            ? cause.message
            : translate(appLanguage, 'Class workspaces are unavailable.'),
        );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [appLanguage]);

  const canCreate = canCreateClassWorkspace(classroomRole);
  const groupedSpaces = groupClassWorkspaces(spaces);
  const classGroups = [
    { items: groupedSpaces.teaching, label: 'Teaching', tone: 'teaching' },
    { items: groupedSpaces.learning, label: 'Learning', tone: 'learning' },
  ].filter((group) => group.items.length > 0);

  return (
    <section
      className="knowledge-page knowledge-page--classes"
      aria-labelledby="spaces-heading"
    >
      <header className="knowledge-heading class-landing-hero">
        <div className="class-landing-hero__copy">
          <p className="eyebrow">{t('Classes')}</p>
          <h1 id="spaces-heading">{t('Class workspaces')}</h1>
          <p>
            {t(
              'Keep each class easy to find, switch between, and manage from one place.',
            )}
          </p>
        </div>
        <div className="class-landing-hero__identity">
          <span className="classroom-role-badge">
            <i aria-hidden="true" />
            {t(
              classroomRole === 'teacher'
                ? 'Teacher'
                : classroomRole === 'student'
                  ? 'Student'
                  : 'Role pending',
            )}
          </span>
          {classroomRole !== 'unassigned' && (
            <span className="class-count">
              <strong>{spaces.length}</strong>
              {t(spaces.length === 1 ? 'class' : 'classes')}
            </span>
          )}
        </div>
      </header>

      {classroomRole === 'unassigned' && (
        <div className="role-pending-card" role="status">
          <span className="role-pending-card__mark" aria-hidden="true">
            01
          </span>
          <div>
            <p className="eyebrow">{t('Account ready')}</p>
            <strong>
              {t('Your classroom role has not been assigned yet.')}
            </strong>
            <p>
              {t(
                'An administrator assigns Teacher or Student after your account is created.',
              )}
            </p>
          </div>
          <div className="role-pending-card__path" aria-hidden="true">
            <span>{t('Account')}</span>
            <i />
            <span>{t('Role')}</span>
            <i />
            <span>{t('Class')}</span>
          </div>
        </div>
      )}

      {classroomRole !== 'unassigned' && (
        <div
          className={`class-entry-grid${canCreate ? '' : ' class-entry-grid--single'}`}
        >
          {canCreate && (
            <form
              className="knowledge-create class-entry-card class-entry-card--create"
              onSubmit={(event) => {
                event.preventDefault();
                if (!name.trim()) return;
                setCreating(true);
                void window.tro
                  .createKnowledgeSpace({
                    clientId: randomUUID(),
                    name: name.trim(),
                    description: '',
                    purposeLabel: 'Class',
                  })
                  .then((result) => {
                    setName('');
                    onOpen(result.space);
                    return load();
                  })
                  .catch((cause: unknown) =>
                    setError(
                      cause instanceof Error
                        ? cause.message
                        : t('Could not create the class workspace.'),
                    ),
                  )
                  .finally(() => setCreating(false));
              }}
            >
              <div className="class-entry-card__heading">
                <span aria-hidden="true">＋</span>
                <div>
                  <strong>{t('Create a class')}</strong>
                  <p>{t('Start a dedicated home for a new group.')}</p>
                </div>
              </div>
              <label htmlFor="space-name">{t('New class workspace')}</label>
              <input
                id="space-name"
                maxLength={240}
                onChange={(event) => setName(event.target.value)}
                placeholder={t('Python Foundations, Class 8A, Design Lab…')}
                value={name}
              />
              <button
                className="primary-button"
                disabled={creating || !name.trim()}
                type="submit"
              >
                {t(creating ? 'Creating…' : 'Create class')}
              </button>
            </form>
          )}
          <form
            className="knowledge-create class-entry-card class-entry-card--join"
            onSubmit={(event) => {
              event.preventDefault();
              if (!inviteCode.trim()) return;
              setJoining(true);
              void window.tro
                .redeemKnowledgeInvite({ code: inviteCode.trim() })
                .then(() => {
                  setInviteCode('');
                  return load();
                })
                .catch((cause: unknown) =>
                  setError(
                    cause instanceof Error
                      ? cause.message
                      : t('Could not join that class.'),
                  ),
                )
                .finally(() => setJoining(false));
            }}
          >
            <div className="class-entry-card__heading">
              <span aria-hidden="true">↳</span>
              <div>
                <strong>{t('Join a class')}</strong>
                <p>{t('Use a code shared for your assigned role.')}</p>
              </div>
            </div>
            <label htmlFor="space-invite-code">{t('Join code')}</label>
            <input
              id="space-invite-code"
              onChange={(event) => setInviteCode(event.target.value)}
              placeholder={t(
                'Paste a join code that matches your assigned role',
              )}
              value={inviteCode}
            />
            <button disabled={joining || !inviteCode.trim()} type="submit">
              {t(joining ? 'Joining…' : 'Join class')}
            </button>
          </form>
        </div>
      )}

      {error && (
        <div className="error-banner" role="alert">
          {error}
        </div>
      )}
      {loading ? (
        <p>{t('Loading…')}</p>
      ) : spaces.length === 0 ? (
        <div className="knowledge-empty">
          <strong>{t('No class workspaces yet')}</strong>
          <p>
            {t(
              canCreate
                ? 'Create a class, then add registered Teachers and Students.'
                : 'A Teacher can add your registered account to a class.',
            )}
          </p>
        </div>
      ) : (
        <div className="class-shelves">
          {classGroups.map((group) => (
            <section className="class-shelf" key={group.label}>
              <header className="class-shelf__heading">
                <div>
                  <span
                    className={`class-shelf__line class-shelf__line--${group.tone}`}
                  />
                  <h2>{t(group.label)}</h2>
                </div>
                <span>{group.items.length}</span>
              </header>
              <ul className="space-grid">
                {group.items.map((space, index) => (
                  <li key={space.id}>
                    <button
                      className={`class-card class-card--${group.tone}`}
                      onClick={() => onOpen(space)}
                      type="button"
                    >
                      <span className="class-card__folio" aria-hidden="true">
                        {String(index + 1).padStart(2, '0')}
                      </span>
                      <span className="class-card__mark" aria-hidden="true">
                        {classInitials(space.name) || 'C'}
                      </span>
                      <span className="space-role">
                        {t(
                          space.role === 'participant'
                            ? 'Student'
                            : space.role === 'owner'
                              ? 'Class owner'
                              : 'Teacher',
                        )}
                      </span>
                      <strong>{space.name}</strong>
                      <p>
                        {space.description ||
                          t('Class resources and activities')}
                      </p>
                      <span className="class-card__open">
                        {t('Open class')} <i aria-hidden="true">→</i>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </section>
  );
}
