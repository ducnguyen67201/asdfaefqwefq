import { createHash, randomBytes } from 'node:crypto';

import { z } from 'zod';

import {
  AuthStatusSchema,
  AuthUserSchema,
  type AuthStatus,
  type AuthUser,
} from '../../shared/contracts';
import type { RustDesktopEngineClient } from '../engine/rust-desktop-engine-client';

import type { OAuthBrowserFlow } from './local-oauth-browser-flow';

const GOOGLE_AUTHORIZATION_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const HostedSessionResponseSchema = z.object({
  accessToken: z.string().regex(/^tro_live_[A-Za-z0-9_-]{43}$/),
  expiresAt: z.string().datetime(),
  user: AuthUserSchema,
});

export interface AuthSession {
  accessToken?: string;
  accessTokenExpiresAt?: string;
  signedInAt: string;
  user: AuthUser;
}

export interface AuthSessionStore {
  clear(): Promise<void>;
  read(): Promise<AuthSession | null>;
  write(session: AuthSession): Promise<void>;
}

export interface GoogleAuthServiceOptions {
  apiBaseUrl?: string;
  browserFlow: OAuthBrowserFlow;
  clientId?: string;
  fetchImpl?: typeof fetch;
  rustEngine: Pick<RustDesktopEngineClient, 'exchangeGoogleOauthCode'>;
  sessionStore: AuthSessionStore;
}

function randomUrlSafeValue(size = 32): string {
  return randomBytes(size).toString('base64url');
}

function codeChallenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

export class GoogleAuthService {
  private readonly apiBaseUrl: string;

  private readonly clientId: string;
  private readonly fetchImpl: typeof fetch;
  private signInPromise: Promise<AuthStatus> | null = null;

  constructor(private readonly options: GoogleAuthServiceOptions) {
    this.apiBaseUrl = normalizeApiBaseUrl(options.apiBaseUrl);
    this.clientId = options.clientId?.trim() ?? '';
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async getStatus(): Promise<AuthStatus> {
    if (!this.clientId) {
      return AuthStatusSchema.parse({
        state: 'error',
        configured: false,
        user: null,
        summary:
          'Google sign-in is not configured. Set GOOGLE_OAUTH_CLIENT_ID.',
      });
    }

    try {
      const session = await this.options.sessionStore.read();
      if (!session) {
        return AuthStatusSchema.parse({
          state: 'signed_out',
          configured: true,
          user: null,
          summary: 'Sign in with Google to continue.',
        });
      }
      const expiresAt = session.accessTokenExpiresAt
        ? Date.parse(session.accessTokenExpiresAt)
        : Number.NaN;
      if (!session.accessToken || !Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
        await this.options.sessionStore.clear();
        return AuthStatusSchema.parse({
          state: 'signed_out',
          configured: true,
          user: null,
          summary: 'Your Tro session expired. Sign in again.',
        });
      }
      return AuthStatusSchema.parse({
        state: 'signed_in',
        configured: true,
        user: session.user,
        summary: `Signed in as ${session.user.email}.`,
      });
    } catch {
      return AuthStatusSchema.parse({
        state: 'error',
        configured: true,
        user: null,
        summary: 'The saved Google session could not be read. Sign in again.',
      });
    }
  }

  signIn(): Promise<AuthStatus> {
    if (this.signInPromise) return this.signInPromise;

    const operation = this.performSignIn().finally(() => {
      if (this.signInPromise === operation) this.signInPromise = null;
    });
    this.signInPromise = operation;
    return operation;
  }

  async signOut(): Promise<AuthStatus> {
    const session = await this.options.sessionStore.read().catch(() => null);
    if (session?.accessToken) {
      await this.fetchImpl(`${this.apiBaseUrl}/v1/auth/session`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${session.accessToken}` },
        signal: AbortSignal.timeout(10_000),
      }).catch(() => undefined);
    }
    await this.options.sessionStore.clear();
    return AuthStatusSchema.parse({
      state: 'signed_out',
      configured: Boolean(this.clientId),
      user: null,
      summary: 'Signed out. Sign in with Google to continue.',
    });
  }

  async assertSignedIn(): Promise<AuthUser> {
    const status = await this.getStatus();
    if (status.state !== 'signed_in' || !status.user) {
      throw new Error('Sign in with Google before using Tro.');
    }
    return status.user;
  }

  async getAccessToken(): Promise<string | null> {
    const status = await this.getStatus();
    if (status.state !== 'signed_in') return null;
    const session = await this.options.sessionStore.read();
    return session?.accessToken ?? null;
  }

  private async performSignIn(): Promise<AuthStatus> {
    if (!this.clientId) {
      throw new Error(
        'Google sign-in is not configured. Set GOOGLE_OAUTH_CLIENT_ID.',
      );
    }

    const state = randomUrlSafeValue();
    const nonce = randomUrlSafeValue();
    const verifier = randomUrlSafeValue(64);
    const authorization = await this.options.browserFlow.authorize({
      state,
      buildAuthorizationUrl: (redirectUri) => {
        const url = new URL(GOOGLE_AUTHORIZATION_URL);
        url.search = new URLSearchParams({
          access_type: 'online',
          client_id: this.clientId,
          code_challenge: codeChallenge(verifier),
          code_challenge_method: 'S256',
          nonce,
          prompt: 'select_account',
          redirect_uri: redirectUri,
          response_type: 'code',
          scope: 'openid email profile',
          state,
        }).toString();
        return url;
      },
    });

    if (!this.apiBaseUrl) {
      throw new Error('The hosted Rust sign-in service is not configured.');
    }
    const tokens = await this.options.rustEngine.exchangeGoogleOauthCode({
      clientId: this.clientId,
      code: authorization.code,
      codeVerifier: verifier,
      expectedNonce: nonce,
      redirectUri: authorization.redirectUri,
    });
    const hostedSession = await this.exchangeHostedSession(tokens.idToken);
    await this.options.sessionStore.write({
      accessToken: hostedSession.accessToken,
      accessTokenExpiresAt: hostedSession.expiresAt,
      signedInAt: new Date().toISOString(),
      user: hostedSession.user,
    });

    return AuthStatusSchema.parse({
      state: 'signed_in',
      configured: true,
      user: hostedSession.user,
      summary: `Signed in as ${hostedSession.user.email}.`,
    });
  }

  private async exchangeHostedSession(idToken: string): Promise<
    z.infer<typeof HostedSessionResponseSchema>
  > {
    const response = await this.fetchImpl(
      `${this.apiBaseUrl}/v1/auth/google/exchange`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken }),
        signal: AbortSignal.timeout(15_000),
      },
    );
    if (!response.ok) {
      throw new Error(
        response.status === 401
          ? 'Tro could not verify this Google account.'
          : 'Tro sign-in service is temporarily unavailable.',
      );
    }
    const hostedSession = HostedSessionResponseSchema.parse(
      await response.json(),
    );
    return hostedSession;
  }
}

function normalizeApiBaseUrl(value: string | undefined): string {
  const trimmed = value?.trim().replace(/\/+$/, '') ?? '';
  if (!trimmed) return '';
  const url = new URL(trimmed);
  if (url.protocol !== 'https:' && url.hostname !== '127.0.0.1' && url.hostname !== 'localhost') {
    throw new Error('TROCODE_API_BASE_URL must use HTTPS.');
  }
  return url.toString().replace(/\/+$/, '');
}
