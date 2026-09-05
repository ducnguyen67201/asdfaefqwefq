import { describe, expect, it, vi } from 'vitest';

import { classroomFixture } from './classroom-broadcast.fixture';
import { TeacherClassroomContextService } from './teacher-classroom-context-service';
describe('teacher classroom binding', () => {
  it('checks owner, capability, open state, and stale selection tokens', async () => {
    const f = classroomFixture();
    const binding = {spaceId:f.binding.spaceId,sessionId:f.binding.sessionId,spaceName:f.binding.spaceName,sessionTitle:f.binding.sessionTitle,verifiedAt:f.binding.verifiedAt};
    let owner = 'teacher';
    const client = {
      capabilities: vi.fn(async () => ({
        knowledgeSpaces: { enabled: true, contractVersion: 2 as const },
        classroomBroadcasts: { contractVersion: 1 as const },
      })),
      teacherClassroomContext: vi.fn(async () => ({
        binding,
        sessionState: 'open' as const,
        assignments: [f.assignment],
      })),
    };
    const service = new TeacherClassroomContextService(
      client,
      async () => owner,
    );
    const selected = await service.select(binding.spaceId, binding.sessionId);
    expect((await service.resolve(selected.selectionId)).ownerId).toBe(
      'teacher',
    );
    service.clear('00000000-0000-4000-8000-000000000001');
    expect(service.get()).not.toBeNull();
    owner = 'student';
    await expect(service.resolve(selected.selectionId)).rejects.toThrow(
      'owner',
    );
    service.clear();
    expect(service.get()).toBeNull();
  });
  it('does not activate a selection whose read finishes after it is cleared', async () => {
    const f = classroomFixture();
    const binding = {spaceId:f.binding.spaceId,sessionId:f.binding.sessionId,spaceName:f.binding.spaceName,sessionTitle:f.binding.sessionTitle,verifiedAt:f.binding.verifiedAt};
    let resolve!: () => void;
    const barrier = new Promise<void>((done) => (resolve = done));
    const service = new TeacherClassroomContextService(
      {
        capabilities: async () => ({
          knowledgeSpaces: { enabled: true, contractVersion: 2 },
          classroomBroadcasts: { contractVersion: 1 },
        }),
        teacherClassroomContext: async () => {
          await barrier;
          return { binding, sessionState: 'open', assignments: [f.assignment] };
        },
      },
      async () => f.binding.ownerId,
    );
    const selection = service.select(binding.spaceId, binding.sessionId);
    service.clear();
    resolve();
    await expect(selection).rejects.toThrow('changed');
    expect(service.get()).toBeNull();
  });
});
