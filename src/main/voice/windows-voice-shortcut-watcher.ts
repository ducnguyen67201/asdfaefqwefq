import { spawn } from 'node:child_process';

import type { VoiceShortcutEvent } from '../../shared/contracts';
import { VOICE_SHORTCUT_MODE_SETTLE_MS } from '../../shared/voice-mode';

import { parseMacOSVoiceShortcutOutput } from './macos-voice-shortcut-watcher';

export const WINDOWS_VOICE_SHORTCUT_ACTIVE_POLL_INTERVAL_MS = 20;
export const WINDOWS_VOICE_SHORTCUT_IDLE_POLL_INTERVAL_MS = 100;

interface WindowsVoiceShortcutPollState {
  leftAltDown: boolean;
  leftControlDown: boolean;
  wasDown: boolean;
}

export function windowsVoiceShortcutPollInterval({
  leftAltDown,
  leftControlDown,
  wasDown,
}: WindowsVoiceShortcutPollState): number {
  return leftAltDown || leftControlDown || wasDown
    ? WINDOWS_VOICE_SHORTCUT_ACTIVE_POLL_INTERVAL_MS
    : WINDOWS_VOICE_SHORTCUT_IDLE_POLL_INTERVAL_MS;
}

export function windowsVoiceShortcutWatchScript(
  settleMilliseconds = VOICE_SHORTCUT_MODE_SETTLE_MS,
): string {
  const safeSettleMilliseconds = Math.max(0, Math.round(settleMilliseconds));
  return `
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class TroModifierState {
  [DllImport("user32.dll")]
  public static extern short GetAsyncKeyState(int vKey);
}
'@
$settleMilliseconds = ${safeSettleMilliseconds}
$state = 'idle'
$deadline = [long]0
while ($true) {
  $leftControlDown = ([TroModifierState]::GetAsyncKeyState(0xA2) -band 0x8000) -ne 0
  $leftAltDown = ([TroModifierState]::GetAsyncKeyState(0xA4) -band 0x8000) -ne 0
  $leftShiftDown = ([TroModifierState]::GetAsyncKeyState(0xA0) -band 0x8000) -ne 0
  $baseDown = $leftControlDown -and $leftAltDown
  $anyBaseDown = $leftControlDown -or $leftAltDown
  $now = [Environment]::TickCount64

  if ($state -eq 'idle') {
    if ($baseDown -and $leftShiftDown) {
      $state = 'active_task'
      [Console]::Out.WriteLine('pressed:task')
      [Console]::Out.Flush()
    } elseif ($baseDown) {
      $state = 'settling'
      $deadline = $now + $settleMilliseconds
    }
  } elseif ($state -eq 'settling') {
    if (-not $baseDown) {
      $state = 'await_all_released'
    } elseif ($now -ge $deadline) {
      $state = 'active_dictation'
      [Console]::Out.WriteLine('pressed:dictation')
      [Console]::Out.Flush()
    } elseif ($leftShiftDown) {
      $state = 'active_task'
      [Console]::Out.WriteLine('pressed:task')
      [Console]::Out.Flush()
    }
  } elseif ($state -eq 'active_task') {
    if (-not ($baseDown -and $leftShiftDown)) {
      $state = 'await_all_released'
      [Console]::Out.WriteLine('released:task')
      [Console]::Out.Flush()
    }
  } elseif ($state -eq 'active_dictation') {
    if (-not $baseDown) {
      $state = 'await_all_released'
      [Console]::Out.WriteLine('released:dictation')
      [Console]::Out.Flush()
    }
  } elseif ($state -eq 'await_all_released' -and -not $anyBaseDown) {
    $state = 'idle'
  }
  $pollInterval = if ($leftControlDown -or $leftAltDown -or $wasDown) {
    ${WINDOWS_VOICE_SHORTCUT_ACTIVE_POLL_INTERVAL_MS}
  } else {
    ${WINDOWS_VOICE_SHORTCUT_IDLE_POLL_INTERVAL_MS}
  }
  $wasDown = $state -ne 'idle'
  Start-Sleep -Milliseconds $pollInterval
}
`;
}

interface WindowsVoiceShortcutWatcherOptions {
  logger?: Pick<Console, 'warn'>;
  onEvent(event: VoiceShortcutEvent): void;
}

export function watchWindowsGlobalVoiceShortcut({
  logger = console,
  onEvent,
}: WindowsVoiceShortcutWatcherOptions): (() => void) | undefined {
  const child = spawn(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-EncodedCommand',
      Buffer.from(windowsVoiceShortcutWatchScript(), 'utf16le').toString(
        'base64',
      ),
    ],
    { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true },
  );
  let outputRemainder = '';
  let stderr = '';
  let stopped = false;

  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => {
    const parsed = parseMacOSVoiceShortcutOutput(outputRemainder, chunk);
    outputRemainder = parsed.remainder;
    for (const event of parsed.events) onEvent(event);
  });
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk: string) => {
    stderr = `${stderr}${chunk}`.slice(-1_000);
  });
  child.once('error', (error) => {
    if (stopped) return;
    logger.warn('[voice] Windows global voice shortcut watcher failed.', {
      error: { message: error.message, name: error.name },
    });
  });
  child.once('exit', (code, signal) => {
    if (stopped) return;
    logger.warn('[voice] Windows global voice shortcut watcher exited.', {
      code,
      signal,
      stderr: stderr.trim() || undefined,
    });
  });

  if (child.pid === undefined) {
    stopped = true;
    return undefined;
  }

  return () => {
    stopped = true;
    if (child.exitCode === null && child.signalCode === null) child.kill();
  };
}
