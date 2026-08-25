import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import type {
  AppUpdateStatus,
  CompanionCustomizationStatus,
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
  state: 'available',
  summary: 'Companion generation is available.',
};

function renderSettings(appUpdateStatus: AppUpdateStatus): string {
  return renderToStaticMarkup(
    SettingsPage({
      appLanguage: 'en',
      autonomyMode: 'balanced',
      appUpdateError: null,
      appUpdateStatus,
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
      muteSystemAudioWhileSpeaking: false,
      onActivateMembership: vi.fn(),
      onActivateCompanion: vi.fn(),
      onAppLanguageChange: vi.fn(),
      onAutonomyModeChange: vi.fn(),
      onCheckForUpdates: vi.fn(),
      onGenerateCompanion: vi.fn(),
      onLanguageChange: vi.fn(),
      onMuteSystemAudioWhileSpeakingChange: vi.fn(),
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
        muteSystemAudioWhileSpeaking: true,
        onActivateMembership: vi.fn(),
        onActivateCompanion: vi.fn(),
        onAppLanguageChange: vi.fn(),
        onAutonomyModeChange: vi.fn(),
        onCheckForUpdates: vi.fn(),
        onGenerateCompanion: vi.fn(),
        onLanguageChange: vi.fn(),
        onMuteSystemAudioWhileSpeakingChange: vi.fn(),
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
