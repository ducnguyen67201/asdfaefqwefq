import { describe, expect, it } from 'vitest';

import {
  ClassroomBroadcastPayloadSchema,
  PrepareClassroomBroadcastSchema,
  KnowledgeCapabilitiesSchema,
  ClassroomDirectiveListSchema,
} from '../../shared/contracts';
import { RuntimeToolRegistry } from '../agent/runtime-tool-registry';

import { classroomToolDefinitions } from './classroom-agent-tools';
import {
  resolveClassroomBroadcast,
  normalizeAssignmentTitle,
  classroomBroadcastDigest,
  canonicalBroadcastJson,
} from './classroom-assignment-resolver';
import { classroomFixture } from './classroom-broadcast.fixture';


describe('teacher broadcast contracts and tools', () => {
  it('registers exactly two strict teacher-only tools, with no commit capability', () => {
    const f = classroomFixture();
    const registry = new RuntimeToolRegistry(classroomToolDefinitions());
    expect(registry.freeze({ taskId: f.binding.sessionId }).tools).toHaveLength(
      0,
    );
    const tools = registry.freeze({
      taskId: f.binding.sessionId,
      teacherClassroom: f.binding,
    }).tools;
    expect(tools.map((t) => t.modelName)).toEqual([
      'list_session_assignments',
      'prepare_classroom_broadcast',
    ]);
    expect(tools[1]!.inputSchema.required).toHaveLength(7);
    expect(() =>
      classroomToolDefinitions()[1]!.parse(
        JSON.stringify({ ...f.prepare, ownerId: 'attacker' }),
      ),
    ).toThrow();
  });
  it('normalizes Vietnamese without losing accents and refuses conflicting references', () => {
    const f = classroomFixture();
    expect(normalizeAssignmentTitle('  VÒNG   LẶP ')).toBe('vòng lặp');
    expect(
      resolveClassroomBroadcast({ ...f.prepare, assignmentTitle: 'VÒNG LẶP' }, [
        f.assignment,
      ]).status,
    ).toBe('resolved');
    const second = {
      ...f.assignment,
      number: 2,
      runId: f.binding.spaceId,
      title: 'Assignment 1',
    };
    expect(
      resolveClassroomBroadcast(f.prepare, [f.assignment, second]).status,
    ).toBe('needs_clarification');
    expect(
      resolveClassroomBroadcast(
        { ...f.prepare, assignmentTitle: second.title },
        [f.assignment, second],
      ).status,
    ).toBe('needs_clarification');
    expect(
      resolveClassroomBroadcast(
        {
          ...f.prepare,
          assignmentNumber: null,
          assignmentTitle: f.assignment.title,
        },
        [f.assignment, { ...second, title: f.assignment.title }],
      ).status,
    ).toBe('needs_clarification');
  });
  it('resolves an immutable assignment or validates a public HTTPS notice', () => {
    const f = classroomFixture();
    const result = resolveClassroomBroadcast(f.prepare, [f.assignment]);
    expect(result.status).toBe('resolved');
    if (result.status === 'resolved')
      expect(result.payload).toMatchObject({
        targetRunId: f.assignment.runId,
        studentAction: 'explain',
        instruction: `Explain Assignment 1 — ${f.assignment.title}.`,
      });
    const link = {
      ...f.prepare,
      kind: 'open_url' as const,
      studentAction: null,
      assignmentNumber: null,
      instruction: 'Open this.',
      url: 'https://127.0.0.1',
    };
    expect(resolveClassroomBroadcast(link, []).status).toBe(
      'needs_clarification',
    );
    expect(
      resolveClassroomBroadcast(
        { ...link, url: 'https://example.com/lesson' },
        [],
      ).status,
    ).toBe('resolved');
  });
  it('shares deterministic sorted-key UTF-8 digest with Rust', () => {
    const payload = {
      kind: 'exercise' as const,
      instruction: 'Explain Assignment 1.',
    };
    expect(canonicalBroadcastJson(payload)).toBe(
      '{"instruction":"Explain Assignment 1.","kind":"exercise"}',
    );
    expect(classroomBroadcastDigest(payload)).toBe(
      '16d459e6c5fa3d51310d044f39c82ad13da5d17401b43f1b33c180eea77339a7',
    );
  });
  it('keeps old capabilities/directives compatible and rejects unbounded authority inputs', () => {
    expect(
      KnowledgeCapabilitiesSchema.parse({
        knowledgeSpaces: { enabled: true, contractVersion: 2 },
      }).classroomBroadcasts,
    ).toBeUndefined();
    expect(
      ClassroomDirectiveListSchema.safeParse({
        attemptState: 'assigned',
        runState: 'open',
        items: [],
        maxSequence: 0,
      }).success,
    ).toBe(true);
    const f = classroomFixture();
    expect(
      PrepareClassroomBroadcastSchema.safeParse({
        ...f.prepare,
        instruction: 'a'.repeat(4001),
      }).success,
    ).toBe(false);
    expect(
      ClassroomBroadcastPayloadSchema.safeParse({
        ...f.broadcast.payload,
        studentTaskId: f.session.attemptId,
      }).success,
    ).toBe(false);
  });
});
