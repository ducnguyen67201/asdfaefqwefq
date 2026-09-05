import { createHash } from 'node:crypto';

import { validatePublicHttpsUrl } from '../../shared/classroom-url-policy';
import {
  PrepareClassroomBroadcastSchema,
  type ClassroomBroadcastPayload,
  type PrepareClassroomBroadcast,
  type SessionAssignment,
} from '../../shared/contracts';

export function canonicalBroadcastJson(value: unknown): string {
  if (Array.isArray(value))
    return `[${value.map(canonicalBroadcastJson).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.entries(value)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonicalBroadcastJson(v)}`)
      .join(',')}}`;
  return JSON.stringify(value);
}
export function classroomBroadcastDigest(
  payload: ClassroomBroadcastPayload,
): string {
  return createHash('sha256')
    .update(canonicalBroadcastJson(payload))
    .digest('hex');
}
export function normalizeAssignmentTitle(value: string): string {
  return value
    .normalize('NFKC')
    .trim()
    .replace(/\s+/gu, ' ')
    .toLocaleLowerCase('vi');
}
export type AssignmentResolution =
  | { status: 'resolved'; payload: ClassroomBroadcastPayload }
  | {
      status: 'needs_clarification';
      message: string;
      candidates: SessionAssignment[];
    };
export function resolveClassroomBroadcast(
  raw: PrepareClassroomBroadcast,
  assignments: SessionAssignment[],
): AssignmentResolution {
  const input = PrepareClassroomBroadcastSchema.parse(raw);
  const clarify = (
    message: string,
    candidates = assignments,
  ): AssignmentResolution => ({
    status: 'needs_clarification',
    message,
    candidates,
  });
  if (input.kind === 'assignment') {
    if (
      input.url ||
      !input.studentAction ||
      (!input.assignmentNumber &&
        !input.assignmentRunId &&
        !input.assignmentTitle)
    )
      return clarify(
        'Choose an assignment and whether students should open it or start an explanation.',
      );
    const byNumber = input.assignmentNumber
      ? assignments.filter((a) => a.number === input.assignmentNumber)
      : null;
    const byTitle = input.assignmentTitle
      ? assignments.filter(
          (a) =>
            normalizeAssignmentTitle(a.title) ===
            normalizeAssignmentTitle(input.assignmentTitle!),
        )
      : null;
    const byId = input.assignmentRunId
      ? assignments.filter((a) => a.runId === input.assignmentRunId)
      : null;
    const references = [byNumber, byTitle, byId].filter(
      (r): r is SessionAssignment[] => r !== null,
    );
    const matches = assignments.filter((a) =>
      references.every((r) => r.some((item) => item.runId === a.runId)),
    );
    // Spoken "Assignment 1" can also be an exact title belonging to another ordinal.
    const ordinalTitle = input.assignmentNumber
      ? assignments.filter((a) =>
          [
            'assignment ' + input.assignmentNumber,
            'bài tập ' + input.assignmentNumber,
          ].includes(normalizeAssignmentTitle(a.title)),
        )
      : [];
    if (
      matches.length !== 1 ||
      (!input.assignmentRunId &&
        !input.assignmentTitle &&
        ordinalTitle.some((a) => a.number !== input.assignmentNumber))
    )
      return clarify(
        'The assignment references are missing or ambiguous. Confirm a number and title.',
        [
          ...new Map(
            [...references.flat(), ...ordinalTitle].map((a) => [a.runId, a]),
          ).values(),
        ],
      );
    const target = matches[0]!;
    return {
      status: 'resolved',
      payload: {
        kind: 'assignment',
        studentAction: input.studentAction,
        targetRunId: target.runId,
        activityVersionId: target.activityVersionId,
        title: target.title,
        number: target.number,
        instruction:
          input.instruction ??
          `${input.studentAction === 'explain' ? 'Explain' : 'Open'} Assignment ${target.number} — ${target.title}.`,
      },
    };
  }
  if (
    input.assignmentNumber !== null ||
    input.assignmentTitle !== null ||
    input.assignmentRunId !== null ||
    input.studentAction !== null
  )
    return clarify(
      'Assignment references are only supported for assignment broadcasts.',
      [],
    );
  if (!input.instruction)
    return clarify('Provide the instruction to show the class.', []);
  if (input.kind === 'exercise')
    return input.url
      ? clarify('Use a link broadcast for a URL.', [])
      : {
          status: 'resolved',
          payload: { kind: 'exercise', instruction: input.instruction },
        };
  const url = input.url ? validatePublicHttpsUrl(input.url) : null;
  if (!url)
    return clarify(
      'Provide an explicit public HTTPS link, or observe the visible link first.',
      [],
    );
  return {
    status: 'resolved',
    payload: {
      kind: 'open_url',
      instruction: input.instruction,
      url: url.href,
      origin: url.origin,
    },
  };
}
