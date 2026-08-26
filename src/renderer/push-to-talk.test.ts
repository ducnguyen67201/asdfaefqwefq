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
    expect(globalPushToTalkShortcutName('macos')).toBe('Command + Control');
    expect(globalPushToTalkShortcutName('macos', 'task')).toBe(
      'Command + Control + Shift',
    );
    const rightShift = transitionVoiceShortcutArbiter(
      INITIAL_VOICE_SHORTCUT_ARBITER_STATE,
      'windows',
      new Set(['AltLeft', 'ControlLeft', 'ShiftRight']),
      0,
    );
    expect(rightShift.events).toEqual([]);
    expect(rightShift.state.phase).toBe('settling');
  });

  it('waits before locking the base chord as dictation', () => {
    const pressed = new Set(['MetaLeft', 'ControlLeft']);
    const settling = transitionVoiceShortcutArbiter(
      INITIAL_VOICE_SHORTCUT_ARBITER_STATE,
      'macos',
      pressed,
      1_000,
    );
    expect(settling.events).toEqual([]);
    expect(settling.state.phase).toBe('settling');

    expect(
      transitionVoiceShortcutArbiter(
        settling.state,
        'macos',
        pressed,
        1_119,
      ).events,
    ).toEqual([]);
    expect(
      transitionVoiceShortcutArbiter(
        settling.state,
        'macos',
        pressed,
        1_120,
      ).events,
    ).toEqual([{ action: 'pressed', mode: 'dictation' }]);
  });

  it('emits nothing when the base chord is released inside settling', () => {
    const settling = transitionVoiceShortcutArbiter(
      INITIAL_VOICE_SHORTCUT_ARBITER_STATE,
      'macos',
      new Set(['MetaLeft', 'ControlLeft']),
      1_000,
    );
    const released = transitionVoiceShortcutArbiter(
      settling.state,
      'macos',
      new Set(),
      1_050,
    );
    expect(released.events).toEqual([]);
    expect(released.state.phase).toBe('await_all_released');
  });

  it('locks task when Shift is held first or arrives during settling', () => {
    const task = new Set(['MetaLeft', 'ControlLeft', 'ShiftLeft']);
    expect(
      transitionVoiceShortcutArbiter(
        INITIAL_VOICE_SHORTCUT_ARBITER_STATE,
        'macos',
        task,
        1_000,
      ).events,
    ).toEqual([{ action: 'pressed', mode: 'task' }]);

    const settling = transitionVoiceShortcutArbiter(
      INITIAL_VOICE_SHORTCUT_ARBITER_STATE,
      'macos',
      new Set(['MetaLeft', 'ControlLeft']),
      1_000,
    );
    expect(
      transitionVoiceShortcutArbiter(settling.state, 'macos', task, 1_119)
        .events,
    ).toEqual([{ action: 'pressed', mode: 'task' }]);
  });

  it('locks the mode deterministically at the 120 ms boundary', () => {
    const settling = transitionVoiceShortcutArbiter(
      INITIAL_VOICE_SHORTCUT_ARBITER_STATE,
      'macos',
      new Set(['MetaLeft', 'ControlLeft']),
      1_000,
    );
    const task = new Set(['MetaLeft', 'ControlLeft', 'ShiftLeft']);

    expect(
      transitionVoiceShortcutArbiter(settling.state, 'macos', task, 1_120)
        .events,
    ).toEqual([{ action: 'pressed', mode: 'dictation' }]);
    expect(
      transitionVoiceShortcutArbiter(settling.state, 'macos', task, 1_121)
        .events,
    ).toEqual([{ action: 'pressed', mode: 'dictation' }]);
  });

  it('does not convert a locked dictation turn into task', () => {
    const settling = transitionVoiceShortcutArbiter(
      INITIAL_VOICE_SHORTCUT_ARBITER_STATE,
      'macos',
      new Set(['MetaLeft', 'ControlLeft']),
      1_000,
    );
    const active = transitionVoiceShortcutArbiter(
      settling.state,
      'macos',
      new Set(['MetaLeft', 'ControlLeft']),
      1_120,
    );
    expect(
      transitionVoiceShortcutArbiter(
        active.state,
        'macos',
        new Set(['MetaLeft', 'ControlLeft', 'ShiftLeft']),
        1_130,
      ),
    ).toEqual({ events: [], state: active.state });
  });

  it('ignores repeated modifier observations after activation', () => {
    const activeTask = transitionVoiceShortcutArbiter(
      INITIAL_VOICE_SHORTCUT_ARBITER_STATE,
      'macos',
      new Set(['MetaLeft', 'ControlLeft', 'ShiftLeft']),
      1_000,
    );

    expect(
      transitionVoiceShortcutArbiter(
        activeTask.state,
        'macos',
        new Set(['MetaLeft', 'ControlLeft', 'ShiftLeft']),
        1_010,
      ),
    ).toEqual({ events: [], state: activeTask.state });
  });

  it('waits for all base modifiers after a task release', () => {
    const activeTask = {
      deadlineMs: null,
      phase: 'active_task' as const,
    };
    const released = transitionVoiceShortcutArbiter(
      activeTask,
      'windows',
      new Set(['ControlLeft', 'AltLeft']),
      1_000,
    );
    expect(released.events).toEqual([{ action: 'released', mode: 'task' }]);
    expect(released.state.phase).toBe('await_all_released');
    expect(
      transitionVoiceShortcutArbiter(
        released.state,
        'windows',
        new Set(['ControlLeft']),
        1_010,
      ).state.phase,
    ).toBe('await_all_released');
    expect(
      transitionVoiceShortcutArbiter(
        released.state,
        'windows',
        new Set(),
        1_020,
      ).state.phase,
    ).toBe('idle');

    const nextGesture = transitionVoiceShortcutArbiter(
      INITIAL_VOICE_SHORTCUT_ARBITER_STATE,
      'windows',
      new Set(['ControlLeft', 'AltLeft']),
      1_030,
    );
    expect(
      transitionVoiceShortcutArbiter(
        nextGesture.state,
        'windows',
        new Set(['ControlLeft', 'AltLeft']),
        1_150,
      ).events,
    ).toEqual([{ action: 'pressed', mode: 'dictation' }]);
  });
});
