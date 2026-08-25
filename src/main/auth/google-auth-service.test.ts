import { describe, expect, it, vi } from 'vitest';

import type { AuthUser } from '../../shared/contracts';

import {
  GoogleAuthService,
  type AuthSession,
  type AuthSessionStore,
} from './google-auth-service';
import type {
  OAuthBrowserAuthorizationOptions,
  OAuthBrowserFlow,
} from './local-oauth-browser-flow';

const TEST_USER: AuthUser = {
  email: 'person@example.com',
  id: 'google-user-123',
  name: 'Test Person',
};
const ACCESS_TOKEN = `tro_live_${'a'.repeat(43)}`;

function memoryStore(initial: AuthSession | null = null): {
  clear: ReturnType<typeof vi.fn>;
  store: AuthSessionStore;
  write: ReturnType<typeof vi.fn>;
} {
  let session = initial;
  const write = vi.fn(async (nextSession: AuthSession) => {
    session = nextSession;
  });
  const clear = vi.fn(async () => {
    session = null;
  });
  return {
    clear,
    store: { clear, read: vi.fn(async () => session), write },
    write,
  };
}

function browserFlow(
  inspectUrl: (url: URL) => void = () => undefined,
): OAuthBrowserFlow {
  return {
    authorize: vi.fn(async (options: OAuthBrowserAuthorizationOptions) => {
      const redirectUri = 'http://127.0.0.1:43210/oauth2/callback';
      inspectUrl(options.buildAuthorizationUrl(redirectUri));
      return { code: 'authorization-code', redirectUri };
    }),
  };
}

function rustEngine() {
  return {
    exchangeGoogleOauthCode: vi.fn(async () => ({
      idToken: 'signed-google-id-token',
    })),
  };
}

describe('GoogleAuthService', () => {
  it('reports missing OAuth configuration without starting the browser flow', async () => {
    const flow = browserFlow();
    const service = new GoogleAuthService({
      browserFlow: flow,
      rustEngine: rustEngine(),
      sessionStore: memoryStore().store,
    });

    await expect(service.getStatus()).resolves.toMatchObject({
      configured: false,
      state: 'error',
    });
    await expect(service.signIn()).rejects.toThrow('GOOGLE_OAUTH_CLIENT_ID');
    expect(flow.authorize).not.toHaveBeenCalled();
  });

  it('uses PKCE, exchanges the Google code in Rust, and stores the hosted session', async () => {
    const { store, write } = memoryStore();
    const engine = rustEngine();
    let authorizationUrl: URL | null = null;
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(
      JSON.stringify({
        accessToken: ACCESS_TOKEN,
        expiresAt: '2099-09-17T00:00:00.000Z',
        user: TEST_USER,
      }),
      { status: 201 },
    ));
    const service = new GoogleAuthService({
      apiBaseUrl: 'http://127.0.0.1:8080',
      browserFlow: browserFlow((url) => {
        authorizationUrl = url;
      }),
      clientId: 'desktop-client.apps.googleusercontent.com',
      fetchImpl,
      rustEngine: engine,
      sessionStore: store,
    });

    await expect(service.signIn()).resolves.toMatchObject({
      state: 'signed_in',
      user: TEST_USER,
    });
    const actualAuthorizationUrl = authorizationUrl as unknown as URL;
    expect(actualAuthorizationUrl.searchParams.get('code_challenge_method'))
      .toBe('S256');
    expect(actualAuthorizationUrl.searchParams.get('nonce')).toBeTruthy();
    expect(engine.exchangeGoogleOauthCode).toHaveBeenCalledWith({
      clientId: 'desktop-client.apps.googleusercontent.com',
      code: 'authorization-code',
      codeVerifier: expect.any(String),
      expectedNonce: actualAuthorizationUrl.searchParams.get('nonce'),
      redirectUri: 'http://127.0.0.1:43210/oauth2/callback',
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://127.0.0.1:8080/v1/auth/google/exchange',
      expect.objectContaining({
        body: JSON.stringify({ idToken: 'signed-google-id-token' }),
        method: 'POST',
      }),
    );
    expect(write).toHaveBeenCalledWith(expect.objectContaining({
      accessToken: ACCESS_TOKEN,
      user: TEST_USER,
    }));
  });

  it('clears expired hosted sessions and revokes active sessions on sign-out', async () => {
    const expired = memoryStore({
      accessToken: ACCESS_TOKEN,
      accessTokenExpiresAt: '2026-01-01T00:00:00.000Z',
      signedInAt: '2025-12-01T00:00:00.000Z',
      user: TEST_USER,
    });
    const expiredService = new GoogleAuthService({
      apiBaseUrl: 'https://api.example.com',
      browserFlow: browserFlow(),
      clientId: 'desktop-client.apps.googleusercontent.com',
      rustEngine: rustEngine(),
      sessionStore: expired.store,
    });
    await expect(expiredService.getStatus()).resolves.toMatchObject({
      state: 'signed_out',
    });
    expect(expired.clear).toHaveBeenCalledOnce();

    const active = memoryStore({
      accessToken: ACCESS_TOKEN,
      accessTokenExpiresAt: '2099-01-01T00:00:00.000Z',
      signedInAt: '2026-08-25T00:00:00.000Z',
      user: TEST_USER,
    });
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(null, { status: 204 }));
    const activeService = new GoogleAuthService({
      apiBaseUrl: 'https://api.example.com',
      browserFlow: browserFlow(),
      clientId: 'desktop-client.apps.googleusercontent.com',
      fetchImpl,
      rustEngine: rustEngine(),
      sessionStore: active.store,
    });
    await expect(activeService.signOut()).resolves.toMatchObject({
      state: 'signed_out',
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.example.com/v1/auth/session',
      expect.objectContaining({ method: 'DELETE' }),
    );
  });
});
