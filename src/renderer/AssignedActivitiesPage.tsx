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
  const [filter, setFilter] = useState<'active' | 'all' | 'finished'>('active');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const t = (
    message: string,
    values?: Readonly<Record<string, string | number>>,
  ) => translate(appLanguage, message, values);
  const formatter = useMemo(
    () =>
      new Intl.DateTimeFormat(appLanguage === 'vi' ? 'vi-VN' : 'en-US', {
        day: 'numeric',
        month: 'short',
      }),
    [appLanguage],
  );

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

  const visibleItems = items.filter((item) => {
    const finished = item.state === 'completed' || item.state === 'withdrawn';
    return filter === 'all' || (filter === 'finished' ? finished : !finished);
  });
  const activeCount = items.filter(
    (item) => item.state !== 'completed' && item.state !== 'withdrawn',
  ).length;

  return (
    <section
      className="knowledge-page classwork-page"
      aria-labelledby="classwork-heading"
    >
      <header className="knowledge-heading knowledge-heading--editorial">
        <div>
          <p className="eyebrow">{t('Your classwork')}</p>
          <h1 id="classwork-heading">
            {t('Every Attempt, in one calm place.')}
          </h1>
          <p>
            {t(
              'Open the published brief, continue your work, ask for Help, Check against criteria, or submit when you decide.',
            )}
          </p>
        </div>
        <div
          className="classwork-summary"
          aria-label={t('{count} active Activities', { count: activeCount })}
        >
          <strong>{activeCount}</strong>
          <span>{t('active')}</span>
        </div>
      </header>

      <div className="classwork-toolbar">
        <div
          className="classwork-filter"
          role="tablist"
          aria-label={t('Filter classwork')}
        >
          {(['active', 'all', 'finished'] as const).map((value) => (
            <button
              aria-selected={filter === value}
              key={value}
              onClick={() => setFilter(value)}
              role="tab"
              type="button"
            >
              {t(
                value === 'active'
                  ? 'In progress'
                  : value === 'all'
                    ? 'All work'
                    : 'Finished',
              )}
            </button>
          ))}
        </div>
        <p>
          <span aria-hidden="true">◌</span>
          {t('Your work is private to you and your teachers.')}
        </p>
      </div>

      {error && (
        <div className="error-banner" role="alert">
          {error}
        </div>
      )}
      {loading ? (
        <p>{t('Loading…')}</p>
      ) : visibleItems.length === 0 ? (
        <div className="knowledge-empty classwork-empty">
          <span className="empty-illustration" aria-hidden="true">
            ◎
          </span>
          <div>
            <strong>
              {t(
                filter === 'active'
                  ? 'Nothing active right now'
                  : 'No classwork here yet',
              )}
            </strong>
            <p>
              {t(
                'Join a room from Knowledge Spaces or wait for your teacher to assign an Activity.',
              )}
            </p>
          </div>
        </div>
      ) : (
        <ul className="assignment-list">
          {visibleItems.map((item, index) => {
            const isLive =
              item.run.mode === 'live' &&
              item.state !== 'completed' &&
              item.state !== 'withdrawn';
            return (
              <li key={item.attemptId}>
                <button onClick={() => onOpen(item.attemptId)} type="button">
                  <div className="assignment-card__top">
                    <span className="space-role">{item.space.name}</span>
                    {isLive && (
                      <span className="assignment-live">
                        <i aria-hidden="true" />
                        {t('Live class')}
                      </span>
                    )}
                  </div>
                  <span className="assignment-card__index">
                    {String(index + 1).padStart(2, '0')}
                  </span>
                  <strong>{item.activity.title}</strong>
                  <p>{item.activity.objective}</p>
                  <div className="assignment-card__footer">
                    <span
                      className={`participant-status participant-status--${item.state}`}
                    >
                      <i aria-hidden="true" />
                      {t(item.state)}
                    </span>
                    <span>
                      {t('Updated {date}', {
                        date: formatter.format(new Date(item.updatedAt)),
                      })}{' '}
                      <i aria-hidden="true">→</i>
                    </span>
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
