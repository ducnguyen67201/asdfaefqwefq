import { z } from 'zod';

import {
  MembershipStatusSchema,
  PlanIdSchema,
  type AuthUser,
  type MembershipStatus,
} from '../../shared/contracts';

const HostedAccessStatusSchema = z.object({
  maxUsers: z.number().int().positive().nullable(),
  plan: PlanIdSchema.nullable().default(null),
  state: z.enum(['inactive', 'active']),
  summary: z.string().min(1).max(1_000),
  usedUsers: z.number().int().nonnegative().nullable(),
});

const HostedErrorSchema = z.object({
  error: z.string().min(1).max(1_000),
});

interface MembershipServiceOptions {
  accessTokenProvider?: () => Promise<string | null>;
  apiBaseUrl?: string;
  fetchImpl?: typeof fetch;
  required: boolean;
}

export function membershipRequiredForBuild(input: {
  apiBaseUrl: string;
  isPackaged: boolean;
}): boolean {
  void input;
  return true;
}

function normalizeApiBaseUrl(value: string | undefined): string {
  const trimmed = value?.trim().replace(/\/+$/u, '') ?? '';
  if (!trimmed) return '';
  const url = new URL(trimmed);
  if (
    url.protocol !== 'https:' &&
    url.hostname !== '127.0.0.1' &&
    url.hostname !== 'localhost'
  ) {
    throw new Error('TROCODE_API_BASE_URL must use HTTPS.');
  }
  return url.toString().replace(/\/+$/u, '');
}

function status(
  input: Omit<MembershipStatus, 'plan' | 'summary'> & {
    plan?: MembershipStatus['plan'];
    summary: string;
  },
): MembershipStatus {
  return MembershipStatusSchema.parse(input);
}

/** API client only. Membership authority and persistence live in the Rust API. */
export class MembershipService {
  private readonly apiBaseUrl: string;

  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: MembershipServiceOptions) {
    this.apiBaseUrl = normalizeApiBaseUrl(options.apiBaseUrl);
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async getStatus(user: AuthUser): Promise<MembershipStatus> {
    void user;
    if (!this.options.required) {
      return status({
        expiresAt: null,
        referenceCode: null,
        required: false,
        state: 'bypassed',
        summary: 'Membership checks are disabled.',
      });
    }
    if (!this.apiBaseUrl) {
      return status({
        expiresAt: null,
        referenceCode: null,
        required: true,
        state: 'error',
        summary: 'The hosted Rust membership service is not configured.',
      });
    }
    try {
      return await this.requestHostedStatus(
        '/v1/access-code-redemptions/me',
        { method: 'GET' },
      );
    } catch (error) {
      return status({
        expiresAt: null,
        referenceCode: null,
        required: true,
        state: 'error',
        summary:
          error instanceof Error
            ? error.message
            : 'Tro could not check your access code.',
      });
    }
  }

  async activate(_user: AuthUser, activationCode: string): Promise<MembershipStatus> {
    if (!this.options.required) return this.getStatus(_user);
    if (!this.apiBaseUrl) {
      throw new Error('The hosted Rust membership service is not configured.');
    }
    return this.requestHostedStatus('/v1/access-code-redemptions', {
      body: JSON.stringify({ code: activationCode.trim() }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    });
  }

  async continueWithFree(user: AuthUser): Promise<MembershipStatus> {
    if (!this.options.required) return this.getStatus(user);
    if (!this.apiBaseUrl) {
      throw new Error('The Free plan requires the hosted Rust service.');
    }
    return this.requestHostedStatus('/v1/access-code-redemptions/free', {
      method: 'POST',
    });
  }

  async assertActive(user: AuthUser): Promise<void> {
    const currentStatus = await this.getStatus(user);
    if (
      currentStatus.state === 'active' ||
      currentStatus.state === 'bypassed'
    ) {
      return;
    }
    if (currentStatus.state === 'expired') {
      throw new Error('Your Tro membership has expired.');
    }
    if (currentStatus.state === 'error') {
      throw new Error(currentStatus.summary);
    }
    throw new Error('A valid access code is required to use Tro.');
  }

  private async requestHostedStatus(
    path: string,
    init: RequestInit,
  ): Promise<MembershipStatus> {
    const accessToken = await this.options.accessTokenProvider?.();
    if (!accessToken) {
      throw new Error('Sign in with Google before checking your access code.');
    }

    const response = await this.fetchImpl(`${this.apiBaseUrl}${path}`, {
      ...init,
      headers: {
        ...init.headers,
        Authorization: `Bearer ${accessToken}`,
      },
      signal: AbortSignal.timeout(10_000),
    });
    const body: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const parsedError = HostedErrorSchema.safeParse(body);
      throw new Error(
        parsedError.success
          ? parsedError.data.error
          : 'Tro could not verify this access code.',
      );
    }

    const hostedStatus = HostedAccessStatusSchema.parse(body);
    return status({
      expiresAt: null,
      plan: hostedStatus.plan,
      referenceCode: null,
      required: true,
      state: hostedStatus.state,
      summary: hostedStatus.summary,
    });
  }
}
