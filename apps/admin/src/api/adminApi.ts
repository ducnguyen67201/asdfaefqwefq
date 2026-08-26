import type { z } from 'zod';

import {
  accessCodesResponseSchema,
  codeUsersResponseSchema,
  createdCodesResponseSchema,
  type ClassroomRole,
  type CreateCodesInput,
  usageResponseSchema,
  usersResponseSchema,
} from './contracts';

interface ErrorPayload {
  code?: string;
  error?: string;
}

export class AdminApiError extends Error {
  readonly code?: string;
  readonly status: number;

  constructor(status: number, payload: ErrorPayload | null) {
    super(payload?.error || 'The admin request could not be completed.');
    this.name = 'AdminApiError';
    this.code = payload?.code;
    this.status = status;
  }
}

async function request<T>(
  path: string,
  schema: z.ZodType<T>,
  options: RequestInit = {},
): Promise<T> {
  const response = await fetch(path, {
    ...options,
    credentials: 'same-origin',
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers,
    },
  });
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    throw new AdminApiError(response.status, payload as ErrorPayload | null);
  }
  return schema.parse(payload);
}

async function requestWithoutBody(
  path: string,
  options: RequestInit = {},
): Promise<void> {
  const response = await fetch(path, {
    ...options,
    credentials: 'same-origin',
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers,
    },
  });
  if (!response.ok) {
    const payload: unknown = await response.json().catch(() => null);
    throw new AdminApiError(response.status, payload as ErrorPayload | null);
  }
}

function queryString(values: Record<string, number | string | undefined>) {
  const parameters = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined && value !== '') {
      parameters.set(key, String(value));
    }
  }
  return parameters.toString();
}

export const adminApi = {
  blockUser: (userId: string, blocked: boolean) =>
    requestWithoutBody(`/v1/admin/users/${encodeURIComponent(userId)}/access`, {
      body: JSON.stringify({ blocked }),
      method: 'PATCH',
    }),
  createCodes: (input: CreateCodesInput) =>
    request(
      '/v1/admin/access-codes/bulk',
      createdCodesResponseSchema,
      { body: JSON.stringify(input), method: 'POST' },
    ),
  createSession: (token: string) =>
    requestWithoutBody('/v1/admin/session', {
      headers: { Authorization: `Bearer ${token}` },
      method: 'POST',
    }),
  deleteCode: (codeId: string) =>
    requestWithoutBody(
      `/v1/admin/access-codes/${encodeURIComponent(codeId)}`,
      { method: 'DELETE' },
    ),
  deleteSession: () =>
    requestWithoutBody('/v1/admin/session', { method: 'DELETE' }),
  grantCode: (userId: string, accessCodeId: string) =>
    requestWithoutBody(
      `/v1/admin/users/${encodeURIComponent(userId)}/access-code`,
      { body: JSON.stringify({ accessCodeId }), method: 'POST' },
    ),
  listCodeUsers: (codeId: string, limit: number, offset: number) =>
    request(
      `/v1/admin/access-codes/${encodeURIComponent(codeId)}/users?${queryString({ limit, offset })}`,
      codeUsersResponseSchema,
    ),
  listCodes: (filters: {
    limit: number;
    offset: number;
    search?: string;
    status?: string;
  }) =>
    request(
      `/v1/admin/access-codes?${queryString(filters)}`,
      accessCodesResponseSchema,
    ),
  listUsage: (filters: {
    lane?: string;
    limit: number;
    offset: number;
    range: string;
    search?: string;
  }) =>
    request(
      `/v1/admin/usage?${queryString(filters)}`,
      usageResponseSchema,
    ),
  listUsers: (filters: {
    classroomRole?: string;
    limit: number;
    offset: number;
    search?: string;
    status?: string;
  }) =>
    request(
      `/v1/admin/users?${queryString(filters)}`,
      usersResponseSchema,
    ),
  pauseCode: (codeId: string, paused: boolean) =>
    requestWithoutBody(
      `/v1/admin/access-codes/${encodeURIComponent(codeId)}`,
      { body: JSON.stringify({ paused }), method: 'PATCH' },
    ),
  setClassroomRole: (userId: string, role: ClassroomRole) =>
    requestWithoutBody(
      `/v1/admin/users/${encodeURIComponent(userId)}/classroom-role`,
      { body: JSON.stringify({ role }), method: 'PATCH' },
    ),
};

export function isUnauthorized(error: unknown): boolean {
  return error instanceof AdminApiError && error.status === 401;
}

export function errorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : 'The admin request could not be completed.';
}
