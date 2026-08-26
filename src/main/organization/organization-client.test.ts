import { describe, expect, it, vi } from 'vitest';

import { OrganizationClient } from './organization-client';

const TOKEN = `tro_live_${'a'.repeat(43)}`;
const BANNER_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
const ORGANIZATION = {
  capacity: {
    assignedSeats: 1,
    maxSeats: 10,
    remainingSeats: 9,
    state: 'available',
  },
  homeBanner: null,
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Math Teachers',
  plan: 'pro',
  role: 'organizer',
};

describe('OrganizationClient', () => {
  it('uses fixed authenticated routes and parses organization responses', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      new Response(JSON.stringify({ organization: ORGANIZATION }), {
        headers: { 'Content-Type': 'application/json' },
        status: 200,
      }),
    );
    const client = new OrganizationClient(
      'https://api.trocode.example/',
      vi.fn(async () => TOKEN),
      fetchImpl,
    );

    await expect(client.getCurrent()).resolves.toEqual({
      organization: ORGANIZATION,
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.trocode.example/v1/organizations/me',
      expect.objectContaining({
        headers: { Authorization: `Bearer ${TOKEN}` },
        method: 'GET',
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it('updates the current organization through a fixed schema-parsed route', async () => {
    const updated = { ...ORGANIZATION, name: 'Greenfield School' };
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      new Response(JSON.stringify({ organization: updated }), {
        headers: { 'Content-Type': 'application/json' },
        status: 200,
      }),
    );
    const client = new OrganizationClient(
      'https://api.trocode.example/',
      vi.fn(async () => TOKEN),
      fetchImpl,
    );

    await expect(
      client.update({ name: 'Greenfield School' }),
    ).resolves.toEqual({ organization: updated });
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.trocode.example/v1/organizations/me',
      expect.objectContaining({
        body: JSON.stringify({ name: 'Greenfield School' }),
        headers: {
          Authorization: `Bearer ${TOKEN}`,
          'Content-Type': 'application/json',
        },
        method: 'PATCH',
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it('sends an organization-scoped image banner through the same bounded route', async () => {
    const updated = {
      ...ORGANIZATION,
      homeBanner: { imageDataUrl: BANNER_DATA_URL },
    };
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      new Response(JSON.stringify({ organization: updated }), {
        headers: { 'Content-Type': 'application/json' },
        status: 200,
      }),
    );
    const client = new OrganizationClient(
      'https://api.trocode.example/',
      vi.fn(async () => TOKEN),
      fetchImpl,
    );

    await expect(
      client.update({ homeBannerImageDataUrl: BANNER_DATA_URL }),
    ).resolves.toEqual({ organization: updated });
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.trocode.example/v1/organizations/me',
      expect.objectContaining({
        body: JSON.stringify({ homeBannerImageDataUrl: BANNER_DATA_URL }),
        method: 'PATCH',
      }),
    );
  });

  it('builds bounded member pagination and mutation requests', async () => {
    const member = {
      createdAt: '2026-08-25T08:00:00.000Z',
      email: 'student@example.com',
      id: '22222222-2222-4222-8222-222222222222',
      joinedAt: null,
      name: null,
      role: 'member',
      state: 'pending',
    };
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            items: [member],
            organization: ORGANIZATION,
            page: { limit: 25, offset: 50, total: 51 },
          }),
          { headers: { 'Content-Type': 'application/json' }, status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            member,
            newlyCreated: true,
            organization: ORGANIZATION,
          }),
          { headers: { 'Content-Type': 'application/json' }, status: 201 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            kind: 'cancelled',
            memberId: member.id,
            organization: ORGANIZATION,
          }),
          { headers: { 'Content-Type': 'application/json' }, status: 200 },
        ),
      );
    const client = new OrganizationClient(
      'https://api.trocode.example',
      vi.fn(async () => TOKEN),
      fetchImpl,
    );

    await client.listMembers({ limit: 25, offset: 50 });
    await client.addMember({ email: member.email });
    await client.cancelMember(member.id);

    expect(fetchImpl.mock.calls[0]?.[0]).toBe(
      'https://api.trocode.example/v1/organizations/me/members?limit=25&offset=50',
    );
    expect(fetchImpl.mock.calls[1]?.[1]).toMatchObject({
      body: JSON.stringify({ email: member.email }),
      method: 'POST',
    });
    expect(fetchImpl.mock.calls[2]?.[0]).toBe(
      `https://api.trocode.example/v1/organizations/me/members/${member.id}`,
    );
  });

  it('surfaces safe hosted conflict messages and rejects malformed success bodies', async () => {
    const conflictClient = new OrganizationClient(
      'https://api.trocode.example',
      vi.fn(async () => TOKEN),
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            code: 'organization_capacity_reached',
            error: 'All organization seats are already assigned.',
          }),
          { headers: { 'Content-Type': 'application/json' }, status: 409 },
        ),
      ),
    );
    await expect(
      conflictClient.addMember({ email: 'student@example.com' }),
    ).rejects.toThrow('All organization seats are already assigned.');

    const malformedClient = new OrganizationClient(
      'https://api.trocode.example',
      vi.fn(async () => TOKEN),
      vi.fn(async () =>
        new Response(JSON.stringify({ organization: { role: 'admin' } }), {
          headers: { 'Content-Type': 'application/json' },
          status: 200,
        }),
      ),
    );
    await expect(malformedClient.getCurrent()).rejects.toThrow();
    await expect(
      malformedClient.update({ name: 'Greenfield School' }),
    ).rejects.toThrow();
  });

  it('fails closed without a hosted URL or access token', async () => {
    await expect(
      new OrganizationClient('', vi.fn(async () => TOKEN)).getCurrent(),
    ).rejects.toThrow('hosted Tro service');
    await expect(
      new OrganizationClient(
        'https://api.trocode.example',
        vi.fn(async () => null),
      ).getCurrent(),
    ).rejects.toThrow('Sign in');
  });
});
