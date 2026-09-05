import { describe, expect, it } from 'vitest';

import { TEST_API_BASE_URL, testAppEnvironment } from '../../scripts/test-app-config.mts';

describe('test app environment', () => {
  const config = { GOOGLE_OAUTH_CLIENT_ID: 'test-google-client', TROCODE_API_BASE_URL: TEST_API_BASE_URL };

  it.each([undefined, 'http://localhost:8080', 'https://api-production-3022a.up.railway.app'])('rejects an incorrect backend: %s', (url) => {
    expect(() => testAppEnvironment({ ...config, TROCODE_API_BASE_URL: url })).toThrow('tro-app/stg');
  });

  it('forwards signing credentials only to packaging while excluding backend secrets', () => {
    const signing = {
      TROCODE_MACOS_SIGNING_IDENTITY: 'Developer ID Application: Test',
      TROCODE_APPLE_API_KEY: '/private/key.p8',
      TROCODE_APPLE_API_KEY_ID: 'key-id',
      TROCODE_APPLE_API_ISSUER: 'issuer-id',
      TROCODE_WINDOWS_CERTIFICATE_FILE: '/private/cert.pfx',
      TROCODE_WINDOWS_CERTIFICATE_PASSWORD: 'signing-password',
      TROCODE_WINDOWS_KIT_VERSION: '10.0.26100.0',
    };
    const source = { ...config, ...signing, OPENAI_API_KEY: 'provider-secret', TROCODE_ADMIN_ACCESS_TOKEN: 'admin-secret' };
    const packaging = testAppEnvironment(source, 'package');
    expect(packaging).toMatchObject(signing);
    expect(packaging.OPENAI_API_KEY).toBeUndefined();
    expect(packaging.TROCODE_ADMIN_ACCESS_TOKEN).toBeUndefined();
    const start = testAppEnvironment(source, 'start');
    for (const key of Object.keys(signing)) expect(start[key]).toBeUndefined();
  });

  it('requires the matching Google client configuration', () => {
    expect(() => testAppEnvironment({ ...config, GOOGLE_OAUTH_CLIENT_ID: '' })).toThrow('GOOGLE_OAUTH_CLIENT_ID');
  });

  it('isolates test config and removes backend secrets before spawning build tools', () => {
    const source = {
      ...config,
      TROCODE_APP_ENV: 'production',
      OPENAI_API_KEY: 'provider-secret',
      DATABASE_URL: 'database-secret',
      TROCODE_SESSION_TOKEN_HMAC_KEY: 'session-secret',
      DOPPLER_TOKEN: 'doppler-secret',
      POSTHOG_PROJECT_TOKEN: 'production-analytics',
      PATH: '/usr/bin',
    };
    const env = testAppEnvironment(source);
    expect(env).toMatchObject({ ...config, TROCODE_APP_ENV: 'test', POSTHOG_PROJECT_TOKEN: '', PATH: '/usr/bin' });
    for (const key of ['OPENAI_API_KEY', 'DATABASE_URL', 'TROCODE_SESSION_TOKEN_HMAC_KEY', 'DOPPLER_TOKEN']) {
      expect(env[key]).toBeUndefined();
    }
    expect(source.OPENAI_API_KEY).toBe('provider-secret');
  });
});
