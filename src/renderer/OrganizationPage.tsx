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
  onOpenClasses,
  onOrganizationChange,
  onRefresh,
  organization,
}: {
  appLanguage: AppLanguage;
  error: string | null;
  isLoading: boolean;
  onOpenClasses?: () => void;
  onOrganizationChange: (organization: OrganizationSummary) => void;
  onRefresh: () => Promise<OrganizationSummary | null | void>;
  organization: OrganizationSummary | null;
}) {
  const [email, setEmail] = useState('');
  const [organizationNameDraft, setOrganizationNameDraft] = useState(
    organization?.name ?? '',
  );
  const [members, setMembers] = useState<OrganizationMember[]>([]);
  const [memberCount, setMemberCount] = useState(0);
  const [membersError, setMembersError] = useState<string | null>(null);
  const [isLoadingMembers, setIsLoadingMembers] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [isAdding, setIsAdding] = useState(false);
  const [isSavingName, setIsSavingName] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [cancellingMemberId, setCancellingMemberId] = useState<string | null>(
    null,
  );
  const [notice, setNotice] = useState<string | null>(null);
  const membersRequestIdRef = useRef(0);
  const profileRequestIdRef = useRef(0);
  const emailInputRef = useRef<HTMLInputElement | null>(null);
  const membersHeadingRef = useRef<HTMLHeadingElement | null>(null);
  const nameInputRef = useRef<HTMLInputElement | null>(null);
  const organizationId = organization?.id ?? null;
  const isOrganizer = organization?.role === 'organizer';
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
      if (!organizationId || !isOrganizer) {
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
    [isOrganizer, onOrganizationChange, organizationId, t],
  );

  useEffect(() => {
    profileRequestIdRef.current += 1;
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setOrganizationNameDraft(organization?.name ?? '');
      setProfileError(null);
      setIsSavingName(false);
    });
    return () => {
      cancelled = true;
      profileRequestIdRef.current += 1;
    };
  }, [organization?.id, organization?.name, organization?.role]);

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

  const saveOrganizationName = useCallback(async () => {
    if (!organization || !isOrganizer) return;
    const name = organizationNameDraft.trim();
    if (name.length < 1 || name.length > 100) {
      setProfileError(t('Organization name must be between 1 and 100 characters.'));
      return;
    }
    if (name === organization.name) {
      setNotice(t('Organization name is already up to date.'));
      nameInputRef.current?.focus();
      return;
    }

    const requestId = profileRequestIdRef.current + 1;
    profileRequestIdRef.current = requestId;
    const expectedOrganizationId = organization.id;
    setIsSavingName(true);
    setProfileError(null);
    setNotice(null);
    try {
      const response = await window.tro.updateOrganization({ name });
      if (
        profileRequestIdRef.current !== requestId ||
        response.organization.id !== expectedOrganizationId
      ) {
        return;
      }
      onOrganizationChange(response.organization);
      setOrganizationNameDraft(response.organization.name);
      setNotice(t('Organization name saved.'));
      nameInputRef.current?.focus();
    } catch (updateError) {
      if (profileRequestIdRef.current !== requestId) return;
      setProfileError(
        updateError instanceof Error
          ? updateError.message
          : t('Tro could not save the organization name.'),
      );
    } finally {
      if (profileRequestIdRef.current === requestId) {
        setIsSavingName(false);
      }
    }
  }, [isOrganizer, onOrganizationChange, organization, organizationNameDraft, t]);

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
          <p className="eyebrow">{t('Organization settings')}</p>
          <h1>{organization.name}</h1>
          <p>
            {isOrganizer
              ? t('Manage your organization profile and access seats.')
              : t('View the organization that manages your Tro access.')}
          </p>
        </div>
        <span
          className={`organization-role-badge organization-role-badge--${organization.role}`}
        >
          {t(isOrganizer ? 'Organizer' : 'Member')}
        </span>
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
      {profileError && (
        <div className="organization-alert organization-alert--error" role="alert">
          <strong>{t('Organization name was not saved')}</strong>
          <span>{profileError}</span>
        </div>
      )}
      {isOrganizer && capacityFull && (
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

      {isOrganizer ? (
        <form
          className="organization-profile"
          onSubmit={(event) => {
            event.preventDefault();
            void saveOrganizationName();
          }}
        >
          <div>
            <p className="eyebrow">{t('Organization profile')}</p>
            <label htmlFor="organization-name">{t('Organization name')}</label>
          </div>
          <div className="organization-profile__controls">
            <input
              autoComplete="organization"
              disabled={isSavingName}
              id="organization-name"
              maxLength={100}
              minLength={1}
              onChange={(event) => {
                setOrganizationNameDraft(event.target.value);
                setProfileError(null);
                setNotice(null);
              }}
              ref={nameInputRef}
              required
              type="text"
              value={organizationNameDraft}
            />
            <span className="organization-profile__count">
              {t('{count} of 100 characters', {
                count: organizationNameDraft.length,
              })}
            </span>
          </div>
          <button
            className="primary-button"
            disabled={
              isSavingName ||
              organizationNameDraft.trim().length < 1 ||
              organizationNameDraft.trim().length > 100
            }
            type="submit"
          >
            {isSavingName ? t('Saving name…') : t('Save name')}
          </button>
        </form>
      ) : (
        <section
          className="organization-managed-access"
          aria-labelledby="managed-access-heading"
        >
          <p className="eyebrow">{t('Managed access')}</p>
          <h2 id="managed-access-heading">
            {t('Your access is managed by this organization')}
          </h2>
          <p>
            {t(
              'You joined automatically with your verified Google email. You do not need to enter the organization code.',
            )}
          </p>
        </section>
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

      {isOrganizer && (
        <form
          className="organization-add-member"
          onSubmit={(event) => {
            event.preventDefault();
            void addMember();
          }}
        >
          <div className="organization-add-member__heading">
            <p className="eyebrow">{t('Access seats')}</p>
            <h2>{t('Invite a student or staff member')}</h2>
            <p>
              {t(
                'Reserve the exact Google account email. Tro does not send an invitation email, and the person does not need your organization code. They join automatically when they sign in.',
              )}
            </p>
          </div>
          <label htmlFor="organization-member-email">
            <span>{t('Google account email')}</span>
            <input
              autoComplete="email"
              disabled={capacityFull || isAdding}
              id="organization-member-email"
              onChange={(event) => setEmail(event.target.value)}
              placeholder={t('student@example.com')}
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
      )}

      {isOrganizer && (
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
      )}

      {isOrganizer && (
        <section
          className="organization-class-next-step"
          aria-labelledby="organization-class-next-step-heading"
        >
          <div>
            <p className="eyebrow">{t('Next step: class enrollment')}</p>
            <h2 id="organization-class-next-step-heading">
              {t('Add active students to a class separately')}
            </h2>
            <p>
              {t(
                'An organization seat provides Tro access, but it does not enroll someone in a class.',
              )}
            </p>
            <p>
              {t(
                'After the account exists and has the Student role, open Class workspaces, choose the class, then use People to add them.',
              )}
            </p>
          </div>
          {onOpenClasses && (
            <button
              className="secondary-button"
              onClick={onOpenClasses}
              type="button"
            >
              {t('Open Class workspaces')}
            </button>
          )}
        </section>
      )}
    </section>
  );
}
