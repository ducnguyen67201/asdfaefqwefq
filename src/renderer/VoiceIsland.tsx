import { useEffect, useState } from 'react';

import type { CompanionVoiceActivity } from '../shared/contracts';

import { translate } from './app-language';

function voiceActivityLabel(
  mode: CompanionVoiceActivity['mode'],
  phase: CompanionVoiceActivity['phase'],
  appLanguage: CompanionVoiceActivity['appLanguage'],
): string {
  if (mode === 'task') {
    switch (phase) {
      case 'requesting_permission':
        return translate(appLanguage, 'Preparing voice Task');
      case 'listening':
        return translate(appLanguage, 'Giving Tro a task');
      case 'processing':
        return translate(appLanguage, 'Transcribing Task');
      case 'committing':
        return translate(appLanguage, 'Sending voice Task');
      case 'complete':
        return translate(appLanguage, 'Voice Task sent');
      case 'error':
        return translate(appLanguage, 'Voice Task needs attention');
    }
  }
  switch (phase) {
    case 'requesting_permission':
      return translate(appLanguage, 'Preparing Dictation');
    case 'listening':
      return translate(appLanguage, 'Dictating');
    case 'processing':
      return translate(appLanguage, 'Transcribing Dictation');
    case 'committing':
      return translate(appLanguage, 'Inserting Dictation');
    case 'complete':
      return translate(appLanguage, 'Dictation complete');
    case 'error':
      return translate(appLanguage, 'Dictation needs attention');
  }
}

function voiceActivityPlaceholder(
  phase: CompanionVoiceActivity['phase'],
  appLanguage: CompanionVoiceActivity['appLanguage'],
): string {
  switch (phase) {
    case 'requesting_permission':
      return translate(appLanguage, 'Waiting for microphone access…');
    case 'listening':
      return translate(appLanguage, 'Speak now…');
    case 'processing':
      return translate(appLanguage, 'Finishing transcript…');
    case 'committing':
      return translate(appLanguage, 'Finishing safely…');
    case 'complete':
      return translate(appLanguage, 'Complete');
    case 'error':
      return translate(appLanguage, 'Text kept in your Tro draft.');
  }
}

function DictationIcon({ phase }: { phase: CompanionVoiceActivity['phase'] }) {
  if (phase === 'complete') {
    return <svg viewBox="0 0 24 24"><path d="m5 12.5 4.2 4.2L19 7" /></svg>;
  }
  if (phase === 'error') {
    return <svg viewBox="0 0 24 24"><path d="M12 3 2.8 20h18.4L12 3Z" /><path d="M12 9v5M12 17.5h.01" /></svg>;
  }
  return (
    <svg viewBox="0 0 24 24">
      <path d="M12 15.25a3.25 3.25 0 0 0 3.25-3.25V7a3.25 3.25 0 0 0-6.5 0v5A3.25 3.25 0 0 0 12 15.25Z" />
      <path d="M6.75 11.5v.5a5.25 5.25 0 0 0 10.5 0v-.5M12 17.25V21M9.5 21h5" />
    </svg>
  );
}

function TaskIcon() {
  return <svg viewBox="0 0 24 24"><path d="m12 2 1.8 6.2L20 10l-6.2 1.8L12 18l-1.8-6.2L4 10l6.2-1.8L12 2ZM19 16l.7 2.3L22 19l-2.3.7L19 22l-.7-2.3L16 19l2.3-.7L19 16Z" /></svg>;
}

export function VoiceIslandContent({
  activity,
}: {
  activity: CompanionVoiceActivity;
}) {
  const terminal = activity.phase === 'complete' || activity.phase === 'error';
  const transcript = terminal ? '' : activity.transcript.trim();
  const detail =
    activity.message?.trim() ||
    transcript ||
    voiceActivityPlaceholder(activity.phase, activity.appLanguage);

  return (
    <div
      aria-live="polite"
      className={`voice-island voice-island--${activity.mode} voice-island--${activity.phase} ${
        transcript
          ? 'voice-island--has-transcript'
          : 'voice-island--compact'
      }`}
      role={activity.phase === 'error' ? 'alert' : 'status'}
    >
      <span className="voice-island__signal" aria-hidden="true">
        {activity.mode === 'task' ? (
          <TaskIcon />
        ) : (
          <DictationIcon phase={activity.phase} />
        )}
      </span>
      <span className="voice-island__copy">
        <strong>
          {voiceActivityLabel(
            activity.mode,
            activity.phase,
            activity.appLanguage,
          )}
        </strong>
        <span className={transcript ? '' : 'voice-island__placeholder'}>
          {detail}
          <span className="voice-island__destination">
            {' · '}
            {translate(activity.appLanguage, 'To {destination}', {
              destination: activity.destination.label,
            })}
          </span>
        </span>
      </span>
      {!terminal && (
        <span className="voice-island__meter" aria-hidden="true">
          <i />
          <i />
          <i />
          <i />
          <i />
        </span>
      )}
    </div>
  );
}

export function VoiceIsland() {
  const [activity, setActivity] = useState<CompanionVoiceActivity | null>(null);

  useEffect(
    () => window.troCompanion.onVoiceActivityChange(setActivity),
    [],
  );

  return activity ? <VoiceIslandContent activity={activity} /> : null;
}
