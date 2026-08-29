import { describe, expect, it } from 'vitest';

import { AGENTS_SDK_VERSION, graphVersion, loadConfig } from '../src/config.js';

describe('runtime configuration', () => {
  it('pins the SDK graph and rejects a missing service boundary', () => {
    const first = graphVersion();
    expect(first).toMatch(/^[a-f0-9]{64}$/u);
    expect(graphVersion()).toBe(first);
    expect(() => loadConfig({})).toThrow();
  });

  it('parses a bounded private deployment configuration', () => {
    const config = loadConfig({
      TROCODE_API_BASE_URL: 'https://api.example.com/',
      TROCODE_AGENT_ORCHESTRATOR_SERVICE_TOKEN: 'x'.repeat(32),
    });
    expect(config.apiBaseUrl).toBe('https://api.example.com');
    expect(config.sdkVersion).toBe(AGENTS_SDK_VERSION);
    expect(config.graphVersion).toBe(graphVersion());
    expect(config.healthPort).toBe(8_788);
  });
});
