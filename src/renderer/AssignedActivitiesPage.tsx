import { useEffect, useMemo, useState } from 'react';

import type { AppLanguage, AssignedActivityList } from '../shared/contracts';

import { translate } from './app-language';

export function AssignedActivitiesPage({
  appLanguage,
  onOpen,
}: {
  appLanguage: AppLanguage;
  onOpen: (attemptId: string) => void;
}) {
  const [items, setItems] = useState<AssignedActivityList['items']>([]);
  const [spaceId, setSpaceId] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const t = (
    message: string,
    replacements: Readonly<Record<string, string | number>> = {},
  ) => translate(appLanguage, message, replacements);
  const spaces = useMemo(
    () => [
      ...new Map(items.map((item) => [item.space.id, item.space])).values(),
    ],
    [items],
  );
  const visibleItems = useMemo(
    () => (spaceId ? items.filter((item) => item.space.id === spaceId) : items),
    [items, spaceId],
  );
  const classGroups = useMemo(() => {
    const groups = new Map<
      string,
      { items: AssignedActivityList['items']; name: string }
    >();
    for (const item of visibleItems) {
      const group = groups.get(item.space.id) ?? {
        items: [],
        name: item.space.name,
      };
      group.items.push(item);
      groups.set(item.space.id, group);
    }
    return [...groups.entries()].map(([id, group]) => ({ id, ...group }));
  }, [visibleItems]);

  useEffect(() => {
    void window.tro
      .listAssignedActivities()
      .then((result) => {
        setItems(result.items);
        setError(null);
      })
      .catch((cause: unknown) =>
        setError(
          cause instanceof Error
            ? cause.message
            : translate(appLanguage, 'Assignments are unavailable.'),
        ),
      )
      .finally(() => setLoading(false));
  }, [appLanguage]);

  return (
    <section className="knowledge-page knowledge-page--assigned">
      <header className="knowledge-heading assigned-hero">
        <div className="assigned-hero__copy">
          <p className="eyebrow">{t('Your work')}</p>
          <h1>{t('Assigned Activities')}</h1>
          <p>
            {t(
              'Start in class, continue later, and keep each Attempt private across Work Sessions.',
            )}
          </p>
        </div>
        {spaces.length > 1 && (
          <label className="assigned-class-filter">
            <span>{t('Showing work from')}</span>
            <select
              aria-label={t('Class workspace')}
              onChange={(event) => setSpaceId(event.target.value)}
              value={spaceId}
            >
              <option value="">{t('All classes')}</option>
              {spaces.map((space) => (
                <option key={space.id} value={space.id}>
                  {space.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </header>
      {error && (
        <div className="error-banner" role="alert">
          {error}
        </div>
      )}
      {loading ? (
        <div className="assignment-loading" role="status">
          <i aria-hidden="true" />
          <p>{t('Loading…')}</p>
        </div>
      ) : visibleItems.length === 0 ? (
        <div className="knowledge-empty assignment-empty">
          <span className="assignment-empty__mark" aria-hidden="true">
            ✓
          </span>
          <div>
            <p className="eyebrow">{t('All clear')}</p>
            <strong>{t('Nothing assigned')}</strong>
            <p>
              {t('When a Teacher opens a Run for you, it will appear here.')}
            </p>
          </div>
        </div>
      ) : (
        <div className="assignment-folios">
          {classGroups.map((group) => (
            <section className="assignment-class-folio" key={group.id}>
              <header className="assignment-class-folio__heading">
                <span
                  className="assignment-class-folio__mark"
                  aria-hidden="true"
                >
                  {group.name
                    .split(/\s+/u)
                    .filter(Boolean)
                    .slice(0, 2)
                    .map((part) => part[0]?.toUpperCase())
                    .join('') || 'C'}
                </span>
                <div>
                  <p className="eyebrow">{t('Class folio')}</p>
                  <h2>{group.name}</h2>
                </div>
                <span>
                  {t(
                    group.items.length === 1
                      ? '{count} activity'
                      : '{count} activities',
                    { count: group.items.length },
                  )}
                </span>
              </header>
              <ul className="assignment-list">
                {group.items.map((item, index) => (
                  <li key={item.attemptId}>
                    <button
                      className="assignment-card"
                      onClick={() => onOpen(item.attemptId)}
                      type="button"
                    >
                      <span
                        className="assignment-card__index"
                        aria-hidden="true"
                      >
                        {String(index + 1).padStart(2, '0')}
                      </span>
                      <div className="assignment-card__context">
                        <span className="assignment-card__mode">
                          {t(item.run.mode)}
                        </span>
                        <span
                          className={`assignment-state assignment-state--${item.state}`}
                        >
                          <i aria-hidden="true" />
                          {t(item.state)}
                        </span>
                      </div>
                      <div className="assignment-card__copy">
                        <strong>{item.activity.title}</strong>
                        <p>{item.activity.objective}</p>
                      </div>
                      <span className="assignment-card__open">
                        <span>{t('Open activity')}</span>
                        <i aria-hidden="true">→</i>
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
