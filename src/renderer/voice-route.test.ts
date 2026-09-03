import { describe, expect, it } from 'vitest';

import {
  shouldRetainVoiceTerminalActivity,
  voiceTaskScreenContext,
  voiceTurnRoute,
} from './voice-route';

describe('voiceTurnRoute', () => {
  it('routes only explicit Task mode to the task runtime', () => {
    expect(
      voiceTurnRoute({ activation: 'local_hold', mode: 'task' }),
    ).toBe('task');
    expect(
      voiceTurnRoute({ activation: 'global_hold', mode: 'task' }),
    ).toBe('task');
  });

  it('requires initial screen context for every voice Task transcript', () => {
    expect(voiceTaskScreenContext({ mode: 'task' })).toBe('required');
    expect(voiceTaskScreenContext({ mode: 'dictation' })).toBe('auto');
  });

  it('routes Dictation by activation without inspecting transcript text', () => {
    expect(
      voiceTurnRoute({ activation: 'local_hold', mode: 'dictation' }),
    ).toBe('local_dictation');
    expect(
      voiceTurnRoute({ activation: 'global_hold', mode: 'dictation' }),
    ).toBe('global_dictation');
  });

  it('retains the accepted transcript through the task handoff', () => {
    expect(
      shouldRetainVoiceTerminalActivity({
        disposition: 'task_submitted',
        mode: 'task',
      }),
    ).toBe(true);
    expect(
      shouldRetainVoiceTerminalActivity({
        disposition: 'feedback',
        mode: 'dictation',
      }),
    ).toBe(true);
  });
});
