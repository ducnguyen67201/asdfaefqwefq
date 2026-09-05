export const TEST_API_BASE_URL = 'https://api-test-test-d2da.up.railway.app';

const PACKAGING_VARIABLES = new Set([
  'TROCODE_MACOS_SIGNING_IDENTITY',
  'TROCODE_APPLE_API_KEY',
  'TROCODE_APPLE_API_KEY_ID',
  'TROCODE_APPLE_API_ISSUER',
  'TROCODE_WINDOWS_CERTIFICATE_FILE',
  'TROCODE_WINDOWS_CERTIFICATE_PASSWORD',
  'TROCODE_WINDOWS_KIT_VERSION',
]);

/** Fail before launching if Doppler points this test profile at another backend. */
export function testAppEnvironment(
  source: NodeJS.ProcessEnv,
  command: 'start' | 'package' = 'start',
): NodeJS.ProcessEnv {
  if (source.TROCODE_API_BASE_URL?.replace(/\/$/u, '') !== TEST_API_BASE_URL) {
    throw new Error(`Doppler tro-app/stg must set TROCODE_API_BASE_URL=${TEST_API_BASE_URL}.`);
  }
  if (!source.GOOGLE_OAUTH_CLIENT_ID?.trim()) {
    throw new Error('Doppler tro-app/stg is missing GOOGLE_OAUTH_CLIENT_ID.');
  }
  const env = { ...source };
  // Backend secrets stay out of child processes. Only packaging receives signing credentials.
  for (const key of Object.keys(env)) {
    if (command === 'package' && PACKAGING_VARIABLES.has(key)) continue;
    if (/^(?:TROCODE_|OPENAI_|ELEVENLABS_|DATABASE_|PG|POSTGRES_|DOPPLER_TOKEN)/u.test(key)) {
      delete env[key];
    }
  }
  return {
    ...env,
    TROCODE_APP_ENV: 'test',
    TROCODE_API_BASE_URL: TEST_API_BASE_URL,
    POSTHOG_ENVIRONMENT: 'test',
    POSTHOG_PROJECT_TOKEN: '',
  };
}
