import { useCallback, useEffect, useRef, useState } from 'react';

import type {
  VoiceDiagnostic,
  VoiceMode,
  VoiceShortcutEvent,
} from '../shared/contracts';

import {
  detectPushToTalkPlatform,
  INITIAL_VOICE_SHORTCUT_ARBITER_STATE,
  isVoiceShortcutModifierCode,
  pushToTalkShortcutName,
  transitionVoiceShortcutArbiter,
  type PushToTalkPlatform,
  type VoiceShortcutArbiterState,
} from './push-to-talk';
import { openVoiceCapture, type VoiceCapturePipeline } from './voice-capture';
import {
  encodePcm16Wav,
  normalizeVoiceSamples,
  OrderedTranscriptAssembler,
  SegmentUploadQueue,
  VoiceSegmenter,
  type FinalizedVoiceSegment,
} from './voice-segmentation';

export type VoiceInputStatus =
  | 'idle'
  | 'listening'
  | 'processing'
  | 'committing'
  | 'requesting_permission'
  | 'unavailable';

export type VoiceConnectionStep = VoiceDiagnostic['step'];
export type VoiceActivationMode = 'global_hold' | 'local_hold';

export interface VoiceTurnContext {
  activation: VoiceActivationMode;
  mode: VoiceMode;
  turnId: string;
}

export interface VoiceAttemptDecision {
  accepted: boolean;
  destination: {
    kind: 'application' | 'tro_composer' | 'task';
    label: string;
  };
}

export type VoiceTurnEndReason =
  | 'cancelled'
  | 'completed'
  | 'failed'
  | 'no_speech'
  | 'partial_failure'
  | 'preflight_rejected';

export const VOICE_TASK_CONFIRMATION_MS = 1_000;

export interface UsePushToTalkOptions {
  disabled?: boolean;
  enabled?: boolean;
  onAttemptStart(context: VoiceTurnContext): Promise<VoiceAttemptDecision>;
  onError(message: string): void;
  onTranscriptChange(context: VoiceTurnContext, transcript: string): void;
  onTranscriptReady(
    context: VoiceTurnContext,
    transcript: string,
  ): Promise<void>;
  onTurnEnd(context: VoiceTurnContext, reason: VoiceTurnEndReason): void;
  selectedMode: VoiceMode;
}

interface PushToTalkState {
  cancel(): void;
  isHolding: boolean;
  mode: VoiceMode | null;
  platform: PushToTalkPlatform;
  status: VoiceInputStatus;
}

interface ActiveVoiceTurn {
  abortController: AbortController;
  assembler: OrderedTranscriptAssembler;
  attempt: number;
  cancelled: boolean;
  capture: VoiceCapturePipeline | null;
  completionTimer: ReturnType<typeof setTimeout> | null;
  context: VoiceTurnContext;
  endNotified: boolean;
  expectedSegmentCount: number | null;
  finalizing: boolean;
  limitReached: boolean;
  queue: SegmentUploadQueue<FinalizedVoiceSegment, void>;
  released: boolean;
  releasedAt: number | null;
  segmentCount: number;
  segmenter: VoiceSegmenter;
}

interface PushToTalkAttemptReadiness {
  disabled: boolean;
  enabled: boolean;
  hasActiveTurn: boolean;
  isChordHeld: boolean;
  platform: PushToTalkPlatform;
}

interface VoiceShortcutEventHandlers {
  beginListening(mode: VoiceMode): unknown;
  finishListening(): void;
  isListening: boolean;
  selectedMode: VoiceMode;
}

interface LocalVoiceReleaseState {
  activationMode: VoiceActivationMode | null;
  isListening: boolean;
  isLocalChordHeld: boolean;
}

export function beginPushToTalkAttemptIfValid(
  {
    disabled,
    enabled,
    hasActiveTurn,
    isChordHeld,
    platform,
  }: PushToTalkAttemptReadiness,
  onAttemptStart: () => void,
): boolean {
  if (
    disabled ||
    !enabled ||
    platform === 'unsupported' ||
    isChordHeld ||
    hasActiveTurn
  ) {
    return false;
  }
  onAttemptStart();
  return true;
}

export function handleVoiceShortcutEvent(
  event: VoiceShortcutEvent,
  {
    beginListening,
    finishListening,
    isListening,
    selectedMode,
  }: VoiceShortcutEventHandlers,
): void {
  if (event.action === 'pressed') {
    if (!isListening) beginListening(selectedMode);
    return;
  }
  if (event.action === 'released' && isListening) finishListening();
}

export function shouldFinishVoiceOnLocalRelease({
  activationMode,
  isListening,
  isLocalChordHeld,
}: LocalVoiceReleaseState): boolean {
  return activationMode === 'local_hold' && isListening && !isLocalChordHeld;
}

export function shouldMuteSystemAudioForVoice(
  enabled: boolean,
  isHolding: boolean,
): boolean {
  return enabled && isHolding;
}

function getPushToTalkPlatform(): PushToTalkPlatform {
  if (typeof navigator === 'undefined') return 'unsupported';
  return detectPushToTalkPlatform(navigator.platform, navigator.userAgent);
}

export function voiceConnectionErrorMessage(error: unknown): string {
  if (error instanceof DOMException && error.name === 'NotAllowedError') {
    return 'Microphone access is required for voice input.';
  }
  if (error instanceof Error && error.message) return error.message;
  return 'Tro could not transcribe voice input.';
}

export function createVoiceConnectionDiagnostic(
  step: VoiceConnectionStep,
  error: unknown,
): VoiceDiagnostic {
  return {
    error:
      error instanceof Error
        ? { message: error.message, name: error.name }
        : { message: String(error) },
    step,
  };
}

export function logVoiceConnectionFailure(
  step: VoiceConnectionStep,
  error: unknown,
  logger: Pick<Console, 'error'> = console,
): void {
  logger.error(
    '[voice] GPT Transcribe transcription failed.',
    createVoiceConnectionDiagnostic(step, error),
  );
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 32_768) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 32_768));
  }
  return btoa(binary);
}

function voiceTurnDiagnostic(
  event: string,
  properties: Record<string, string | number | boolean> = {},
): void {
  const details =
    Object.keys(properties).length > 0 ? ` ${JSON.stringify(properties)}` : '';
  console.info(`[voice:renderer] turn.${event}${details}`);
}

export function usePushToTalk({
  disabled = false,
  enabled = true,
  onAttemptStart,
  onError,
  onTranscriptChange,
  onTranscriptReady,
  onTurnEnd,
  selectedMode,
}: UsePushToTalkOptions): PushToTalkState {
  const [platform] = useState<PushToTalkPlatform>(getPushToTalkPlatform);
  const [status, setStatus] = useState<VoiceInputStatus>(() =>
    enabled && platform !== 'unsupported' ? 'idle' : 'unavailable',
  );
  const [isHolding, setIsHolding] = useState(false);
  const [mode, setMode] = useState<VoiceMode | null>(null);
  const activeTurnRef = useRef<ActiveVoiceTurn | null>(null);
  const activationModeRef = useRef<VoiceActivationMode | null>(null);
  const attemptRef = useRef(0);
  const chordHeldRef = useRef(false);
  const disabledRef = useRef(disabled);
  const enabledRef = useRef(enabled);
  const localArbiterRef = useRef<VoiceShortcutArbiterState>(
    INITIAL_VOICE_SHORTCUT_ARBITER_STATE,
  );
  const localSettleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pressedCodesRef = useRef(new Set<string>());
  const onAttemptStartRef = useRef(onAttemptStart);
  const onErrorRef = useRef(onError);
  const onTranscriptChangeRef = useRef(onTranscriptChange);
  const onTranscriptReadyRef = useRef(onTranscriptReady);
  const onTurnEndRef = useRef(onTurnEnd);
  const selectedModeRef = useRef(selectedMode);
  const finishListeningRef = useRef<(mode?: VoiceMode) => void>(
    () => undefined,
  );

  useEffect(() => {
    disabledRef.current = disabled;
    enabledRef.current = enabled;
    onAttemptStartRef.current = onAttemptStart;
    onErrorRef.current = onError;
    onTranscriptChangeRef.current = onTranscriptChange;
    onTranscriptReadyRef.current = onTranscriptReady;
    onTurnEndRef.current = onTurnEnd;
    selectedModeRef.current = selectedMode;
  }, [
    disabled,
    enabled,
    onAttemptStart,
    onError,
    onTranscriptChange,
    onTranscriptReady,
    onTurnEnd,
    selectedMode,
  ]);

  const notifyTurnEnd = useCallback(
    (turn: ActiveVoiceTurn, reason: VoiceTurnEndReason): void => {
      if (turn.endNotified) return;
      turn.endNotified = true;
      onTurnEndRef.current(turn.context, reason);
    },
    [],
  );

  const closeTurn = useCallback(async (turn: ActiveVoiceTurn): Promise<void> => {
    turn.abortController.abort();
    const capture = turn.capture;
    turn.capture = null;
    await capture?.stop().catch(() => undefined);
  }, []);

  const resetTurnState = useCallback(
    (turn: ActiveVoiceTurn): void => {
      if (turn.completionTimer) clearTimeout(turn.completionTimer);
      turn.completionTimer = null;
      if (activeTurnRef.current === turn) activeTurnRef.current = null;
      activationModeRef.current = null;
      chordHeldRef.current = false;
      setIsHolding(false);
      setMode(null);
      setStatus(
        enabledRef.current &&
          !disabledRef.current &&
          platform !== 'unsupported'
          ? 'idle'
          : 'unavailable',
      );
    },
    [platform],
  );

  const finishTerminalTurn = useCallback(
    (turn: ActiveVoiceTurn, reason: VoiceTurnEndReason): void => {
      resetTurnState(turn);
      void closeTurn(turn);
      notifyTurnEnd(turn, reason);
    },
    [closeTurn, notifyTurnEnd, resetTurnState],
  );

  const commitTranscript = useCallback(
    async (
      turn: ActiveVoiceTurn,
      transcript: string,
      releaseToFinalMs: number,
    ): Promise<void> => {
      if (activeTurnRef.current !== turn || turn.cancelled) return;
      setStatus('committing');
      try {
        await onTranscriptReadyRef.current(turn.context, transcript);
        if (activeTurnRef.current !== turn || turn.cancelled) return;
        voiceTurnDiagnostic('completed', {
          activation: turn.context.activation,
          attempt: turn.attempt,
          characters: transcript.length,
          disposition: 'completed',
          mode: turn.context.mode,
          releaseToFinalMs,
          segmentCount: turn.expectedSegmentCount ?? 0,
        });
        finishTerminalTurn(turn, 'completed');
      } catch (error) {
        if (activeTurnRef.current !== turn || turn.cancelled) return;
        voiceTurnDiagnostic('completed', {
          activation: turn.context.activation,
          attempt: turn.attempt,
          disposition: 'delivery_failed',
          mode: turn.context.mode,
          releaseToFinalMs,
          segmentCount: turn.expectedSegmentCount ?? 0,
        });
        finishTerminalTurn(turn, 'failed');
        onErrorRef.current(
          error instanceof Error && error.message
            ? error.message
            : 'Tro could not finish voice input.',
        );
      }
    },
    [finishTerminalTurn],
  );

  const maybeFinishTurn = useCallback(
    (turn: ActiveVoiceTurn): void => {
      if (
        activeTurnRef.current !== turn ||
        turn.cancelled ||
        !turn.released ||
        turn.expectedSegmentCount === null ||
        turn.assembler.outcomes.size < turn.expectedSegmentCount ||
        turn.finalizing
      ) {
        return;
      }

      turn.finalizing = true;
      const transcript = turn.assembler.completeTranscript(
        turn.expectedSegmentCount,
      );
      const provisional = turn.assembler.provisionalTranscript();
      const releaseToFinalMs = Math.max(
        0,
        Date.now() - (turn.releasedAt ?? Date.now()),
      );
      if (turn.expectedSegmentCount === 0) {
        finishTerminalTurn(turn, 'no_speech');
        voiceTurnDiagnostic('completed', {
          activation: turn.context.activation,
          attempt: turn.attempt,
          disposition: 'no_speech',
          mode: turn.context.mode,
          releaseToFinalMs,
          segmentCount: turn.expectedSegmentCount,
        });
        onErrorRef.current(
          `No speech was detected. Hold ${pushToTalkShortcutName(platform)} and try again.`,
        );
        return;
      }
      if (transcript === null) {
        if (provisional) {
          onTranscriptChangeRef.current(turn.context, provisional);
        }
        finishTerminalTurn(turn, 'partial_failure');
        voiceTurnDiagnostic('completed', {
          activation: turn.context.activation,
          attempt: turn.attempt,
          disposition: 'partial_failure',
          mode: turn.context.mode,
          releaseToFinalMs,
          segmentCount: turn.expectedSegmentCount,
        });
        onErrorRef.current(
          'A part of this recording could not be transcribed. Review it or record again.',
        );
        return;
      }
      if (!transcript.trim()) {
        finishTerminalTurn(turn, 'no_speech');
        voiceTurnDiagnostic('completed', {
          activation: turn.context.activation,
          attempt: turn.attempt,
          disposition: 'no_speech',
          mode: turn.context.mode,
          releaseToFinalMs,
          segmentCount: turn.expectedSegmentCount,
        });
        onErrorRef.current(
          `No speech was detected. Hold ${pushToTalkShortcutName(platform)} and try again.`,
        );
        return;
      }

      const confirmationMs =
        turn.context.mode === 'task' ? VOICE_TASK_CONFIRMATION_MS : 0;
      voiceTurnDiagnostic('transcript-ready', {
        activation: turn.context.activation,
        attempt: turn.attempt,
        characters: transcript.length,
        confirmationMs,
        mode: turn.context.mode,
        releaseToFinalMs,
        segmentCount: turn.expectedSegmentCount,
      });
      onTranscriptChangeRef.current(turn.context, transcript);
      if (confirmationMs === 0) {
        void commitTranscript(turn, transcript, releaseToFinalMs);
        return;
      }
      turn.completionTimer = setTimeout(() => {
        void commitTranscript(turn, transcript, releaseToFinalMs);
      }, confirmationMs);
    },
    [commitTranscript, finishTerminalTurn, platform],
  );

  const dispatchSegment = useCallback(
    (turn: ActiveVoiceTurn, segment: FinalizedVoiceSegment): void => {
      turn.segmentCount += 1;
      voiceTurnDiagnostic('segment-finalized', {
        boundary: segment.boundary,
        durationMs: Math.round(segment.durationMs),
        mode: turn.context.mode,
        overlap: segment.overlapWithPrevious,
        sequence: segment.sequence,
      });
      void turn.queue.enqueue(segment).catch(() => undefined);
    },
    [],
  );

  const cancel = useCallback(() => {
    attemptRef.current += 1;
    const turn = activeTurnRef.current;
    if (turn) {
      turn.cancelled = true;
      voiceTurnDiagnostic('completed', {
        activation: turn.context.activation,
        attempt: turn.attempt,
        disposition: 'cancelled',
        mode: turn.context.mode,
        segmentCount: turn.segmentCount,
      });
      turn.queue.cancelPending();
      finishTerminalTurn(turn, 'cancelled');
      return;
    }
    activationModeRef.current = null;
    chordHeldRef.current = false;
    setIsHolding(false);
    setMode(null);
    setStatus(
      enabledRef.current &&
        !disabledRef.current &&
        platform !== 'unsupported'
        ? 'idle'
        : 'unavailable',
    );
  }, [finishTerminalTurn, platform]);

  const beginListening = useCallback(
    async (
      activation: VoiceActivationMode = 'local_hold',
      voiceMode: VoiceMode = 'dictation',
    ) => {
      if (
        !beginPushToTalkAttemptIfValid(
          {
            disabled: disabledRef.current,
            enabled: enabledRef.current,
            hasActiveTurn: activeTurnRef.current !== null,
            isChordHeld: chordHeldRef.current,
            platform,
          },
          () => undefined,
        )
      ) {
        return;
      }

      const attempt = attemptRef.current + 1;
      attemptRef.current = attempt;
      const abortController = new AbortController();
      const assembler = new OrderedTranscriptAssembler();
      const segmenter = new VoiceSegmenter();
      const context: VoiceTurnContext = {
        activation,
        mode: voiceMode,
        turnId: crypto.randomUUID(),
      };
      const turn = {} as ActiveVoiceTurn;
      const queue = new SegmentUploadQueue<FinalizedVoiceSegment, void>(
        async (segment) => {
          let encoded;
          try {
            const normalized = normalizeVoiceSamples(segment.samples);
            encoded = encodePcm16Wav(normalized.samples, segment.sampleRate);
            voiceTurnDiagnostic('segment-normalized', {
              gain: Number(normalized.gain.toFixed(2)),
              inputDbfs: Number(
                (
                  20 * Math.log10(Math.max(normalized.inputRms, 0.000_001))
                ).toFixed(1),
              ),
              mode: turn.context.mode,
              sequence: segment.sequence,
            });
          } catch (error) {
            if (activeTurnRef.current === turn && !turn.cancelled) {
              assembler.addFailure(
                segment.sequence,
                error instanceof Error ? error : new Error(String(error)),
              );
              logVoiceConnectionFailure('audio_encode', error);
              void window.tro
                .reportVoiceDiagnostic(
                  createVoiceConnectionDiagnostic('audio_encode', error),
                )
                .catch(() => undefined);
              if (turn.released) maybeFinishTurn(turn);
            }
            return;
          }

          const segmentStartedAt = Date.now();
          const requestId = crypto.randomUUID();
          voiceTurnDiagnostic('segment-dispatched', {
            byteCount: encoded.bytes.byteLength,
            durationMs: Math.round(encoded.durationMs),
            mode: turn.context.mode,
            requestId,
            sequence: segment.sequence,
          });
          try {
            const result = await window.tro.transcribeVoiceSegment({
              audioBase64: bytesToBase64(encoded.bytes),
              durationMs: Math.round(encoded.durationMs),
              requestId,
              sequence: segment.sequence,
              utteranceId: turn.context.turnId,
            });
            if (activeTurnRef.current !== turn || turn.cancelled) return;
            voiceTurnDiagnostic('segment-completed', {
              billedSeconds: result.billedSeconds,
              latencyMs: Date.now() - segmentStartedAt,
              mode: turn.context.mode,
              requestId,
              sequence: segment.sequence,
            });
            assembler.addSuccess({
              overlapWithPrevious: segment.overlapWithPrevious,
              sequence: result.sequence,
              text: result.text,
            });
            const provisional = assembler.provisionalTranscript();
            if (provisional) {
              onTranscriptChangeRef.current(turn.context, provisional);
            }
            if (turn.released) maybeFinishTurn(turn);
          } catch (error) {
            if (activeTurnRef.current !== turn || turn.cancelled) return;
            voiceTurnDiagnostic('segment-uncertain', {
              latencyMs: Date.now() - segmentStartedAt,
              mode: turn.context.mode,
              requestId,
              sequence: segment.sequence,
            });
            assembler.addFailure(
              segment.sequence,
              error instanceof Error ? error : new Error(String(error)),
            );
            logVoiceConnectionFailure('segment_upload', error);
            void window.tro
              .reportVoiceDiagnostic(
                createVoiceConnectionDiagnostic('segment_upload', error),
              )
              .catch(() => undefined);
            if (turn.released) maybeFinishTurn(turn);
          }
        },
      );
      Object.assign(turn, {
        abortController,
        assembler,
        attempt,
        cancelled: false,
        capture: null,
        completionTimer: null,
        context,
        endNotified: false,
        expectedSegmentCount: null,
        finalizing: false,
        limitReached: false,
        queue,
        released: false,
        releasedAt: null,
        segmentCount: 0,
        segmenter,
      } satisfies ActiveVoiceTurn);
      activeTurnRef.current = turn;
      activationModeRef.current = activation;
      chordHeldRef.current = true;
      setIsHolding(true);
      setMode(voiceMode);
      setStatus('requesting_permission');
      voiceTurnDiagnostic('started', {
        activation,
        attempt,
        mode: voiceMode,
        platform,
      });

      try {
        const decision = await onAttemptStartRef.current(context);
        if (activeTurnRef.current !== turn || turn.cancelled || turn.released) {
          if (!turn.endNotified) notifyTurnEnd(turn, 'cancelled');
          return;
        }
        if (!decision.accepted) {
          finishTerminalTurn(turn, 'preflight_rejected');
          return;
        }

        const capture = await openVoiceCapture({
          onFrame: (frame) => {
            if (
              activeTurnRef.current !== turn ||
              turn.cancelled ||
              turn.limitReached ||
              turn.released
            ) {
              return;
            }
            const update = segmenter.push(frame);
            for (const segment of update.segments) {
              dispatchSegment(turn, segment);
            }
            if (update.limitReached && !turn.limitReached) {
              turn.limitReached = true;
              void turn.capture?.stop().catch(() => undefined);
              onErrorRef.current(
                'Voice input reached 60 seconds. Release the shortcut to finish.',
              );
            }
          },
          signal: abortController.signal,
        });
        if (activeTurnRef.current !== turn || turn.cancelled || turn.released) {
          await capture.stop();
          return;
        }
        turn.capture = capture;
        setStatus('listening');
        voiceTurnDiagnostic('listening', {
          activation,
          attempt,
          mode: voiceMode,
        });
      } catch (error) {
        if (turn.cancelled || abortController.signal.aborted) return;
        finishTerminalTurn(turn, 'failed');
        logVoiceConnectionFailure('microphone', error);
        void window.tro
          .reportVoiceDiagnostic(
            createVoiceConnectionDiagnostic('microphone', error),
          )
          .catch(() => undefined);
        onErrorRef.current(voiceConnectionErrorMessage(error));
      }
    },
    [
      dispatchSegment,
      finishTerminalTurn,
      maybeFinishTurn,
      notifyTurnEnd,
      platform,
    ],
  );

  const finishListening = useCallback(
    (releasedMode?: VoiceMode): void => {
      const turn = activeTurnRef.current;
      if (!turn || turn.cancelled || turn.released) return;
      if (releasedMode && releasedMode !== turn.context.mode) return;
      if (!turn.capture) {
        turn.cancelled = true;
        turn.queue.cancelPending();
        finishTerminalTurn(turn, 'cancelled');
        return;
      }
      turn.released = true;
      turn.releasedAt = Date.now();
      chordHeldRef.current = false;
      setIsHolding(false);
      setStatus('processing');
      const capture = turn.capture;
      turn.capture = null;
      void capture.stop().catch(() => undefined);
      turn.abortController.abort();
      const finalUpdate = turn.segmenter.finish();
      for (const segment of finalUpdate.segments) {
        dispatchSegment(turn, segment);
      }
      turn.expectedSegmentCount = turn.segmentCount;
      voiceTurnDiagnostic('released', {
        activation: turn.context.activation,
        attempt: turn.attempt,
        mode: turn.context.mode,
        segmentCount: turn.expectedSegmentCount,
      });
      maybeFinishTurn(turn);
    },
    [dispatchSegment, finishTerminalTurn, maybeFinishTurn],
  );

  useEffect(() => {
    finishListeningRef.current = finishListening;
  }, [finishListening]);

  useEffect(() => {
    if (!enabled || disabled || platform === 'unsupported') {
      cancel();
      return;
    }
    if (activeTurnRef.current) return;
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled && !activeTurnRef.current) setStatus('idle');
    });
    return () => {
      cancelled = true;
    };
  }, [cancel, disabled, enabled, platform]);

  useEffect(() => {
    const clearLocalSettleTimer = (): void => {
      if (localSettleTimerRef.current) {
        clearTimeout(localSettleTimerRef.current);
        localSettleTimerRef.current = null;
      }
    };
    const processLocalShortcut = (nowMs: number): void => {
      clearLocalSettleTimer();
      const transition = transitionVoiceShortcutArbiter(
        localArbiterRef.current,
        platform,
        pressedCodesRef.current,
        nowMs,
        selectedModeRef.current,
      );
      localArbiterRef.current = transition.state;
      for (const shortcutEvent of transition.events) {
        if (shortcutEvent.action === 'pressed') {
          void beginListening('local_hold', shortcutEvent.mode);
        } else {
          finishListeningRef.current(shortcutEvent.mode);
        }
      }
      if (
        transition.state.phase === 'settling' &&
        transition.state.deadlineMs !== null
      ) {
        const delay = Math.max(0, transition.state.deadlineMs - performance.now());
        localSettleTimerRef.current = setTimeout(
          () => processLocalShortcut(transition.state.deadlineMs ?? performance.now()),
          delay,
        );
      }
    };
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        if (activeTurnRef.current) {
          event.preventDefault();
          cancel();
          return;
        }
        if (localArbiterRef.current.phase === 'settling') {
          event.preventDefault();
          clearLocalSettleTimer();
          localArbiterRef.current = {
            deadlineMs: null,
            phase: 'await_all_released',
          };
        }
        return;
      }
      if (event.repeat || !isVoiceShortcutModifierCode(event.code)) return;
      pressedCodesRef.current.add(event.code);
      processLocalShortcut(performance.now());
      if (localArbiterRef.current.phase !== 'idle') event.preventDefault();
    };
    const handleKeyUp = (event: KeyboardEvent): void => {
      if (!isVoiceShortcutModifierCode(event.code)) return;
      pressedCodesRef.current.delete(event.code);
      processLocalShortcut(performance.now());
    };
    const handleBlur = (): void => {
      clearLocalSettleTimer();
      if (activeTurnRef.current) cancel();
      pressedCodesRef.current.clear();
      localArbiterRef.current = INITIAL_VOICE_SHORTCUT_ARBITER_STATE;
    };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', handleBlur);
    return () => {
      clearLocalSettleTimer();
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', handleBlur);
    };
  }, [beginListening, cancel, platform]);

  useEffect(
    () =>
      window.tro.onVoiceShortcut((event) => {
        handleVoiceShortcutEvent(event, {
          beginListening: (eventMode) =>
            beginListening('global_hold', eventMode),
          finishListening: () => finishListeningRef.current(),
          isListening: Boolean(activeTurnRef.current),
          selectedMode: selectedModeRef.current,
        });
      }),
    [beginListening],
  );

  useEffect(
    () => () => {
      const turn = activeTurnRef.current;
      if (!turn) return;
      turn.cancelled = true;
      turn.queue.cancelPending();
      turn.abortController.abort();
      void turn.capture?.stop().catch(() => undefined);
      notifyTurnEnd(turn, 'cancelled');
      activeTurnRef.current = null;
    },
    [notifyTurnEnd],
  );

  return { cancel, isHolding, mode, platform, status };
}
