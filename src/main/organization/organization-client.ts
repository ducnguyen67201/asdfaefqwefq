import { z } from 'zod';

import {
  AddOrganizationMemberResponseSchema,
  CancelOrganizationMemberResponseSchema,
  OrganizationCurrentResponseSchema,
  OrganizationMemberListSchema,
  type AddOrganizationMemberRequest,
  type AddOrganizationMemberResponse,
  type CancelOrganizationMemberResponse,
  type ListOrganizationMembersRequest,
  type OrganizationCurrentResponse,
  type OrganizationMemberList,
} from '../../shared/contracts';

const HostedErrorSchema = z
  .object({
    code: z.string().min(1).max(100).optional(),
    error: z.string().min(1).max(1_000),
  })
  .passthrough();

export class OrganizationClient {
  constructor(
    private readonly apiBaseUrl: string,
    private readonly accessTokenProvider: () => Promise<string | null>,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  getCurrent(): Promise<OrganizationCurrentResponse> {
    return this.request(
      '/v1/organizations/me',
      { method: 'GET' },
      OrganizationCurrentResponseSchema,
    );
  }

  listMembers(
    input: ListOrganizationMembersRequest,
  ): Promise<OrganizationMemberList> {
    const query = new URLSearchParams({
      limit: String(input.limit),
      offset: String(input.offset),
    });
    return this.request(
      `/v1/organizations/me/members?${query}`,
      { method: 'GET' },
      OrganizationMemberListSchema,
    );
  }

  addMember(
    input: AddOrganizationMemberRequest,
  ): Promise<AddOrganizationMemberResponse> {
    return this.request(
      '/v1/organizations/me/members',
      this.json('POST', input),
      AddOrganizationMemberResponseSchema,
    );
  }

  cancelMember(memberId: string): Promise<CancelOrganizationMemberResponse> {
    return this.request(
      `/v1/organizations/me/members/${memberId}`,
      { method: 'DELETE' },
      CancelOrganizationMemberResponseSchema,
    );
  }

  private json(method: string, body: unknown): RequestInit {
    return {
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json' },
      method,
    };
  }

  private async request<T>(
    path: string,
    init: RequestInit,
    schema: z.ZodType<T>,
  ): Promise<T> {
    const baseUrl = this.apiBaseUrl.trim().replace(/\/+$/u, '');
    if (!baseUrl) {
      throw new Error('Organization management requires the hosted Tro service.');
    }
    const token = await this.accessTokenProvider();
    if (!token) throw new Error('Sign in to manage your organization.');
    const response = await this.fetchImpl(`${baseUrl}${path}`, {
      ...init,
      headers: { ...init.headers, Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10_000),
    });
    const body: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const error = HostedErrorSchema.safeParse(body);
      throw new Error(
        error.success
          ? error.data.error
          : `Organization service returned HTTP ${response.status}.`,
      );
    }
    return schema.parse(body);
  }
}
