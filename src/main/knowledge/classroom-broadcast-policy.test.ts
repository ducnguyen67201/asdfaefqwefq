import { describe, expect, it } from 'vitest';

import { assertBroadcastTransition } from './classroom-broadcast-policy';
describe('broadcast effect lifecycle', () => {
  it('never replays or cancels an unknown send', () => {
    expect(() => assertBroadcastTransition('unknown', 'sent')).not.toThrow();
    for (const state of ['sending', 'prepared', 'cancelled'] as const)
      expect(() => assertBroadcastTransition('unknown', state)).toThrow();
    expect(() => assertBroadcastTransition('sent', 'sending')).toThrow();
  });
  it('accepts only a reviewed unsent draft for dispatch', () => {
    expect(() =>
      assertBroadcastTransition('prepared', 'sending'),
    ).not.toThrow();
    expect(() => assertBroadcastTransition('cancelled', 'sending')).toThrow();
    expect(() => assertBroadcastTransition('stale', 'sending')).toThrow();
  });
});
