// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AuthStatus } from '../shared/contracts';
import type { DesktopApi } from '../shared/desktop-api';

import { AuthGate } from './AuthGate';

vi.mock('./App', () => ({
  App: () => <div data-testid="authenticated-app" />,
}));

const SIGNED_OUT_STATUS: AuthStatus = {
  configured: true,
  state: 'signed_out',
  summary: 'Sign in with Google to continue.',
  user: null,
};

describe('AuthGate account placement', () => {
  let container: HTMLDivElement;
  let root: Root;
  let signInWithGoogle: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    signInWithGoogle = vi.fn().mockResolvedValue(SIGNED_OUT_STATUS);

    window.tro = {
      getAuthStatus: vi.fn().mockResolvedValue(SIGNED_OUT_STATUS),
      signInWithGoogle,
      signOutGoogle: vi.fn().mockResolvedValue(SIGNED_OUT_STATUS),
    } as unknown as DesktopApi;
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  it('keeps the signed-out action at the bottom of the left rail', async () => {
    await act(async () => {
      root.render(<AuthGate />);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const accountArea = container.querySelector('.login-sidebar__account');
    const signInButton =
      accountArea?.querySelector<HTMLButtonElement>('.google-sign-in-button') ??
      null;

    expect(accountArea?.textContent).toContain('Sign in to continue');
    expect(signInButton?.textContent).toContain('Continue with Google');
    expect(
      container.querySelector('.login-workspace .google-sign-in-button'),
    ).toBeNull();

    await act(async () => signInButton?.click());
    expect(signInWithGoogle).toHaveBeenCalledOnce();
  });
});
