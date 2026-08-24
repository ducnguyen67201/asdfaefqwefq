import { useEffect, useState } from 'react';

import type { AppLanguage, KnowledgeSpaceSummary } from '../shared/contracts';
import { randomUUID } from '../shared/renderer-uuid';

import { translate } from './app-language';

export function SpacesPage({
  appLanguage,
  onJoined,
  onOpen,
}: {
  appLanguage: AppLanguage;
  onJoined: (attemptId: string) => void;
  onOpen: (space: KnowledgeSpaceSummary) => void;
}) {
  const [spaces, setSpaces] = useState<KnowledgeSpaceSummary[]>([]);
  const [name, setName] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [roomCode, setRoomCode] = useState('');
  const [autoOpenConsent, setAutoOpenConsent] = useState(false);
  const [joinBusy, setJoinBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const t = (message: string) => translate(appLanguage, message);

  const load = async () => {
    setLoading(true);
    try {
      setSpaces((await window.tro.listKnowledgeSpaces()).items);
      setError(null);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : t('Knowledge Spaces are unavailable.'),
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let active = true;
    void window.tro
      .listKnowledgeSpaces()
      .then((value) => {
        if (!active) return;
        setSpaces(value.items);
        setError(null);
      })
      .catch((cause: unknown) => {
        if (!active) return;
        setError(
          cause instanceof Error
            ? cause.message
            : translate(appLanguage, 'Knowledge Spaces are unavailable.'),
        );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [appLanguage]);

  const joinClass = async () => {
    const code = roomCode.trim().toUpperCase();
    if (!code) return;
    setJoinBusy(true);
    setError(null);
    try {
      const session = await window.tro.joinKnowledgeRoom({
        autoOpenConsent,
        clientId: randomUUID(),
        code,
      });
      setRoomCode('');
      onJoined(session.attemptId);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : t('Could not join this class room.'),
      );
    } finally {
      setJoinBusy(false);
    }
  };

  return (
    <section
      className="knowledge-page classroom-home"
      aria-labelledby="spaces-heading"
    >
      <header className="knowledge-heading knowledge-heading--editorial">
        <div>
          <p className="eyebrow">{t('Tro Classroom')}</p>
          <h1 id="spaces-heading">{t('One room. Everyone in context.')}</h1>
          <p>
            {t(
              'Teachers prepare the path. Students ask for help only when they need it. Tro keeps the published exercise in view.',
            )}
          </p>
        </div>
        <div className="classroom-orbit" aria-hidden="true">
          <span className="classroom-orbit__ring" />
          <span className="classroom-orbit__teacher">T</span>
          <i />
          <i />
          <i />
          <i />
        </div>
      </header>

      <div className="classroom-entry-grid">
        <form
          className="classroom-join-card"
          onSubmit={(event) => {
            event.preventDefault();
            void joinClass();
          }}
        >
          <div className="classroom-entry-label">
            <span>{t('For students')}</span>
            <small>{t('Takes less than a minute')}</small>
          </div>
          <h2>{t('Join your class')}</h2>
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
              disabled={joinBusy || roomCode.trim().length < 8}
              type="submit"
            >
              {joinBusy ? t('Joining…') : t('Join room')}
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

        <form
          className="teacher-space-card"
          onSubmit={(event) => {
            event.preventDefault();
            if (!name.trim()) return;
            void window.tro
              .createKnowledgeSpace({
                clientId: randomUUID(),
                name: name.trim(),
                description: '',
                purposeLabel: null,
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
                    : t('Could not create the Space.'),
                ),
              );
          }}
        >
          <div className="classroom-entry-label">
            <span>{t('For teachers')}</span>
            <small>{t('Prepare before class')}</small>
          </div>
          <h2>{t('Create a teaching Space')}</h2>
          <p>
            {t(
              'Add material, publish an Activity, then open a live room your students can join.',
            )}
          </p>
          <label htmlFor="space-name">{t('Space name')}</label>
          <input
            id="space-name"
            maxLength={240}
            onChange={(event) => setName(event.target.value)}
            placeholder={t('Python Foundations, Design Studio…')}
            value={name}
          />
          <button disabled={!name.trim()} type="submit">
            {t('Create teaching Space')} →
          </button>
        </form>
      </div>

      {error && (
        <div className="error-banner" role="alert">
          {error}
        </div>
      )}

      <section
        className="space-collection"
        aria-labelledby="your-spaces-heading"
      >
        <div className="section-heading-row">
          <div>
            <p className="eyebrow">{t('Your Spaces')}</p>
            <h2 id="your-spaces-heading">{t('Continue where you left off')}</h2>
          </div>
          <span>
            {spaces.length} {t('total')}
          </span>
        </div>
        {loading ? (
          <p>{t('Loading…')}</p>
        ) : spaces.length === 0 ? (
          <div className="knowledge-empty knowledge-empty--inline">
            <span className="empty-illustration" aria-hidden="true">
              ＋
            </span>
            <div>
              <strong>{t('No Spaces yet')}</strong>
              <p>{t('Create a teaching Space or join a class room above.')}</p>
            </div>
          </div>
        ) : (
          <ul className="space-grid">
            {spaces.map((space, index) => (
              <li key={space.id}>
                <button onClick={() => onOpen(space)} type="button">
                  <span className="space-card__index">
                    {String(index + 1).padStart(2, '0')}
                  </span>
                  <span className={`space-role space-role--${space.role}`}>
                    {t(space.role === 'participant' ? 'Student' : 'Teacher')}
                  </span>
                  <strong>{space.name}</strong>
                  <p>
                    {space.description ||
                      t(
                        space.role === 'participant'
                          ? 'Your classwork and published context'
                          : 'Materials, Activities, and live rooms',
                      )}
                  </p>
                  <span className="space-card__open">
                    {t('Open Space')} <i aria-hidden="true">→</i>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <details className="legacy-invite-panel">
        <summary>{t('Have a longer Space invite code?')}</summary>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (!inviteCode.trim()) return;
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
                    : t('Could not join that Space.'),
                ),
              );
          }}
        >
          <label htmlFor="space-invite-code">{t('Space invite code')}</label>
          <input
            id="space-invite-code"
            onChange={(event) => setInviteCode(event.target.value)}
            placeholder={t('Paste an expiring invite code')}
            value={inviteCode}
          />
          <button type="submit">{t('Join Space')}</button>
        </form>
      </details>
    </section>
  );
}
