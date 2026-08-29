import type { AppLanguage, VoiceMode } from '../shared/contracts';
import { voiceShortcutDescriptor } from '../shared/voice-mode';

import { translate } from './app-language';
import type { PushToTalkPlatform } from './push-to-talk';

interface VoiceModeControlProps {
  appLanguage: AppLanguage;
  disabled?: boolean;
  mode: VoiceMode;
  onChange(mode: VoiceMode): void;
  platform: PushToTalkPlatform;
}

interface VoiceModeKeyboardEvent {
  altKey: boolean;
  ctrlKey: boolean;
  key: string;
  metaKey: boolean;
  shiftKey: boolean;
}

interface ShortcutDescriptor {
  accessibleName: string;
  ariaKeyShortcut: string;
  keys: readonly string[];
}

export function nextVoiceMode(mode: VoiceMode): VoiceMode {
  return mode === 'dictation' ? 'task' : 'dictation';
}

export function voiceModeToggleShortcutDescriptor(
  platform: PushToTalkPlatform,
): ShortcutDescriptor | null {
  if (platform === 'macos') {
    return {
      accessibleName: 'Command + Backslash',
      ariaKeyShortcut: 'Meta+\\',
      keys: ['⌘', '\\'],
    };
  }
  if (platform === 'windows') {
    return {
      accessibleName: 'Control + Backslash',
      ariaKeyShortcut: 'Control+\\',
      keys: ['Ctrl', '\\'],
    };
  }
  return null;
}

export function isVoiceModeToggleShortcut(
  event: VoiceModeKeyboardEvent,
  platform: PushToTalkPlatform,
): boolean {
  if (event.key !== '\\' || event.altKey || event.shiftKey) return false;
  if (platform === 'macos') return event.metaKey && !event.ctrlKey;
  if (platform === 'windows') return event.ctrlKey && !event.metaKey;
  return false;
}

function PencilIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20">
      <path d="m4 13.8-.8 3 3-.8L15 7.2 12.8 5 4 13.8Z" />
      <path d="m11.8 6 2.2 2.2" />
    </svg>
  );
}

function SparkleIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20">
      <path d="m10 2 1.3 4.7L16 8l-4.7 1.3L10 14l-1.3-4.7L4 8l4.7-1.3L10 2Z" />
      <path d="m15.5 13 .6 2.1 2.1.6-2.1.6-.6 2.1-.6-2.1-2.1-.6 2.1-.6.6-2.1Z" />
    </svg>
  );
}

function Keycaps({ keys }: { keys: readonly string[] }) {
  return (
    <span aria-hidden="true" className="voice-mode-control__keycaps">
      {keys.map((key, index) => (
        <span className="voice-mode-control__key" key={key}>
          {index > 0 && <span>+</span>}
          <kbd>{key}</kbd>
        </span>
      ))}
    </span>
  );
}

export function VoiceModeControl({
  appLanguage,
  disabled = false,
  mode,
  onChange,
  platform,
}: VoiceModeControlProps) {
  if (platform === 'unsupported') return null;

  const t = (message: string) => translate(appLanguage, message);
  const talkShortcut = voiceShortcutDescriptor(platform);
  const toggleShortcut = voiceModeToggleShortcutDescriptor(platform);
  const options = [
    {
      description: t('Adds your words without sending.'),
      icon: <PencilIcon />,
      label: t('Write my words'),
      mode: 'dictation' as const,
    },
    {
      description: t('Sends your request to Tro.'),
      icon: <SparkleIcon />,
      label: t('Ask Tro'),
      mode: 'task' as const,
    },
  ];

  return (
    <div
      aria-keyshortcuts={toggleShortcut?.ariaKeyShortcut}
      aria-label={t('Voice mode')}
      className="voice-mode-control"
      role="group"
      title={
        toggleShortcut
          ? `${t('Switch mode')}: ${toggleShortcut.accessibleName}`
          : undefined
      }
    >
      <span className="voice-mode-control__options">
        {options.map((option) => (
          <button
            aria-label={`${option.label}. ${option.description}`}
            aria-pressed={mode === option.mode}
            className={`voice-mode-option voice-mode-option--${option.mode}`}
            disabled={disabled}
            key={option.mode}
            onClick={() => onChange(option.mode)}
            type="button"
          >
            {option.icon}
            <span>{option.label}</span>
          </button>
        ))}
      </span>
      <span
        aria-label={`${t('Hold')} ${talkShortcut.accessibleName} ${t('to talk')}`}
        className="voice-mode-control__talk"
      >
        <span>{t('Hold')}</span>
        <Keycaps keys={talkShortcut.keys} />
        <span>{t('to talk')}</span>
      </span>
      {toggleShortcut && (
        <span
          aria-label={`${t('Switch mode')}: ${toggleShortcut.accessibleName}`}
          className="voice-mode-control__switch"
        >
          <span>{t('Switch')}</span>
          <Keycaps keys={toggleShortcut.keys} />
        </span>
      )}
    </div>
  );
}
