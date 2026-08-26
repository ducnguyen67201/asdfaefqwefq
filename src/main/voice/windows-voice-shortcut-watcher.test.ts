import { describe, expect, it } from 'vitest';

import {
  WINDOWS_VOICE_SHORTCUT_ACTIVE_POLL_INTERVAL_MS,
  WINDOWS_VOICE_SHORTCUT_IDLE_POLL_INTERVAL_MS,
  windowsVoiceShortcutPollInterval,
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
