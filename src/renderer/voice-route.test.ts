import { describe, expect, it } from 'vitest';

import { voiceTurnRoute } from './voice-route';

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
});
