import { spawn } from 'node:child_process';

import type {
  VoiceModeToggleEvent,
  VoiceShortcutEvent,
} from '../../shared/contracts';
import { IPC_CHANNELS } from '../../shared/desktop-api';

export const WINDOWS_GLOBAL_VOICE_SHORTCUT = 'Control+Alt+Space';
export const MACOS_GLOBAL_VOICE_MODE_TOGGLE_SHORTCUT = 'Command+\\';
export const WINDOWS_GLOBAL_VOICE_MODE_TOGGLE_SHORTCUT = 'Control+\\';
const VOICE_MODE_TOGGLE_REPEAT_GUARD_MS = 500;
const WINDOWS_KEY_RELEASE_POLL_INTERVAL_MS = 30;
const WINDOWS_KEY_RELEASE_POLL_SCRIPT = `
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

public static class TroKeyboardState {
  [DllImport("user32.dll")]
  public static extern short GetAsyncKeyState(int vKey);
}
'@

$keys = @(0x11, 0x12, 0x20)
while ($true) {
  $allDown = $true
  foreach ($key in $keys) {
    if (([TroKeyboardState]::GetAsyncKeyState($key) -band 0x8000) -eq 0) {
      $allDown = $false
      break
    }
  }

  if (-not $allDown) {
    exit 0
  }

  Start-Sleep -Milliseconds ${WINDOWS_KEY_RELEASE_POLL_INTERVAL_MS}
}
`;

interface GlobalShortcutRegistry {
  register(accelerator: string, callback: () => void): boolean;
  unregister(accelerator: string): void;
}

interface VoiceShortcutTarget {
  isDestroyed(): boolean;
  isFocused(): boolean;
  webContents: {
    send(channel: string, value: VoiceShortcutEvent): void;
  };
}

interface VoiceModeToggleTarget {
  isDestroyed(): boolean;
  webContents: {
    send(channel: string, value: VoiceModeToggleEvent): void;
  };
}

interface GlobalVoiceShortcutOptions {
  getTarget(): VoiceShortcutTarget | null;
  logger?: Pick<Console, 'warn'>;
  platform: NodeJS.Platform;
  registry: GlobalShortcutRegistry;
  waitForRelease?: VoiceShortcutReleaseWatcher;
  watchForMacOSShortcut?: VoiceShortcutWatcher;
  watchForWindowsShortcut?: VoiceShortcutWatcher;
}

type VoiceShortcutReleaseWatcher = (signal: AbortSignal) => Promise<void>;
type VoiceShortcutWatcher = (
  listener: (event: VoiceShortcutEvent) => void,
) => (() => void) | undefined;

interface GlobalVoiceModeToggleOptions {
  getTarget(): VoiceModeToggleTarget | null;
  logger?: Pick<Console, 'warn'>;
  now?: () => number;
  platform: NodeJS.Platform;
  registry: GlobalShortcutRegistry;
}

export function registerGlobalVoiceModeToggleShortcut({
  getTarget,
  logger = console,
  now = Date.now,
  platform,
  registry,
}: GlobalVoiceModeToggleOptions): () => void {
  const accelerator =
    platform === 'darwin'
      ? MACOS_GLOBAL_VOICE_MODE_TOGGLE_SHORTCUT
      : platform === 'win32'
        ? WINDOWS_GLOBAL_VOICE_MODE_TOGGLE_SHORTCUT
        : null;
  if (!accelerator) return () => undefined;

  let lastDeliveredAt = Number.NEGATIVE_INFINITY;
  const registered = registry.register(accelerator, () => {
    const target = getTarget();
    if (!target || target.isDestroyed()) return;

    const triggeredAt = now();
    if (triggeredAt - lastDeliveredAt < VOICE_MODE_TOGGLE_REPEAT_GUARD_MS) {
      return;
    }

    target.webContents.send(IPC_CHANNELS.voiceModeToggleRequested, {
      source: 'global',
    });
    lastDeliveredAt = triggeredAt;
  });

  if (!registered) {
    logger.warn('[voice] Could not register global voice mode shortcut.', {
      accelerator,
    });
    return () => undefined;
  }

  return () => registry.unregister(accelerator);
}

function encodedPowerShellCommand(script: string): string {
  return Buffer.from(script, 'utf16le').toString('base64');
}

export function waitForWindowsGlobalVoiceShortcutRelease(
  signal: AbortSignal,
): Promise<void> {
  if (signal.aborted) return Promise.resolve();

  return new Promise((resolve, reject) => {
    let settled = false;
    const child = spawn(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-EncodedCommand',
        encodedPowerShellCommand(WINDOWS_KEY_RELEASE_POLL_SCRIPT),
      ],
      {
        stdio: 'ignore',
        windowsHide: true,
      },
    );

    const finish = (error?: Error): void => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', handleAbort);
      if (error) reject(error);
      else resolve();
    };

    const handleAbort = (): void => {
      child.kill();
      finish();
    };

    child.once('error', (error) => finish(error));
    child.once('exit', (code, processSignal) => {
      if (signal.aborted || code === 0) {
        finish();
        return;
      }

      finish(
        new Error(
          `Windows voice shortcut release watcher exited with code ${code ?? 'null'} and signal ${processSignal ?? 'null'}.`,
        ),
      );
    });

    signal.addEventListener('abort', handleAbort, { once: true });
    if (signal.aborted) handleAbort();
  });
}

export function registerGlobalVoiceShortcut({
  getTarget,
  logger = console,
  platform,
  registry,
  waitForRelease = waitForWindowsGlobalVoiceShortcutRelease,
  watchForMacOSShortcut,
  watchForWindowsShortcut,
}: GlobalVoiceShortcutOptions): () => void {
  const sendVoiceShortcutEvent = (
    event: VoiceShortcutEvent,
    options: { allowFocused: boolean },
  ): boolean => {
    const target = getTarget();
    if (!target || target.isDestroyed()) return false;
    if (!options.allowFocused && target.isFocused()) return false;

    target.webContents.send(IPC_CHANNELS.voiceShortcut, event);
    return true;
  };

  if (platform === 'darwin') {
    if (!watchForMacOSShortcut) {
      logger.warn('[voice] macOS global voice shortcut helper is unavailable.');
      return () => undefined;
    }

    const stopWatching = watchForMacOSShortcut((event) => {
      sendVoiceShortcutEvent(event, {
        allowFocused: event.action === 'released',
      });
    });
    if (stopWatching) return stopWatching;
    logger.warn('[voice] macOS global voice shortcut helper could not start.');
    return () => undefined;
  }

  if (platform !== 'win32') return () => undefined;

  if (watchForWindowsShortcut) {
    const stopWatching = watchForWindowsShortcut((event) => {
      sendVoiceShortcutEvent(event, {
        allowFocused: event.action === 'released',
      });
    });
    if (stopWatching) return stopWatching;
  }

  logger.warn(
    '[voice] Native Windows shortcut watcher is unavailable; modifier-only voice input is disabled and Control+Alt+Space will be used as the fallback.',
  );

  let releaseController: AbortController | null = null;

  const registered = registry.register(WINDOWS_GLOBAL_VOICE_SHORTCUT, () => {
    if (releaseController) return;

    const sent = sendVoiceShortcutEvent(
      {
        action: 'pressed',
        source: 'global',
      },
      { allowFocused: false },
    );
    if (!sent) return;

    const controller = new AbortController();
    releaseController = controller;
    void waitForRelease(controller.signal)
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        logger.warn('[voice] Global voice shortcut release watcher failed.', {
          error:
            error instanceof Error
              ? {
                  message: error.message,
                  name: error.name,
                }
              : {
                  message: String(error),
                },
        });
      })
      .then(() => {
        if (releaseController !== controller) return;
        releaseController = null;
        if (controller.signal.aborted) return;

        sendVoiceShortcutEvent(
          {
            action: 'released',
            source: 'global',
          },
          { allowFocused: true },
        );
      });
  });

  if (!registered) {
    logger.warn('[voice] Could not register global voice shortcut.', {
      accelerator: WINDOWS_GLOBAL_VOICE_SHORTCUT,
    });
    return () => undefined;
  }

  return () => {
    releaseController?.abort();
    releaseController = null;
    registry.unregister(WINDOWS_GLOBAL_VOICE_SHORTCUT);
  };
}
