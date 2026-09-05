import { describe, expect, it } from 'vitest';

import { sameClassroomVoiceDestination } from './classroom-voice-binding';
describe('voice task destination', () => {
  it('preserves the captured class, task and pending interaction', () => {
    const current = {
      selectionId: 'class-a',
      taskId: 'task-a',
      interactionId: 'question-a',
    };
    expect(sameClassroomVoiceDestination(current, current)).toBe(true);
    for (const change of [
      { selectionId: 'class-b' },
      { taskId: 'task-b' },
      { interactionId: 'question-b' },
    ])
      expect(
        sameClassroomVoiceDestination(current, { ...current, ...change }),
      ).toBe(false);
    expect(sameClassroomVoiceDestination(undefined, current)).toBe(false);
    expect(
      sameClassroomVoiceDestination(
        { selectionId: null, taskId: null, interactionId: null },
        { selectionId: null, taskId: null, interactionId: null },
      ),
    ).toBe(true);
  });
});
