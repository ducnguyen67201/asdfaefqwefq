import { useCallback, useEffect, useRef, useState } from 'react';

import type {
  AppLanguage,
  OrganizationMember,
  OrganizationSummary,
} from '../shared/contracts';

import { appLocale, translate } from './app-language';

const MEMBERS_PAGE_SIZE = 50;

function formatJoinedDate(value: string, appLanguage: AppLanguage): string {
  return new Intl.DateTimeFormat(appLocale(appLanguage), {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(new Date(value));
}

export function OrganizationPage({
  appLanguage,
  error,
  isLoading,
  onOrganizationChange,
  onRefresh,
  organization,
}: {
  appLanguage: AppLanguage;
  error: string | null;
  isLoading: boolean;
  onOrganizationChange: (organization: OrganizationSummary) => void;
  onRefresh: () => Promise<void>;
  organization: OrganizationSummary | null;
}) {
  const [email, setEmail] = useState('');
  const [members, setMembers] = useState<OrganizationMember[]>([]);
  const [memberCount, setMemberCount] = useState(0);
  const [membersError, setMembersError] = useState<string | null>(null);
  const [isLoadingMembers, setIsLoadingMembers] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [isAdding, setIsAdding] = useState(false);
  const [cancellingMemberId, setCancellingMemberId] = useState<string | null>(
    null,
  );
  const [notice, setNotice] = useState<string | null>(null);
  const membersRequestIdRef = useRef(0);
  const emailInputRef = useRef<HTMLInputElement | null>(null);
  const membersHeadingRef = useRef<HTMLHeadingElement | null>(null);
  const organizationId = organization?.id ?? null;
  const t = useCallback(
    (
      message: string,
      replacements?: Readonly<Record<string, string | number>>,
    ) => translate(appLanguage, message, replacements),
    [appLanguage],
  );

  const loadMembers = useCallback(
    async ({
      append = false,
      offset = 0,
    }: { append?: boolean; offset?: number } = {}) => {
      if (!organizationId) {
        membersRequestIdRef.current += 1;
        setMembers([]);
        setMemberCount(0);
        setMembersError(null);
        return;
      }

      const requestId = membersRequestIdRef.current + 1;
      membersRequestIdRef.current = requestId;
      if (append) setIsLoadingMore(true);
      else setIsLoadingMembers(true);
      setMembersError(null);

      try {
        const response = await window.tro.listOrganizationMembers({
          limit: MEMBERS_PAGE_SIZE,
          offset,
        });
        if (membersRequestIdRef.current !== requestId) return;
        setMembers((current) =>
          append
            ? [
                ...current,
                ...response.items.filter(
                  (member) =>
                    !current.some(
                      (currentMember) => currentMember.id === member.id,
                    ),
                ),
              ]
            : response.items,
        );
        setMemberCount(response.page.total);
        onOrganizationChange(response.organization);
      } catch (loadError) {
        if (membersRequestIdRef.current !== requestId) return;
        setMembersError(
          loadError instanceof Error
            ? loadError.message
            : t('Tro could not load organization members.'),
        );
      } finally {
        if (membersRequestIdRef.current === requestId) {
          setIsLoadingMembers(false);
          setIsLoadingMore(false);
        }
      }
    },
    [onOrganizationChange, organizationId, t],
  );

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setMembers([]);
      setMemberCount(0);
      setNotice(null);
      void loadMembers();
    });
    return () => {
      cancelled = true;
      membersRequestIdRef.current += 1;
    };
  }, [loadMembers]);

  const addMember = useCallback(async () => {
    if (!organization || organization.capacity.state === 'full') return;
    setIsAdding(true);
    setMembersError(null);
    setNotice(null);
    try {
      const response = await window.tro.addOrganizationMember({ email });
      onOrganizationChange(response.organization);
      setEmail('');
      setNotice(
        response.newlyCreated
          ? t('Seat reserved for {email}.', { email: response.member.email })
          : t('{email} already has a reserved seat.', {
              email: response.member.email,
            }),
      );
      await loadMembers();
      emailInputRef.current?.focus();
    } catch (addError) {
      setMembersError(
        addError instanceof Error
          ? addError.message
          : t('Tro could not reserve this seat.'),
      );
    } finally {
      setIsAdding(false);
    }
  }, [email, loadMembers, onOrganizationChange, organization, t]);

  const cancelPendingMember = useCallback(
    async (member: OrganizationMember) => {
      if (member.state !== 'pending') return;
      setCancellingMemberId(member.id);
      setMembersError(null);
      setNotice(null);
      try {
        const response = await window.tro.cancelOrganizationMember({
          memberId: member.id,
        });
        onOrganizationChange(response.organization);
        setNotice(t('The reserved seat for {email} was cancelled.', {
          email: member.email,
        }));
        await loadMembers();
        membersHeadingRef.current?.focus();
      } catch (cancelError) {
        setMembersError(
          cancelError instanceof Error
            ? cancelError.message
            : t('Tro could not cancel this reserved seat.'),
        );
      } finally {
        setCancellingMemberId(null);
      }
    },
    [loadMembers, onOrganizationChange, t],
  );

  if (isLoading && !organization) {
    return (
      <section className="organization-page organization-page--centered">
        <p aria-live="polite">{t('Loading organization…')}</p>
      </section>
    );
  }

  if (!organization) {
    return (
      <section className="organization-page">
        <div className="organization-empty">
          <p className="eyebrow">{t('Organization access')}</p>
          <h1>{t('No organization to manage')}</h1>
          <p>
            {error ??
              t('This account does not manage an organization access code.')}
          </p>
          <button
            className="secondary-button"
            onClick={() => void onRefresh()}
            type="button"
          >
            {t('Refresh')}
          </button>
        </div>
      </section>
    );
  }

  const capacityPercent = Math.min(
    100,
    Math.round(
      (organization.capacity.assignedSeats / organization.capacity.maxSeats) *
        100,
    ),
  );
  const capacityFull = organization.capacity.state === 'full';
  const canLoadMore = members.length < memberCount;

  return (
    <section className="organization-page">
      <header className="organization-heading">
        <div>
          <p className="eyebrow">{t('Organization access')}</p>
          <h1>{organization.name}</h1>
          <p>
            {t(
              'Reserve seats by email. Members join automatically when they sign in with that address.',
            )}
          </p>
        </div>
        <span className="organization-role-badge">{t('Organizer')}</span>
      </header>

      {error && (
        <div className="organization-alert organization-alert--error" role="alert">
          <strong>{t('Organization refresh failed')}</strong>
          <span>{error}</span>
        </div>
      )}
      {membersError && (
        <div className="organization-alert organization-alert--error" role="alert">
          <strong>{t('Something needs attention')}</strong>
          <span>{membersError}</span>
        </div>
      )}
      {capacityFull && (
        <div className="organization-alert organization-alert--full" role="alert">
          <strong>{t('All seats are assigned')}</strong>
          <span>
            {t(
              'Cancel a pending reservation before adding another person.',
            )}
          </span>
        </div>
      )}
      {notice && (
        <p className="organization-notice" role="status">
          {notice}
        </p>
      )}

      <section className="organization-capacity" aria-labelledby="capacity-heading">
        <div className="organization-capacity__copy">
          <div>
            <p className="eyebrow">{t('Access capacity')}</p>
            <h2 id="capacity-heading">
              {t('{assigned} of {maximum} seats assigned', {
                assigned: organization.capacity.assignedSeats,
                maximum: organization.capacity.maxSeats,
              })}
            </h2>
          </div>
          <strong>
            {t('{remaining} remaining', {
              remaining: organization.capacity.remainingSeats,
            })}
          </strong>
        </div>
        <div
          aria-label={t('{percent}% of seats assigned', {
            percent: capacityPercent,
          })}
          aria-valuemax={organization.capacity.maxSeats}
          aria-valuemin={0}
          aria-valuenow={organization.capacity.assignedSeats}
          className="organization-capacity__track"
          role="progressbar"
        >
          <span style={{ width: `${capacityPercent}%` }} />
        </div>
      </section>

      <form
        className="organization-add-member"
        onSubmit={(event) => {
          event.preventDefault();
          void addMember();
        }}
      >
        <label htmlFor="organization-member-email">
          <span>{t('Add a person by email')}</span>
          <input
            autoComplete="email"
            disabled={capacityFull || isAdding}
            id="organization-member-email"
            onChange={(event) => setEmail(event.target.value)}
            placeholder={t('teacher@example.com')}
            required
            type="email"
            ref={emailInputRef}
            value={email}
          />
        </label>
        <button
          className="primary-button"
          disabled={capacityFull || isAdding || email.trim().length === 0}
          type="submit"
        >
          {isAdding ? t('Reserving…') : t('Reserve seat')}
        </button>
      </form>

      <section className="organization-members" aria-labelledby="members-heading">
        <div className="organization-members__heading">
          <div>
            <p className="eyebrow">{t('People')}</p>
            <h2 id="members-heading" ref={membersHeadingRef} tabIndex={-1}>
              {t('{count} assigned seats', { count: memberCount })}
            </h2>
          </div>
          <button
            className="secondary-button"
            disabled={isLoadingMembers}
            onClick={() => void loadMembers()}
            type="button"
          >
            {isLoadingMembers ? t('Refreshing…') : t('Refresh')}
          </button>
        </div>

        {isLoadingMembers && members.length === 0 ? (
          <p className="organization-members__loading" aria-live="polite">
            {t('Loading members…')}
          </p>
        ) : members.length === 0 ? (
          <p className="organization-members__loading">
            {t('No seats have been assigned yet.')}
          </p>
        ) : (
          <ul className="organization-member-list">
            {members.map((member) => (
              <li key={member.id}>
                <span className="organization-member-avatar" aria-hidden="true">
                  {(member.name ?? member.email).slice(0, 1).toUpperCase()}
                </span>
                <div className="organization-member-copy">
                  <strong>{member.name ?? member.email}</strong>
                  {member.name && <span>{member.email}</span>}
                  <small>
                    {member.state === 'active'
                      ? t('Joined {date}', {
                          date: formatJoinedDate(
                            member.joinedAt ?? member.createdAt,
                            appLanguage,
                          ),
                        })
                      : t('Reserved {date}', {
                          date: formatJoinedDate(member.createdAt, appLanguage),
                        })}
                  </small>
                </div>
                <div className="organization-member-actions">
                  <span
                    className={`organization-member-state organization-member-state--${member.state}`}
                  >
                    {member.state === 'active' ? t('Active') : t('Pending')}
                  </span>
                  {member.state === 'pending' && (
                    <button
                      className="organization-cancel-button"
                      disabled={cancellingMemberId !== null}
                      onClick={() => void cancelPendingMember(member)}
                      type="button"
                    >
                      {cancellingMemberId === member.id
                        ? t('Cancelling…')
                        : t('Cancel reservation')}
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}

        {canLoadMore && (
          <button
            className="organization-load-more secondary-button"
            disabled={isLoadingMore}
            onClick={() =>
              void loadMembers({ append: true, offset: members.length })
            }
            type="button"
          >
            {isLoadingMore ? t('Loading…') : t('Load more')}
          </button>
        )}
      </section>
    </section>
  );
}
