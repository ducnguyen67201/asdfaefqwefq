import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import type { RustDesktopEngineTransport } from './rust-desktop-engine-client';
import {
  resolveRustDesktopEngineCommand,
  RustDesktopEngineClient,
} from './rust-desktop-engine-client';

function fakeTransport(
  request: RustDesktopEngineTransport['request'],
): RustDesktopEngineTransport {
  return {
    request,
    start: vi.fn(async () => undefined),
    stop: vi.fn(async () => undefined),
  };
}

describe('RustDesktopEngineClient', () => {
  it('requires the Rust health handshake before provider methods', async () => {
    const request = vi.fn(async (method: string) => method === 'health'
      ? {
          engine: 'rust',
          protocolVersion: 1,
          features: ['google_oauth', 'voice'],
        }
      : { status: 200, body: { text: 'hello' } });
    const client = new RustDesktopEngineClient({
      transport: fakeTransport(request),
    });

    await expect(client.validateVoiceCredential('sk-test')).resolves.toMatchObject({
      status: 200,
    });
    expect(request.mock.calls.map(([method]) => method)).toEqual([
      'health',
      'voice.validate_credential',
    ]);
  });

  it('rejects a sidecar that does not advertise every required Rust feature', async () => {
    const client = new RustDesktopEngineClient({
      transport: fakeTransport(vi.fn(async () => ({
        engine: 'rust',
        protocolVersion: 1,
        features: ['voice'],
      }))),
    });

    await expect(client.start()).rejects.toThrow('google_oauth');
  });

  it('resolves native packaged binaries and a Cargo development command', () => {
    expect(resolveRustDesktopEngineCommand({
      enginePath: '/opt/tro/trocode-api',
      isPackaged: false,
      repositoryRoot: '/workspace/TroCode',
      resourcesPath: '/unused',
    })).toEqual({
      executable: '/opt/tro/trocode-api',
      args: ['desktop-engine'],
    });
    expect(resolveRustDesktopEngineCommand({
      isPackaged: true,
      platform: 'win32',
      repositoryRoot: '/workspace/TroCode',
      resourcesPath: 'C:\\Tro\\resources',
    })).toEqual({
      executable: path.join('C:\\Tro\\resources', 'trocode-api.exe'),
      args: ['desktop-engine'],
    });
    expect(resolveRustDesktopEngineCommand({
      cargoExecutable: '/opt/cargo/bin/cargo',
      isPackaged: false,
      repositoryRoot: '/workspace/TroCode',
      resourcesPath: '/unused',
    })).toMatchObject({
      executable: '/opt/cargo/bin/cargo',
      cwd: '/workspace/TroCode',
      args: expect.arrayContaining(['desktop-engine']),
    });
  });
});
