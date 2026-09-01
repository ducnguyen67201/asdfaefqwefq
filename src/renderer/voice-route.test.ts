import { describe, expect, it } from 'vitest';

import {
  shouldRetainVoiceTerminalActivity,
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

  it('routes Dictation by activation without inspecting transcript text', () => {
    expect(
      voiceTurnRoute({ activation: 'local_hold', mode: 'dictation' }),
    ).toBe('local_dictation');
    expect(
      voiceTurnRoute({ activation: 'global_hold', mode: 'dictation' }),
    ).toBe('global_dictation');
  });

  it('hands accepted Tasks to task presentation but retains Dictation feedback', () => {
    expect(
      shouldRetainVoiceTerminalActivity({
        disposition: 'task_submitted',
        mode: 'task',
      }),
    ).toBe(false);
    expect(
      shouldRetainVoiceTerminalActivity({
        disposition: 'feedback',
        mode: 'dictation',
      }),
    ).toBe(true);
  });
});
