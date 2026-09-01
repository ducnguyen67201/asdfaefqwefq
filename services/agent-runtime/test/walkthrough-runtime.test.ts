import { describe, expect, it } from 'vitest';

import {
  advanceWalkthrough,
  assessWalkthroughCompletion,
  createWalkthroughState,
  evaluateWalkthroughTool,
  nextWalkthroughCorrectionCount,
  parseWalkthroughCompletion,
  requestsGuidedWalkthrough,
  walkthroughModelInstruction,
} from '../src/walkthrough-runtime.js';

describe('Agents SDK walkthrough runtime', () => {
  it.each([
    'Guide me through this exercise.',
    'Walk me through filtering my inbox.',
    'Teach me step by step how to use this form.',
    'Give me guidance on how to do this exercise.',
    'Show me how to do this in the app.',
    'Help me do this assignment myself.',
    'Let me solve this exercise myself.',
    'I want to complete this on-screen task myself.',
    'Guide how to do this form.',
    'Hướng dẫn tôi từng bước làm bài này.',
    'Chỉ mình từng bước cách lọc email.',
    'Dạy em từng bước cách làm bài.',
    'Chỉ cho tôi cách làm việc này.',
    'Hướng dẫn cách làm bài này.',
    'Giúp tôi tự làm bài tập này.',
    'Để tôi tự làm bài này.',
    'Tôi muốn tự giải bài tập này.',
    'Show me each area and explain it, then continue.',
    'Point to each question and walk me through it.',
    'Circle the relevant area, explain it, and move to the next one.',
    'Point here, explain, then continue one area at a time.',
    'Chỉ vào từng phần rồi giải thích, sau đó tiếp tục.',
    'Khoanh vùng từng câu, giải thích rồi chuyển sang câu tiếp theo.',
    'Làm sao làm bài tập Scratch này?',
    'Làm sao để làm bài tập Scratch này?',
    'How do I do this on-screen exercise?',
  ])('detects a visible teacher request: %s', (request) => {
    expect(requestsGuidedWalkthrough(request)).toBe(true);
  });

  it.each([
    'Explain this exercise.',
    'Solve this equation step by step.',
    'Write a step-by-step guide for onboarding.',
    'Open Gmail and read the latest email.',
    'Giải thích bài tập này.',
    'Giải thích cách làm bài tập này.',
    'Teach me about the present simple tense.',
    'Help me understand this explanation myself.',
    'Viết hướng dẫn sử dụng cho khách hàng.',
    'I remember OpenClicky used to circle areas, explain them, then continue.',
    'Highlights should use arrows when a walkthrough is active.',
    'Tôi nhớ ứng dụng từng khoanh vùng rồi giải thích từng phần.',
  ])('keeps a self-contained request in text mode: %s', (request) => {
    expect(requestsGuidedWalkthrough(request)).toBe(false);
  });

  it('enforces a fresh observation before every narrated teacher pointer step', () => {
    const initial = createWalkthroughState(true);
    expect(walkthroughModelInstruction(initial)).toMatch(/observe_context/u);
    expect(evaluateWalkthroughTool(initial, 'show_guidance').allowed).toBe(false);

    const observed = advanceWalkthrough(initial, 'observe_context', 'completed');
    expect(observed.phase).toBe('needs_guidance');
    expect(walkthroughModelInstruction(observed)).toMatch(/show_guidance/u);
    expect(walkthroughModelInstruction(observed)).toMatch(/step 1/iu);
    expect(evaluateWalkthroughTool(observed, 'show_guidance').allowed).toBe(true);

    const guided = advanceWalkthrough(observed, 'show_guidance', 'completed');
    expect(guided).toEqual({
      completedSteps: 1,
      enabled: true,
      phase: 'needs_observation',
    });
    const secondObserved = advanceWalkthrough(
      guided,
      'observe_context',
      'completed',
    );
    expect(walkthroughModelInstruction(secondObserved)).toMatch(/step 2/iu);
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

  it('leaves direct tasks unconstrained and validates bounded recap syntax', () => {
    const direct = createWalkthroughState(false);
    expect(evaluateWalkthroughTool(direct, 'open_url').allowed).toBe(true);
    expect(assessWalkthroughCompletion(direct, 'A normal response.')).toEqual({
      accepted: true,
      finalOutput: 'A normal response.',
    });
    expect(parseWalkthroughCompletion('WALKTHROUGH_COMPLETE: Done.')).toBe('Done.');
    expect(parseWalkthroughCompletion('WALKTHROUGH_COMPLETE: 1. Answer')).toBeNull();
    expect(parseWalkthroughCompletion('WALKTHROUGH_COMPLETE: Line one\nLine two')).toBeNull();
    expect(parseWalkthroughCompletion(`WALKTHROUGH_COMPLETE: ${'A'.repeat(181)}`)).toBeNull();
  });
});
