import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  BeginDictationRequestSchema,
  CommitDictationRequestSchema,
  CompanionVoiceActivitySchema,
  DictationCommitResultSchema,
  RecordVoiceTranscriptRequestSchema,
  VoiceModeToggleEventSchema,
  VoiceShortcutEventSchema,
} from './contracts';

describe('voice mode contracts', () => {
  it('accepts content-free shortcut edges and rejects mode payloads', () => {
    expect(
      VoiceShortcutEventSchema.safeParse({
        action: 'pressed',
        source: 'global',
      }).success,
    ).toBe(true);
    expect(
      VoiceShortcutEventSchema.safeParse({
        action: 'pressed',
        mode: 'task',
        source: 'global',
      }).success,
    ).toBe(false);
    expect(
      VoiceShortcutEventSchema.safeParse({
        action: 'pressed',
        extra: true,
        source: 'global',
      }).success,
    ).toBe(false);
  });

  it('accepts only a content-free global voice mode toggle request', () => {
    expect(
      VoiceModeToggleEventSchema.safeParse({ source: 'global' }).success,
    ).toBe(true);
    expect(
      VoiceModeToggleEventSchema.safeParse({
        mode: 'task',
        source: 'global',
      }).success,
    ).toBe(false);
    expect(
      VoiceModeToggleEventSchema.safeParse({ source: 'local' }).success,
    ).toBe(false);
  });

  it('bounds strict dictation mutation requests', () => {
    const turnId = randomUUID();
    expect(BeginDictationRequestSchema.parse({ turnId })).toEqual({ turnId });
    expect(
      BeginDictationRequestSchema.safeParse({ extra: true, turnId }).success,
    ).toBe(false);
    expect(
      CommitDictationRequestSchema.safeParse({ text: 'x'.repeat(8_000), turnId })
        .success,
    ).toBe(true);
    expect(
      CommitDictationRequestSchema.safeParse({ text: 'x'.repeat(8_001), turnId })
        .success,
    ).toBe(false);
    expect(
      CommitDictationRequestSchema.safeParse({ text: 'hello', turnId: 'bad' })
        .success,
    ).toBe(false);
    expect(
      CommitDictationRequestSchema.parse({ text: '  hello!  ', turnId }).text,
    ).toBe('hello!');
  });

  it('allows only content-free analytics dimensions and known results', () => {
    expect(
      RecordVoiceTranscriptRequestSchema.parse({
        characterCount: 8_000,
        destination: 'application',
        disposition: 'delivery_unverified',
        mode: 'dictation',
      }),
    ).toMatchObject({ characterCount: 8_000, mode: 'dictation' });
    expect(
      RecordVoiceTranscriptRequestSchema.safeParse({
        characterCount: 5,
        destination: 'application',
        disposition: 'retried',
        mode: 'dictation',
        text: 'secret',
      }).success,
    ).toBe(false);
    expect(
      DictationCommitResultSchema.safeParse({
        disposition: 'inserted',
        reason: 'maybe',
        summary: 'Done.',
      }).success,
    ).toBe(false);
  });

  it('requires redundant bounded island presentation fields', () => {
    expect(
      CompanionVoiceActivitySchema.safeParse({
        destination: { kind: 'task', label: 'Tro task' },
        mode: 'task',
        phase: 'listening',
        transcript: '',
      }).success,
    ).toBe(true);
    expect(
      CompanionVoiceActivitySchema.safeParse({
        destination: { kind: 'task', label: 'Tro task' },
        message: 'x'.repeat(241),
        mode: 'task',
        phase: 'error',
        transcript: '',
      }).success,
    ).toBe(false);
  });
});
