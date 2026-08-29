import { describe, expect, it } from 'vitest';

import {
  WINDOWS_VOICE_SHORTCUT_ACTIVE_POLL_INTERVAL_MS,
  WINDOWS_VOICE_SHORTCUT_IDLE_POLL_INTERVAL_MS,
  windowsVoiceShortcutPollInterval,
  windowsVoiceShortcutWatchScript,
} from './windows-voice-shortcut-watcher';

describe('Windows voice shortcut polling cadence', () => {
  it('cuts idle keyboard polling by eighty percent', () => {
    const baselinePollsPerMinute = Math.ceil(
      60_000 / WINDOWS_VOICE_SHORTCUT_ACTIVE_POLL_INTERVAL_MS,
    );
    const idlePollsPerMinute = Math.ceil(
      60_000 / WINDOWS_VOICE_SHORTCUT_IDLE_POLL_INTERVAL_MS,
    );

    expect(baselinePollsPerMinute).toBe(3_000);
    expect(idlePollsPerMinute).toBe(600);
    expect(idlePollsPerMinute / baselinePollsPerMinute).toBe(0.2);
  });

  it('polls quickly after either shortcut modifier is detected', () => {
    expect(
      windowsVoiceShortcutPollInterval({
        leftAltDown: true,
        leftControlDown: false,
        wasDown: false,
      }),
    ).toBe(WINDOWS_VOICE_SHORTCUT_ACTIVE_POLL_INTERVAL_MS);
    expect(
      windowsVoiceShortcutPollInterval({
        leftAltDown: false,
        leftControlDown: true,
        wasDown: false,
      }),
    ).toBe(WINDOWS_VOICE_SHORTCUT_ACTIVE_POLL_INTERVAL_MS);
  });

  it('keeps release detection fast for a previously active chord', () => {
    expect(
      windowsVoiceShortcutPollInterval({
        leftAltDown: false,
        leftControlDown: false,
        wasDown: true,
      }),
    ).toBe(WINDOWS_VOICE_SHORTCUT_ACTIVE_POLL_INTERVAL_MS);
  });

  it('uses the idle cadence when no shortcut key is involved', () => {
    expect(
      windowsVoiceShortcutPollInterval({
        leftAltDown: false,
        leftControlDown: false,
        wasDown: false,
      }),
    ).toBe(WINDOWS_VOICE_SHORTCUT_IDLE_POLL_INTERVAL_MS);
  });
});

describe('windowsVoiceShortcutWatchScript', () => {
  it('uses one left-side two-key shortcut without a Shift mode chord', () => {
    const script = windowsVoiceShortcutWatchScript(120);

    expect(script).toContain('GetAsyncKeyState(0xA2)');
    expect(script).toContain('GetAsyncKeyState(0xA4)');
    expect(script).not.toContain('GetAsyncKeyState(0xA0)');
    expect(script).toContain("'pressed'");
    expect(script).toContain("'released'");
    expect(script).not.toContain('task');
    expect(script).not.toContain('dictation');
    expect(script).toContain('$settleMilliseconds = 120');
  });

  it('normalizes the internal settle duration before interpolation', () => {
    expect(windowsVoiceShortcutWatchScript(119.6)).toContain(
      '$settleMilliseconds = 120',
    );
    expect(windowsVoiceShortcutWatchScript(-20)).toContain(
      '$settleMilliseconds = 0',
    );
  });
});
