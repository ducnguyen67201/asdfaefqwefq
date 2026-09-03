import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from 'react';

import type {
  CompanionGuidance,
  CompanionInteraction,
  CompanionPetNudge,
  CompanionResponseAction,
  CompanionResponseCard as CompanionResponse,
  CompanionSpeech,
} from '../shared/contracts';

import { CompanionPetNudge as CompanionPetNudgeCard } from './CompanionPetNudge';
import {
  CompanionResponseCard,
  getCompanionCalloutKind,
} from './CompanionResponseCard';
import {
  createGuidanceAudioPlayback,
  type GuidanceAudioPlayback,
  type GuidanceAudioStatus,
} from './guidance-audio-playback';

interface SharedPlayback {
  playback: GuidanceAudioPlayback;
  references: number;
}

const sharedGuidancePlaybacks = new Map<string, SharedPlayback>();

function acquireGuidancePlayback(
  id: string,
  create: () => GuidanceAudioPlayback,
): GuidanceAudioPlayback {
  const existing = sharedGuidancePlaybacks.get(id);
  if (existing) {
    existing.references += 1;
    return existing.playback;
  }
  const playback = create();
  sharedGuidancePlaybacks.set(id, { playback, references: 1 });
  return playback;
}

function releaseGuidancePlayback(
  id: string,
  playback: GuidanceAudioPlayback,
): void {
  const shared = sharedGuidancePlaybacks.get(id);
  if (!shared || shared.playback !== playback) return;
  shared.references -= 1;
  queueMicrotask(() => {
    const latest = sharedGuidancePlaybacks.get(id);
    if (!latest || latest.playback !== playback || latest.references > 0) return;
    sharedGuidancePlaybacks.delete(id);
    playback.dispose();
  });
}

function friendlyError(error: unknown): string {
  return error instanceof Error
    ? error.message
    : 'Tro could not send that response. Try again.';
}

export function guidanceStatusLabel(
  guidance: CompanionGuidance,
  audioStatus: GuidanceAudioStatus | null,
): string {
  const vietnamese = guidance.language === 'vi';
  if (
    guidance.phase === 'paused' ||
    guidance.playback === 'paused' ||
    audioStatus === 'paused'
  ) {
    return vietnamese ? 'Tạm dừng' : 'Paused';
  }
  if (guidance.phase === 'checking') {
    return vietnamese ? 'Đang kiểm tra' : 'Checking';
  }
  if (audioStatus === 'loading') {
    return vietnamese ? 'Đang tải giọng nói' : 'Loading voice';
  }
  if (audioStatus === 'fallback') {
    return vietnamese ? 'Giọng nói dự phòng' : 'Fallback voice';
  }
  if (audioStatus === 'speaking') {
    return vietnamese ? 'Đang nói' : 'Speaking';
  }
  if (guidance.phase === 'waiting') {
    return vietnamese ? 'Đến lượt em' : 'Your turn';
  }
  if (guidance.kind === 'result') {
    return vietnamese ? 'Hoàn tất' : 'Completed';
  }
  if (guidance.kind === 'thinking') {
    return vietnamese ? 'Đang suy nghĩ' : 'Thinking';
  }
  if (guidance.kind === 'action_preview') {
    return vietnamese ? 'Sắp thực hiện' : 'Up next';
  }
  return vietnamese ? 'Đang hướng dẫn' : 'Guiding';
}

export function GuidanceResponseTimer({
  guidance,
}: {
  guidance: CompanionGuidance;
}) {
  const active = Boolean(
    guidance.taskId &&
    guidance.kind === 'guidance' &&
    guidance.phase === 'waiting' &&
    guidance.responseWindowSeconds,
  );
  const duration = guidance.responseWindowSeconds ?? 0;
  const [remaining, setRemaining] = useState(duration);
  useEffect(() => {
    if (!active) return undefined;
    const startedAt = Date.now();
    const timer = window.setInterval(() => {
      const elapsed = Math.floor((Date.now() - startedAt) / 1_000);
      setRemaining(Math.max(0, duration - elapsed));
    }, 250);
    return () => window.clearInterval(timer);
  }, [active, duration, guidance.taskId]);
  if (!active) return null;
  const vietnamese = guidance.language === 'vi';
  return (
    <div className="guidance-callout__timer" aria-hidden="true">
      <span>
        {remaining > 0
          ? `${vietnamese ? 'Em thử ngay nhé' : 'Try it now'} · ${remaining}s`
          : vietnamese ? 'Em cứ làm nhé' : 'Keep going'}
      </span>
      <progress max={duration} value={remaining} />
    </div>
  );
}

export function GuidanceCallout() {
  const [answer, setAnswer] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [guidance, setGuidance] = useState<CompanionGuidance | null>(null);
  const [response, setResponse] = useState<CompanionResponse | null>(null);
  const [petNudge, setPetNudge] = useState<CompanionPetNudge | null>(null);
  const [interaction, setInteraction] =
    useState<CompanionInteraction | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [speech, setSpeech] = useState<CompanionSpeech | null>(null);
  const [audioStatus, setAudioStatus] =
    useState<GuidanceAudioStatus | null>(null);
  const audioPlaybackRef = useRef<GuidanceAudioPlayback | null>(null);
  const presentationIdentityRef = useRef<string | null>(null);

  useEffect(
    () =>
      window.troCompanion.onGuidanceChange((nextGuidance) => {
        setAudioStatus(null);
        setGuidance(nextGuidance);
      }),
    [],
  );
  useEffect(
    () =>
      window.troCompanion.onInteractionChange((nextInteraction) => {
        setInteraction(nextInteraction);
      }),
    [],
  );
  useEffect(
    () => window.troCompanion.onResponseChange(setResponse),
    [],
  );
  useEffect(
    () => window.troCompanion.onPetNudgeChange(setPetNudge),
    [],
  );
  useEffect(
    () =>
      window.troCompanion.onSpeechChange((nextSpeech) => {
        setAudioStatus(null);
        setSpeech(nextSpeech);
      }),
    [],
  );

  const presentationIdentity = interaction
    ? `interaction:${interaction.id}`
    : guidance
      ? `${guidance.kind}:${guidance.target ?? ''}\u0000${guidance.message}`
      : response
        ? `response:${response.cardId}`
        : petNudge
          ? `pet:${petNudge.id}`
          : null;

  useEffect(() => {
    if (presentationIdentityRef.current === presentationIdentity) return;
    presentationIdentityRef.current = presentationIdentity;
    setAnswer('');
    setError(null);
    setIsSending(false);
  }, [presentationIdentity]);

  const interactionSpokenMessage = useMemo(
    () => interaction?.prompt ?? '',
    [interaction],
  );

  useEffect(() => {
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    if (!interactionSpokenMessage) return undefined;

    const timer = window.setTimeout(() => {
      if (
        !('speechSynthesis' in window) ||
        typeof SpeechSynthesisUtterance === 'undefined'
      ) {
        return;
      }
      const utterance = new SpeechSynthesisUtterance(interactionSpokenMessage);
      utterance.lang = /[À-ỹ]/u.test(interactionSpokenMessage) ? 'vi-VN' : 'en-US';
      utterance.rate = 0.92;
      window.speechSynthesis.speak(utterance);
    }, 2_200);

    return () => {
      window.clearTimeout(timer);
      if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    };
  }, [interactionSpokenMessage]);

  useEffect(() => {
    audioPlaybackRef.current = null;
    if (!speech) return undefined;

    const playback = acquireGuidancePlayback(speech.id, () =>
      createGuidanceAudioPlayback({
        message: speech.text,
        onStatus: setAudioStatus,
        paused: false,
        report: (report) => {
          void window.troCompanion
            .reportSpeechPlayback(report)
            .catch(() => undefined);
        },
        speech,
      }),
    );
    audioPlaybackRef.current = playback;
    return () => {
      if (audioPlaybackRef.current === playback) {
        audioPlaybackRef.current = null;
      }
      releaseGuidancePlayback(speech.id, playback);
    };
  }, [speech]);

  useEffect(() => {
    audioPlaybackRef.current?.setPaused(guidance?.playback === 'paused');
  }, [guidance?.playback]);

  const submitAnswer = useCallback(
    async (text: string) => {
      if (!interaction || isSending) return;
      const normalized = text.trim();
      if (!normalized) return;

      setError(null);
      setIsSending(true);
      try {
        await window.troCompanion.respondToInteraction({
          interactionId: interaction.id,
          kind: 'answer',
          taskId: interaction.taskId,
          text: normalized,
        });
      } catch (nextError) {
        setError(friendlyError(nextError));
        setIsSending(false);
      }
    },
    [interaction, isSending],
  );

  const performResponseAction = useCallback(
    async (action: CompanionResponseAction) => {
      if (!response || isSending) return;

      setError(null);
      setIsSending(true);
      try {
        await window.troCompanion.performResponseAction({
          action,
          cardId: response.cardId,
          taskId: response.taskId,
        });
      } catch (nextError) {
        setError(friendlyError(nextError));
      } finally {
        setIsSending(false);
      }
    },
    [isSending, response],
  );

  useEffect(() => {
    if (!interaction) return undefined;
    const handleKeyDown = (event: KeyboardEvent): void => {
      const target = event.target;
      const isTyping =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement;
      if (
        isTyping ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        !/^[1-9]$/.test(event.key)
      ) {
        return;
      }
      const choice = interaction.choices?.[Number(event.key) - 1];
      if (!choice) return;
      event.preventDefault();
      void submitAnswer(choice.label);
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [interaction, submitAnswer]);

  const handleAnswerSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    void submitAnswer(answer);
  };

  const calloutKind = getCompanionCalloutKind({
    hasGuidance: guidance !== null,
    hasInteraction: interaction !== null,
    hasPetNudge: petNudge !== null,
    hasResponse: response !== null,
  });
  if (!calloutKind) return null;

  return (
    <>
      {calloutKind === 'interaction' && interaction ? (
        <aside
          aria-labelledby="companion-interaction-title"
          aria-live="polite"
          className={`guidance-callout guidance-callout--interactive guidance-callout--${interaction.side}`}
          role="dialog"
        >
          <div className="guidance-callout__header">
            <span className="guidance-callout__avatar" aria-hidden="true">
              T
            </span>
            <span className="guidance-callout__name">Tro</span>
            <span className="guidance-callout__status">
              Question
            </span>
          </div>
          <p className="guidance-callout__eyebrow">
            I need one detail
          </p>
          <h2 id="companion-interaction-title">{interaction.prompt}</h2>

          <>
              {interaction.choices?.length ? (
                <div className="guidance-callout__choices">
                  {interaction.choices.map((choice, index) => (
                    <button
                      aria-keyshortcuts={String(index + 1)}
                      disabled={isSending}
                      key={choice.id}
                      onClick={() => void submitAnswer(choice.label)}
                      type="button"
                    >
                      <kbd>{index + 1}</kbd>
                      {choice.label}
                    </button>
                  ))}
                </div>
              ) : null}
              <form
                className="guidance-callout__answer"
                onSubmit={handleAnswerSubmit}
              >
                <input
                  aria-label="Your answer"
                  disabled={isSending}
                  onChange={(event) => setAnswer(event.target.value)}
                  onKeyDown={(event) => {
                    if (
                      event.key === 'Enter' &&
                      (event.metaKey || event.ctrlKey)
                    ) {
                      event.preventDefault();
                      void submitAnswer(answer);
                    }
                  }}
                  placeholder="Type an answer…"
                  value={answer}
                />
                <button disabled={isSending || !answer.trim()} type="submit">
                  {isSending ? 'Sending…' : 'Send'}
                </button>
              </form>
              <p className="guidance-callout__hint">
                Or use your voice shortcut to answer · <kbd>⌘/Ctrl ↵</kbd> send
              </p>
          </>
          {error ? <p className="guidance-callout__error">{error}</p> : null}
        </aside>
      ) : calloutKind === 'guidance' && guidance ? (
        <aside
          aria-label={guidance.taskId
            ? guidance.language === 'vi' ? 'Bước hướng dẫn của Tro' : 'Tro coaching step'
            : undefined}
          aria-live="polite"
          className={`guidance-callout guidance-callout--${guidance.kind} guidance-callout--${guidance.side}${guidance.taskId ? ' guidance-callout--coach' : ''}`}
          role={guidance.taskId ? 'region' : 'status'}
        >
          <div className="guidance-callout__header" aria-hidden="true">
            <span className="guidance-callout__avatar">T</span>
            <span className="guidance-callout__name">Tro</span>
            <span className="guidance-callout__status">
              {guidanceStatusLabel(guidance, audioStatus)}
            </span>
          </div>
          <p>{guidance.message}</p>
          {guidance.kind === 'guidance' ? (
            <>
              <span className="guidance-callout__target">
                {guidance.target ?? 'Look here'}
              </span>
              {guidance.taskId ? (
                <GuidanceResponseTimer
                  guidance={guidance}
                  key={`${guidance.taskId}:${guidance.phase}:${guidance.message}`}
                />
              ) : (
                <div className="guidance-callout__controls">
                  {guidance.shortcuts?.back.available ? (
                    <span><kbd>{guidance.shortcuts.back.label}</kbd> Back</span>
                  ) : null}
                  {guidance.shortcuts?.pause.available ? (
                    <span>
                      <kbd>{guidance.shortcuts.pause.label}</kbd>{' '}
                      {guidance.playback === 'paused' ? 'Resume' : 'Pause'}
                    </span>
                  ) : null}
                  {guidance.shortcuts?.next.available ? (
                    <span><kbd>{guidance.shortcuts.next.label}</kbd> Next</span>
                  ) : null}
                  <span className="guidance-callout__ask">⌘⌃ Ask</span>
                </div>
              )}
              {error ? <p className="guidance-callout__error">{error}</p> : null}
            </>
          ) : null}
        </aside>
      ) : calloutKind === 'response' && response ? (
        <CompanionResponseCard
          audioStatus={audioStatus}
          error={error}
          isBusy={isSending}
          onAction={(action) => void performResponseAction(action)}
          response={response}
        />
      ) : calloutKind === 'pet_nudge' && petNudge ? (
        <CompanionPetNudgeCard nudge={petNudge} />
      ) : null}
    </>
  );
}
