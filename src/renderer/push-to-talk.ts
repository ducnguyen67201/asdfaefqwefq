import type { VoiceMode } from '../shared/contracts';
import {
  VOICE_SHORTCUT_MODE_SETTLE_MS,
  voiceShortcutDescriptor,
} from '../shared/voice-mode';

export type PushToTalkPlatform = 'macos' | 'unsupported' | 'windows';

export type VoiceShortcutArbiterPhase =
  | 'idle'
  | 'settling'
  | 'active_dictation'
  | 'active_task'
  | 'await_all_released';

export interface VoiceShortcutArbiterState {
  deadlineMs: number | null;
  phase: VoiceShortcutArbiterPhase;
}

export interface VoiceShortcutArbiterEvent {
  action: 'pressed' | 'released';
  mode: VoiceMode;
}

export interface VoiceShortcutArbiterTransition {
  events: VoiceShortcutArbiterEvent[];
  state: VoiceShortcutArbiterState;
}

export const INITIAL_VOICE_SHORTCUT_ARBITER_STATE: VoiceShortcutArbiterState = {
  deadlineMs: null,
  phase: 'idle',
};

export function detectPushToTalkPlatform(
  navigatorPlatform: string,
  userAgent: string,
): PushToTalkPlatform {
  const platformDescription = `${navigatorPlatform} ${userAgent}`.toLowerCase();
  if (platformDescription.includes('mac')) return 'macos';
  if (platformDescription.includes('win')) return 'windows';
  return 'unsupported';
}

function macOSModifierState(pressedCodes: ReadonlySet<string>) {
  const command =
    pressedCodes.has('MetaLeft') || pressedCodes.has('MetaRight');
  const control =
    pressedCodes.has('ControlLeft') || pressedCodes.has('ControlRight');
  return { anyBase: command || control, base: command && control };
}

function windowsModifierState(pressedCodes: ReadonlySet<string>) {
  const alt = pressedCodes.has('AltLeft');
  const control = pressedCodes.has('ControlLeft');
  return { anyBase: alt || control, base: alt && control };
}

function modifierState(
  platform: PushToTalkPlatform,
  pressedCodes: ReadonlySet<string>,
) {
  if (platform === 'macos') return macOSModifierState(pressedCodes);
  if (platform === 'windows') return windowsModifierState(pressedCodes);
  return { anyBase: false, base: false };
}

export function isPushToTalkChord(
  platform: PushToTalkPlatform,
  pressedCodes: ReadonlySet<string>,
): boolean {
  return modifierState(platform, pressedCodes).base;
}

export function isVoiceShortcutModifierCode(code: string): boolean {
  return /^(?:Alt|Control|Meta|Shift)(?:Left|Right)$/u.test(code);
}

export function transitionVoiceShortcutArbiter(
  state: VoiceShortcutArbiterState,
  platform: PushToTalkPlatform,
  pressedCodes: ReadonlySet<string>,
  nowMs: number,
  mode: VoiceMode = 'dictation',
): VoiceShortcutArbiterTransition {
  if (platform === 'unsupported') {
    return { events: [], state: INITIAL_VOICE_SHORTCUT_ARBITER_STATE };
  }

  const { anyBase, base } = modifierState(platform, pressedCodes);

  switch (state.phase) {
    case 'idle':
      if (!base) return { events: [], state };
      return {
        events: [],
        state: {
          deadlineMs: nowMs + VOICE_SHORTCUT_MODE_SETTLE_MS,
          phase: 'settling',
        },
      };
    case 'settling':
      if (!base) {
        return {
          events: [],
          state: { deadlineMs: null, phase: 'await_all_released' },
        };
      }
      if (state.deadlineMs !== null && nowMs >= state.deadlineMs) {
        return {
          events: [{ action: 'pressed', mode }],
          state: {
            deadlineMs: null,
            phase: mode === 'task' ? 'active_task' : 'active_dictation',
          },
        };
      }
      return { events: [], state };
    case 'active_dictation':
      if (base) return { events: [], state };
      return {
        events: [{ action: 'released', mode: 'dictation' }],
        state: { deadlineMs: null, phase: 'await_all_released' },
      };
    case 'active_task':
      if (base) return { events: [], state };
      return {
        events: [{ action: 'released', mode: 'task' }],
        state: { deadlineMs: null, phase: 'await_all_released' },
      };
    case 'await_all_released':
      return !anyBase
        ? { events: [], state: INITIAL_VOICE_SHORTCUT_ARBITER_STATE }
        : { events: [], state };
  }
}

export function voiceShortcutName(
  platform: PushToTalkPlatform,
): string {
  if (platform === 'unsupported') return 'voice shortcut';
  return voiceShortcutDescriptor(platform).accessibleName;
}

export function pushToTalkShortcutName(
  platform: PushToTalkPlatform,
): string {
  return voiceShortcutName(platform);
}

export function globalPushToTalkShortcutName(
  platform: PushToTalkPlatform,
): string | null {
  return platform === 'unsupported' ? null : voiceShortcutName(platform);
}
