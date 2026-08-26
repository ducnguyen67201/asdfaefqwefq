import { describe, expect, it } from 'vitest';

import { usersResponseSchema } from './contracts';

const validResponse = {
  items: [
    {
      accessCodeId: null,
      blockedAt: null,
      classroomRole: 'teacher',
      codeLabel: null,
      createdAt: '2026-08-26T00:00:00Z',
      email: 'teacher@example.com',
      id: 'teacher-id',
      knowledgeSpacesEnabled: true,
      lastSeenAt: null,
      name: 'Teacher',
      plan: 'pro',
      status: 'active',
    },
  ],
  page: { limit: 50, offset: 0, total: 1 },
  summary: { activeUsers: 1, blockedUsers: 0, totalUsers: 1 },
};

describe('admin API contracts', () => {
  it('accepts a valid users response', () => {
    expect(usersResponseSchema.parse(validResponse)).toEqual(validResponse);
  });

  it('rejects a non-boolean Knowledge Spaces capability', () => {
    expect(() =>
      usersResponseSchema.parse({
        ...validResponse,
        items: [
          {
            ...validResponse.items[0],
            knowledgeSpacesEnabled: 'enabled',
          },
        ],
      }),
    ).toThrow();
  });

  it('rejects an unsupported classroom role at the HTTP boundary', () => {
    expect(() =>
      usersResponseSchema.parse({
        ...validResponse,
        items: [{ ...validResponse.items[0], classroomRole: 'owner' }],
      }),
    ).toThrow();
  });
});
