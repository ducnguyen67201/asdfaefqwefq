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
    accessibleName: 'Command + Control',
    keys: ['⌘', '⌃'],
  },
  windows: {
    accessibleName: 'left Control + left Alt',
    keys: ['Left Ctrl', 'Left Alt'],
  },
} as const satisfies Record<
  VoiceShortcutPlatform,
  VoiceShortcutDescriptor
>;

export function voiceShortcutDescriptor(
  platform: VoiceShortcutPlatform,
): VoiceShortcutDescriptor {
  return VOICE_SHORTCUTS[platform];
}
