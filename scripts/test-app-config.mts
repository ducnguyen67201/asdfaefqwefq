export const TEST_API_BASE_URL = 'https://api-test-test-d2da.up.railway.app';

/** Fail before launching if Doppler points this test profile at another backend. */
export function testAppEnvironment(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  if (source.TROCODE_API_BASE_URL?.replace(/\/$/u, '') !== TEST_API_BASE_URL) {
    throw new Error(`Doppler tro-app/stg must set TROCODE_API_BASE_URL=${TEST_API_BASE_URL}.`);
  }
  if (!source.GOOGLE_OAUTH_CLIENT_ID?.trim()) {
    throw new Error('Doppler tro-app/stg is missing GOOGLE_OAUTH_CLIENT_ID.');
  }
  const env = { ...source };
  // Only public Tro configuration is needed by the desktop and its build tools.
  for (const key of Object.keys(env)) {
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
