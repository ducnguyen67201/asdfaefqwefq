// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CompanionCustomizationStatus } from '../shared/contracts';
import type { DesktopApi } from '../shared/desktop-api';

import { SettingsPage } from './SettingsPage';

const companionStatus: CompanionCustomizationStatus = {
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

function settingsProps(onClose = vi.fn()) {
  return {
    appLanguage: 'en' as const,
    autonomyMode: 'balanced' as const,
    appUpdateError: null,
    appUpdateStatus: {
      currentVersion: '0.1.8',
      message: 'Tro is up to date.',
      phase: 'up_to_date' as const,
      targetVersion: null,
    },
    classroomPetEnabled: true,
    companionBusy: null,
    companionError: null,
    companionStatus,
    error: null,
    hasChanges: false,
    isActivatingMembership: false,
    isLoadingOrganization: false,
    isSaving: false,
    isUpdatingApp: false,
    membershipError: null,
    membershipStatus: {
      expiresAt: null,
      plan: 'free' as const,
      referenceCode: null,
      required: true,
      state: 'active' as const,
      summary: 'Free plan active.',
    },
    muteSystemAudioWhileSpeaking: false,
    onActivateCompanion: vi.fn(),
    onActivateMembership: vi.fn(),
    onActivateSavedCompanion: vi.fn(),
    onAppLanguageChange: vi.fn(),
    onAutonomyModeChange: vi.fn(),
    onCheckForUpdates: vi.fn(),
    onClassroomPetEnabledChange: vi.fn(),
    onClose,
    onGenerateCompanion: vi.fn(),
    onLanguageChange: vi.fn(),
    onMuteSystemAudioWhileSpeakingChange: vi.fn(),
    onOpenOrganization: vi.fn(),
    onRefreshOrganization: vi.fn(),
    onRestartAndInstall: vi.fn(),
    onSave: vi.fn(),
    onUseDefaultCompanion: vi.fn(),
    organization: null,
    organizationError: null,
    primaryLanguage: 'en' as const,
    saveMessage: null,
    systemAudioMuteSupported: true,
  };
}

describe('SettingsPage dialog interaction', () => {
  let container: HTMLDivElement;
  let root: Root;
  let closeDialog: ReturnType<typeof vi.fn>;
  let showModal: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    showModal = vi.fn(function show(this: HTMLDialogElement) {
      this.setAttribute('open', '');
    });
    closeDialog = vi.fn(function close(this: HTMLDialogElement) {
      this.removeAttribute('open');
    });
    Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
      configurable: true,
      value: showModal,
    });
    Object.defineProperty(HTMLDialogElement.prototype, 'close', {
      configurable: true,
      value: closeDialog,
    });
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      callback(0);
      return 1;
    });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);
    window.tro = {
      listConnectors: vi.fn().mockResolvedValue({
        catalog: [],
        connections: [],
        enabled: false,
      }),
    } as unknown as DesktopApi;
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  it('opens modally, focuses General, and keeps mounted panels while navigating', async () => {
    await act(async () => root.render(<SettingsPage {...settingsProps()} />));

    const dialog = container.querySelector('dialog');
    const generalButton = container.querySelector<HTMLButtonElement>(
      '#settings-nav-general',
    );
    const voiceButton = container.querySelector<HTMLButtonElement>(
      '#settings-nav-voice',
    );
    const generalPanel = container.querySelector<HTMLElement>(
      '#settings-panel-general',
    );
    const voicePanel = container.querySelector<HTMLElement>(
      '#settings-panel-voice',
    );

    expect(showModal).toHaveBeenCalledOnce();
    expect(dialog?.open).toBe(true);
    expect(document.activeElement).toBe(generalButton);
    expect(generalButton?.getAttribute('aria-current')).toBe('page');
    expect(generalPanel?.hidden).toBe(false);
    expect(voicePanel?.hidden).toBe(true);

    await act(async () => voiceButton?.click());

    expect(voiceButton?.getAttribute('aria-current')).toBe('page');
    expect(generalPanel?.hidden).toBe(true);
    expect(voicePanel?.hidden).toBe(false);
    expect(container.querySelector('#settings-panel-account')).not.toBeNull();
  });

  it('routes native cancel and the close button through the same close callback', async () => {
    const onClose = vi.fn();
    await act(async () =>
      root.render(<SettingsPage {...settingsProps(onClose)} />),
    );
    const dialog = container.querySelector('dialog');
    const cancelEvent = new Event('cancel', { cancelable: true });

    await act(async () => dialog?.dispatchEvent(cancelEvent));
    expect(cancelEvent.defaultPrevented).toBe(true);
    expect(onClose).toHaveBeenCalledOnce();

    await act(async () =>
      container
        .querySelector<HTMLButtonElement>('.settings-dialog__close')
        ?.click(),
    );
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
