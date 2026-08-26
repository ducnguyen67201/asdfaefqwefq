import { useState } from 'react';

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
  hasAssignedClassroomRole,
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
  classroomRole,
  error,
  loading,
  onJoined,
  onOpen,
  onRefresh,
  spaces,
}: {
  appLanguage: AppLanguage;
  classroomRole: ClassroomAccountRole;
  error: string | null;
  loading: boolean;
  onJoined: (attemptId: string) => void;
  onOpen: (space: KnowledgeSpaceSummary) => void;
  onRefresh: () => Promise<void>;
  spaces: KnowledgeSpaceSummary[];
}) {
  const [name, setName] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [roomCode, setRoomCode] = useState('');
  const [autoOpenConsent, setAutoOpenConsent] = useState(false);
  const [creating, setCreating] = useState(false);
  const [joining, setJoining] = useState(false);
  const [joiningRoom, setJoiningRoom] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const t = (message: string) => translate(appLanguage, message);

  if (!hasAssignedClassroomRole(classroomRole)) return null;

  const canCreate = canCreateClassWorkspace(classroomRole);
  const groupedSpaces = groupClassWorkspaces(spaces);
  const classGroups = [
    { items: groupedSpaces.teaching, label: 'Teaching', tone: 'teaching' },
    { items: groupedSpaces.learning, label: 'Learning', tone: 'learning' },
  ].filter((group) => group.items.length > 0);

  const joinRoom = async () => {
    const code = roomCode.trim().toUpperCase();
    if (!code) return;
    setJoiningRoom(true);
    setActionError(null);
    try {
      const session = await window.tro.joinKnowledgeRoom({
        autoOpenConsent,
        clientId: randomUUID(),
        code,
      });
      setRoomCode('');
      onJoined(session.attemptId);
    } catch (cause) {
      setActionError(
        cause instanceof Error
          ? cause.message
          : t('Could not join this class room.'),
      );
    } finally {
      setJoiningRoom(false);
    }
  };

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
          <span className="class-count">
            <strong>{spaces.length}</strong>
            {t(spaces.length === 1 ? 'class' : 'classes')}
          </span>
        </div>
      </header>

      {classroomRole === 'student' && (
        <form
          className="classroom-join-card class-room-entry"
          onSubmit={(event) => {
            event.preventDefault();
            void joinRoom();
          }}
        >
          <div className="classroom-entry-label">
            <span>{t('Live class')}</span>
            <small>{t('Takes less than a minute')}</small>
          </div>
          <h2>{t('Join your class room')}</h2>
          <p>
            {t(
              'Enter the room code from your teacher. Tro will wait with you until class starts.',
            )}
          </p>
          <label htmlFor="classroom-room-code">{t('Room code')}</label>
          <div className="classroom-code-entry">
            <input
              autoCapitalize="characters"
              autoComplete="off"
              id="classroom-room-code"
              maxLength={32}
              onChange={(event) =>
                setRoomCode(event.target.value.toUpperCase())
              }
              placeholder="TRO-84MK"
              spellCheck={false}
              value={roomCode}
            />
            <button
              className="primary-button"
              disabled={joiningRoom || roomCode.trim().length < 8}
              type="submit"
            >
              {t(joiningRoom ? 'Joining…' : 'Join room')}
            </button>
          </div>
          <label className="classroom-join-consent">
            <input
              checked={autoOpenConsent}
              onChange={(event) => setAutoOpenConsent(event.target.checked)}
              type="checkbox"
            />
            <span>
              <strong>{t('Open approved class links automatically')}</strong>
              <small>
                {t(
                  'Optional. Only published HTTPS sites for this Activity; change it anytime.',
                )}
              </small>
            </span>
          </label>
          <div className="classroom-privacy-note">
            <span aria-hidden="true">◌</span>
            <p>
              <strong>{t('What this session shares')}</strong>
              {t(
                ' Join, Help, Check, submission, and review events only. No continuous cursor, typing, or screen monitoring.',
              )}
            </p>
          </div>
        </form>
      )}

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
              setActionError(null);
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
                  return onRefresh();
                })
                .catch((cause: unknown) =>
                  setActionError(
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
            setActionError(null);
            void window.tro
              .redeemKnowledgeInvite({ code: inviteCode.trim() })
              .then(() => {
                setInviteCode('');
                return onRefresh();
              })
              .catch((cause: unknown) =>
                setActionError(
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

      {(actionError ?? error) && (
        <div className="error-banner" role="alert">
          {actionError ?? error}
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
