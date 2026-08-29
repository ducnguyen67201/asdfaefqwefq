import { describe, expect, it } from 'vitest';

import {
  detectPushToTalkPlatform,
  globalPushToTalkShortcutName,
  INITIAL_VOICE_SHORTCUT_ARBITER_STATE,
  isPushToTalkChord,
  pushToTalkShortcutName,
  transitionVoiceShortcutArbiter,
} from './push-to-talk';

describe('push-to-talk shortcuts', () => {
  it('detects supported desktop platforms', () => {
    expect(detectPushToTalkPlatform('MacIntel', 'Electron')).toBe('macos');
    expect(detectPushToTalkPlatform('Win32', 'Electron')).toBe('windows');
    expect(detectPushToTalkPlatform('Linux x86_64', 'Electron')).toBe(
      'unsupported',
    );
  });

  it('accepts either Command and Control side on macOS', () => {
    expect(
      isPushToTalkChord('macos', new Set(['MetaLeft', 'ControlRight'])),
    ).toBe(true);
    expect(isPushToTalkChord('macos', new Set(['MetaLeft']))).toBe(false);
    expect(pushToTalkShortcutName('macos')).toBe('Command + Control');
    expect(globalPushToTalkShortcutName('macos')).toBe('Command + Control');
  });

  it('requires left Alt and left Control on Windows', () => {
    expect(
      isPushToTalkChord('windows', new Set(['AltLeft', 'ControlLeft'])),
    ).toBe(true);
    expect(
      isPushToTalkChord('windows', new Set(['AltRight', 'ControlLeft'])),
    ).toBe(false);
    expect(pushToTalkShortcutName('windows')).toBe('left Control + left Alt');
    expect(globalPushToTalkShortcutName('windows')).toBe(
      'left Control + left Alt',
    );
  });

  it('waits 120 ms before activating the selected mode', () => {
    const pressed = new Set(['MetaLeft', 'ControlLeft']);
    const settling = transitionVoiceShortcutArbiter(
      INITIAL_VOICE_SHORTCUT_ARBITER_STATE,
      'macos',
      pressed,
      1_000,
      'task',
    );
    expect(settling.events).toEqual([]);
    expect(settling.state.phase).toBe('settling');

    expect(
      transitionVoiceShortcutArbiter(
        settling.state,
        'macos',
        pressed,
        1_119,
        'task',
      ).events,
    ).toEqual([]);
    expect(
      transitionVoiceShortcutArbiter(
        settling.state,
        'macos',
        pressed,
        1_120,
        'task',
      ),
    ).toEqual({
      events: [{ action: 'pressed', mode: 'task' }],
      state: { deadlineMs: null, phase: 'active_task' },
    });
  });

  it('does not let Shift change the selected mode', () => {
    const pressed = new Set(['MetaLeft', 'ControlLeft', 'ShiftLeft']);
    const settling = transitionVoiceShortcutArbiter(
      INITIAL_VOICE_SHORTCUT_ARBITER_STATE,
      'macos',
      pressed,
      1_000,
      'dictation',
    );
    expect(settling.state.phase).toBe('settling');
    expect(
      transitionVoiceShortcutArbiter(
        settling.state,
        'macos',
        pressed,
        1_120,
        'dictation',
      ).events,
    ).toEqual([{ action: 'pressed', mode: 'dictation' }]);
  });

  it('emits nothing when the chord is released inside settling', () => {
    const settling = transitionVoiceShortcutArbiter(
      INITIAL_VOICE_SHORTCUT_ARBITER_STATE,
      'macos',
      new Set(['MetaLeft', 'ControlLeft']),
      1_000,
      'task',
    );
    const released = transitionVoiceShortcutArbiter(
      settling.state,
      'macos',
      new Set(),
      1_050,
      'task',
    );
    expect(released.events).toEqual([]);
    expect(released.state.phase).toBe('await_all_released');
  });

  it('locks the chosen mode for the full hold and waits for all modifiers', () => {
    const pressed = new Set(['ControlLeft', 'AltLeft']);
    const settling = transitionVoiceShortcutArbiter(
      INITIAL_VOICE_SHORTCUT_ARBITER_STATE,
      'windows',
      pressed,
      1_000,
      'task',
    );
    const active = transitionVoiceShortcutArbiter(
      settling.state,
      'windows',
      pressed,
      1_120,
      'task',
    );

    expect(
      transitionVoiceShortcutArbiter(
        active.state,
        'windows',
        pressed,
        1_130,
        'dictation',
      ),
    ).toEqual({ events: [], state: active.state });

    const released = transitionVoiceShortcutArbiter(
      active.state,
      'windows',
      new Set(['ControlLeft']),
      1_140,
      'dictation',
    );
    expect(released.events).toEqual([{ action: 'released', mode: 'task' }]);
    expect(released.state.phase).toBe('await_all_released');
    expect(
      transitionVoiceShortcutArbiter(
        released.state,
        'windows',
        new Set(['ControlLeft']),
        1_150,
      ).state.phase,
    ).toBe('await_all_released');
    expect(
      transitionVoiceShortcutArbiter(
        released.state,
        'windows',
        new Set(),
        1_160,
      ).state.phase,
    ).toBe('idle');
  });
});
