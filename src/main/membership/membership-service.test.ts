import { describe, expect, it, vi } from 'vitest';

import { MembershipService, membershipRequiredForBuild } from './membership-service';

const user = { id: 'user-1', email: 'user@example.com', name: 'User' };

describe('MembershipService', () => {
  it('requires the hosted Rust membership service for every build', () => {
    expect(membershipRequiredForBuild({ apiBaseUrl: '', isPackaged: false }))
      .toBe(true);
  });

  it('fails closed without a hosted API', async () => {
    const service = new MembershipService({ required: true });
    await expect(service.getStatus(user)).resolves.toMatchObject({
      state: 'error',
      required: true,
    });
    await expect(service.activate(user, 'code')).rejects.toThrow(
      'hosted Rust membership service',
    );
  });

  it('projects membership returned by the Rust API', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      maxUsers: 10,
      plan: 'pro',
      state: 'active',
      summary: 'Membership active.',
      usedUsers: 2,
    }), {
      headers: { 'Content-Type': 'application/json' },
      status: 200,
    }));
    const service = new MembershipService({
      accessTokenProvider: async () => 'tro_live_token',
      apiBaseUrl: 'https://api.example.com',
      fetchImpl: fetchImpl as typeof fetch,
      required: true,
    });

    await expect(service.getStatus(user)).resolves.toMatchObject({
      plan: 'pro',
      state: 'active',
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.example.com/v1/access-code-redemptions/me',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer tro_live_token' }),
      }),
    );
  });
});
