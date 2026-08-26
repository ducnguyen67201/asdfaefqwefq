import { describe, expect, it } from 'vitest';

import { parseMacOSVoiceShortcutOutput } from './macos-voice-shortcut-watcher';

describe('parseMacOSVoiceShortcutOutput', () => {
  it('parses press and release lines across process chunks', () => {
    const first = parseMacOSVoiceShortcutOutput('', 'ready\npressed:ta');

    expect(first.events).toEqual([]);
    expect(first.remainder).toBe('pressed:ta');

    const second = parseMacOSVoiceShortcutOutput(
      first.remainder,
      'sk\nreleased:task\n',
    );

    expect(second.events).toEqual([
      { action: 'pressed', mode: 'task', source: 'global' },
      { action: 'released', mode: 'task', source: 'global' },
    ]);
    expect(second.remainder).toBe('');
  });

  it('ignores unknown helper output', () => {
    expect(parseMacOSVoiceShortcutOutput('', 'unknown\n')).toEqual({
      events: [],
      remainder: '',
    });
  });

  it('accepts Windows CRLF shortcut events', () => {
    expect(
      parseMacOSVoiceShortcutOutput(
        '',
        'pressed:dictation\r\nreleased:dictation\r\n',
      ),
    ).toEqual({
      events: [
        { action: 'pressed', mode: 'dictation', source: 'global' },
        { action: 'released', mode: 'dictation', source: 'global' },
      ],
      remainder: '',
    });
  });
});
