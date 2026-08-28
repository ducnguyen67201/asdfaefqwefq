import { useCallback, useEffect, useState } from 'react';

import type {
  AutonomyMode,
  AppLanguage,
  AppUpdateStatus,
  CompanionCustomizationStatus,
  ConnectorList,
  GenerateCompanionImageRequest,
  MembershipStatus,
  OrganizationSummary,
  PrimaryLanguage,
} from '../shared/contracts';

import {
  APP_LANGUAGE_OPTIONS,
  appLanguageLabel,
  translate,
} from './app-language';
import {
  CompanionCustomizationCard,
  type CompanionCustomizationBusy,
} from './CompanionCustomizationCard';
import {
  PRIMARY_LANGUAGE_OPTIONS,
  primaryLanguageLabel,
} from './language-options';
import { planTitle } from './usage-presentation';

function ConnectedApplicationsCard({ appLanguage }: { appLanguage: AppLanguage }) {
  const t = useCallback((message: string) => translate(appLanguage, message), [appLanguage]);
  const [connectors, setConnectors] = useState<ConnectorList | null>(null);
  const [attemptId, setAttemptId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setConnectors(await window.tro.listConnectors());
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('Connected applications are unavailable.'));
    }
  }, [t]);

  useEffect(() => {
    let active = true;
    void window.tro.listConnectors().then(
      (next) => {
        if (!active) return;
        setConnectors(next);
        setError(null);
      },
      (cause: unknown) => {
        if (!active) return;
        setError(cause instanceof Error ? cause.message : t('Connected applications are unavailable.'));
      },
    );
    return () => {
      active = false;
    };
  }, [t]);
  useEffect(() => {
    if (!attemptId) return;
    let active = true;
    const poll = async () => {
      try {
        const attempt = await window.tro.getConnectorAttempt({ attemptId });
        if (!active) return;
        if (['connected', 'denied', 'failed', 'expired'].includes(attempt.status)) {
          setAttemptId(null);
          setBusy(false);
          if (attempt.status !== 'connected') setError(t('Gmail was not connected. Please try again.'));
          await refresh();
          return;
        }
        window.setTimeout(() => { void poll(); }, 2_000);
      } catch (cause) {
        if (!active) return;
        setBusy(false);
        setAttemptId(null);
        setError(cause instanceof Error ? cause.message : t('Could not check the Gmail connection.'));
      }
    };
    const timer = window.setTimeout(() => { void poll(); }, 1_000);
    return () => { active = false; window.clearTimeout(timer); };
  }, [attemptId, refresh, t]);

  const gmail = connectors?.catalog.find((item) => item.catalogKey === 'gmail');
  const connection = connectors?.connections.find((item) => item.catalogKey === 'gmail' && item.status !== 'disconnected');
  const connect = async () => {
    setBusy(true);
    setError(null);
    try {
      const attempt = await window.tro.connectConnector({ catalogKey: 'gmail' });
      setAttemptId(attempt.attemptId);
    } catch (cause) {
      setBusy(false);
      setError(cause instanceof Error ? cause.message : t('Could not start the Gmail connection.'));
    }
  };
  const disconnect = async () => {
    if (!connection) return;
    setBusy(true);
    setError(null);
    try {
      setConnectors(await window.tro.disconnectConnector({ connectionId: connection.id }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('Could not disconnect Gmail.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="settings-card" aria-labelledby="connected-applications-heading">
      <div className="settings-card__heading">
        <div>
          <p className="eyebrow">{t('Agent tools')}</p>
          <h2 id="connected-applications-heading">{t('Connected applications')}</h2>
        </div>
        <span className="settings-badge settings-badge--neutral">{t('Developer Preview')}</span>
      </div>
      <p className="settings-help">
        {gmail?.description ?? t('Connect Gmail so Tro can search and read mail, create drafts, and organize labels. Sending is not available.')}
      </p>
      <p className="settings-help">
        {connection?.status === 'connected'
          ? t('Gmail is connected to your account only.')
          : connection?.status === 'reauthorize'
            ? t('Reconnect Gmail to continue using it.')
            : busy
              ? t('Finish authorization in your browser…')
              : connectors?.enabled === false
                ? t('Connected applications are not enabled for this account yet.')
                : t('Gmail is not connected.')}
      </p>
      {error && <p className="settings-feedback settings-feedback--error" role="alert">{error}</p>}
      <div className="settings-actions">
        {connection?.status === 'connected' ? (
          <button className="secondary-button" disabled={busy} onClick={() => void disconnect()} type="button">
            {busy ? t('Disconnecting…') : t('Disconnect Gmail')}
          </button>
        ) : (
          <button className="primary-button" disabled={busy || connectors?.enabled === false} onClick={() => void connect()} type="button">
            {busy ? t('Connecting…') : connection ? t('Reconnect Gmail') : t('Connect Gmail')}
          </button>
        )}
      </div>
    </section>
  );
}

interface SettingsPageProps {
  autonomyMode: AutonomyMode;
  appLanguage: AppLanguage;
  appUpdateError: string | null;
  appUpdateStatus: AppUpdateStatus | null;
  classroomPetEnabled: boolean;
  companionBusy: CompanionCustomizationBusy;
  companionError: string | null;
  companionStatus: CompanionCustomizationStatus | null;
  error: string | null;
  hasChanges: boolean;
  isSaving: boolean;
  isActivatingMembership: boolean;
  isUpdatingApp: boolean;
  membershipError: string | null;
  membershipStatus: MembershipStatus | null;
  organization: OrganizationSummary | null;
  organizationError: string | null;
  isLoadingOrganization: boolean;
  muteSystemAudioWhileSpeaking: boolean;
  onAutonomyModeChange(mode: AutonomyMode): void;
  onAppLanguageChange(language: AppLanguage): void;
  onActivateCompanion(candidateId: string): Promise<void>;
  onActivateSavedCompanion(companionId: string): Promise<void>;
  onCheckForUpdates(): void;
  onClassroomPetEnabledChange(enabled: boolean): void;
  onGenerateCompanion(
    request: GenerateCompanionImageRequest,
  ): Promise<boolean>;
  onLanguageChange(language: PrimaryLanguage): void;
  onActivateMembership(code: string): void;
  onMuteSystemAudioWhileSpeakingChange(enabled: boolean): void;
  onOpenOrganization(): void;
  onRefreshOrganization(): void;
  onRestartAndInstall(): void;
  onSave(): void;
  onUseDefaultCompanion(): Promise<void>;
  primaryLanguage: PrimaryLanguage;
  saveMessage: string | null;
  systemAudioMuteSupported: boolean;
}

function appUpdateActionLabel(
  status: AppUpdateStatus | null,
  isUpdatingApp: boolean,
): string {
  if (isUpdatingApp) {
    return status?.phase === 'ready' ? 'Restarting…' : 'Checking…';
  }

  switch (status?.phase) {
    case 'ready':
      return 'Restart to update';
    case 'checking':
      return 'Checking…';
    case 'downloading':
      return 'Downloading update…';
    case 'installing':
      return 'Restarting…';
    case 'unsupported':
      return 'Updates unavailable';
    case 'up_to_date':
      return 'Check again';
    case 'error':
      return 'Try again';
    case undefined:
      return 'Loading…';
    default:
      return 'Check for updates';
  }
}

export function SettingsPage({
  autonomyMode,
  appLanguage,
  appUpdateError,
  appUpdateStatus,
  classroomPetEnabled,
  companionBusy,
  companionError,
  companionStatus,
  error,
  hasChanges,
  isSaving,
  isActivatingMembership,
  isUpdatingApp,
  membershipError,
  membershipStatus,
  organization,
  organizationError,
  isLoadingOrganization,
  muteSystemAudioWhileSpeaking,
  onAutonomyModeChange,
  onActivateCompanion,
  onActivateSavedCompanion,
  onAppLanguageChange,
  onCheckForUpdates,
  onClassroomPetEnabledChange,
  onGenerateCompanion,
  onLanguageChange,
  onActivateMembership,
  onMuteSystemAudioWhileSpeakingChange,
  onOpenOrganization,
  onRefreshOrganization,
  onRestartAndInstall,
  onSave,
  onUseDefaultCompanion,
  primaryLanguage,
  saveMessage,
  systemAudioMuteSupported,
}: SettingsPageProps) {
  const t = (message: string, replacements?: Record<string, string | number>) =>
    translate(appLanguage, message, replacements);
  const isUpdateReady = appUpdateStatus?.phase === 'ready';
  const updateActionDisabled =
    isUpdatingApp ||
    !appUpdateStatus ||
    [
      'unsupported',
      'checking',
      'downloading',
      'installing',
    ].includes(appUpdateStatus.phase);
  const updateActionLabel = t(
    appUpdateActionLabel(appUpdateStatus, isUpdatingApp),
  );
  const updateMessage =
    appUpdateError ??
    appUpdateStatus?.message ??
    t('Loading application update status…');
  const updateHasError =
    Boolean(appUpdateError) || appUpdateStatus?.phase === 'error';

  return (
    <section className="settings-page" aria-labelledby="settings-heading">
      <div className="settings-heading">
        <p className="eyebrow">{t('Preferences')}</p>
        <h1 id="settings-heading">{t('Settings')}</h1>
        <p>
          {t(
            'Manage Tro’s companion, interface language, voice input, and installed application.',
          )}
        </p>
      </div>

      {(error || saveMessage) && (
        <p
          className={`settings-feedback ${
            error ? 'settings-feedback--error' : ''
          }`}
          role={error ? 'alert' : 'status'}
        >
          {error ?? saveMessage}
        </p>
      )}

      <section
        className="settings-card settings-membership-card"
        aria-labelledby="membership-settings-heading"
      >
        <div className="settings-card__heading">
          <div>
            <p className="eyebrow">{t('Plan access')}</p>
            <h2 id="membership-settings-heading">{t('Promo code')}</h2>
          </div>
          <span className="settings-badge">
            {planTitle(membershipStatus?.plan ?? 'free')}
          </span>
        </div>

        <p className="settings-help">
          {membershipStatus?.plan === 'free'
            ? t(
                'You can keep using Tro Free. Enter a promo code here whenever you are ready to upgrade.',
              )
            : t('Your promo code is active on this account.')}
        </p>

        {membershipStatus?.plan === 'free' && (
          <form
            className="settings-promo-form"
            onSubmit={(event) => {
              event.preventDefault();
              const code = String(
                new FormData(event.currentTarget).get('promoCode') ?? '',
              ).trim();
              if (code.length >= 4) onActivateMembership(code);
            }}
          >
            <label className="settings-promo-field">
              <span>{t('Promo or access code')}</span>
              <input
                autoCapitalize="none"
                autoComplete="off"
                disabled={isActivatingMembership}
                minLength={4}
                name="promoCode"
                placeholder={t('Enter your promo code')}
                required
                spellCheck={false}
                type="text"
              />
            </label>
            <p
              className={`settings-feedback ${
                membershipError ? 'settings-feedback--error' : ''
              }`}
              role={membershipError ? 'alert' : 'status'}
            >
              {membershipError ?? membershipStatus.summary}
            </p>
            <div className="settings-actions">
              <button
                className="primary-button"
                disabled={isActivatingMembership}
                type="submit"
              >
                {isActivatingMembership
                  ? t('Checking…')
                  : t('Apply promo code')}
              </button>
            </div>
          </form>
        )}
      </section>

      <form
        className="settings-card desktop-pet-settings-card"
        onSubmit={(event) => {
          event.preventDefault();
          onSave();
        }}
      >
        <div className="settings-card__heading">
          <div>
            <p className="eyebrow">{t('Personalization')}</p>
            <h2>{t('Desktop pet')}</h2>
          </div>
          <span className="settings-badge settings-badge--neutral">
            {classroomPetEnabled ? t('Enabled') : t('Disabled')}
          </span>
        </div>

        <label className="settings-toggle" htmlFor="settings-classroom-pet-enabled">
          <input
            checked={classroomPetEnabled}
            id="settings-classroom-pet-enabled"
            onChange={(event) =>
              onClassroomPetEnabledChange(event.target.checked)
            }
            type="checkbox"
          />
          <span>
            <strong>{t('Show desktop pet')}</strong>
            <small>
              {t(
                'Show a small animated companion on your desktop. Drag it anywhere you like; it moves independently and can offer occasional local encouragement during live classes. It never watches apps, websites, cursor activity, or typing.',
              )}
            </small>
          </span>
        </label>

        <div className="settings-actions">
          <button
            className="primary-button"
            disabled={isSaving || !hasChanges}
            type="submit"
          >
            {isSaving
              ? t('Saving…')
              : hasChanges
                ? t('Save preferences')
                : t('Saved')}
          </button>
        </div>
      </form>

      <CompanionCustomizationCard
        appLanguage={appLanguage}
        busy={companionBusy}
        error={companionError}
        onActivate={onActivateCompanion}
        onActivateSaved={onActivateSavedCompanion}
        onGenerate={onGenerateCompanion}
        onUseDefault={onUseDefaultCompanion}
        status={companionStatus}
      />

      <ConnectedApplicationsCard appLanguage={appLanguage} />

      {(organization ||
        organizationError ||
        (isLoadingOrganization && membershipStatus?.plan !== 'free')) && (
        <section
          className="settings-card settings-organization-card"
          aria-labelledby="organization-settings-summary-heading"
        >
          <div className="settings-card__heading">
            <div>
              <p className="eyebrow">{t('Organization access')}</p>
              <h2 id="organization-settings-summary-heading">
                {organization?.name ?? t('Organization settings')}
              </h2>
            </div>
            {organization && (
              <span className="settings-badge settings-badge--neutral">
                {t(organization.role === 'organizer' ? 'Organizer' : 'Member')}
              </span>
            )}
          </div>

          {organization ? (
            <>
              <dl className="settings-organization-summary">
                <div>
                  <dt>{t('Plan')}</dt>
                  <dd>{planTitle(organization.plan)}</dd>
                </div>
                <div>
                  <dt>{t('Assigned seats')}</dt>
                  <dd>
                    {t('{assigned} of {maximum}', {
                      assigned: organization.capacity.assignedSeats,
                      maximum: organization.capacity.maxSeats,
                    })}
                  </dd>
                </div>
              </dl>
              <p className="settings-help">
                {organization.role === 'organizer'
                  ? t(
                      'Manage your organization name and reserve seats by email. Students sign in with that address and do not need your code.',
                    )
                  : t(
                      'Your Tro access is managed by this organization. You do not need to enter its access code.',
                    )}
              </p>
              {organizationError && (
                <p
                  className="settings-feedback settings-feedback--error"
                  role="alert"
                >
                  {organizationError}
                </p>
              )}
              <div className="settings-actions">
                <button
                  className="primary-button"
                  onClick={onOpenOrganization}
                  type="button"
                >
                  {t('Open organization settings')}
                </button>
              </div>
            </>
          ) : isLoadingOrganization ? (
            <p className="settings-help" aria-live="polite">
              {t('Loading organization…')}
            </p>
          ) : (
            <>
              <p
                className="settings-feedback settings-feedback--error"
                role="alert"
              >
                {organizationError}
              </p>
              <div className="settings-actions">
                <button
                  className="secondary-button"
                  onClick={onRefreshOrganization}
                  type="button"
                >
                  {t('Try again')}
                </button>
              </div>
            </>
          )}
        </section>
      )}

      <form
        className="settings-card"
        onSubmit={(event) => {
          event.preventDefault();
          onSave();
        }}
      >
        <div className="settings-card__heading">
          <div>
            <p className="eyebrow">{t('App interface')}</p>
            <h2>{t('App language')}</h2>
          </div>
          <span className="settings-badge settings-badge--neutral">
            {appLanguageLabel(appLanguage)}
          </span>
        </div>

        <label className="language-field" htmlFor="settings-app-language">
          <span>{t('Interface language')}</span>
          <select
            id="settings-app-language"
            onChange={(event) =>
              onAppLanguageChange(event.target.value as AppLanguage)
            }
            value={appLanguage}
          >
            {APP_LANGUAGE_OPTIONS.map((option) => (
              <option key={option.code} value={option.code}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <p className="settings-help">
          {t(
            'Choose the language used for navigation, settings, and other Tro controls.',
          )}
        </p>

        <div className="settings-section-divider" />

        <div className="settings-card__heading">
          <div>
            <p className="eyebrow">{t('Task safety')}</p>
            <h2>{t('Autonomy')}</h2>
          </div>
          <span className="settings-badge settings-badge--neutral">
            {autonomyMode === 'balanced' ? t('Balanced') : t('Strict')}
          </span>
        </div>

        <label className="language-field" htmlFor="settings-autonomy-mode">
          <span>{t('Approval style')}</span>
          <select
            id="settings-autonomy-mode"
            onChange={(event) =>
              onAutonomyModeChange(event.target.value as AutonomyMode)
            }
            value={autonomyMode}
          >
            <option value="balanced">{t('Balanced')}</option>
            <option value="strict">{t('Strict')}</option>
          </select>
        </label>

        <p className="settings-help">
          {autonomyMode === 'balanced'
            ? t(
                'Routine, reversible actions continue automatically. Tro still pauses for destructive, financial, privacy-sensitive, or permission-changing actions.',
              )
            : t(
                'Ask before routine desktop mutations as well as consequential actions.',
              )}
        </p>

        <div className="settings-section-divider" />

        <div className="settings-card__heading">
          <div>
            <p className="eyebrow">{t('Voice input')}</p>
            <h2>{t('Primary language')}</h2>
          </div>
          <span className="settings-badge">{t('OpenAI GPT Transcribe')}</span>
        </div>

        <label className="language-field" htmlFor="settings-primary-language">
          <span>{t('Spoken language')}</span>
          <select
            id="settings-primary-language"
            onChange={(event) =>
              onLanguageChange(event.target.value as PrimaryLanguage)
            }
            value={primaryLanguage}
          >
            {PRIMARY_LANGUAGE_OPTIONS.map((option) => (
              <option key={option.code} value={option.code}>
                {primaryLanguageLabel(option.code, appLanguage)}
              </option>
            ))}
          </select>
        </label>

        <p className="settings-help">
          {t(
            'Tro sends this as a transcription hint so short or noisy speech is less likely to be interpreted as an unexpected language or script.',
          )}
        </p>

        <div className="settings-voice-shortcuts" aria-label={t('Voice shortcuts')}>
          <p>
            <strong>{t('Dictation')}</strong>
            <span>{t('macOS: Command + Control · Windows: left Control + left Alt')}</span>
          </p>
          <p>
            <strong>{t('Task')}</strong>
            <span>{t('Add Shift to either Dictation shortcut')}</span>
          </p>
        </div>

        <p className="settings-help">
          {t(
            'Dictation adds text without sending. Task gives the spoken request to Tro after a one-second Escape window.',
          )}
        </p>

        <label className="settings-toggle">
          <input
            checked={muteSystemAudioWhileSpeaking}
            disabled={!systemAudioMuteSupported}
            onChange={(event) =>
              onMuteSystemAudioWhileSpeakingChange(event.target.checked)
            }
            type="checkbox"
          />
          <span>
            <strong>{t('Mute other audio while speaking')}</strong>
            <small>
              {systemAudioMuteSupported
                ? t(
                    'Mute system output while you hold the voice shortcut, then restore its previous mute state when you release.',
                  )
                : t('System audio muting is currently available on macOS.')}
            </small>
          </span>
        </label>

        <div className="settings-actions">
          <button
            className="primary-button"
            disabled={isSaving || !hasChanges}
            type="submit"
          >
            {isSaving
              ? t('Saving…')
              : hasChanges
                ? t('Save preferences')
                : t('Saved')}
          </button>
        </div>
      </form>

      <section className="settings-card settings-update-card" aria-labelledby="app-update-heading">
        <div className="settings-card__heading">
          <div>
            <p className="eyebrow">{t('About Tro')}</p>
            <h2 id="app-update-heading">{t('Application update')}</h2>
          </div>
          <span className="settings-badge settings-badge--neutral">
            {appUpdateStatus
              ? t('Version {version}', {
                  version: appUpdateStatus.currentVersion,
                })
              : t('Loading version…')}
          </span>
        </div>

        <p
          className={`settings-help settings-update-message ${
            updateHasError ? 'settings-feedback--error' : ''
          }`}
          role={updateHasError ? 'alert' : 'status'}
          aria-live="polite"
        >
          {updateMessage}
        </p>

        <div className="settings-actions">
          <button
            className="primary-button"
            disabled={updateActionDisabled}
            onClick={
              isUpdateReady ? onRestartAndInstall : onCheckForUpdates
            }
            type="button"
          >
            {updateActionLabel}
          </button>
        </div>
      </section>
    </section>
  );
}
