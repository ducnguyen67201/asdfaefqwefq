import { describe, expect, it } from 'vitest';

import {
  canCreateClassWorkspace,
  canManageClassPeople,
  groupClassWorkspaces,
  parseClassMemberEmails,
  rolesAvailableToMemberManager,
} from './class-workspace';

describe('class workspace access', () => {
  it('only lets Admin-assigned Teachers create classes', () => {
    expect(canCreateClassWorkspace('teacher')).toBe(true);
    expect(canCreateClassWorkspace('student')).toBe(false);
    expect(canCreateClassWorkspace('unassigned')).toBe(false);
  });

  it('limits non-owner Teachers to adding Students', () => {
    expect(rolesAvailableToMemberManager('owner')).toEqual([
      'participant',
      'facilitator',
    ]);
    expect(rolesAvailableToMemberManager('facilitator')).toEqual([
      'participant',
    ]);
    expect(rolesAvailableToMemberManager('participant')).toEqual([]);
    expect(canManageClassPeople('participant')).toBe(false);
  });

  it('normalizes, deduplicates, and reports malformed bulk entries', () => {
    expect(
      parseClassMemberEmails(
        'Student@One.example, student@one.example\ninvalid;two@example.com',
      ),
    ).toEqual({
      emails: ['student@one.example', 'two@example.com'],
      invalid: ['invalid'],
    });
  });

  it('groups and deterministically orders teaching and learning classes', () => {
    const base = {
      createdAt: '2026-08-20T00:00:00.000Z',
      description: '',
      purposeLabel: 'Class',
    };
    const grouped = groupClassWorkspaces([
      {
        ...base,
        id: '11111111-1111-4111-8111-111111111111',
        name: 'Learning class',
        role: 'participant',
        updatedAt: '2026-08-22T00:00:00.000Z',
      },
      {
        ...base,
        id: '22222222-2222-4222-8222-222222222222',
        name: 'Older teaching class',
        role: 'owner',
        updatedAt: '2026-08-21T00:00:00.000Z',
      },
      {
        ...base,
        id: '33333333-3333-4333-8333-333333333333',
        name: 'New teaching class',
        role: 'facilitator',
        updatedAt: '2026-08-23T00:00:00.000Z',
      },
    ]);
    expect(grouped.teaching.map((space) => space.name)).toEqual([
      'New teaching class',
      'Older teaching class',
    ]);
    expect(grouped.learning.map((space) => space.name)).toEqual([
      'Learning class',
    ]);
  });
});
