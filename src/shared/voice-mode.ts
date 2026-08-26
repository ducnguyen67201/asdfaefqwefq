export const VOICE_MODES = ['dictation', 'task'] as const;

export type VoiceMode = (typeof VOICE_MODES)[number];
export type VoiceModeValue = VoiceMode;

export const VOICE_SHORTCUT_MODE_SETTLE_MS = 120;

export type VoiceShortcutPlatform = 'macos' | 'windows';

export interface VoiceShortcutDescriptor {
  accessibleName: string;
  keys: readonly string[];
}

const VOICE_SHORTCUTS = {
  macos: {
    dictation: {
      accessibleName: 'Command + Control',
      keys: ['⌘', '⌃'],
    },
    task: {
      accessibleName: 'Command + Control + Shift',
      keys: ['⌘', '⌃', '⇧'],
    },
  },
  windows: {
    dictation: {
      accessibleName: 'left Control + left Alt',
      keys: ['Left Ctrl', 'Left Alt'],
    },
    task: {
      accessibleName: 'left Control + left Alt + left Shift',
      keys: ['Left Ctrl', 'Left Alt', 'Left Shift'],
    },
  },
} as const satisfies Record<
  VoiceShortcutPlatform,
  Record<VoiceModeValue, VoiceShortcutDescriptor>
>;

export function voiceShortcutDescriptor(
  platform: VoiceShortcutPlatform,
  mode: VoiceModeValue,
): VoiceShortcutDescriptor {
  return VOICE_SHORTCUTS[platform][mode];
}
