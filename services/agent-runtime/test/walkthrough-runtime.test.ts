import { describe, expect, it } from 'vitest';

import {
  advanceWalkthrough,
  assessWalkthroughCompletion,
  createWalkthroughState,
  evaluateWalkthroughTool,
  nextWalkthroughCorrectionCount,
  walkthroughModelInstruction,
} from '../src/walkthrough-runtime.js';

describe('Agents SDK walkthrough runtime', () => {
  it('enforces a fresh observation before every narrated teacher pointer step', () => {
    const initial = createWalkthroughState(true);
    expect(walkthroughModelInstruction(initial)).toMatch(/observe_context/u);
    expect(evaluateWalkthroughTool(initial, 'show_guidance').allowed).toBe(false);

    const observed = advanceWalkthrough(initial, 'observe_context', 'completed');
    expect(observed.phase).toBe('needs_guidance');
    expect(walkthroughModelInstruction(observed)).toMatch(/show_guidance/u);
    expect(evaluateWalkthroughTool(observed, 'show_guidance').allowed).toBe(true);

    const guided = advanceWalkthrough(observed, 'show_guidance', 'completed');
    expect(guided).toEqual({
      completedSteps: 1,
      enabled: true,
      phase: 'needs_observation',
    });
  });

  it('does not advance sequencing for failed or unrelated tools', () => {
    const initial = createWalkthroughState(true);
    expect(advanceWalkthrough(initial, 'observe_context', 'failed')).toEqual(initial);
    expect(advanceWalkthrough(initial, 'open_url', 'completed')).toEqual(initial);
  });

  it('resets completion-recovery attempts after a successful visible step', () => {
    expect(nextWalkthroughCorrectionCount(2, 'failed')).toBe(2);
    expect(nextWalkthroughCorrectionCount(2, 'completed')).toBe(0);
  });

  it('rejects upfront text and accepts only a bounded completion sentinel after guidance', () => {
    const waitingForGuidance = advanceWalkthrough(
      createWalkthroughState(true),
      'observe_context',
      'completed',
    );
    expect(assessWalkthroughCompletion(waitingForGuidance, 'Here are all nine steps.'))
      .toMatchObject({ accepted: false, correction: expect.stringMatching(/show_guidance/u) });

    const afterGuidance = advanceWalkthrough(
      waitingForGuidance,
      'show_guidance',
      'completed',
    );
    expect(
      assessWalkthroughCompletion(
        afterGuidance,
        'WALKTHROUGH_COMPLETE: You finished the Scratch exercise.',
      ),
    ).toEqual({
      accepted: true,
      finalOutput: 'You finished the Scratch exercise.',
    });
  });
});
