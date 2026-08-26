import { describe, expect, it } from 'vitest';

import {
  applyDictationTranscript,
  captureVoiceDraftSnapshot,
} from './voice-draft';

describe('voice draft insertion', () => {
  it('inserts at the focused caret with word-boundary spacing', () => {
    const snapshot = captureVoiceDraftSnapshot('Helloagain', 5, 5, true);
    expect(applyDictationTranscript(snapshot, 'there')).toEqual({
      caret: 12,
      value: 'Hello there again',
    });
  });

  it('replaces a selection without stacking provisional transcripts', () => {
    const snapshot = captureVoiceDraftSnapshot('Meet Friday please', 5, 11, true);
    expect(applyDictationTranscript(snapshot, 'tomorrow')).toEqual({
      caret: 13,
      value: 'Meet tomorrow please',
    });
    expect(applyDictationTranscript(snapshot, 'at three')).toEqual({
      caret: 13,
      value: 'Meet at three please',
    });
  });

  it('appends when the textarea was not focused', () => {
    const snapshot = captureVoiceDraftSnapshot('Existing draft', 0, 0, false);
    expect(applyDictationTranscript(snapshot, 'continued').value).toBe(
      'Existing draft continued',
    );
  });

  it('preserves punctuation and supports Unicode word boundaries', () => {
    const snapshot = captureVoiceDraftSnapshot('Xinban.', 3, 3, true);
    expect(applyDictationTranscript(snapshot, 'chào').value).toBe(
      'Xin chào ban.',
    );
    expect(
      applyDictationTranscript(
        captureVoiceDraftSnapshot('Hello world', 5, 5, true),
        ',',
      ).value,
    ).toBe('Hello, world');
    expect(
      applyDictationTranscript(
        captureVoiceDraftSnapshot('👋there', 2, 2, true),
        ' xin chào ',
      ).value,
    ).toBe('👋 xin chào there');
  });

  it('accepts an exact 8,000-character transcript deterministically', () => {
    const transcript = 'đ'.repeat(8_000);
    const result = applyDictationTranscript(
      captureVoiceDraftSnapshot('', 0, 0, true),
      transcript,
    );
    expect(result.value).toHaveLength(8_000);
    expect(result.caret).toBe(8_000);
  });
});
