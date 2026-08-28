import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import type {
  AppLanguage,
  AppUpdateStatus,
  CompanionCustomizationStatus,
  OrganizationSummary,
} from '../shared/contracts';

import { SettingsPage } from './SettingsPage';

const COMPANION_STATUS: CompanionCustomizationStatus = {
  appearance: { kind: 'default' },
  candidate: null,
  quota: {
    limit: 5,
    periodEndsAt: '2026-09-01T00:00:00.000Z',
    periodStartsAt: '2026-08-01T00:00:00.000Z',
    remaining: 5,
    used: 0,
  },
  savedCompanions: [],
  state: 'available',
  summary: 'Companion generation is available.',
};

const ORGANIZATION: OrganizationSummary = {
  capacity: {
    assignedSeats: 4,
    maxSeats: 25,
    remainingSeats: 21,
    state: 'available',
  },
  homeBanner: null,
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Greenfield School',
  plan: 'pro',
  role: 'organizer',
};

function renderSettings(
  appUpdateStatus: AppUpdateStatus,
  options: {
    appLanguage?: AppLanguage;
    classroomPetEnabled?: boolean;
    isLoadingOrganization?: boolean;
    organization?: OrganizationSummary | null;
    organizationError?: string | null;
  } = {},
): string {
  return renderToStaticMarkup(
    SettingsPage({
      appLanguage: options.appLanguage ?? 'en',
      autonomyMode: 'balanced',
      appUpdateError: null,
      appUpdateStatus,
      classroomPetEnabled: options.classroomPetEnabled ?? true,
      companionBusy: null,
      companionError: null,
      companionStatus: COMPANION_STATUS,
      error: null,
      hasChanges: false,
      isActivatingMembership: false,
      isSaving: false,
      isUpdatingApp: false,
      membershipError: null,
      membershipStatus: {
        expiresAt: null,
        plan: 'free',
        referenceCode: null,
        required: true,
        state: 'active',
        summary: 'Free plan active.',
      },
      organization:
        'organization' in options ? (options.organization ?? null) : null,
      organizationError: options.organizationError ?? null,
      isLoadingOrganization: options.isLoadingOrganization ?? false,
      muteSystemAudioWhileSpeaking: false,
      onActivateMembership: vi.fn(),
      onActivateCompanion: vi.fn(),
      onActivateSavedCompanion: vi.fn(),
      onAppLanguageChange: vi.fn(),
      onAutonomyModeChange: vi.fn(),
      onCheckForUpdates: vi.fn(),
      onClassroomPetEnabledChange: vi.fn(),
      onGenerateCompanion: vi.fn(),
      onLanguageChange: vi.fn(),
      onMuteSystemAudioWhileSpeakingChange: vi.fn(),
      onOpenOrganization: vi.fn(),
      onRefreshOrganization: vi.fn(),
      onRestartAndInstall: vi.fn(),
      onSave: vi.fn(),
      onUseDefaultCompanion: vi.fn(),
      primaryLanguage: 'en',
      saveMessage: null,
      systemAudioMuteSupported: true,
    }),
  );
}

describe('SettingsPage application updates', () => {
  it('offers a manual update check with the installed version', () => {
    const markup = renderSettings({
      currentVersion: '0.1.0',
      message: 'Check whether a newer version of Tro is available.',
      phase: 'idle',
      targetVersion: null,
    });

    expect(markup).toContain('Application update');
    expect(markup).toContain('Version 0.1.0');
    expect(markup).toContain('Check for updates');
    expect(markup).toContain('App language');
    expect(markup).toContain('Spoken language');
  });

  it('offers restart only after an update is ready', () => {
    const markup = renderSettings({
      currentVersion: '0.1.0',
      message: 'Version v0.2.0 is ready to install.',
      phase: 'ready',
      targetVersion: 'v0.2.0',
    });

    expect(markup).toContain('Restart to update');
    expect(markup).toContain('v0.2.0');
  });

  it('disables the action on unsupported platforms', () => {
    const markup = renderSettings({
      currentVersion: '0.1.0',
      message: 'Use your Linux package manager to update Tro.',
      phase: 'unsupported',
      targetVersion: null,
    });

    expect(markup).toContain('Updates unavailable');
    expect(markup).toContain('disabled');
  });

  it('offers a concise retry after an update error', () => {
    const markup = renderSettings({
      currentVersion: '0.1.1',
      message: 'Tro could not reach the update service.',
      phase: 'error',
      targetVersion: null,
    });

    expect(markup).toContain('Try again');
    expect(markup).not.toContain('System.Net.WebException');
  });
});

describe('SettingsPage app language', () => {
  it('renders translated controls when Vietnamese is selected', () => {
    const markup = renderToStaticMarkup(
      SettingsPage({
        appLanguage: 'vi',
        autonomyMode: 'strict',
        appUpdateError: null,
        appUpdateStatus: {
          currentVersion: '0.1.0',
          message: 'No updates found.',
          phase: 'up_to_date',
          targetVersion: null,
        },
        classroomPetEnabled: true,
        companionBusy: null,
        companionError: null,
        companionStatus: COMPANION_STATUS,
        error: null,
        hasChanges: true,
        isActivatingMembership: false,
        isSaving: false,
        isUpdatingApp: false,
        membershipError: null,
        membershipStatus: {
          expiresAt: null,
          plan: 'free',
          referenceCode: null,
          required: true,
          state: 'active',
          summary: 'Free plan active.',
        },
        organization: null,
        organizationError: null,
        isLoadingOrganization: false,
        muteSystemAudioWhileSpeaking: true,
        onActivateMembership: vi.fn(),
        onActivateCompanion: vi.fn(),
        onActivateSavedCompanion: vi.fn(),
        onAppLanguageChange: vi.fn(),
        onAutonomyModeChange: vi.fn(),
        onCheckForUpdates: vi.fn(),
        onClassroomPetEnabledChange: vi.fn(),
        onGenerateCompanion: vi.fn(),
        onLanguageChange: vi.fn(),
        onMuteSystemAudioWhileSpeakingChange: vi.fn(),
        onOpenOrganization: vi.fn(),
        onRefreshOrganization: vi.fn(),
        onRestartAndInstall: vi.fn(),
        onSave: vi.fn(),
        onUseDefaultCompanion: vi.fn(),
        primaryLanguage: 'vi',
        saveMessage: null,
        systemAudioMuteSupported: true,
      }),
    );

    expect(markup).toContain('Cài đặt');
    expect(markup).toContain('Ngôn ngữ ứng dụng');
    expect(markup).toContain('Ngôn ngữ nói');
    expect(markup).toContain('Lưu tùy chọn');
    expect(markup).toContain('Tắt âm thanh khác khi đang nói');
    expect(markup).toContain('Bạn đồng hành tùy chỉnh');
    expect(markup).toContain('Thú cưng trên màn hình');
    expect(markup).toContain('không theo dõi ứng dụng');
    expect(markup).toContain('Còn 5 trên 5 trong tháng này');
    expect(markup).not.toContain('Custom companion');
  });
});

describe('SettingsPage voice audio preference', () => {
  it('offers an opt-in macOS system audio mute control', () => {
    const markup = renderSettings({
      currentVersion: '0.1.0',
      message: 'No updates found.',
      phase: 'up_to_date',
      targetVersion: null,
    });

    expect(markup).toContain('Mute other audio while speaking');
    expect(markup).toContain('restore its previous mute state');
    expect(markup).toContain('type="checkbox"');
    expect(markup).toContain('Dictation');
    expect(markup).toContain('Command + Control');
    expect(markup).toContain('left Control + left Alt');
    expect(markup).toContain('Add Shift');
    expect(markup).toContain('without sending');
  });
});

describe('SettingsPage desktop pet preference', () => {
  const updateStatus: AppUpdateStatus = {
    currentVersion: '0.1.0',
    message: 'No updates found.',
    phase: 'up_to_date',
    targetVersion: null,
  };

  it('shows the independent-motion and local-only privacy explanation', () => {
    const markup = renderSettings(updateStatus);

    expect(markup).toContain('Desktop pet');
    expect(markup).toContain(
      'Show a small animated companion on your desktop',
    );
    expect(markup).toContain('Drag it anywhere you like');
    expect(markup).toContain(
      'It never watches apps, websites, cursor activity, or typing.',
    );
    expect(markup).toMatch(
      /id="settings-classroom-pet-enabled"[^>]*checked=""/u,
    );
  });

  it('renders the controlled disabled state without checking the toggle', () => {
    const markup = renderSettings(updateStatus, {
      classroomPetEnabled: false,
    });

    expect(markup).toMatch(/id="settings-classroom-pet-enabled"/u);
    expect(markup).not.toMatch(
      /id="settings-classroom-pet-enabled"[^>]*checked=""/u,
    );
  });
});

describe('SettingsPage autonomy preference', () => {
  it('explains balanced autonomy without hiding strict mode', () => {
    const markup = renderSettings({
      currentVersion: '0.1.0',
      message: 'No updates found.',
      phase: 'up_to_date',
      targetVersion: null,
    });

    expect(markup).toContain('Autonomy');
    expect(markup).toContain('Routine, reversible actions continue automatically');
    expect(markup).toContain('value="strict"');
  });
});

describe('SettingsPage promo codes', () => {
  it('lets a Free user enter a promo code later', () => {
    const markup = renderSettings({
      currentVersion: '0.1.0',
      message: 'No updates found.',
      phase: 'up_to_date',
      targetVersion: null,
    });

    expect(markup).toContain('Promo code');
    expect(markup).toContain('Tro Free');
    expect(markup).toContain('name="promoCode"');
    expect(markup).toContain('Apply promo code');
  });
});

describe('SettingsPage organization summary', () => {
  const updateStatus: AppUpdateStatus = {
    currentVersion: '0.1.0',
    message: 'No updates found.',
    phase: 'up_to_date',
    targetVersion: null,
  };

  it('shows organizer identity, capacity, and the settings action', () => {
    const markup = renderSettings(updateStatus, {
      organization: ORGANIZATION,
    });

    expect(markup).toContain('Organization access');
    expect(markup).toContain('Greenfield School');
    expect(markup).toContain('Organizer');
    expect(markup).toContain('4 of 25');
    expect(markup).toContain('Open organization settings');
    expect(markup).not.toContain('student@example.com');
  });

  it('shows a localized read-only member summary', () => {
    const markup = renderSettings(updateStatus, {
      appLanguage: 'vi',
      organization: { ...ORGANIZATION, role: 'member' },
    });

    expect(markup).toContain('Greenfield School');
    expect(markup).toContain('Thành viên');
    expect(markup).toContain('Mở cài đặt tổ chức');
    expect(markup).toContain('không cần nhập mã');
  });

  it('hides a successful null organization result and shows bounded failures', () => {
    expect(renderSettings(updateStatus)).not.toContain(
      'settings-organization-card',
    );

    const loadingMarkup = renderSettings(updateStatus, {
      isLoadingOrganization: true,
    });
    expect(loadingMarkup).not.toContain('settings-organization-card');

    const errorMarkup = renderSettings(updateStatus, {
      organizationError: 'Organization service unavailable.',
    });
    expect(errorMarkup).toContain('role="alert"');
    expect(errorMarkup).toContain('Organization service unavailable.');
    expect(errorMarkup).toContain('Try again');
  });
});
